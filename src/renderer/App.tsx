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

  const [isPinned, setIsPinned] = useState(false);
  const [scale, setScale] = useState(100);
  const [showInspector, setShowInspector] = useState(false);
  const [isWizardActive, setIsWizardActive] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

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

  const totalPhoneWidth = screenWidth + scaledOptions.bezelWidth * 2;
  const totalPhoneHeight = screenHeight + scaledOptions.bezelWidth * 2;

  // Window size adaptation via Electron IPC
  useEffect(() => {
    const PADDING = 48; // padding for drop shadow & hover HUD
    const INSPECTOR_WIDTH = showInspector ? 320 : 0;
    const targetWidth = totalPhoneWidth + PADDING + INSPECTOR_WIDTH;
    const targetHeight = totalPhoneHeight + PADDING;

    if (window.electronAPI?.setWindowSize) {
      window.electronAPI.setWindowSize(targetWidth, targetHeight);
    }
  }, [totalPhoneWidth, totalPhoneHeight, showInspector]);

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

  const currentColorDef = FRAME_COLOR_DEFINITIONS[frameOptions.color];
  const activeDevice = adbStatus.activeDevice;
  const isDeviceConnected = adbStatus.state === "device";
  const isStreaming = mirrorState === "running";

  return (
    <div
      className="floating-phone-root"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        backgroundColor: "transparent",
        color: "var(--text)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Phone Stage Container (Centered with drop shadow padding) */}
      <div
        className="phone-stage"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: "24px",
        }}
      >
        {/* Floating Contextual HUD (Hover revealed or always visible when inspector open) */}
        <div
          style={{
            position: "absolute",
            top: "8px",
            zIndex: 100,
            opacity: isHovered || showInspector ? 1 : 0,
            pointerEvents: isHovered || showInspector ? "auto" : "none",
            transform: isHovered || showInspector ? "translateY(0)" : "translateY(-6px)",
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

      {/* Collapsible Frame Inspector Drawer (Docked to the right of the floating phone) */}
      {showInspector && (
        <aside
          className="app-no-drag"
          style={{
            width: "320px",
            height: "100%",
            backgroundColor: "var(--surface)",
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            overflowY: "auto",
            zIndex: 90,
            boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.5)",
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
