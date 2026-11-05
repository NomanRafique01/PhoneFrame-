import React, { useEffect, useRef, useState } from "react";

interface VideoCanvasProps {
  width: number;
  height: number;
  isStreaming: boolean;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({ width, height, isStreaming }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const isConfiguredRef = useRef<boolean>(false);
  const [hasReceivedFrames, setHasReceivedFrames] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  const frameCounterRef = useRef<number>(0);
  const bufferRef = useRef<Uint8Array>(new Uint8Array(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Check if WebCodecs VideoDecoder is supported
    if (typeof VideoDecoder === "undefined") {
      console.warn("WebCodecs VideoDecoder API is not supported in this runtime.");
      return;
    }

    try {
      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (!hasReceivedFrames) {
            setHasReceivedFrames(true);
          }
          frameCounterRef.current += 1;

          // Render decoded frame onto GPU canvas
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        },
        error: (err: DOMException) => {
          console.error("[VideoDecoder error]:", err);
        },
      });

      decoderRef.current = decoder;

      // Initial configuration for H.264 baseline/main profile
      decoder.configure({
        codec: "avc1.42E01E", // H.264 Baseline Profile level 3.0
        optimizeForLatency: true,
      });
      isConfiguredRef.current = true;
    } catch (e) {
      console.error("Failed to initialize VideoDecoder:", e);
    }

    // Measure FPS
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

  // Listen for raw H.264 video chunks from Electron IPC
  useEffect(() => {
    if (!window.electronAPI || !isStreaming) return;

    const parseNalUnits = (chunkData: Uint8Array) => {
      // Concatenate buffer
      const prev = bufferRef.current;
      const combined = new Uint8Array(prev.length + chunkData.length);
      combined.set(prev, 0);
      combined.set(chunkData, prev.length);
      bufferRef.current = combined;

      const data = bufferRef.current;
      let startIndex = -1;

      for (let i = 0; i < data.length - 4; i++) {
        // Search for Annex-B start code (0x00 0x00 0x00 0x01 or 0x00 0x00 0x01)
        const is4Byte = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
        const is3Byte = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;

        if (is4Byte || is3Byte) {
          if (startIndex !== -1) {
            const nal = data.slice(startIndex, i);
            feedNalToDecoder(nal);
          }
          startIndex = i;
          if (is4Byte) i += 3;
          else i += 2;
        }
      }

      if (startIndex !== -1) {
        bufferRef.current = data.slice(startIndex);
      }
    };

    const feedNalToDecoder = (nal: Uint8Array) => {
      const decoder = decoderRef.current;
      if (!decoder || decoder.state !== "configured") return;

      // Extract NAL type (lower 5 bits of first byte after start code)
      let offset = 3;
      if (nal[0] === 0 && nal[1] === 0 && nal[2] === 0 && nal[3] === 1) {
        offset = 4;
      }
      const nalType = nal[offset] & 0x1f;
      const isKey = nalType === 5 || nalType === 7;

      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: isKey ? "key" : "delta",
            timestamp: performance.now() * 1000,
            data: nal,
          })
        );
      } catch (err) {
        // Handled silently for malformed initial slices
      }
    };

    // Subscribing to IPC video stream
    const onVideoChunk = (chunk: Uint8Array) => {
      parseNalUnits(chunk);
    };

    // Attach to electronAPI if present
    const unsubscribe = (window as unknown as { electronAPI?: { onVideoChunk?: (cb: (c: Uint8Array) => void) => () => void } })
      .electronAPI?.onVideoChunk?.(onVideoChunk);

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
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: hasReceivedFrames ? "block" : "none",
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
            color: "rgba(255, 255, 255, 0.45)",
            pointerEvents: "none",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            padding: "2px 6px",
            borderRadius: "4px",
          }}
        >
          {fps} FPS • WebCodecs GPU
        </div>
      )}
    </div>
  );
};

