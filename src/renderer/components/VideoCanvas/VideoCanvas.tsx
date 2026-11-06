import React, { useEffect, useRef, useState } from "react";
import type { ScreenControlInput } from "../../types/electron";

interface VideoCanvasProps {
  width: number;
  height: number;
  isStreaming: boolean;
  onInteractionChange?: (active: boolean) => void;
}

interface FramePoint {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

// Keys that must travel as Android key events instead of injected text.
// Escape maps to BACK, since a phone has no meaningful Escape action.
const ANDROID_KEYCODES: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Tab: 61,
  Escape: 4,
  Delete: 112,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122, // move to line start while typing
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Insert: 124,
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,
};

const KEYCODE_BACK = 4;
const KEYCODE_HOME = 3;

// Chromium reports ~100 px per wheel notch; scrcpy treats 1.0 as one notch.
const WHEEL_PIXELS_PER_NOTCH = 100;

function androidKeycode(key: string): number | null {
  return ANDROID_KEYCODES[key] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta / 3; // lines
  if (deltaMode === 2) return delta; // pages
  return delta / WHEEL_PIXELS_PER_NOTCH; // pixels
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({
  isStreaming,
  onInteractionChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const isConfiguredRef = useRef<boolean>(false);
  const currentCodecRef = useRef<string>("avc1.420020");
  const lastTimestampRef = useRef<number>(0);
  const hasReceivedFramesRef = useRef<boolean>(false);

  const [hasReceivedFrames, setHasReceivedFrames] = useState<boolean>(false);

  const screenRef = useRef<HTMLDivElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const lastPointRef = useRef<FramePoint | null>(null);
  const pressedKeysRef = useRef<Map<string, number>>(new Map());
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});

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

  const sendControl = (input: ScreenControlInput) => {
    window.electronAPI?.sendControl?.(input);
  };

  /**
   * Maps a window point into the video frame's pixel space. The canvas is
   * letterboxed by object-fit: contain, so the drawn area is centered.
   * scrcpy expects coordinates relative to the video size it is encoding,
   * which makes max_size scaling and rotation transparent to us.
   */
  const mapPointer = (clientX: number, clientY: number): FramePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const frameWidth = canvas.width;
    const frameHeight = canvas.height;
    if (frameWidth <= 0 || frameHeight <= 0) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
    const drawnWidth = frameWidth * scale;
    const drawnHeight = frameHeight * scale;
    const offsetX = (rect.width - drawnWidth) / 2;
    const offsetY = (rect.height - drawnHeight) / 2;

    const x = (clientX - rect.left - offsetX) / scale;
    const y = (clientY - rect.top - offsetY) / scale;

    return {
      x: clamp(x, 0, frameWidth - 1),
      y: clamp(y, 0, frameHeight - 1),
      screenWidth: frameWidth,
      screenHeight: frameHeight,
    };
  };

  const sendKeyTap = (keycode: number) => {
    sendControl({ type: "key", action: "down", keycode, repeat: 0, metaState: 0 });
    sendControl({ type: "key", action: "up", keycode, metaState: 0 });
  };

  const endTouch = (pointerId: number, point?: FramePoint | null) => {
    if (activePointerRef.current !== pointerId) return;
    const lastPoint = point ?? lastPointRef.current;
    activePointerRef.current = null;
    lastPointRef.current = null;
    onInteractionChange?.(false);
    if (lastPoint) {
      sendControl({ type: "touch", action: "up", ...lastPoint });
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isStreaming) return;

    // Keep the bezel-drag handler in App from moving the window.
    event.stopPropagation();
    event.preventDefault();
    screenRef.current?.focus({ preventScroll: true });

    if (event.button === 2) {
      sendKeyTap(KEYCODE_BACK);
      return;
    }
    if (event.button === 1) {
      sendKeyTap(KEYCODE_HOME);
      return;
    }
    if (event.button !== 0 || activePointerRef.current !== null) return;

    const point = mapPointer(event.clientX, event.clientY);
    if (!point) return;

    activePointerRef.current = event.pointerId;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    onInteractionChange?.(true);
    sendControl({ type: "touch", action: "down", ...point });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isStreaming || activePointerRef.current !== event.pointerId) return;
    event.stopPropagation();

    const point = mapPointer(event.clientX, event.clientY);
    if (!point) return;

    lastPointRef.current = point;
    sendControl({ type: "touch", action: "move", ...point });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.stopPropagation();

    const point = mapPointer(event.clientX, event.clientY);
    endTouch(event.pointerId, point);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    endTouch(event.pointerId);
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    endTouch(event.pointerId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isStreaming || event.nativeEvent.isComposing) return;
    // Leave app/system shortcuts (DevTools, quit, etc.) to the desktop.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const keycode = androidKeycode(event.key);
    if (keycode !== null) {
      event.preventDefault();
      pressedKeysRef.current.set(event.code, keycode);
      sendControl({
        type: "key",
        action: "down",
        keycode,
        repeat: event.repeat ? 1 : 0,
        metaState: 0,
      });
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      sendControl({ type: "text", text: event.key });
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isStreaming) return;
    if (!pressedKeysRef.current.has(event.code)) return;

    const keycode = pressedKeysRef.current.get(event.code);
    pressedKeysRef.current.delete(event.code);
    if (keycode === undefined) return;

    event.preventDefault();
    sendControl({ type: "key", action: "up", keycode, metaState: 0 });
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isStreaming) event.preventDefault();
  };

  wheelHandlerRef.current = (event: WheelEvent) => {
    if (!isStreaming) return;

    const rawX = normalizeWheelDelta(event.deltaX, event.deltaMode);
    const rawY = normalizeWheelDelta(event.deltaY, event.deltaMode);

    // DOM deltaY is positive downward, while Android's AXIS_VSCROLL is
    // positive upward (AOSP ScrollView scrolls by -axisValue).
    let hScroll = rawX;
    let vScroll = -rawY;

    // Shift+wheel is the conventional horizontal-scroll gesture; wheel down
    // scrolls right, matching HorizontalScrollView's shift handling.
    if (event.shiftKey && rawX === 0) {
      hScroll = rawY;
      vScroll = 0;
    }
    if (hScroll === 0 && vScroll === 0) return;

    const point = mapPointer(event.clientX, event.clientY);
    if (!point) return;

    sendControl({
      type: "scroll",
      ...point,
      hScroll: clamp(hScroll, -1, 1),
      vScroll: clamp(vScroll, -1, 1),
    });
  };

  // Native listener (not React's passive onWheel) so the page cannot scroll
  // or zoom while the wheel is driving the phone.
  useEffect(() => {
    const element = screenRef.current;
    if (!element || !isStreaming) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelHandlerRef.current(event);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [isStreaming]);

  // Never leave a finger down or a key pressed on the device after focus loss.
  useEffect(() => {
    const releaseAll = () => {
      for (const keycode of pressedKeysRef.current.values()) {
        sendControl({ type: "key", action: "up", keycode, metaState: 0 });
      }
      pressedKeysRef.current.clear();

      const pointerId = activePointerRef.current;
      if (pointerId !== null) {
        endTouch(pointerId);
      }
    };

    window.addEventListener("blur", releaseAll);
    return () => window.removeEventListener("blur", releaseAll);
  }, []);

  useEffect(() => {
    if (isStreaming) return;
    pressedKeysRef.current.clear();
    activePointerRef.current = null;
    lastPointRef.current = null;
    onInteractionChange?.(false);
  }, [isStreaming, onInteractionChange]);

  // The component unmounts when the stream ends (the setup screen replaces
  // it), so release the window's interaction hold here as well.
  useEffect(() => {
    return () => {
      onInteractionChange?.(false);
    };
  }, [onInteractionChange]);

  return (
    <div
      ref={screenRef}
      tabIndex={isStreaming ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onContextMenu={handleContextMenu}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        overflow: "hidden",
        outline: "none",
        touchAction: "none",
        cursor: isStreaming ? "default" : undefined,
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
          <span>{isStreaming ? "WAITING FOR STREAM…" : "STARTING STREAM…"}</span>
        </div>
      )}

    </div>
  );
};
