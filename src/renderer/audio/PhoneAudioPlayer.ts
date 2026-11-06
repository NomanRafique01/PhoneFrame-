const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 2;
const PLAYBACK_LEAD_SECONDS = 0.08;

/**
 * Decodes the raw Opus packets forwarded by scrcpy-server and schedules them
 * on the Web Audio clock. Packets are dropped while muted to save work, so
 * unmuting simply restarts the schedule with the next live packets.
 */
export class PhoneAudioPlayer {
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private decoder: AudioDecoder | null = null;
  private nextStartTime = 0;
  private lastTimestamp = 0;
  private muted: boolean;
  private volume: number;
  private disposed = false;

  constructor(muted: boolean, volume: number) {
    this.muted = muted;
    this.volume = volume;
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.gain = this.context.createGain();
    this.gain.gain.value = muted ? 0 : volume;
    this.gain.connect(this.context.destination);
    this.createDecoder();
  }

  private createDecoder(): void {
    if (this.disposed || typeof AudioDecoder === "undefined") return;

    try {
      const decoder = new AudioDecoder({
        output: (data) => this.play(data),
        error: (error) => {
          console.error("[PhoneAudio] decoder error:", error);
          this.decoder = null;
        },
      });

      // Raw Opus packets: a description (OpusHead) would imply an Ogg
      // bitstream, so it is intentionally omitted.
      decoder.configure({
        codec: "opus",
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfChannels: OPUS_CHANNELS,
      });

      this.decoder = decoder;
    } catch (error) {
      console.error("[PhoneAudio] could not initialize Opus decoder:", error);
      this.decoder = null;
    }
  }

  public setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;

    if (muted) {
      this.applyGain();
      this.stopSources();
    } else {
      this.nextStartTime = 0;
      this.applyGain();
      void this.context.resume();
    }
  }

  public setVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, volume));
    if (this.volume === next) return;
    this.volume = next;
    this.applyGain();
  }

  private applyGain(): void {
    const target = this.muted ? 0 : this.volume;
    // Ramp instead of jumping so dragging the slider does not click.
    this.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.015);
  }

  public push(packet: Uint8Array): void {
    if (this.disposed || this.muted || packet.length === 0) return;

    if (!this.decoder || this.decoder.state === "closed") {
      this.createDecoder();
    }
    const decoder = this.decoder;
    if (!decoder || decoder.state !== "configured") return;

    if (this.context.state === "suspended") {
      void this.context.resume();
    }

    // WebCodecs only needs monotonic timestamps; playback pacing comes from
    // the AudioContext clock, not from the device PTS.
    const timestamp = Math.max(Math.round(performance.now() * 1000), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    try {
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp, data: packet }));
    } catch (error) {
      console.debug("[PhoneAudio] packet decode failed:", error);
    }
  }

  private play(data: AudioData): void {
    try {
      if (this.disposed || this.muted || data.numberOfFrames === 0) return;

      const context = this.context;
      const buffer = context.createBuffer(
        data.numberOfChannels,
        data.numberOfFrames,
        data.sampleRate
      );

      for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
        data.copyTo(buffer.getChannelData(channel), {
          planeIndex: channel,
          format: "f32-planar",
        });
      }

      const now = context.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now + PLAYBACK_LEAD_SECONDS;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
      };
      this.sources.add(source);
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
    } catch (error) {
      console.debug("[PhoneAudio] playback failed:", error);
    } finally {
      data.close();
    }
  }

  private stopSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    this.sources.clear();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stopSources();

    if (this.decoder && this.decoder.state !== "closed") {
      try {
        this.decoder.close();
      } catch {
        // already closed
      }
    }
    this.decoder = null;

    this.gain.disconnect();
    void this.context.close().catch(() => {});
  }
}
