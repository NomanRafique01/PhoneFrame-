import { spawn, exec, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";

export type AdbDeviceState = "device" | "unauthorized" | "offline" | "no-device";

export interface AdbDeviceInfo {
  serial: string;
  state: AdbDeviceState;
  model?: string;
  product?: string;
  device?: string;
  width?: number;
  height?: number;
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
   * Start tracking devices via `adb track-devices` and polling fallback
   */
  public async start(): Promise<void> {
    const adb = await this.resolveAdbPath();

    this.runDevicesPoll(adb);

    try {
      this.trackProcess = spawn(adb, ["track-devices"]);

      let buffer = "";
      this.trackProcess.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        // track-devices sends device list updates
        this.runDevicesPoll(adb);
      });

      this.trackProcess.stderr.on("data", (data: Buffer) => {
        console.warn("[ADB Tracker stderr]:", data.toString().trim());
      });

      this.trackProcess.on("close", () => {
        this.trackProcess = null;
      });
    } catch (err) {
      console.error("[ADB Tracker spawn error]:", err);
    }

    // Periodic safety poll every 3 seconds
    this.pollInterval = setInterval(() => {
      this.runDevicesPoll(adb);
    }, 3000);
  }

  /**
   * Stop tracking
   */
  public stop(): void {
    if (this.trackProcess) {
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
      exec(`"${adb}" -s ${serial} shell wm size`, (err, stdout) => {
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
   * Poll active devices with `adb devices -l` to get rich metadata
   */
  private runDevicesPoll(adb: string): void {
    exec(`"${adb}" devices -l`, async (err, stdout) => {
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

        const info: AdbDeviceInfo = { serial, state };

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

