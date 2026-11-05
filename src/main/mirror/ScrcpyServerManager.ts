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

export interface VideoInitPayload {
  codec: string;
  width: number;
  height: number;
}

export class ScrcpyServerManager extends EventEmitter {
  private adbPath: string;
  private state: MirrorState = "stopped";
  private serverProcess: ChildProcessWithoutNullStreams | null = null;
  private videoSocket: net.Socket | null = null;
  private activeSerial: string | null = null;
  private localPort: number = 27183;
  private scid: string = "01234567";

  // Stream parser state
  private rxBuf: Buffer = Buffer.alloc(0);
  private headerParsed: boolean = false;
  private savedConfig: Buffer | null = null;
  private videoWidth: number = 0;
  private videoHeight: number = 0;
  private codecId: string = "h264";

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

  public findServerJar(): string | null {
    const candidates = [
      path.join(process.cwd(), "assets", "scrcpy-server-v3.1.jar"),
      path.join(process.cwd(), "assets", "scrcpy-server.jar"),
      path.join(process.cwd(), "assets", "scrcpy-server"),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    return null;
  }

  public async start(options: MirrorOptions): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      await this.stop();
    }

    this.state = "starting";
    this.activeSerial = options.serial;
    this.emit("state-changed", this.state);

    const jarPath = this.findServerJar();
    if (!jarPath) {
      const msg = "scrcpy-server jar not found in assets/.";
      console.error("[ScrcpyServerManager]", msg);
      this.state = "error";
      this.emit("state-changed", this.state, msg);
      return;
    }

    console.log(`[ScrcpyServerManager] Using jar: ${jarPath}`);

    try {
      // 1. Push server jar to device
      await this.execAdb(`-s ${options.serial} push "${jarPath}" /data/local/tmp/scrcpy-server.jar`);
      console.log("[ScrcpyServerManager] Server jar pushed to /data/local/tmp/scrcpy-server.jar");

      // 2. Generate random safe port & positive hex scid (<= 0x7fffffff to avoid Java NumberFormatException)
      this.localPort = 27183 + Math.floor(Math.random() * 200);
      this.scid = Math.floor(Math.random() * 0x7fffffff)
        .toString(16)
        .padStart(8, "0");

      // 3. Set up ADB port forwarding
      await this.execAdb(
        `-s ${options.serial} forward tcp:${this.localPort} localabstract:scrcpy_${this.scid}`
      );
      console.log(`[ScrcpyServerManager] adb forward: tcp:${this.localPort} → scrcpy_${this.scid}`);

      // 4. Reset stream parser state
      this.rxBuf = Buffer.alloc(0);
      this.headerParsed = false;
      this.savedConfig = null;
      this.videoWidth = 0;
      this.videoHeight = 0;
      this.codecId = "h264";

      // 5. Launch scrcpy-server
      //    - send_device_meta=false ensures no 64-byte ASCII device header shifts the stream
      //    - max_size ensures crisp high definition without straining USB
      const maxSize = options.maxSize || 1440;
      const bitRate = options.bitRate || 8000000;
      const serverArgs = [
        "-s", options.serial,
        "shell",
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        "3.1",
        `scid=${this.scid}`,
        "tunnel_forward=true",
        "audio=false",
        "control=false",
        "send_device_meta=false",
        `max_size=${maxSize}`,
        `video_bit_rate=${bitRate}`,
      ];

      if (options.maxFps) {
        serverArgs.push(`max_fps=${options.maxFps}`);
      }

      this.serverProcess = spawn(this.adbPath, serverArgs);

      this.serverProcess.stderr.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log("[scrcpy-server stderr]:", line);
      });

      this.serverProcess.stdout.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log("[scrcpy-server stdout]:", line);
      });

      this.serverProcess.on("close", (code) => {
        console.log(`[scrcpy-server] process exited with code ${code}`);
        this.cleanup();
        if (this.state !== "stopped") {
          this.state = "error";
          this.emit("state-changed", this.state, `Server exited with code ${code}`);
        }
      });

      // 6. Connect after giving the server time to bind the local abstract socket
      setTimeout(() => {
        this.connectVideoSocket();
      }, 1200);

    } catch (err: unknown) {
      console.error("[ScrcpyServerManager start error]:", err);
      this.state = "error";
      this.emit("state-changed", this.state, String(err));
    }
  }

  public async stop(): Promise<void> {
    const serial = this.activeSerial;
    const port   = this.localPort;

    this.cleanup();

    if (serial) {
      try {
        await this.execAdb(`-s ${serial} forward --remove tcp:${port}`);
      } catch {
        // ignore – forward may already be removed
      }
      this.activeSerial = null;
    }

    this.state = "stopped";
    this.emit("state-changed", this.state);
  }

  private connectVideoSocket(retries = 8): void {
    const socket = net.createConnection({ host: "127.0.0.1", port: this.localPort });

    socket.on("connect", () => {
      console.log(`[ScrcpyServerManager] Video socket connected on 127.0.0.1:${this.localPort}`);
      this.state = "running";
      this.emit("state-changed", this.state);
    });

    socket.on("data", (chunk: Buffer) => {
      this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
      this.parseStream();
    });

    socket.on("error", (err) => {
      if (retries > 0 && (this.state === "starting" || this.state === "running")) {
        console.log(`[ScrcpyServerManager] Socket error (${err.message}), retrying (${retries} left)…`);
        setTimeout(() => this.connectVideoSocket(retries - 1), 500);
      } else {
        console.error("[ScrcpyServerManager] Socket error:", err);
        this.state = "error";
        this.emit("state-changed", this.state, err.message);
      }
    });

    socket.on("close", () => {
      console.log("[ScrcpyServerManager] Video socket closed.");
      if (this.state === "running") {
        this.cleanup();
        this.state = "stopped";
        this.emit("state-changed", this.state);
      }
    });

    this.videoSocket = socket;
  }

  /**
   * Parse scrcpy stream packets:
   * 1. 13-byte initial stream header:
   *    - 1 byte dummy connection sentinel (0x00)
   *    - 4 bytes codec ID ("h264")
   *    - 4 bytes initial width (BE uint32)
   *    - 4 bytes initial height (BE uint32)
   * 2. 12-byte per-frame packet header:
   *    - 8 bytes PTS and flags (bit 63 = config/session, bit 62 = keyframe)
   *    - 4 bytes packet size (BE uint32)
   *    - Followed by [packet_size] bytes of Annex-B payload.
   */
  private parseStream(): void {
    // Step 1: parse 13-byte stream header
    if (!this.headerParsed) {
      if (this.rxBuf.length < 13) return;

      const dummy = this.rxBuf[0];
      this.codecId = this.rxBuf.subarray(1, 5).toString("ascii");
      this.videoWidth = this.rxBuf.readUInt32BE(5);
      this.videoHeight = this.rxBuf.readUInt32BE(9);

      console.log(
        `[ScrcpyServerManager] Stream initialized: dummy=0x${dummy.toString(16)} codec=${this.codecId} resolution=${this.videoWidth}×${this.videoHeight}`
      );

      this.emit("video-init", {
        codec: this.codecId,
        width: this.videoWidth,
        height: this.videoHeight,
      });

      this.rxBuf = this.rxBuf.subarray(13);
      this.headerParsed = true;
    }

    // Step 2: parse framed video packets
    while (this.rxBuf.length >= 12) {
      const flagsByte = this.rxBuf[0];
      const isConfigOrSession = (flagsByte & 0x80) !== 0;
      const isKey = (flagsByte & 0x40) !== 0;

      const ptsLow = this.rxBuf.readUInt32BE(4);
      const packetSize = this.rxBuf.readUInt32BE(8);

      // Check if this is a 12-byte session resize event:
      // (ptsLow carries the new width > 0, packetSize carries new height > 0)
      if (isConfigOrSession && ptsLow > 0) {
        this.videoWidth = ptsLow;
        this.videoHeight = packetSize;
        console.log(`[ScrcpyServerManager] Stream resized: ${this.videoWidth}×${this.videoHeight}`);
        this.emit("video-init", {
          codec: this.codecId,
          width: this.videoWidth,
          height: this.videoHeight,
        });
        this.rxBuf = this.rxBuf.subarray(12);
        continue;
      }

      // Normal packet payload check
      if (this.rxBuf.length < 12 + packetSize) {
        break; // wait for full payload
      }

      const payload = this.rxBuf.subarray(12, 12 + packetSize);
      this.rxBuf = this.rxBuf.subarray(12 + packetSize);

      if (isConfigOrSession) {
        // Save SPS/PPS config to prepend to the subsequent keyframe
        this.savedConfig = Buffer.from(payload);

        // Check if SPS gives us an exact codec profile
        const spsIdx = payload.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67]));
        if (spsIdx !== -1 && payload.length >= spsIdx + 8) {
          const profile = payload[spsIdx + 5].toString(16).padStart(2, "0");
          const constraint = payload[spsIdx + 6].toString(16).padStart(2, "0");
          const level = payload[spsIdx + 7].toString(16).padStart(2, "0");
          const codecMime = `avc1.${profile}${constraint}${level}`;
          this.emit("video-codec", codecMime);
        }
        continue;
      }

      let nalData = payload;
      if (isKey) {
        if (this.savedConfig) {
          // Prepend SPS & PPS to the IDR keyframe access unit for WebCodecs
          nalData = Buffer.concat([this.savedConfig, payload]);
        }
      }

      // Tag byte: 1 = keyframe, 0 = delta frame
      const out = Buffer.alloc(1 + nalData.length);
      out[0] = isKey ? 1 : 0;
      nalData.copy(out, 1);

      this.emit("video-chunk", out);
    }
  }

  private cleanup(): void {
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = null;
    }
    if (this.serverProcess) {
      try { this.serverProcess.kill(); } catch { /* ignore */ }
      this.serverProcess = null;
    }
    this.rxBuf = Buffer.alloc(0);
    this.headerParsed = false;
    this.savedConfig = null;
    this.videoWidth = 0;
    this.videoHeight = 0;
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
