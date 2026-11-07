import { spawn, exec, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { assetPath } from "../assets";

// Suppress ADB mDNS / network discovery to prevent Windows Defender Firewall prompts.
const ADB_SILENT_ENV = {
  ...process.env,
  ADB_MDNS: "0",
  ADB_MDNS_OPENSCREEN: "0",
  ADB_MDNS_AUTO_CONNECT: "0",
  ADB_SERVER_SOCKET: "tcp:127.0.0.1:5037",
};

export type AdbDeviceState = "device" | "unauthorized" | "offline" | "no-device";

export interface AdbDeviceInfo {
  serial: string;
  state: AdbDeviceState;
  model?: string;
  product?: string;
  device?: string;
  width?: number;
  height?: number;
  isWireless?: boolean;
}

export interface AdbStatusPayload {
  state: AdbDeviceState;
  devices: AdbDeviceInfo[];
  activeDevice: AdbDeviceInfo | null;
}

export class AdbTracker extends EventEmitter {
  private adbPath: string | null = null;
  private trackProcess: ChildProcessWithoutNullStreams | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private running = false;
  private currentStatus: AdbStatusPayload = {
    state: "no-device",
    devices: [],
    activeDevice: null,
  };

  constructor() {
    super();
  }

  /**
   * Find adb binary path from environment, standard Android SDK paths, or system PATH
   */
  public async resolveAdbPath(): Promise<string> {
    if (this.adbPath) return this.adbPath;

    const candidatePaths: string[] = [];

    // Custom environment variable
    if (process.env.ADB_PATH) {
      candidatePaths.push(process.env.ADB_PATH);
    }

    // Platform-tools shipped with the installer. Checked before SDK copies so
    // an installed build always has a working adb without Android Studio.
    candidatePaths.push(
      assetPath("platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
    );

    // Windows local Android SDK platform-tools
    if (process.env.LOCALAPPDATA) {
      candidatePaths.push(
        path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe")
      );
    }

    // Program Files platform-tools
    if (process.env.PROGRAMFILES) {
      candidatePaths.push(
        path.join(process.env.PROGRAMFILES, "Android", "platform-tools", "adb.exe")
      );
    }

    // Check candidate paths on disk
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        this.adbPath = candidate;
        return candidate;
      }
    }

    // Fallback: check if adb is globally available via `where` or `which`
    const isWindows = process.platform === "win32";
    const lookupCmd = isWindows ? "where adb" : "which adb";

    return new Promise((resolve) => {
      exec(lookupCmd, (error, stdout) => {
        if (!error && stdout) {
          const firstLine = stdout.trim().split(/\r?\n/)[0];
          if (firstLine && fs.existsSync(firstLine)) {
            this.adbPath = firstLine;
            return resolve(firstLine);
          }
        }
        // Default fallback string
        const fallback = isWindows ? "adb.exe" : "adb";
        this.adbPath = fallback;
        resolve(fallback);
      });
    });
  }

  /**
   * Start tracking devices via `adb track-devices` and polling fallback.
   * Idempotent: repeated calls never create a second monitor.
   */
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const adb = await this.resolveAdbPath();
    this.runDevicesPoll(adb);
    this.startTrackDevices(adb);

    // Safety poll: catches anything the event stream misses.
    this.pollInterval = setInterval(() => {
      if (this.running) this.runDevicesPoll(adb);
    }, 3000);
  }

  /**
   * Event-driven device feed. If the adb process dies (e.g. adb server was
   * killed), re-attach it so monitoring never silently degrades to polling.
   */
  private startTrackDevices(adb: string): void {
    if (!this.running || this.trackProcess) return;

    const track = spawn(adb, ["track-devices"], {
      env: ADB_SILENT_ENV,
      windowsHide: true,
    });
    this.trackProcess = track;

    track.stdout.on("data", () => {
      // track-devices sends device list updates
      if (this.running) this.runDevicesPoll(adb);
    });

    track.stderr.on("data", (data: Buffer) => {
      console.warn("[ADB Tracker stderr]:", data.toString().trim());
    });

    track.on("error", (err) => {
      console.error("[ADB Tracker error]:", err.message);
      if (this.trackProcess === track) this.trackProcess = null;
    });

    track.on("close", () => {
      if (this.trackProcess === track) this.trackProcess = null;
      if (!this.running) return;
      setTimeout(() => this.startTrackDevices(adb), 1000);
    });
  }

  /**
   * Stop tracking
   */
  public stop(): void {
    this.running = false;
    if (this.trackProcess) {
      this.trackProcess.removeAllListeners();
      this.trackProcess.kill();
      this.trackProcess = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get current cached status
   */
  public getStatus(): AdbStatusPayload {
    return this.currentStatus;
  }

  /**
   * Query screen physical resolution for a device
   */
  public async getScreenSize(serial: string): Promise<{ width: number; height: number } | null> {
    const adb = await this.resolveAdbPath();
    return new Promise((resolve) => {
      exec(
        `"${adb}" -s ${serial} shell wm size`,
        { env: ADB_SILENT_ENV, windowsHide: true },
        (err, stdout) => {
        if (err || !stdout) {
          return resolve(null);
        }
        // Output format: "Physical size: 1080x2400"
        const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
        if (match && match[1] && match[2]) {
          const width = parseInt(match[1], 10);
          const height = parseInt(match[2], 10);
          return resolve({ width, height });
        }
        resolve(null);
      });
    });
  }

  /**
   * Get device's local Wi-Fi IP address
   */
  public async getDeviceIp(serial: string): Promise<string | null> {
    const adb = await this.resolveAdbPath();
    const run = (cmd: string) =>
      new Promise<string>((resolve) => {
        exec(cmd, { env: ADB_SILENT_ENV, windowsHide: true }, (_err, stdout) => {
          resolve(stdout ? stdout.trim() : "");
        });
      });

    // 1. Try wlan0 / wlan1 / swlan0 inet addr directly
    for (const iface of ["wlan0", "wlan1", "swlan0", "eth0"]) {
      const addrOutput = await run(`"${adb}" -s ${serial} shell ip -f inet addr show ${iface}`);
      const match = addrOutput.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      if (match && match[1] && !match[1].startsWith("127.")) {
        console.log(`[AdbTracker] Found IP via ${iface}:`, match[1]);
        return match[1];
      }
    }

    // 2. Scan all interfaces from "ip -f inet addr", prioritizing wlan/wifi interfaces
    const allAddrOutput = await run(`"${adb}" -s ${serial} shell ip -f inet addr`);
    if (allAddrOutput) {
      const wlanMatch = allAddrOutput.match(/(?:wlan\d*|swlan\d*|wifi\d*)[\s\S]*?inet\s+(\d+\.\d+\.\d+\.\d+)/i);
      if (wlanMatch && wlanMatch[1] && !wlanMatch[1].startsWith("127.")) {
        console.log("[AdbTracker] Found IP via wlan block in ip addr:", wlanMatch[1]);
        return wlanMatch[1];
      }
    }

    // 3. Try ip route for wlan/wifi routes
    const routeOutput = await run(`"${adb}" -s ${serial} shell ip route`);
    if (routeOutput) {
      const wlanRoute =
        routeOutput.match(/(?:wlan\d*|swlan\d*|wifi\d*)[\s\S]*?src\s+(\d+\.\d+\.\d+\.\d+)/i) ||
        routeOutput.match(/src\s+(\d+\.\d+\.\d+\.\d+)[\s\S]*?(?:wlan\d*|swlan\d*|wifi\d*)/i);
      if (wlanRoute && wlanRoute[1] && !wlanRoute[1].startsWith("127.")) {
        console.log("[AdbTracker] Found IP via wlan route:", wlanRoute[1]);
        return wlanRoute[1];
      }
    }

    // 4. Try Android 11+ "cmd wifi status"
    const wifiStatus = await run(`"${adb}" -s ${serial} shell cmd wifi status`);
    const wifiStatusMatch = wifiStatus.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/i);
    if (wifiStatusMatch && wifiStatusMatch[1] && !wifiStatusMatch[1].startsWith("127.")) {
      console.log("[AdbTracker] Found IP via cmd wifi status:", wifiStatusMatch[1]);
      return wifiStatusMatch[1];
    }

    // 5. Try system properties
    for (const prop of ["dhcp.wlan0.ipaddress", "dhcp.wlan1.ipaddress", "wifi.interface.ip"]) {
      const propOutput = await run(`"${adb}" -s ${serial} shell getprop ${prop}`);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(propOutput) && !propOutput.startsWith("127.")) {
        console.log(`[AdbTracker] Found IP via getprop ${prop}:`, propOutput);
        return propOutput;
      }
    }

    // 6. Fallback: Any private RFC 1918 address (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (allAddrOutput) {
      const privateMatch = allAddrOutput.match(/inet\s+(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/);
      if (privateMatch && privateMatch[1]) {
        console.log("[AdbTracker] Found IP via private address fallback:", privateMatch[1]);
        return privateMatch[1];
      }
    }

    return null;
  }

  /**
   * Enable wireless debugging on a USB-connected device and connect to it
   */
  public async enableWireless(
    serial: string
  ): Promise<{ success: boolean; ip?: string; error?: string }> {
    const adb = await this.resolveAdbPath();
    const run = (cmd: string) =>
      new Promise<string>((resolve, reject) => {
        exec(cmd, { env: ADB_SILENT_ENV, windowsHide: true }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || stdout || err.message));
          resolve(stdout ? stdout.trim() : "");
        });
      });

    try {
      console.log(`[AdbTracker] Enabling wireless for device ${serial}...`);
      // 1. Query device IP before switching tcpip
      const ip = await this.getDeviceIp(serial);
      if (!ip) {
        return {
          success: false,
          error: "Could not find your phone's Wi-Fi IP address. Please ensure your phone is connected to the same Wi-Fi network as this PC.",
        };
      }

      console.log(`[AdbTracker] Phone IP is ${ip}. Setting tcpip 5555 on ${serial}...`);
      // 2. Restart adbd in TCP mode on port 5555
      try {
        await run(`"${adb}" -s ${serial} tcpip 5555`);
      } catch (tcpErr: any) {
        console.warn(`[AdbTracker] tcpip notice:`, tcpErr?.message);
      }

      // 3. Wait for adbd to restart on the device
      await new Promise((r) => setTimeout(r, 2500));

      console.log(`[AdbTracker] Connecting to ${ip}:5555...`);
      // 4. Connect to the device IP, with up to 3 attempts
      let connectResult = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          connectResult = await run(`"${adb}" connect ${ip}:5555`);
          console.log(`[AdbTracker] adb connect attempt ${attempt + 1}: ${connectResult}`);
        } catch (e: any) {
          connectResult = e?.message || "";
          console.log(`[AdbTracker] adb connect attempt ${attempt + 1} error: ${connectResult}`);
        }
        const lower = connectResult.toLowerCase();
        if (
          (lower.includes("connected to") || lower.includes("already connected")) &&
          !lower.includes("cannot") &&
          !lower.includes("failed") &&
          !lower.includes("unable")
        ) {
          break; // success
        }
        // Wait before retry
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }

      const lower = connectResult.toLowerCase();
      if (
        (!lower.includes("connected to") && !lower.includes("already connected")) ||
        lower.includes("cannot") ||
        lower.includes("failed") ||
        lower.includes("unable")
      ) {
        return {
          success: false,
          error: connectResult || `Could not connect to ${ip}:5555. Check that your phone and PC are on the same Wi-Fi.`,
          ip,
        };
      }

      // Trigger immediate poll so active device updates to the wireless serial
      this.runDevicesPoll(adb);
      return { success: true, ip };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Connect to an existing wireless debugging address (e.g. 192.168.1.50:5555 or Android 11+ pairing port)
   */
  public async connectWireless(target: string): Promise<{ success: boolean; message: string }> {
    const adb = await this.resolveAdbPath();
    let addr = target.trim();
    if (!addr) return { success: false, message: "Target IP/host cannot be empty." };
    if (!addr.includes(":")) addr = `${addr}:5555`;

    return new Promise((resolve) => {
      exec(
        `"${adb}" connect ${addr}`,
        { env: ADB_SILENT_ENV, windowsHide: true },
        (_err, stdout, stderr) => {
          const out = (stdout || stderr || "").trim();
          const lower = out.toLowerCase();
          const success =
            (lower.includes("connected to") || lower.includes("already connected")) &&
            !lower.includes("cannot connect") &&
            !lower.includes("failed") &&
            !lower.includes("unable");
          if (success) {
            this.runDevicesPoll(adb);
          }
          resolve({
            success,
            message: out || (success ? `Connected to ${addr}` : "Failed to connect"),
          });
        }
      );
    });
  }

  /**
   * Disconnect from a wireless target
   */
  public async disconnectWireless(target: string): Promise<{ success: boolean; message: string }> {
    const adb = await this.resolveAdbPath();
    return new Promise((resolve) => {
      exec(
        `"${adb}" disconnect ${target.trim()}`,
        { env: ADB_SILENT_ENV, windowsHide: true },
        (_err, stdout, stderr) => {
          const out = (stdout || stderr || "").trim();
          this.runDevicesPoll(adb);
          resolve({ success: true, message: out || `Disconnected ${target}` });
        }
      );
    });
  }

  /**
   * Pair a wireless debugging device via 6-digit code (Android 11+)
   * and optionally connect immediately.
   */
  public async pairWireless(
    target: string,
    code: string,
    connectPort?: string
  ): Promise<{ success: boolean; message: string }> {
    const adb = await this.resolveAdbPath();
    const addr = target.trim();
    const pairingCode = code.trim();
    if (!addr || !pairingCode) {
      return { success: false, message: "IP:Port and Pairing Code are required." };
    }

    return new Promise((resolve) => {
      exec(
        `"${adb}" pair ${addr} ${pairingCode}`,
        { env: ADB_SILENT_ENV, windowsHide: true },
        async (_err, stdout, stderr) => {
          const out = (stdout || stderr || "").trim();
          const lower = out.toLowerCase();
          const success =
            (lower.includes("successfully paired") || lower.includes("paired to")) &&
            !lower.includes("failed");

          if (!success) {
            return resolve({
              success: false,
              message:
                out ||
                "Pairing failed. Make sure the 'Pair with pairing code' popup is still visible on your phone.",
            });
          }

          // Extract IP from target (e.g. "192.168.1.15" from "192.168.1.15:37829")
          const ipMatch = addr.match(/^(\d+\.\d+\.\d+\.\d+)/);
          const ip = ipMatch ? ipMatch[1] : addr.split(":")[0];

          // If a specific connect port is supplied, connect to it
          if (connectPort && connectPort.trim()) {
            const port = connectPort.trim();
            const connectTarget = port.includes(":") ? port : `${ip}:${port}`;
            const connRes = await this.connectWireless(connectTarget);
            return resolve({
              success: connRes.success,
              message: connRes.success
                ? `Paired & connected to ${connectTarget}!`
                : `Paired with ${addr}, but connection to ${connectTarget} failed: ${connRes.message}`,
            });
          }

          // Otherwise attempt standard port 5555 first
          const defaultConn = await this.connectWireless(`${ip}:5555`);
          if (defaultConn.success) {
            return resolve({
              success: true,
              message: `Paired and connected to ${ip}:5555! Ready to mirror.`,
            });
          }

          resolve({
            success: true,
            message: `Successfully paired with ${addr}! Enter the Connect Port shown on your phone's Wireless debugging screen to complete connection.`,
          });
        }
      );
    });
  }

  /**
   * Poll active devices with `adb devices -l` to get rich metadata
   */
  private runDevicesPoll(adb: string): void {
    exec(`"${adb}" devices -l`, { env: ADB_SILENT_ENV, windowsHide: true }, async (err, stdout) => {
      if (err) {
        this.updateStatus({
          state: "no-device",
          devices: [],
          activeDevice: null,
        });
        return;
      }

      const devices = this.parseDevicesOutput(stdout);

      let overallState: AdbDeviceState = "no-device";
      let active: AdbDeviceInfo | null = null;

      if (devices.length > 0) {
        // Prefer wireless device when both USB and WiFi are present —
        // this ensures that after enableWireless() the WiFi serial becomes active.
        const authorizedDevices = devices.filter((d) => d.state === "device");
        const wirelessAuthorized = authorizedDevices.find((d) => d.isWireless);
        const authorizedDevice = wirelessAuthorized ?? authorizedDevices[0];
        const unauthorizedDevice = devices.find((d) => d.state === "unauthorized");

        if (authorizedDevice) {
          overallState = "device";
          active = authorizedDevice;
          // Retrieve screen dimensions if not yet populated
          if (!active.width || !active.height) {
            const size = await this.getScreenSize(active.serial);
            if (size) {
              active.width = size.width;
              active.height = size.height;
            }
          }
        } else if (unauthorizedDevice) {
          overallState = "unauthorized";
          active = unauthorizedDevice;
        } else {
          overallState = devices[0].state;
          active = devices[0];
        }
      }

      this.updateStatus({
        state: overallState,
        devices,
        activeDevice: active,
      });
    });
  }

  /**
   * Parse `adb devices -l` output text
   */
  private parseDevicesOutput(output: string): AdbDeviceInfo[] {
    const lines = output.split(/\r?\n/);
    const devices: AdbDeviceInfo[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("List of devices")) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const stateStr = parts[1];
        let state: AdbDeviceState = "offline";

        if (stateStr === "device") state = "device";
        else if (stateStr === "unauthorized") state = "unauthorized";
        else if (stateStr === "offline") state = "offline";

        const isWireless = serial.includes(":") || /^\d+\.\d+\.\d+\.\d+/.test(serial);
        const info: AdbDeviceInfo = { serial, state, isWireless };

        for (let i = 2; i < parts.length; i++) {
          const item = parts[i];
          if (item.startsWith("model:")) info.model = item.replace("model:", "").replace(/_/g, " ");
          if (item.startsWith("product:")) info.product = item.replace("product:", "");
          if (item.startsWith("device:")) info.device = item.replace("device:", "");
        }

        devices.push(info);
      }
    }

    return devices;
  }

  private updateStatus(newStatus: AdbStatusPayload): void {
    const prev = JSON.stringify(this.currentStatus);
    const next = JSON.stringify(newStatus);
    if (prev !== next) {
      this.currentStatus = newStatus;
      this.emit("status-changed", this.currentStatus);
    }
  }
}

