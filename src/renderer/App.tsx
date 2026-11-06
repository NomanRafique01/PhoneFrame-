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
import { SmartphoneIcon } from "./components/icons";
import type { AdbStatusPayload, MirrorState } from "./types/electron";

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
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  const [isPinned, setIsPinned] = useState(true);
  const [scale, setScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("phoneframe_scale_v3") ?? localStorage.getItem("phoneframe_scale_v2");
      const parsed = saved ? Number(saved) : NaN;
      if (isNaN(parsed) || parsed < 60 || parsed > 140) {
        return 80;
      }
      return parsed;
    } catch {
      return 80;
    }
  });
  const [showInspector, setShowInspector] = useState(false);
  const [isWizardActive, setIsWizardActive] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [phoneOffset, setPhoneOffset] = useState({ x: 0, y: 0 });
  const hideTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneWrapRef = useRef<HTMLDivElement>(null);

  // Persist scale preference across sessions
  useEffect(() => {
    try {
      localStorage.setItem("phoneframe_scale_v3", String(scale));
    } catch {
      // Ignore storage restrictions
    }
  }, [scale]);

  // Subscribe to real-time ADB status events & mirror state
  useEffect(() => {
    // Initial ADB fetch
    if (window.electronAPI?.getAdbStatus) {
      window.electronAPI.getAdbStatus().then((status) => {
        if (status) setAdbStatus(status);
      });
    }

    // ADB event listener
    if (window.electronAPI?.onAdbStatusChange) {
      const unsubscribeAdb = window.electronAPI.onAdbStatusChange((status) => {
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
        setMirrorState(payload.state);
        if (payload.error) {
          setMirrorError(payload.error);
        } else {
          setMirrorError(null);
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
  useEffect(() => {
    window.electronAPI?.setIgnoreMouseEvents?.(!(isHovered || isDragging || showInspector));
  }, [isHovered, isDragging, showInspector]);

  // Opening the settings page glides the phone back to the center of its page
  useEffect(() => {
    if (showInspector) setPhoneOffset({ x: 0, y: 0 });
  }, [showInspector]);

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
    if (!adbStatus.activeDevice?.serial) return;
    setIsWizardActive(false);
    await window.electronAPI?.startMirror(adbStatus.activeDevice.serial);
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

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  };

  const currentColorDef = FRAME_COLOR_DEFINITIONS[frameOptions.color];
  const activeDevice = adbStatus.activeDevice;
  const isDeviceConnected = adbStatus.state === "device";
  const isStreaming = mirrorState === "running";

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
        >
          {/* Floating Contextual HUD (Hover revealed or always visible when inspector open) */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "calc(100% + 10px)",
              right: "auto",
              zIndex: 100,
              opacity: isHovered || showInspector || isDragging ? 1 : 0,
              pointerEvents: isHovered || showInspector || isDragging ? "auto" : "none",
              transform: isHovered || showInspector || isDragging
                ? "translateY(-50%) translateX(0)"
                : "translateY(-50%) translateX(6px)",
              transition: "opacity 160ms cubic-bezier(0.16, 1, 0.3, 1), transform 160ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <FloatingHUD
              isPinned={isPinned}
              onTogglePin={handleTogglePin}
              onRotate={handleRotate}
              showInspector={showInspector}
              onToggleInspector={() => setShowInspector(!showInspector)}
              onMinimize={handleMinimize}
              onClose={handleClose}
            />
          </div>

          {/* Procedural SVG Phone Frame Engine */}
          <PhoneFrame options={scaledOptions}>
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
                  onComplete={() => {
                    setIsWizardActive(false);
                    if (isDeviceConnected) {
                      handleStartMirror();
                    }
                  }}
                  onDismiss={() => setIsWizardActive(false)}
                />
              ) : isStreaming ? (
                /* Real Video Stream Canvas with WebCodecs GPU decoding */
                <VideoCanvas width={screenWidth} height={screenHeight} isStreaming={isStreaming} />
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
                        : "FLOATING PHONE READY"}
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
                        : "Connect phone via USB with USB debugging enabled."}
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    {isDeviceConnected && (
                      <button
                        onClick={handleStartMirror}
                        style={{
                          padding: "6px 14px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--success)",
                          border: "1px solid var(--success)",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#06141B",
                        }}
                      >
                        Start Mirroring
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

                  {mirrorError && (
                    <div
                      className="mono-data"
                      style={{
                        fontSize: "10px",
                        color: "var(--danger)",
                        marginTop: "4px",
                      }}
                    >
                      {mirrorError}
                    </div>
                  )}

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
                    style={{
                      flex: 1,
                      padding: "6px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--ink-800)",
                      border: "1px solid var(--border)",
                      fontSize: "11px",
                      color: "var(--mist-200)",
                    }}
                  >
                    Start Stream
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
