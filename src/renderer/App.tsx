import React, { useState, useEffect, useRef } from "react";
import {
  PhoneFrame,
  FrameControls,
  type PhoneFrameOptions,
  FRAME_COLOR_DEFINITIONS,
} from "./components/PhoneFrame";
import { FloatingHUD } from "./components/HUD/FloatingHUD";
import { SetupWizard } from "./components/SetupWizard";
import { VideoCanvas } from "./components/VideoCanvas/VideoCanvas";
import { ChevronRightIcon, SmartphoneIcon } from "./components/icons";
import { usePhoneAudio } from "./audio/usePhoneAudio";
import type { AdbStatusPayload, MirrorState } from "./types/electron";

// Drag mode requires a deliberate hold so a quick tap or a small wobble never
// moves the frame. 180 ms is short enough to feel immediate, long enough to
// distinguish intent from a click.
const DRAG_HOLD_MS = 180;
const DRAG_MOVE_TOLERANCE = 6;

export const App: React.FC = () => {
  const [frameOptions, setFrameOptions] = useState<PhoneFrameOptions>({
    bezelWidth: 16,
    outerRadius: 40,
    screenRadius: 26,
    color: "slate",
    notchStyle: "punch-center",
    showSpeaker: true,
    showHardwareButtons: true,
    orientation: "portrait",
    aspectRatio: { width: 9, height: 20 },
    baseScreenWidth: 360,
  });

  const [adbStatus, setAdbStatus] = useState<AdbStatusPayload>({
    state: "no-device",
    devices: [],
    activeDevice: null,
  });

  const [mirrorState, setMirrorState] = useState<MirrorState>("stopped");
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const prevMirrorStateRef = useRef<MirrorState>("stopped");
  const lastAdbStatusRef = useRef<AdbStatusPayload>({
    state: "no-device",
    devices: [],
    activeDevice: null,
  });
  const noticeTimerRef = useRef<number | null>(null);

  const [isPinned, setIsPinned] = useState(true);
  const [audioMuted, setAudioMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("phoneframe_audio_muted_v1") === "1";
    } catch {
      return false;
    }
  });
  const [audioVolume, setAudioVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("phoneframe_audio_volume_v1");
      if (saved === null) return 1;
      const parsed = Number(saved);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
    } catch {
      return 1;
    }
  });
  const [scale, setScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("phoneframe_scale_v4") ?? localStorage.getItem("phoneframe_scale_v3");
      const parsed = saved ? Number(saved) : NaN;
      if (isNaN(parsed) || parsed < 60 || parsed > 140) {
        return 75;
      }
      return parsed;
    } catch {
      return 75;
    }
  });
  const [showInspector, setShowInspector] = useState(false);
  const [isWizardActive, setIsWizardActive] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(false);
  const [isScreenInteracting, setIsScreenInteracting] = useState(false);
  const [touchHudOpen, setTouchHudOpen] = useState(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  const [phoneOffset, setPhoneOffset] = useState({ x: 0, y: 0 });
  const hideTimerRef = useRef<number | null>(null);
  const tapRef = useRef<{ pointerId: number; x: number; y: number; t: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const dragPendingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const startInFlightRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneWrapRef = useRef<HTMLDivElement>(null);

  const showSessionNotice = (text: string) => {
    setSessionNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setSessionNotice(null), 5000);
  };

  // Persist scale preference across sessions
  useEffect(() => {
    try {
      localStorage.setItem("phoneframe_scale_v4", String(scale));
    } catch {
      // Ignore storage restrictions
    }
  }, [scale]);

  // Persist the PC audio toggle across sessions
  useEffect(() => {
    try {
      localStorage.setItem("phoneframe_audio_muted_v1", audioMuted ? "1" : "0");
    } catch {
      // Ignore storage restrictions
    }
  }, [audioMuted]);

  // Persist the PC audio level across sessions
  useEffect(() => {
    try {
      localStorage.setItem("phoneframe_audio_volume_v1", String(audioVolume));
    } catch {
      // Ignore storage restrictions
    }
  }, [audioVolume]);

  usePhoneAudio(audioMuted, audioVolume);

  // Subscribe to real-time ADB status events & mirror state
  useEffect(() => {
    // Initial ADB fetch
    if (window.electronAPI?.getAdbStatus) {
      window.electronAPI.getAdbStatus().then((status) => {
        if (status) {
          lastAdbStatusRef.current = status;
          setAdbStatus(status);
        }
      });
    }

    // ADB event listener
    if (window.electronAPI?.onAdbStatusChange) {
      const unsubscribeAdb = window.electronAPI.onAdbStatusChange((status) => {
        lastAdbStatusRef.current = status;
        setAdbStatus(status);

        // Auto-adapt aspect ratio to connected device
        if (status.state === "device" && status.activeDevice?.width && status.activeDevice?.height) {
          const w = status.activeDevice.width;
          const h = status.activeDevice.height;
          const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
          const divisor = gcd(w, h);
          const ratioW = Math.round((w / divisor) * 10) / 10;
          const ratioH = Math.round((h / divisor) * 10) / 10;

          setFrameOptions((prev) => ({
            ...prev,
            aspectRatio: {
              width: Math.min(ratioW, ratioH),
              height: Math.max(ratioW, ratioH),
            },
          }));
        }
      });

      // Mirror state listener
      const unsubscribeMirror = window.electronAPI?.onMirrorStateChange?.((payload) => {
        const wasActive =
          prevMirrorStateRef.current === "running" || prevMirrorStateRef.current === "starting";
        const isEnded = payload.state === "stopped" || payload.state === "error";
        prevMirrorStateRef.current = payload.state;

        setMirrorState(payload.state);

        // Any stream termination — manual stop, unplug, scrcpy crash — returns
        // to the connection screen. ADB detection keeps running underneath.
        if (wasActive && isEnded) {
          setIsWizardActive(true);
          const stillConnected = lastAdbStatusRef.current.state === "device";
          showSessionNotice(
            payload.state === "error" || !stillConnected
              ? "Phone disconnected. Waiting for a new connection…"
              : "Stream stopped. Device is still connected."
          );
        }
      });

      // Stream resolution / init listener
      const unsubscribeVideoInit = window.electronAPI?.onVideoInit?.((meta) => {
        if (meta.width && meta.height) {
          const w = meta.width;
          const h = meta.height;
          const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
          const divisor = gcd(w, h);
          const ratioW = Math.round((w / divisor) * 10) / 10;
          const ratioH = Math.round((h / divisor) * 10) / 10;

          setFrameOptions((prev) => ({
            ...prev,
            aspectRatio: {
              width: Math.min(ratioW, ratioH),
              height: Math.max(ratioW, ratioH),
            },
          }));
        }
      });

      return () => {
        unsubscribeAdb();
        unsubscribeMirror?.();
        unsubscribeVideoInit?.();
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      };
    }
  }, []);

  // Scaled dimensions
  const scaledOptions: PhoneFrameOptions = {
    ...frameOptions,
    baseScreenWidth: Math.round((360 * scale) / 100),
    bezelWidth: Math.round((frameOptions.bezelWidth * scale) / 100),
    outerRadius: Math.round((frameOptions.outerRadius * scale) / 100),
    screenRadius: Math.round((frameOptions.screenRadius * scale) / 100),
  };

  const isPortrait = scaledOptions.orientation === "portrait";
  const ratioMultiplier = scaledOptions.aspectRatio.height / scaledOptions.aspectRatio.width;
  const screenWidth = Math.round(isPortrait ? scaledOptions.baseScreenWidth : scaledOptions.baseScreenWidth * ratioMultiplier);
  const screenHeight = Math.round(isPortrait ? scaledOptions.baseScreenWidth * ratioMultiplier : scaledOptions.baseScreenWidth);

  // The window is a permanent fullscreen transparent overlay; the phone is
  // centered in it and the inspector overlays the right edge. Sizing once at
  // startup (and on phone scale changes would be needless) means toggling the
  // panel never moves the frame.
  useEffect(() => {
    window.electronAPI?.setWindowSize(window.screen.availWidth, window.screen.availHeight);
  }, []);

  // Click-through when the pointer is off the phone (transparent overlay must not block the desktop).
  // While dragging, the window must keep receiving events so the drag survives the cursor leaving the frame.
  // While the inspector is open, it must stay clickable, so the window keeps capturing the mouse.
  // Screen gestures (swipe/scroll) also keep the window interactive even if the cursor leaves the frame.
  useEffect(() => {
    window.electronAPI?.setIgnoreMouseEvents?.(
      !(isHovered || isDragging || isScreenInteracting || showInspector || touchHudOpen)
    );
  }, [isHovered, isDragging, isScreenInteracting, showInspector, touchHudOpen]);

  // Opening the settings page glides the phone back to the center of its page
  useEffect(() => {
    if (showInspector) setPhoneOffset({ x: 0, y: 0 });
  }, [showInspector]);

  // A pending long-press must never outlive the component.
  useEffect(() => {
    return () => {
      if (dragHoldTimerRef.current !== null) {
        window.clearTimeout(dragHoldTimerRef.current);
        dragHoldTimerRef.current = null;
      }
    };
  }, []);

  // Window Always-on-top handler
  const handleTogglePin = async () => {
    const newFlag = !isPinned;
    setIsPinned(newFlag);
    if (window.electronAPI?.setAlwaysOnTop) {
      await window.electronAPI.setAlwaysOnTop(newFlag);
    }
  };

  const handleRotate = () => {
    setFrameOptions((prev) => ({
      ...prev,
      orientation: prev.orientation === "portrait" ? "landscape" : "portrait",
    }));
  };

  const handleMinimize = () => {
    window.electronAPI?.minimize();
  };

  const handleClose = () => {
    window.electronAPI?.close();
  };

  const handleStartMirror = async () => {
    const serial = adbStatus.activeDevice?.serial;
    if (adbStatus.state !== "device" || !serial) {
      // Never launch scrcpy without a live device; stay in the guide and wait.
      showSessionNotice("Your phone is not connected. Waiting for a connection…");
      return;
    }
    // One click = one startup. The ref stops rapid double-clicks before the
    // "starting" state has rendered; the state check stops later duplicates.
    if (startInFlightRef.current || mirrorState === "starting" || mirrorState === "running") return;
    startInFlightRef.current = true;
    setIsWizardActive(false);
    try {
      await window.electronAPI?.startMirror(serial);
    } finally {
      startInFlightRef.current = false;
    }
  };

  const handleStopMirror = async () => {
    await window.electronAPI?.stopMirror();
  };

  const handleMouseEnter = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hideTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
    }, 400);
  };

  // Drag the whole phone (bezel and screen) by any non-interactive part; only
  // real controls (buttons, inputs, links) opt out. The offset is clamped to
  // the phone page so the frame can never cover the settings panel.
  const clampOffset = (x: number, y: number) => {
    const stage = stageRef.current;
    const wrap = phoneWrapRef.current;
    if (!stage || !wrap) return { x, y };
    // Left, top, and bottom edges can reach the window edges; the right side
    // keeps a small HUD gutter, plus the settings strip while the panel is open.
    const reachX = Math.max(0, (stage.clientWidth - wrap.offsetWidth) / 2);
    const reachY = Math.max(0, (stage.clientHeight - wrap.offsetHeight) / 2);
    const rightGutter = showInspector ? 320 + 16 : 16;
    const minX = -reachX;
    const maxX = Math.max(minX, reachX - rightGutter);
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(reachY, Math.max(-reachY, y)),
    };
  };

  const clearDragHold = () => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    dragPendingRef.current = null;
  };

  const handleToggleDragMode = () => {
    if (dragMode) {
      clearDragHold();
      dragRef.current = null;
      setIsDragging(false);
    }
    setDragMode(!dragMode);
  };

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;

    if (dragMode) {
      if (dragPendingRef.current || dragRef.current) return;
      // Arm the drag only after a deliberate press-and-hold. Until the timer
      // fires this is a pending gesture, never a phone movement or a tap that
      // reaches the mirrored device.
      e.preventDefault();
      const pointerId = e.pointerId;
      dragPendingRef.current = {
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      e.currentTarget.setPointerCapture(pointerId);
      dragHoldTimerRef.current = window.setTimeout(() => {
        dragHoldTimerRef.current = null;
        const pending = dragPendingRef.current;
        if (!pending || pending.pointerId !== pointerId) return;
        dragPendingRef.current = null;
        // Start from the pointer's current position so the frame does not jump.
        dragRef.current = { pointerId, lastX: pending.lastX, lastY: pending.lastY };
        setIsDragging(true);
      }, DRAG_HOLD_MS);
      return;
    }

    if (e.pointerType === "touch") {
      tapRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    }
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pending = dragPendingRef.current;
    if (pending && pending.pointerId === e.pointerId) {
      // Moving before the hold completes means this was not a drag gesture.
      if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > DRAG_MOVE_TOLERANCE) {
        clearDragHold();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        return;
      }
      pending.lastX = e.clientX;
      pending.lastY = e.clientY;
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    if (dx === 0 && dy === 0) return;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    setPhoneOffset((prev) => clampOffset(prev.x + dx, prev.y + dy));
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPendingRef.current?.pointerId === e.pointerId) {
      clearDragHold();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
    // Touch has no hover: a quick, barely-moving tap toggles the HUD drawer
    const tap = tapRef.current;
    tapRef.current = null;
    if (tap && tap.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      if (dist < 8 && Date.now() - tap.t < 300) {
        setTouchHudOpen((v) => !v);
      }
    }
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    clearDragHold();
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
    }
  };

  // Same definition the chassis renders with, so the side key recolors with
  // the frame the moment a new frame color is picked.
  const currentColorDef = FRAME_COLOR_DEFINITIONS[scaledOptions.color] ?? FRAME_COLOR_DEFINITIONS.slate;
  const activeDevice = adbStatus.activeDevice;
  const isDeviceConnected = adbStatus.state === "device";
  const isStreaming = mirrorState === "running";
  const isStarting = mirrorState === "starting";
  // Shared visibility for the drawer: phone hover (phone + HUD are one wrapper,
  // so moving between them never flickers), drag, inspector, or touch toggle.
  // A manual collapse always wins and hands over to the hardware side key.
  const hudVisible = !isHudCollapsed && (isHovered || showInspector || isDragging || touchHudOpen);
  // The collapsed control is a volume-style side key that scales 1:1 with the
  // frame. Its hit area stops 2px short of the screen edge, so it can never
  // paint over — or steal pointer input from — the display at any scale.
  const frameScale = scale / 75;
  const sideKeyProtrusion = Math.max(5, Math.round(10 * frameScale));
  const sideKeyInset = Math.max(2, scaledOptions.bezelWidth - 2);
  const sideKeyWidth = sideKeyInset + sideKeyProtrusion;
  const sideKeyHeight = Math.max(24, Math.round(34 * frameScale));
  const sideKeyRadius = Math.max(3, Math.round(4 * frameScale));
  const sideKeyChevron = Math.max(7, Math.round(8 * frameScale));

  return (
    <div
      className="floating-phone-root"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: "transparent",
        color: "var(--text)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Phone page: the frame lives and drags here; the settings strip is
          only reserved while the panel is actually open */}
      <div
        className="phone-stage"
        ref={stageRef}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: "24px",
        }}
      >
        {/* Phone + HUD wrapper (shrink-fits the frame so the HUD can anchor to it) */}
        <div
          ref={phoneWrapRef}
          style={{
            position: "relative",
            display: "flex",
            transform: `translate(${phoneOffset.x}px, ${phoneOffset.y}px)`,
            // Smooth glide when recentering for the panel; 1:1 tracking while dragging
            transition: isDragging
              ? "none"
              : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onLostPointerCapture={handleLostPointerCapture}
        >
          {/* Floating Contextual HUD — slides out from behind the right bezel like a drawer */}
          <div
            className="hud-drawer"
            style={{
              position: "absolute",
              top: "50%",
              left: "calc(100% + 10px)",
              right: "auto",
              zIndex: 100,
              opacity: hudVisible ? 1 : 0,
              pointerEvents: hudVisible ? "auto" : "none",
              transform: hudVisible
                ? "translateY(-50%) translateX(0)"
                : "translateY(-50%) translateX(-14px)",
              transition: hudVisible
                ? "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)"
                : "transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <FloatingHUD
              dragMode={dragMode}
              onToggleDragMode={handleToggleDragMode}
              onCollapse={() => setIsHudCollapsed(true)}
              isPinned={isPinned}
              onTogglePin={handleTogglePin}
              onRotate={handleRotate}
              audioMuted={audioMuted}
              onToggleAudio={() => setAudioMuted((muted) => !muted)}
              audioVolume={audioVolume}
              onAudioVolumeChange={setAudioVolume}
              showInspector={showInspector}
              onToggleInspector={() => setShowInspector(!showInspector)}
              onMinimize={handleMinimize}
              onClose={handleClose}
            />
          </div>

          {/* Collapsed HUD side key — a hardware volume-style key sunk into the
              right chassis, sitting just below the drawn power button. Only the
              outer edge protrudes, so it reads as part of the frame. */}
          <button
            type="button"
            className="app-no-drag hud-side-key"
            onClick={() => setIsHudCollapsed(false)}
            title="Expand HUD"
            aria-label="Expand HUD"
            aria-expanded={!isHudCollapsed}
            aria-hidden={!isHudCollapsed}
            tabIndex={isHudCollapsed ? 0 : -1}
            style={{
              position: "absolute",
              top: "41%",
              left: `calc(100% - ${sideKeyInset}px)`,
              zIndex: 100,
              width: `${sideKeyWidth}px`,
              height: `${sideKeyHeight}px`,
              padding: 0,
              background: "transparent",
              border: "none",
              outlineOffset: "1px",
              opacity: isHudCollapsed ? 1 : 0,
              pointerEvents: isHudCollapsed ? "auto" : "none",
              transform: `translateY(-50%) translateX(${isHudCollapsed ? 0 : -10}px)`,
              transition:
                "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms cubic-bezier(0.22, 1, 0.36, 1), filter 120ms ease",
            }}
          >
            {/* Only the outer face is painted, so the bezel stays untouched
                while the whole key remains the click target */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: `${sideKeyProtrusion}px`,
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `linear-gradient(180deg, ${currentColorDef.borderHex} 0%, ${currentColorDef.hex} 46%, ${currentColorDef.borderHex} 100%)`,
                borderRadius: `0 ${sideKeyRadius}px ${sideKeyRadius}px 0`,
                border: `1px solid ${currentColorDef.borderHex}`,
                borderLeft: "none",
                boxShadow: `1px 0 2px rgba(0, 0, 0, 0.5), ${Math.round(3 * frameScale)}px ${Math.round(2 * frameScale)}px ${Math.round(7 * frameScale)}px rgba(0, 0, 0, 0.35), inset 0 1px 0 ${currentColorDef.highlightHex}, inset 0 -1px 0 rgba(0, 0, 0, 0.4)`,
                color: "rgba(204, 208, 207, 0.65)",
              }}
            >
              <ChevronRightIcon size={sideKeyChevron} />
            </span>
          </button>

          {/* Procedural SVG Phone Frame Engine */}
          <PhoneFrame
            options={scaledOptions}
            dragMode={dragMode}
            cursor={dragMode ? (isDragging ? "grabbing" : "grab") : undefined}
          >
          {/* Inner Phone Screen Content */}
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              position: "relative",
              backgroundColor: "#000000",
            }}
          >
            {/* Status bar (only show in standby/setup mode; during streaming, real phone status bar is visible) */}
            {!isStreaming && (
              <div
                style={{
                  height: "26px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 18px",
                  fontSize: "11px",
                  fontWeight: 500,
                  color: "var(--mist-400)",
                  zIndex: 20,
                  backgroundColor: "rgba(0, 0, 0, 0.4)",
                }}
              >
                <span className="mono-data">09:41</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="mono-data" style={{ fontSize: "10px" }}>5G</span>
                  <span className="mono-data" style={{ fontSize: "10px" }}>98%</span>
                </div>
              </div>
            )}

            {/* Main Screen Content: Setup Wizard vs Video Canvas vs Standby */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              {isWizardActive ? (
                <SetupWizard
                  adbStatus={adbStatus}
                  notice={sessionNotice}
                  onComplete={handleStartMirror}
                  onDismiss={() => setIsWizardActive(false)}
                />
              ) : isStreaming || isStarting ? (
                /* Mounted as soon as startup begins so the first codec config
                   and keyframe are not missed while connecting */
                <VideoCanvas
                  width={screenWidth}
                  height={screenHeight}
                  isStreaming={isStreaming}
                  dragMode={dragMode}
                  isDragging={isDragging}
                  onInteractionChange={setIsScreenInteracting}
                />
              ) : (
                /* Standby / Ready View */
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "var(--space-4)",
                    textAlign: "center",
                    gap: "var(--space-3)",
                    background: "linear-gradient(180deg, #091319 0%, #03080c 100%)",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isDeviceConnected ? "var(--success)" : "var(--mist-400)",
                    }}
                  >
                    <SmartphoneIcon size={24} />
                  </div>

                  <div>
                    <div
                      className="mono-data"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: isDeviceConnected ? "var(--success)" : "var(--mist-200)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {isDeviceConnected
                        ? `${activeDevice?.model ?? "ANDROID DEVICE"} ONLINE`
                        : "YOUR PHONE IS NOT CONNECTED"}
                    </div>
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        marginTop: "4px",
                        maxWidth: "24ch",
                      }}
                    >
                      {isDeviceConnected
                        ? "Device authorized. Click below to start stream mirroring."
                        : "Waiting for a connection… Plug in your phone via USB with USB debugging enabled."}
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    {isDeviceConnected && (
                      <button
                        onClick={handleStartMirror}
                        disabled={isStarting}
                        style={{
                          padding: "6px 14px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--success)",
                          border: "1px solid var(--success)",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#06141B",
                          opacity: isStarting ? 0.6 : 1,
                          cursor: isStarting ? "not-allowed" : "pointer",
                        }}
                      >
                        {isStarting ? "Starting…" : "Start Stream"}
                      </button>
                    )}

                    <button
                      onClick={() => setIsWizardActive(true)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--ink-800)",
                        border: "1px solid var(--border)",
                        fontSize: "11px",
                        color: "var(--mist-200)",
                      }}
                    >
                      Setup Guide
                    </button>
                  </div>

                  <div
                    className="mono-data"
                    style={{
                      fontSize: "11px",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: "var(--ink-900)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--mist-400)",
                    }}
                  >
                    {scaledOptions.aspectRatio.width}:{scaledOptions.aspectRatio.height} • {currentColorDef.name}
                  </div>

                </div>
              )}
            </div>
          </div>
          </PhoneFrame>
        </div>
      </div>

      {/* Settings page (right region): permanently reserved strip, fixed to the
          screen's right edge; phone drag can never reach or move it */}
      {showInspector && (
        <aside
          className="app-no-drag"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            bottom: "12px",
            width: "320px",
            minWidth: "320px",
            maxWidth: "320px",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            overflowY: "auto",
            zIndex: 90,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "var(--mist-200)",
              }}
            >
              Frame Inspector
            </h3>
            <button
              onClick={() => setShowInspector(false)}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
            >
              Done
            </button>
          </div>

          {/* Real ADB Hardware Telemetry Card */}
          <div
            style={{
              padding: "var(--space-3)",
              backgroundColor: "var(--ink-950)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                ADB Link
              </span>
              <span
                className="mono-data"
                style={{
                  fontSize: "10px",
                  color:
                    adbStatus.state === "device"
                      ? "var(--success)"
                      : adbStatus.state === "unauthorized"
                      ? "var(--warning)"
                      : "var(--ink-600)",
                }}
              >
                {adbStatus.state.toUpperCase()}
              </span>
            </div>

            <table className="mono-data" style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Devices:</td>
                  <td style={{ textAlign: "right", color: "var(--mist-200)" }}>{adbStatus.devices.length}</td>
                </tr>
                {activeDevice && (
                  <>
                    <tr>
                      <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Model:</td>
                      <td style={{ textAlign: "right", color: "var(--mist-200)" }}>{activeDevice.model ?? "Generic"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Serial:</td>
                      <td style={{ textAlign: "right", color: "var(--mist-400)" }}>{activeDevice.serial}</td>
                    </tr>
                    {activeDevice.width && (
                      <tr>
                        <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Display:</td>
                        <td style={{ textAlign: "right", color: "var(--mist-200)" }}>
                          {activeDevice.width} × {activeDevice.height}
                        </td>
                      </tr>
                    )}
                  </>
                )}
                <tr>
                  <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Mirror Engine:</td>
                  <td style={{ textAlign: "right", color: isStreaming ? "var(--success)" : "var(--mist-400)" }}>
                    {mirrorState.toUpperCase()}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Mirror Stream Action Buttons */}
            {isDeviceConnected && (
              <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                {!isStreaming ? (
                  <button
                    onClick={handleStartMirror}
                    disabled={isStarting}
                    style={{
                      flex: 1,
                      padding: "6px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--ink-800)",
                      border: "1px solid var(--border)",
                      fontSize: "11px",
                      color: "var(--mist-200)",
                      opacity: isStarting ? 0.6 : 1,
                      cursor: isStarting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isStarting ? "Starting…" : "Start Stream"}
                  </button>
                ) : (
                  <button
                    onClick={handleStopMirror}
                    style={{
                      flex: 1,
                      padding: "6px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--danger)",
                      border: "1px solid var(--danger)",
                      fontSize: "11px",
                      color: "#06141B",
                      fontWeight: 600,
                    }}
                  >
                    Stop Stream
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quick Setup Wizard Toggle */}
          <div
            style={{
              padding: "var(--space-3)",
              backgroundColor: "var(--ink-950)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--mist-200)" }}>
                USB Setup Guide
              </div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                {isWizardActive ? "Active on phone display" : "Inactive"}
              </div>
            </div>
            <button
              onClick={() => setIsWizardActive(!isWizardActive)}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: isWizardActive ? "var(--ink-800)" : "transparent",
                border: "1px solid var(--border)",
                fontSize: "11px",
                color: isWizardActive ? "var(--mist-200)" : "var(--text-muted)",
              }}
            >
              {isWizardActive ? "Hide" : "Show"}
            </button>
          </div>

          {/* Zoom / Scale Control */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Scale Factor
              </span>
              <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
                {scale}%
              </span>
            </div>
            <input
              type="range"
              min="60"
              max="140"
              step="5"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
            />
          </div>

          {/* Frame Controls Component */}
          <FrameControls options={frameOptions} onChange={setFrameOptions} />
        </aside>
      )}
    </div>
  );
};
