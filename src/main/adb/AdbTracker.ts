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

    // 1. Try wlan0 inet addr
    const addrOutput = await run(`"${adb}" -s ${serial} shell ip -f inet addr show wlan0`);
    const match1 = addrOutput.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match1 && match1[1] && !match1[1].startsWith("127.")) return match1[1];

    // 2. Try any non-loopback inet interface
    const allAddrOutput = await run(`"${adb}" -s ${serial} shell ip -f inet addr`);
    const matchAll = allAddrOutput.match(/inet\s+(?!127\.)(\d+\.\d+\.\d+\.\d+)/);
    if (matchAll && matchAll[1]) return matchAll[1];

    // 3. Try ip route
    const routeOutput = await run(`"${adb}" -s ${serial} shell ip route`);
    const match2 = routeOutput.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match2 && match2[1] && !match2[1].startsWith("127.")) return match2[1];

    // 4. Try dhcp property
    const propOutput = await run(`"${adb}" -s ${serial} shell getprop dhcp.wlan0.ipaddress`);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(propOutput)) return propOutput;

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
      // 1. Query device IP before switching tcpip
      const ip = await this.getDeviceIp(serial);
      if (!ip) {
        return {
          success: false,
          error: "Could not find a Wi-Fi IP address on the phone. Make sure your phone is connected to Wi-Fi.",
        };
      }

      // 2. Restart adbd in TCP mode on port 5555
      await run(`"${adb}" -s ${serial} tcpip 5555`);

      // 3. Short pause for adbd to restart on the device
      await new Promise((r) => setTimeout(r, 1500));

      // 4. Connect to the device IP
      const connectResult = await run(`"${adb}" connect ${ip}:5555`);
      if (
        connectResult.toLowerCase().includes("cannot") ||
        connectResult.toLowerCase().includes("failed")
      ) {
        return { success: false, error: connectResult, ip };
      }

      // Trigger immediate poll
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
          const success = out.toLowerCase().includes("connected to");
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
   */
  public async pairWireless(
    target: string,
    code: string
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
        (_err, stdout, stderr) => {
          const out = (stdout || stderr || "").trim();
          const success =
            out.toLowerCase().includes("successfully paired") ||
            out.toLowerCase().includes("paired to");
          resolve({
            success,
            message: out || (success ? `Paired with ${addr}` : "Pairing failed"),
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
        const authorizedDevice = devices.find((d) => d.state === "device");
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

