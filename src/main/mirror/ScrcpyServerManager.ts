import { execFile, spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as net from "node:net";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { encodeControlInput } from "./controlMessages";
import { assetPath } from "../assets";

const REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar";
const SERVER_VERSION = "3.1";
const STREAM_START_TIMEOUT_MS = 12000;
const CONNECT_RETRY_MS = 200;
const ADB_COMMAND_TIMEOUT_MS = 8000;
const PUSH_TIMEOUT_MS = 30000;
const VOLUME_DEBOUNCE_MS = 60;
const STREAM_MUSIC = "3";

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

export interface AudioInitPayload {
  codec: string;
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
  private audioSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;
  private controlConnectStarted = false;
  private audioConnectStarted = false;
  private activeSerial: string | null = null;
  private localPort: number = 0;
  private scid: string = "";
  private deviceSdk: number | null = null;

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

  // Audio stream parser state
  private audioRxBuf: Buffer = Buffer.alloc(0);
  private audioHeaderParsed: boolean = false;
  private audioDisabled: boolean = false;
  private audioCodec: string = "opus";

  // Renderer audio settings. With playback capture the phone keeps rendering
  // its own audio (audio_dup), so exclusive routing is done by moving the
  // phone's real STREAM_MUSIC volume: 0 while the desktop is listening, the
  // slider level while the desktop is muted.
  private desiredAudioMuted: boolean = false;
  private desiredAudioLevel: number = 1;
  private phoneVolumeMax: number | null = null;
  private phoneOriginalVolume: number | null = null;
  private appliedPhoneVolume: number | null = null;
  private pendingPhoneVolume: number | null = null;
  private volumeTimer: NodeJS.Timeout | null = null;
  private volumeGeneration: number = 0;
  private volumeChain: Promise<void> = Promise.resolve();

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
      assetPath("scrcpy-server-v3.1.jar"),
      assetPath("scrcpy-server.jar"),
      assetPath("scrcpy-server"),
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
    // Restore the phone's own media volume before this session imposes its
    // routing, otherwise a superseded session's "desktop is listening" mute
    // would leak into the new one.
    await this.restorePhoneVolume(previousSerial);
    if (session !== this.sessionId) return;

    this.activeSerial = serial;
    this.localPort = 0;
    this.scid = "";
    this.deviceSdk = null;
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

      // Android 13+ can capture playback while keeping the speaker active
      // (audio_source=playback + audio_dup). Older devices use the default
      // output capture, which takes over the device's audio route.
      this.deviceSdk = await this.getDeviceSdk(serial);
      this.assertCurrent(session);

      // Playback capture keeps the phone rendering its own audio, so the
      // phone's real media volume is the routing switch. Capture the user's
      // level now so it can be restored when mirroring ends.
      if (this.deviceSdk !== null && this.deviceSdk >= 33) {
        // Wait for any queued volume write from a previous session first, so
        // the captured "original" is never that session's routing value.
        await this.volumeChain;
        this.assertCurrent(session);
        const volume = await this.readStreamMusicVolume(serial);
        this.assertCurrent(session);
        if (volume) {
          this.phoneVolumeMax = volume.max;
          this.phoneOriginalVolume = volume.current;
          this.appliedPhoneVolume = volume.current;
          console.log(
            `[ScrcpyServerManager] Phone media volume ${volume.current}/${volume.max} (restored on stop).`
          );
        }
      }

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

  private async getDeviceSdk(serial: string): Promise<number | null> {
    try {
      const output = await this.execAdb(
        ["-s", serial, "shell", "getprop", "ro.build.version.sdk"],
        4000
      );
      const sdk = Number.parseInt(output, 10);
      return Number.isInteger(sdk) ? sdk : null;
    } catch {
      return null;
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
      "audio=true",
      "audio_codec=opus",
      "control=true",
      "send_device_meta=false",
      `max_size=${maxSize}`,
      `video_bit_rate=${bitRate}`,
    ];

    if (options.maxFps) {
      serverArgs.push(`max_fps=${options.maxFps}`);
    }

    // Keep the device speaker playing while its audio is captured, so muting
    // on the desktop falls back to the phone instead of silencing both ends.
    if (this.deviceSdk !== null && this.deviceSdk >= 33) {
      serverArgs.push("audio_source=playback", "audio_dup=true");
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
      // The first byte is the server's dummy byte, written right after it
      // accepts the video socket and right before it waits for audio.
      const isFirstData = !gotData;
      gotData = true;
      this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
      if (isFirstData) this.connectAudio(session);
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

  /**
   * The server accepts its sockets in video → audio → control order, so the
   * audio socket must be opened before the control socket; otherwise the
   * server would treat the control connection as its audio channel. Audio is
   * best-effort: a failure here must never stop video or control from coming up.
   */
  private connectAudio(session: number): void {
    if (session !== this.sessionId) return;
    if (this.audioSocket || this.audioConnectStarted) return;
    if (this.localPort <= 0) {
      this.connectControl(session);
      return;
    }

    this.audioConnectStarted = true;
    const socket = net.createConnection({ host: "127.0.0.1", port: this.localPort });
    this.audioSocket = socket;
    socket.setNoDelay(true);

    let controlStarted = false;
    const continueToControl = () => {
      if (controlStarted) return;
      controlStarted = true;
      this.connectControl(session);
    };

    socket.once("connect", () => {
      if (session !== this.sessionId) return;
      console.log("[ScrcpyServerManager] Audio channel connected.");
      continueToControl();
    });

    socket.on("data", (chunk: Buffer) => {
      if (session !== this.sessionId) return;
      this.audioRxBuf = Buffer.concat([this.audioRxBuf, chunk]);
      this.parseAudio(session);
    });

    socket.on("error", (err) => {
      if (this.audioSocket === socket) this.audioSocket = null;
      if (session !== this.sessionId) return;
      console.warn("[ScrcpyServerManager] Audio channel unavailable:", err.message);
      // No audio means nothing to route: give the phone its speaker back.
      void this.restorePhoneVolume(this.activeSerial);
      continueToControl();
    });

    socket.on("close", () => {
      if (this.audioSocket === socket) this.audioSocket = null;
      if (session !== this.sessionId) return;
      void this.restorePhoneVolume(this.activeSerial);
      continueToControl();
    });
  }

  /**
   * scrcpy accepts video first, writes the dummy byte, then blocks accepting
   * the audio connection and finally the control connection before it starts
   * encoding. Both extra sockets must ride the same ADB forward as video.
   */
  private connectControl(session: number): void {
    if (session !== this.sessionId) return;
    if (this.controlSocket || this.controlConnectStarted) return;
    if (this.localPort <= 0) return;

    this.controlConnectStarted = true;
    const socket = net.createConnection({ host: "127.0.0.1", port: this.localPort });
    this.controlSocket = socket;
    socket.setNoDelay(true);

    socket.once("connect", () => {
      if (session !== this.sessionId) return;
      console.log("[ScrcpyServerManager] Control channel connected.");
    });

    // Device → client messages (clipboard sync, UHID output) are not used,
    // but the socket must be drained so the server never blocks on writes.
    socket.on("data", () => {});

    socket.on("error", (err) => {
      if (session !== this.sessionId) return;
      this.fail(session, `Control connection failed: ${err.message}`);
    });

    socket.on("close", () => {
      if (this.controlSocket === socket) this.controlSocket = null;
      if (session !== this.sessionId) return;
      this.fail(session, "The control connection closed unexpectedly.");
    });
  }

  /**
   * Audio stream layout (scrcpy 3.x):
   *   4-byte codec id ("opus"), or a disable code (0 = no audio capture on
   *   this device, 1 = configuration error); video keeps running either way.
   *   12-byte frame header (flags/PTS, size) followed by one Opus packet.
   *   Config packets carry the OpusHead header, which raw-packet WebCodecs
   *   decoders do not need.
   */
  private parseAudio(session: number): void {
    if (session !== this.sessionId) return;

    if (!this.audioHeaderParsed && !this.audioDisabled) {
      if (this.audioRxBuf.length < 4) return;

      const codecBytes = this.audioRxBuf.subarray(0, 4);
      const code = codecBytes.readUInt32BE(0);
      this.audioRxBuf = this.audioRxBuf.subarray(4);

      if (code === 0 || code === 1) {
        this.audioDisabled = true;
        this.audioRxBuf = Buffer.alloc(0);
        console.log(
          `[ScrcpyServerManager] Device did not provide audio (code ${code}); continuing video-only.`
        );
        // Nothing is captured, so muting the phone would silence both ends.
        void this.restorePhoneVolume(this.activeSerial);
        return;
      }

      this.audioCodec = codecBytes.toString("ascii");
      this.audioHeaderParsed = true;
      console.log(`[ScrcpyServerManager] Audio stream initialized: codec=${this.audioCodec}`);
      this.emit("audio-init", { codec: this.audioCodec });
    }

    if (this.audioDisabled) return;

    while (this.audioRxBuf.length >= 12) {
      const flagsByte = this.audioRxBuf[0];
      const isConfig = (flagsByte & 0x80) !== 0;
      const packetSize = this.audioRxBuf.readUInt32BE(8);

      if (this.audioRxBuf.length < 12 + packetSize) break;

      const payload = this.audioRxBuf.subarray(12, 12 + packetSize);
      this.audioRxBuf = this.audioRxBuf.subarray(12 + packetSize);

      if (isConfig) continue;

      this.emit("audio-chunk", Buffer.from(payload));
    }
  }

  /** Queues one pointer/keyboard event on the control channel. */
  public injectInput(input: unknown): boolean {
    if (this.state !== "running") return false;
    const socket = this.controlSocket;
    if (!socket || socket.destroyed || !socket.writable) return false;

    const message = encodeControlInput(input);
    if (!message) return false;

    socket.write(message);
    return true;
  }

  /**
   * Applies the HUD audio state. The desktop player mutes itself; this side
   * owns the phone's real media volume so the sound only comes out of the
   * selected end:
   *   desktop on  → phone STREAM_MUSIC = 0 (capture still gets full audio)
   *   desktop off → phone STREAM_MUSIC = level × max
   */
  public setDesktopAudio(muted: boolean, level: number): void {
    this.desiredAudioMuted = muted;
    this.desiredAudioLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
    this.applyAudioRouting();
  }

  private applyAudioRouting(): void {
    if (this.phoneVolumeMax === null) return;
    if (this.state !== "starting" && this.state !== "running") return;

    const index = this.desiredAudioMuted
      ? Math.round(this.desiredAudioLevel * this.phoneVolumeMax)
      : 0;
    this.queuePhoneVolume(index);
  }

  private queuePhoneVolume(index: number): void {
    if (this.pendingPhoneVolume === index) return;
    this.pendingPhoneVolume = index;

    if (this.volumeTimer) clearTimeout(this.volumeTimer);
    const generation = this.volumeGeneration;
    this.volumeTimer = setTimeout(() => {
      this.volumeTimer = null;
      void this.flushPhoneVolume(generation);
    }, VOLUME_DEBOUNCE_MS);
  }

  private async flushPhoneVolume(generation: number): Promise<void> {
    const target = this.pendingPhoneVolume;
    const serial = this.activeSerial;
    if (target === null || !serial) return;
    if (generation !== this.volumeGeneration) return;
    if (target === this.appliedPhoneVolume) return;

    this.pendingPhoneVolume = null;
    try {
      await this.enqueueVolumeWrite(serial, target);
      if (generation === this.volumeGeneration) this.appliedPhoneVolume = target;
    } catch (err) {
      console.warn(`[ScrcpyServerManager] Phone volume update failed: ${toMessage(err)}`);
    }
  }

  /** Hands the phone its original media volume back. */
  private async restorePhoneVolume(serial: string | null): Promise<void> {
    this.volumeGeneration += 1;
    if (this.volumeTimer) {
      clearTimeout(this.volumeTimer);
      this.volumeTimer = null;
    }
    this.pendingPhoneVolume = null;

    const original = this.phoneOriginalVolume;
    this.phoneOriginalVolume = null;
    this.phoneVolumeMax = null;
    this.appliedPhoneVolume = null;

    if (!serial || original === null) return;
    try {
      await this.enqueueVolumeWrite(serial, original);
      console.log(`[ScrcpyServerManager] Phone media volume restored to ${original}.`);
    } catch {
      // Device unplugged or volume service unavailable – nothing else to do.
    }
  }

  /** Serializes ADB volume writes so a restore can never land before a mute. */
  private enqueueVolumeWrite(serial: string, index: number): Promise<void> {
    const run = this.volumeChain.then(() => this.writeStreamMusicVolume(serial, index));
    this.volumeChain = run.catch(() => {});
    return run;
  }

  private writeStreamMusicVolume(serial: string, index: number): Promise<void> {
    return this.execAdb(
      ["-s", serial, "shell", "cmd", "media_session", "volume", "--stream", STREAM_MUSIC, "--set", String(index)],
      5000
    ).then(
      () => undefined,
      () =>
        this.execAdb(
          ["-s", serial, "shell", "media", "volume", "--stream", STREAM_MUSIC, "--set", String(index)],
          5000
        ).then(() => undefined)
    );
  }

  private async readStreamMusicVolume(
    serial: string
  ): Promise<{ current: number; max: number } | null> {
    try {
      const output = await this.execAdb(["-s", serial, "shell", "dumpsys", "audio"], 6000);
      const block = output.split(/^-\s+STREAM_/m).find((part) => part.startsWith("MUSIC:"));
      if (block) {
        const max = /^\s*Max:\s*(\d+)/m.exec(block);
        const current = /^\s*streamVolume:\s*(\d+)/m.exec(block);
        if (max && current) {
          return {
            current: Number.parseInt(current[1], 10),
            max: Number.parseInt(max[1], 10),
          };
        }
      }
    } catch {
      // fall through to media_session
    }

    try {
      const output = await this.execAdb(
        ["-s", serial, "shell", "cmd", "media_session", "volume", "--stream", STREAM_MUSIC, "--get"],
        5000
      );
      const match = /volume is (\d+) in range \[(\d+)\.\.(\d+)\]/i.exec(output);
      if (match) {
        return {
          current: Number.parseInt(match[1], 10),
          max: Number.parseInt(match[3], 10),
        };
      }
    } catch {
      // Volume service unavailable; routing falls back to desktop-only mute.
    }

    console.warn("[ScrcpyServerManager] Could not read phone media volume.");
    return null;
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

    void this.restorePhoneVolume(serial);
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

    await this.restorePhoneVolume(serial);

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

    this.applyAudioRouting();

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
    if (this.audioSocket) {
      this.audioSocket.removeAllListeners();
      this.audioSocket.on("error", () => {});
      this.audioSocket.destroy();
      this.audioSocket = null;
    }
    this.audioConnectStarted = false;
    if (this.controlSocket) {
      this.controlSocket.removeAllListeners();
      this.controlSocket.on("error", () => {});
      this.controlSocket.destroy();
      this.controlSocket = null;
    }
    this.controlConnectStarted = false;
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
    this.audioRxBuf = Buffer.alloc(0);
    this.audioHeaderParsed = false;
    this.audioDisabled = false;
    this.audioCodec = "opus";
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
