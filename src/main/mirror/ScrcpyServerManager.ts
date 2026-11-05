import { exec, spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";

export interface MirrorOptions {
  serial: string;
  maxSize?: number;
  bitRate?: number;
  maxFps?: number;
}

export type MirrorState = "stopped" | "starting" | "running" | "error";

export class ScrcpyServerManager extends EventEmitter {
  private adbPath: string;
  private state: MirrorState = "stopped";
  private serverProcess: ChildProcessWithoutNullStreams | null = null;
  private videoSocket: net.Socket | null = null;
  private activeSerial: string | null = null;
  private localPort: number = 27183;
  private scid: string = "01234567";

  constructor(adbPath: string) {
    super();
    this.adbPath = adbPath;
  }

  public setAdbPath(adbPath: string): void {
    this.adbPath = adbPath;
  }

  public getState(): MirrorState {
    return this.state;
  }

  /**
   * Locate the scrcpy-server jar on disk
   */
  public findServerJar(): string | null {
    const candidates = [
      path.join(process.cwd(), "assets", "scrcpy-server.jar"),
      path.join(process.cwd(), "assets", "scrcpy-server"),
      path.join(
        process.cwd(),
        "scrcpy-master",
        "scrcpy-master",
        "server",
        "build",
        "outputs",
        "apk",
        "release",
        "server-release-unsigned.apk"
      ),
      path.join(
        process.cwd(),
        "reference",
        "scrcpy",
        "server",
        "build",
        "outputs",
        "apk",
        "release",
        "server-release-unsigned.apk"
      ),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    return null;
  }

  /**
   * Start a mirror session for a given device serial
   */
  public async start(options: MirrorOptions): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      await this.stop();
    }

    this.state = "starting";
    this.activeSerial = options.serial;
    this.emit("state-changed", this.state);

    const jarPath = this.findServerJar();
    if (!jarPath) {
      console.warn("[ScrcpyServerManager] scrcpy-server.jar not yet found on disk.");
      this.state = "error";
      this.emit("state-changed", this.state, "scrcpy-server.jar binary missing");
      return;
    }

    try {
      // 1. Push server jar to device /data/local/tmp/
      await this.execAdb(`-s ${options.serial} push "${jarPath}" /data/local/tmp/scrcpy-server.jar`);

      // 2. Set up adb forward tunnel
      this.localPort = 27183 + Math.floor(Math.random() * 100);
      this.scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, "0");
      await this.execAdb(`-s ${options.serial} forward tcp:${this.localPort} localabstract:scrcpy_${this.scid}`);

      // 3. Launch scrcpy-server via adb shell app_process
      const maxSize = options.maxSize || 1920;
      const serverVersion = jarPath.includes("5.0") ? "5.0.1" : "3.1";
      const serverArgs = [
        "-s",
        options.serial,
        "shell",
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        serverVersion,
        `scid=${this.scid}`,
        "tunnel_forward=true",
        "audio=false",
        "control=false",
        "raw_stream=true",
        `max_size=${maxSize}`,
      ];

      this.serverProcess = spawn(this.adbPath, serverArgs);

      this.serverProcess.stderr.on("data", (data: Buffer) => {
        console.log("[scrcpy-server stderr]:", data.toString().trim());
      });

      this.serverProcess.stdout.on("data", (data: Buffer) => {
        console.log("[scrcpy-server stdout]:", data.toString().trim());
      });

      this.serverProcess.on("close", (code) => {
        console.log(`[scrcpy-server] process exited with code ${code}`);
        this.cleanup();
      });

      // 4. Connect to forwarded TCP port (with brief retry delay)
      setTimeout(() => {
        this.connectVideoSocket();
      }, 600);
    } catch (err: unknown) {
      console.error("[ScrcpyServerManager start error]:", err);
      this.state = "error";
      this.emit("state-changed", this.state, String(err));
    }
  }

  /**
   * Stop current mirror session and clean up
   */
  public async stop(): Promise<void> {
    this.cleanup();
    if (this.activeSerial) {
      try {
        await this.execAdb(`-s ${this.activeSerial} forward --remove tcp:${this.localPort}`);
      } catch {
        // ignore
      }
      this.activeSerial = null;
    }
    this.state = "stopped";
    this.emit("state-changed", this.state);
  }

  private connectVideoSocket(retries = 5): void {
    const socket = net.createConnection({ host: "127.0.0.1", port: this.localPort }, () => {
      console.log(`[ScrcpyServerManager] Video socket connected on 127.0.0.1:${this.localPort}`);
      this.state = "running";
      this.emit("state-changed", this.state);
    });

    socket.on("data", (chunk: Buffer) => {
      // Forward raw H.264 stream packet to renderer
      this.emit("video-chunk", chunk);
    });

    socket.on("error", (err) => {
      if (retries > 0 && this.state === "starting") {
        setTimeout(() => this.connectVideoSocket(retries - 1), 400);
      } else {
        console.error("[ScrcpyServerManager socket error]:", err);
        this.state = "error";
        this.emit("state-changed", this.state, err.message);
      }
    });

    socket.on("close", () => {
      this.cleanup();
    });

    this.videoSocket = socket;
  }

  private cleanup(): void {
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  private execAdb(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`"${this.adbPath}" ${cmd}`, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || stdout || err.message));
        resolve(stdout.trim());
      });
    });
  }
}
