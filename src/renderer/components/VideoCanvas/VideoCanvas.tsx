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
  const [fps, setFps] = useState<number>(0);
  const [streamResolution, setStreamResolution] = useState<{ width: number; height: number } | null>(null);
  const frameCounterRef = useRef<number>(0);

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
            setStreamResolution({ width: w, height: h });
          }

          ctx.drawImage(frame, 0, 0, w, h);
          frame.close();

          frameCounterRef.current += 1;
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

    const fpsInterval = setInterval(() => {
      setFps(frameCounterRef.current);
      frameCounterRef.current = 0;
    }, 1000);

    return () => {
      clearInterval(fpsInterval);
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
        setStreamResolution({ width: meta.width, height: meta.height });
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

  // Listen for framed H.264 video chunks
  useEffect(() => {
    if (!window.electronAPI || !isStreaming) return;

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
  }, [isStreaming]);

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

      {/* Latency & Telemetry HUD Overlay */}
      {hasReceivedFrames && (
        <div
          className="mono-data"
          style={{
            position: "absolute",
            bottom: "8px",
            right: "12px",
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.65)",
            pointerEvents: "none",
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            padding: "2px 8px",
            borderRadius: "4px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            zIndex: 30,
          }}
        >
          {fps} FPS {streamResolution ? `• ${streamResolution.width}×${streamResolution.height} ` : ""}• WebCodecs GPU
        </div>
      )}
    </div>
  );
};
