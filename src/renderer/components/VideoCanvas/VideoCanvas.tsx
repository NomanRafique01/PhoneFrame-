import React, { useEffect, useRef, useState } from "react";

interface VideoCanvasProps {
  width: number;
  height: number;
  isStreaming: boolean;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({ isStreaming }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const isConfiguredRef = useRef<boolean>(false);
  const currentCodecRef = useRef<string>("avc1.420020");
  const lastTimestampRef = useRef<number>(0);
  const hasReceivedFramesRef = useRef<boolean>(false);

  const [hasReceivedFrames, setHasReceivedFrames] = useState<boolean>(false);

  // Initialize or reconfigure WebCodecs VideoDecoder
  const setupDecoder = (codecToUse: string) => {
    if (typeof VideoDecoder === "undefined") {
      console.warn("[VideoCanvas] WebCodecs VideoDecoder not available in this runtime.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    if (decoderRef.current && decoderRef.current.state !== "closed") {
      try {
        decoderRef.current.close();
      } catch {
        // ignore
      }
    }

    try {
      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          const w = frame.displayWidth;
          const h = frame.displayHeight;

          // Dynamically adjust internal canvas pixel resolution to native video frame
          // (fixes blurriness caused by rendering high-res frames onto a low-res canvas)
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }

          ctx.drawImage(frame, 0, 0, w, h);
          frame.close();

          if (!hasReceivedFramesRef.current) {
            hasReceivedFramesRef.current = true;
            setHasReceivedFrames(true);
          }
        },
        error: (err: DOMException) => {
          console.error("[VideoDecoder error]:", err);
          isConfiguredRef.current = false;
        },
      });

      decoder.configure({
        codec: codecToUse,
        optimizeForLatency: true,
      });

      decoderRef.current = decoder;
      currentCodecRef.current = codecToUse;
      isConfiguredRef.current = true;
      console.log(`[VideoCanvas] VideoDecoder initialized with codec ${codecToUse}`);
    } catch (e) {
      console.error("[VideoCanvas] Failed to initialize VideoDecoder:", e);
    }
  };

  useEffect(() => {
    setupDecoder(currentCodecRef.current);

    return () => {
      if (decoderRef.current && decoderRef.current.state !== "closed") {
        try {
          decoderRef.current.close();
        } catch {
          // ignore
        }
      }
      decoderRef.current = null;
      isConfiguredRef.current = false;
    };
  }, []);

  // Listen for video init (initial resolution & codec)
  useEffect(() => {
    if (!window.electronAPI) return;

    const unInit = window.electronAPI.onVideoInit?.((meta) => {
      console.log("[VideoCanvas] Received video:init:", meta);
      if (meta.width && meta.height) {
        if (canvasRef.current) {
          canvasRef.current.width = meta.width;
          canvasRef.current.height = meta.height;
        }
      }
    });

    const unCodec = window.electronAPI.onVideoCodec?.((codec) => {
      console.log("[VideoCanvas] Received SPS codec update:", codec);
      if (codec && codec !== currentCodecRef.current) {
        setupDecoder(codec);
      }
    });

    return () => {
      unInit?.();
      unCodec?.();
    };
  }, []);

  // Listen for framed H.264 video chunks. Subscribed for the component's whole
  // life (it mounts during "starting") so no config/keyframe is missed.
  useEffect(() => {
    if (!window.electronAPI) return;

    const onVideoChunk = (raw: Uint8Array) => {
      const decoder = decoderRef.current;
      if (!decoder || decoder.state !== "configured" || !isConfiguredRef.current) return;
      if (raw.length < 2) return;

      const isKey = raw[0] === 1;
      const nalData = raw.subarray(1);

      // Generate strictly monotonic microsecond timestamps
      const nowUs = Math.round(performance.now() * 1000);
      const timestamp = Math.max(nowUs, lastTimestampRef.current + 1);
      lastTimestampRef.current = timestamp;

      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: isKey ? "key" : "delta",
            timestamp,
            data: nalData,
          })
        );
      } catch (err) {
        console.debug("[VideoCanvas] decode error:", err);
      }
    };

    const unsubscribe = window.electronAPI.onVideoChunk?.(onVideoChunk);
    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: hasReceivedFrames ? "block" : "none",
          imageRendering: "auto",
        }}
      />

      {/* Startup / waiting state: shown until the first decoded frame lands */}
      {!hasReceivedFrames && (
        <div
          className="mono-data"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            fontSize: "11px",
            letterSpacing: "0.08em",
            color: "var(--mist-400)",
            pointerEvents: "none",
          }}
        >
          <span className="stream-starting-dot" />
          <span>{isStreaming ? "WAITING FOR VIDEO…" : "STARTING STREAM…"}</span>
        </div>
      )}

    </div>
  );
};
