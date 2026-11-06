import { execFile, spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";

const REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar";
const SERVER_VERSION = "3.1";
const STREAM_START_TIMEOUT_MS = 12000;
const CONNECT_RETRY_MS = 200;
const ADB_COMMAND_TIMEOUT_MS = 8000;
const PUSH_TIMEOUT_MS = 30000;

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

interface PendingReady {
  session: number;
  resolve: () => void;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ScrcpyServerManager extends EventEmitter {
  private adbPath: string;
  private state: MirrorState = "stopped";
  private serverProcess: ChildProcessWithoutNullStreams | null = null;
  private videoSocket: net.Socket | null = null;
  private activeSerial: string | null = null;
  private localPort: number = 0;
  private scid: string = "";

  // Every start/stop gets a new session id. Async continuations and process /
  // socket events from an older session are ignored, so a superseded startup
  // can never tear down or error out the session that replaced it.
  private sessionId: number = 0;
  private startPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private pendingReady: PendingReady | null = null;
  private stderrTail: string[] = [];

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

  public getActiveSerial(): string | null {
    return this.activeSerial;
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

  /**
   * Starts mirroring and resolves only once the video stream is actually
   * flowing. Repeated calls while a start is in flight join that same start;
   * calls while already running are a no-op.
   */
  public start(options: MirrorOptions): Promise<void> {
    if (this.state === "running") return Promise.resolve();
    if (this.state === "starting" && this.startPromise) return this.startPromise;

    const run = this.launch(options);
    const tracked = run.finally(() => {
      if (this.startPromise === tracked) this.startPromise = null;
    });
    this.startPromise = tracked;
    return tracked;
  }

  private async launch(options: MirrorOptions): Promise<void> {
    const serial = options.serial;
    const previousSerial = this.activeSerial;
    const previousPort = this.localPort;
    const previousScid = this.scid;

    this.sessionId += 1;
    const session = this.sessionId;

    this.teardown();
    this.activeSerial = serial;
    this.localPort = 0;
    this.scid = "";
    this.state = "starting";
    this.emit("state-changed", this.state);

    // Clear leftovers from a previous failed session before a new one begins.
    if (previousSerial && previousPort > 0) {
      await this.removeForward(previousSerial, previousPort);
    }
    if (previousSerial && previousScid) {
      this.killRemoteServer(previousSerial, previousScid);
    }
    if (session !== this.sessionId) return;

    let createdForward: { serial: string; port: number } | null = null;

    try {
      const jarPath = this.findServerJar();
      if (!jarPath) {
        throw new Error("scrcpy-server jar not found in assets/.");
      }
      console.log(`[ScrcpyServerManager] Using jar: ${jarPath}`);

      await this.validateDevice(serial);
      this.assertCurrent(session);

      await this.ensureServerJar(serial, jarPath);
      this.assertCurrent(session);

      this.scid = this.makeScid();
      this.resetParser();
      this.stderrTail = [];

      // tcp:0 asks ADB for a free port, so a port collision can never fail a start.
      const portOutput = await this.execAdb([
        "-s", serial,
        "forward", "tcp:0", `localabstract:scrcpy_${this.scid}`,
      ]);

      const port = Number.parseInt(portOutput, 10);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`ADB did not return a forwarding port (output: "${portOutput}").`);
      }

      // Recorded before the cancellation check so an interrupted start still
      // removes the forward it just created.
      createdForward = { serial, port };
      this.assertCurrent(session);
      this.localPort = port;
      console.log(`[ScrcpyServerManager] adb forward: tcp:${port} → scrcpy_${this.scid}`);

      this.spawnServer(session, serial, options);

      const ready = new Promise<void>((resolve) => {
        this.pendingReady = { session, resolve };
      });

      this.startTimer = setTimeout(() => {
        if (session !== this.sessionId) return;
        this.fail(
          session,
          `Stream did not start within ${Math.round(STREAM_START_TIMEOUT_MS / 1000)} s.`
        );
      }, STREAM_START_TIMEOUT_MS);

      this.connectForStream(session);
      await ready;
    } catch (err) {
      if (createdForward) {
        await this.removeForward(createdForward.serial, createdForward.port);
        if (this.localPort === createdForward.port) this.localPort = 0;
      }
      // Superseded by stop() or a newer start: nothing left to report.
      if (session !== this.sessionId) return;
      this.fail(session, toMessage(err));
    }
  }

  private async validateDevice(serial: string): Promise<void> {
    let deviceState = "";
    try {
      deviceState = await this.execAdb(["-s", serial, "get-state"], 5000);
    } catch (err) {
      throw new Error(`Device ${serial} is not reachable over ADB: ${toMessage(err)}`);
    }
    if (deviceState !== "device") {
      throw new Error(`Device ${serial} is not ready (ADB state: ${deviceState || "unknown"}).`);
    }
  }

  private async ensureServerJar(serial: string, jarPath: string): Promise<void> {
    const localSize = fs.statSync(jarPath).size;
    try {
      const remoteSize = Number.parseInt(
        await this.execAdb(["-s", serial, "shell", "stat", "-c", "%s", REMOTE_JAR], 4000),
        10
      );
      if (remoteSize === localSize) {
        console.log("[ScrcpyServerManager] Server jar already up to date on device.");
        return;
      }
    } catch {
      // stat unavailable or file missing – push below
    }

    await this.execAdb(["-s", serial, "push", jarPath, REMOTE_JAR], PUSH_TIMEOUT_MS);
    console.log(`[ScrcpyServerManager] Server jar pushed to ${REMOTE_JAR}`);
  }

  private spawnServer(session: number, serial: string, options: MirrorOptions): void {
    const maxSize = options.maxSize || 1440;
    const bitRate = options.bitRate || 8000000;
    const serverArgs = [
      "-s", serial,
      "shell",
      `CLASSPATH=${REMOTE_JAR}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      SERVER_VERSION,
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

    const process = spawn(this.adbPath, serverArgs, { windowsHide: true });
    this.serverProcess = process;
    console.log(
      `[ScrcpyServerManager] scrcpy-server spawning (scid=${this.scid}, pid=${process.pid ?? "?"})`
    );

    const recordLine = (line: string) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 8) this.stderrTail.shift();
    };

    process.stdout.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log("[scrcpy-server stdout]:", line);
    });

    process.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.log("[scrcpy-server stderr]:", line);
        recordLine(line);
      }
    });

    process.on("error", (err) => {
      if (session !== this.sessionId) return;
      this.fail(session, `Failed to launch scrcpy-server: ${err.message}`);
    });

    process.on("close", (code, signal) => {
      if (session !== this.sessionId) return;
      const how = signal ? `signal ${signal}` : `code ${code}`;
      const tail = this.stderrTail.length
        ? ` Last output: ${this.stderrTail[this.stderrTail.length - 1]}`
        : "";
      this.fail(session, `scrcpy-server exited unexpectedly (${how}).${tail}`);
    });
  }

  /**
   * Connects through the ADB forward. A local TCP accept does not mean the
   * phone side exists yet, so attempts that close before any stream data are
   * retried until the server is actually listening.
   */
  private connectForStream(session: number): void {
    if (session !== this.sessionId) return;

    if (this.localPort <= 0) {
      this.fail(session, "No local forwarding port available for the video stream.");
      return;
    }

    const port = this.localPort;
    const socket = net.createConnection({ host: "127.0.0.1", port });
    this.videoSocket = socket;
    let attemptDone = false;
    let gotData = false;

    const scheduleRetry = (reason: string) => {
      if (attemptDone) return;
      attemptDone = true;
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
      if (this.videoSocket === socket) this.videoSocket = null;
      if (session !== this.sessionId) return;

      console.log(`[ScrcpyServerManager] Stream not ready yet (${reason}); retrying…`);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connectForStream(session);
      }, CONNECT_RETRY_MS);
    };

    socket.once("connect", () => {
      console.log(`[ScrcpyServerManager] Adb forward accepted on 127.0.0.1:${port}, awaiting stream data…`);
    });

    socket.on("data", (chunk: Buffer) => {
      if (session !== this.sessionId) return;
      gotData = true;
      this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
      this.parseStream(session);
    });

    socket.on("error", (err) => {
      scheduleRetry(err.message);
    });

    socket.on("close", () => {
      if (attemptDone) return;
      attemptDone = true;
      if (this.videoSocket === socket) this.videoSocket = null;
      if (session !== this.sessionId) return;

      if (!gotData) {
        if (this.state === "starting") {
          console.log("[ScrcpyServerManager] Forward closed before stream data; retrying…");
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connectForStream(session);
          }, CONNECT_RETRY_MS);
        }
        return;
      }

      this.fail(session, "The video stream connection closed unexpectedly.");
    });
  }

  private fail(session: number, message: string): void {
    if (session !== this.sessionId) return;
    if (this.state !== "starting" && this.state !== "running") return;

    const serial = this.activeSerial;
    const port = this.localPort;
    const scid = this.scid;

    this.sessionId += 1;
    this.teardown();
    this.state = "error";
    console.error("[ScrcpyServerManager]", message);
    this.emit("state-changed", this.state, message);

    if (serial && port > 0) void this.removeForward(serial, port);
    if (serial && scid) this.killRemoteServer(serial, scid);
    this.localPort = 0;
    this.scid = "";
  }

  public async stop(): Promise<void> {
    const serial = this.activeSerial;
    const port = this.localPort;
    const scid = this.scid;

    // Invalidate every in-flight operation before killing anything, so their
    // close/error handlers cannot report a failure for an intentional stop.
    this.sessionId += 1;
    this.startPromise = null;
    this.teardown();
    this.activeSerial = null;
    this.localPort = 0;
    this.scid = "";
    this.state = "stopped";
    this.emit("state-changed", this.state);

    if (serial && port > 0) {
      await this.removeForward(serial, port);
    }
    if (serial && scid) {
      this.killRemoteServer(serial, scid);
    }
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
  private parseStream(session: number): void {
    if (session !== this.sessionId) return;

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
      this.markRunning(session);
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

  /** The stream header is the first real proof that mirroring is live. */
  private markRunning(session: number): void {
    if (session !== this.sessionId) return;
    if (this.state === "running") return;

    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }

    this.state = "running";
    this.emit("state-changed", this.state);
    console.log("[ScrcpyServerManager] Mirroring is live.");

    const ready = this.pendingReady;
    this.pendingReady = null;
    if (ready && ready.session === session) ready.resolve();
  }

  /** Detach and kill the current session's resources. Never emits state. */
  private teardown(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.videoSocket) {
      this.videoSocket.removeAllListeners();
      this.videoSocket.on("error", () => {});
      this.videoSocket.destroy();
      this.videoSocket = null;
    }
    if (this.serverProcess) {
      const process = this.serverProcess;
      this.serverProcess = null;
      try {
        process.kill();
      } catch {
        // already gone
      }
    }

    const ready = this.pendingReady;
    this.pendingReady = null;
    ready?.resolve();

    this.resetParser();
  }

  private resetParser(): void {
    this.rxBuf = Buffer.alloc(0);
    this.headerParsed = false;
    this.savedConfig = null;
    this.videoWidth = 0;
    this.videoHeight = 0;
  }

  private makeScid(): string {
    // Positive hex id ≤ 0x7fffffff avoids Java NumberFormatException
    return Math.floor(Math.random() * 0x7fffffff)
      .toString(16)
      .padStart(8, "0");
  }

  private assertCurrent(session: number): void {
    if (session !== this.sessionId) throw new Error("Startup cancelled.");
  }

  private async removeForward(serial: string, port: number): Promise<void> {
    try {
      await this.execAdb(["-s", serial, "forward", "--remove", `tcp:${port}`], 4000);
    } catch {
      // The forward may already be gone (device unplugged, adb restarted).
    }
  }

  /** Best-effort cleanup of our own server process, matched by unique scid. */
  private killRemoteServer(serial: string, scid: string): void {
    void this.execAdb(["-s", serial, "shell", "pkill", "-f", `scid=${scid}`], 3000).catch(() => {
      // Device gone or pkill unavailable – nothing else to do.
    });
  }

  private execAdb(args: string[], timeoutMs = ADB_COMMAND_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const detail = (stderr || stdout || "").trim() || err.message;
            return reject(new Error(detail));
          }
          resolve(String(stdout).trim());
        }
      );
    });
  }
}
