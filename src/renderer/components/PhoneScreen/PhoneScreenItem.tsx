import React, { useState, useEffect, useRef } from "react";
import {
  PhoneFrame,
  type PhoneFrameOptions,
  resolveFrameColor,
} from "../PhoneFrame";
import { FloatingHUD, DeviceNameHUD } from "../HUD";
import { SetupWizard } from "../SetupWizard";
import { VideoCanvas } from "../VideoCanvas/VideoCanvas";
import { ChevronRightIcon, SmartphoneIcon, RefreshCwIcon } from "../icons";
import { NoticeBanner } from "../Notice/NoticeBanner";
import { usePhoneAudio } from "../../audio/usePhoneAudio";
import type { AdbStatusPayload, MirrorState } from "../../types/electron";

const ORIENTATION_SETTLE_MS = 160;

export interface PhoneScreenItemProps {
  screenId: string;
  name: string;
  slotNumber?: number;
  connectionMode?: "usb" | "wifi" | null;
  isNameAssigned?: boolean;
  options: PhoneFrameOptions;
  scale: number;
  offset: { x: number; y: number };
  zIndex: number;
  opacity: number;
  isDragging: boolean;
  isHovered: boolean;
  dragMode: boolean;
  isPinned: boolean;
  totalScreens: number;
  canAddScreen: boolean;
  canCloseScreen: boolean;
  adbStatus: AdbStatusPayload;
  occupiedSerials?: string[];
  isInspecting: boolean;
  isBackgrounded?: boolean;
  isFullscreen: boolean;
  onAddScreen: () => void;
  onCloseScreen: () => void;
  onToggleInspector: () => void;
  onTogglePin: () => void;
  onToggleDragMode: () => void;
  onUpdateName: (name: string) => void;
  onNameAssigned?: () => void;
  onUpdateConnectionMode?: (mode: "usb" | "wifi" | null) => void;
  onOptionsChange: (opts: PhoneFrameOptions) => void;
  onScaleChange: (scale: number) => void;
  onSerialAssigned?: (serial: string) => void;
  onSerialReleased?: () => void;
  onDragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onInteractionChange: (active: boolean) => void;
  onMinimize: () => void;
  onClose: () => void;
}

export const PhoneScreenItem: React.FC<PhoneScreenItemProps> = ({
  screenId,
  name,
  slotNumber,
  connectionMode,
  isNameAssigned,
  options,
  scale,
  offset,
  zIndex,
  opacity,
  isDragging,
  isHovered,
  dragMode,
  isPinned,
  totalScreens,
  canAddScreen,
  canCloseScreen,
  adbStatus,
  occupiedSerials = [],
  isInspecting,
  isBackgrounded = false,
  isFullscreen,
  onAddScreen,
  onCloseScreen,
  onToggleInspector,
  onTogglePin,
  onToggleDragMode,
  onUpdateName,
  onNameAssigned,
  onUpdateConnectionMode,
  onOptionsChange,
  onScaleChange,
  onSerialAssigned,
  onSerialReleased,
  onDragStart,
  onDragMove,
  onDragEnd,
  onLostPointerCapture,
  onMouseEnter,
  onMouseLeave,
  onInteractionChange,
  onMinimize,
  onClose,
}) => {
  const [mirrorState, setMirrorState] = useState<MirrorState>("stopped");
  const [isWizardActive, setIsWizardActive] = useState(true);
  const [dpadEnabled, setDpadEnabled] = useState(false);
  const [touchHudOpen, setTouchHudOpen] = useState(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  const [isHudHovered, setIsHudHovered] = useState(false);
  const [hudHeight, setHudHeight] = useState(0);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [isSwitchingToWifi, setIsSwitchingToWifi] = useState(false);
  const [wifiBusy, setWifiBusy] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.55);

  usePhoneAudio(audioMuted, audioVolume, screenId);

  const prevMirrorStateRef = useRef<MirrorState>("stopped");
  const orientationTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const isSwitchingToWifiRef = useRef(false);
  const pendingOrientationRef = useRef<{
    orientation: "portrait" | "landscape";
    aspectRatio: { width: number; height: number };
  } | null>(null);

  const hudDrawerRef = useRef<HTMLDivElement>(null);
  const phoneWrapRef = useRef<HTMLDivElement>(null);

  const showSessionNotice = (text: string) => {
    setSessionNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setSessionNotice(null), 5000);
  };

  // Listen to mirror state changes specifically for this screen
  useEffect(() => {
    if (!window.electronAPI?.onMirrorStateChange) return;

    const unsub = window.electronAPI.onMirrorStateChange((payload) => {
      if (payload.screenId && payload.screenId !== screenId) return;
      const wasActive =
        prevMirrorStateRef.current === "running" || prevMirrorStateRef.current === "starting";
      const isEnded = payload.state === "stopped" || payload.state === "error";
      prevMirrorStateRef.current = payload.state;

      if (isEnded && isSwitchingToWifiRef.current) {
        // The switch tears the USB stream down on purpose; keep the last
        // frame under the overlay instead of dropping to the setup view.
        return;
      }

      setMirrorState(payload.state);

      if (payload.state === "running" && isSwitchingToWifiRef.current) {
        // New Wi-Fi stream is live: fade the switch overlay away, but keep
        // swallowing trailing stop events from the torn-down USB link.
        setIsSwitchingToWifi(false);
        window.setTimeout(() => {
          isSwitchingToWifiRef.current = false;
        }, 1200);
      }

      if (wasActive && isEnded) {
        setIsWizardActive(true);
        onUpdateConnectionMode?.(null);
        onSerialReleased?.();
        showSessionNotice(payload.state === "error" ? "Connection failed" : "Stream stopped");
      }
    }, screenId);

    return () => {
      unsub();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (orientationTimerRef.current) window.clearTimeout(orientationTimerRef.current);
    };
  }, [screenId]);

  // Handle stream orientation changes
  const scheduleStreamOrientation = (width: number, height: number) => {
    if (!width || !height) return;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    const ratioW = Math.round((width / divisor) * 10) / 10;
    const ratioH = Math.round((height / divisor) * 10) / 10;

    pendingOrientationRef.current = {
      orientation: width >= height ? "landscape" : "portrait",
      aspectRatio: {
        width: Math.min(ratioW, ratioH),
        height: Math.max(ratioW, ratioH),
      },
    };

    if (orientationTimerRef.current !== null) {
      window.clearTimeout(orientationTimerRef.current);
    }
    orientationTimerRef.current = window.setTimeout(() => {
      orientationTimerRef.current = null;
      const next = pendingOrientationRef.current;
      if (!next) return;
      onOptionsChange({
        ...options,
        orientation: next.orientation,
        aspectRatio: next.aspectRatio,
      });
    }, ORIENTATION_SETTLE_MS);
  };

  const handleStartMirror = async (chosenSerial?: string) => {
    const serial = chosenSerial || adbStatus.activeDevice?.serial;
    if (!serial || !window.electronAPI) return;
    onSerialAssigned?.(serial);
    setMirrorState("starting");
    setIsWizardActive(false);
    try {
      const ok = await window.electronAPI.startMirror(serial, screenId);
      if (!ok) {
        setMirrorState("error");
        setIsWizardActive(true);
        onSerialReleased?.();
      }
    } catch {
      setMirrorState("error");
      setIsWizardActive(true);
      onSerialReleased?.();
    }
  };

  const handleStopMirror = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.stopMirror(screenId);
    setMirrorState("stopped");
    setIsWizardActive(true);
    onUpdateConnectionMode?.(null);
    onSerialReleased?.();
  };

  const handleSwitchToWifi = async () => {
    const serial = activeDevice?.serial;
    if (!serial || !window.electronAPI) {
      showSessionNotice("✕ No device available to switch to Wi-Fi.");
      return;
    }
    if (wifiBusy) return;

    // Latch before touching ADB: enabling tcpip restarts the link, so the
    // stop event of the USB stream must not be read as a real stream end.
    isSwitchingToWifiRef.current = true;
    setIsSwitchingToWifi(true);
    setWifiBusy(true);

    const stopCurrentStream = async () => {
      if (mirrorState === "running" || mirrorState === "starting") {
        try {
          await window.electronAPI?.stopMirror(screenId);
        } catch {}
      }
    };

    const failSwitch = async (message: string) => {
      setIsSwitchingToWifi(false);
      showSessionNotice(message);
      // Let the notice land on the last frame before the stream closes.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await stopCurrentStream();
      setMirrorState("stopped");
      setIsWizardActive(true);
      onUpdateConnectionMode?.(null);
      onSerialReleased?.();
      // Keep swallowing the stop event until it has definitely landed.
      window.setTimeout(() => {
        isSwitchingToWifiRef.current = false;
      }, 1500);
    };

    try {
      const res = await window.electronAPI.enableWireless(serial);
      if (!res.success || !res.ip) {
        await failSwitch(`✕ Could not switch to Wi-Fi. ${res.error || "Phone stayed on USB."}`);
        return;
      }

      const wifiSerial = `${res.ip}:5555`;
      await stopCurrentStream();
      await new Promise((r) => setTimeout(r, 600));

      onSerialAssigned?.(wifiSerial);
      const ok = await window.electronAPI.startMirror(wifiSerial, screenId);
      if (!ok) {
        await failSwitch("✕ The Wi-Fi stream could not start. Back to setup.");
        return;
      }

      showSessionNotice("✓ Streaming over Wi-Fi! You can now unplug the USB cable.");
      // The running event normally clears the overlay; this is the fallback.
      window.setTimeout(() => {
        isSwitchingToWifiRef.current = false;
        setIsSwitchingToWifi(false);
      }, 4000);
    } catch (e: any) {
      await failSwitch(`✕ ${e?.message || "Error switching to Wi-Fi"}. Stream ended.`);
    } finally {
      setWifiBusy(false);
    }
  };

  const handleDisconnectWifi = async () => {
    if (!window.electronAPI) return;
    const serial = activeDevice?.serial;
    setWifiBusy(true);
    try {
      if (mirrorState === "running" || mirrorState === "starting") {
        await window.electronAPI.stopMirror(screenId);
      }
      if (serial) {
        await window.electronAPI.disconnectWireless(serial);
      }
      setIsWizardActive(true);
      onUpdateConnectionMode?.(null);
      onSerialReleased?.();
      showSessionNotice("Wi-Fi stream disconnected.");
    } catch (e: any) {
      showSessionNotice(`✕ ${e?.message || "Error disconnecting Wi-Fi"}`);
    } finally {
      setWifiBusy(false);
    }
  };

  const handleRotate = () => {
    const nextOrientation = options.orientation === "portrait" ? "landscape" : "portrait";
    onOptionsChange({ ...options, orientation: nextOrientation });
  };

  // Dimensions
  const frameScale = scale / 75;
  const scaledOptions: PhoneFrameOptions = {
    ...options,
    baseScreenWidth: Math.round((360 * scale) / 100),
    bezelWidth: Math.round((options.bezelWidth * scale) / 100),
    outerRadius: Math.round((options.outerRadius * scale) / 100),
    screenRadius: Math.round((options.screenRadius * scale) / 100),
  };

  const isPortrait = scaledOptions.orientation === "portrait";
  const ratioMultiplier = scaledOptions.aspectRatio.height / scaledOptions.aspectRatio.width;
  const screenWidth = Math.round(isPortrait ? scaledOptions.baseScreenWidth : scaledOptions.baseScreenWidth * ratioMultiplier);
  const screenHeight = Math.round(isPortrait ? scaledOptions.baseScreenWidth * ratioMultiplier : scaledOptions.baseScreenWidth);

  const currentColorDef = resolveFrameColor(options.color, options.customColorHex);
  const activeDevice = adbStatus.activeDevice;
  const isDeviceConnected = adbStatus.state === "device";
  const isStreaming = mirrorState === "running";
  const isStarting = mirrorState === "starting";

  const hudVisible = !isHudCollapsed && !isBackgrounded && (isHovered || isHudHovered || isInspecting || isDragging || touchHudOpen);
  const effectiveHudVisible = hudVisible && !isFullscreen;

  // Collapsed side key metrics
  const sideKeyProtrusion = Math.max(5, Math.round(10 * frameScale));
  const sideKeyInset = Math.max(2, scaledOptions.bezelWidth - 2);
  const sideKeyWidth = sideKeyInset + sideKeyProtrusion;
  const sideKeyHeight = Math.max(24, Math.round(34 * frameScale));
  const sideKeyRadius = Math.max(3, Math.round(4 * frameScale));
  const sideKeyChevron = Math.max(7, Math.round(8 * frameScale));

  const frameHeight = screenHeight + scaledOptions.bezelWidth * 2;
  const desiredKeyTop =
    hudHeight > 0 ? frameHeight / 2 - (hudHeight / 2 - 24) : frameHeight * 0.41;
  const minKeyTop = scaledOptions.outerRadius + sideKeyHeight / 2;
  const maxKeyTop = frameHeight - scaledOptions.outerRadius - sideKeyHeight / 2;
  const collapsedKeyTop = `${Math.round(
    Math.min(Math.max(desiredKeyTop, minKeyTop), maxKeyTop)
  )}px`;

  return (
    <div
      ref={phoneWrapRef}
      className="phone-screen-wrap"
      data-screen-id={screenId}
      style={{
        position: "absolute",
        display: "flex",
        zIndex,
        opacity,
        pointerEvents: isBackgrounded ? "none" : "auto",
        filter: opacity < 0.95 ? "brightness(0.95)" : "none",
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: isDragging
          ? "none"
          : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms cubic-bezier(0.22, 1, 0.36, 1), filter 280ms ease",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onLostPointerCapture={onLostPointerCapture}
    >
      {/* Top Device Name Panel: Flush attached to top of frame */}
      <DeviceNameHUD
        name={name}
        isStreaming={isStreaming}
        isDeviceConnected={isDeviceConnected}
        isWireless={Boolean(activeDevice?.isWireless)}
        frameScale={frameScale}
        visible={effectiveHudVisible}
        onClick={onToggleInspector}
        canCloseScreen={canCloseScreen}
        onCloseScreen={onCloseScreen}
      />

      {/* Floating Contextual HUD Drawer */}
      <div
        className="hud-drawer"
        ref={hudDrawerRef}
        onMouseEnter={() => {
          onMouseEnter();
          setIsHudHovered(true);
        }}
        onMouseLeave={() => {
          setIsHudHovered(false);
          onMouseLeave();
        }}
        style={{
          position: "absolute",
          top: "50%",
          left: "100%",
          paddingLeft: "10px",
          right: "auto",
          zIndex: 100,
          opacity: effectiveHudVisible ? 1 : 0,
          pointerEvents: effectiveHudVisible ? "auto" : "none",
          transform: effectiveHudVisible
            ? "translateY(-50%) translateX(0)"
            : "translateY(-50%) translateX(-14px)",
          transition: effectiveHudVisible
            ? "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <FloatingHUD
          connectionMode={connectionMode ?? (activeDevice?.isWireless ? "wifi" : null)}
          dragMode={dragMode}
          onToggleDragMode={onToggleDragMode}
          dpadEnabled={dpadEnabled}
          onToggleDpad={() => setDpadEnabled((d) => !d)}
          onCollapse={() => setIsHudCollapsed(true)}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onRotate={handleRotate}
          audioMuted={audioMuted}
          onToggleAudio={() => setAudioMuted((m) => !m)}
          audioVolume={audioVolume}
          onAudioVolumeChange={setAudioVolume}
          isWireless={Boolean(activeDevice?.isWireless)}
          isStreaming={isStreaming}
          wifiBusy={wifiBusy}
          onSwitchToWifi={handleSwitchToWifi}
          onDisconnectWifi={handleDisconnectWifi}
          showInspector={isInspecting}
          onToggleInspector={onToggleInspector}
          onMinimize={onMinimize}
          onClose={canCloseScreen ? onCloseScreen : onClose}
          onAddScreen={onAddScreen}
          canAddScreen={canAddScreen}
          totalScreens={totalScreens}
          canCloseScreen={canCloseScreen}
          onCloseScreen={onCloseScreen}
        />
      </div>

      {/* Collapsed HUD side key */}
      <button
        type="button"
        className="app-no-drag hud-side-key"
        onClick={() => setIsHudCollapsed(false)}
        title="Expand HUD"
        aria-label="Expand HUD"
        aria-expanded={!isHudCollapsed}
        style={{
          position: "absolute",
          top: collapsedKeyTop,
          left: `calc(100% - ${sideKeyInset}px)`,
          zIndex: 100,
          width: `${sideKeyWidth}px`,
          height: `${sideKeyHeight}px`,
          padding: 0,
          background: "transparent",
          border: "none",
          outlineOffset: "1px",
          opacity: isHudCollapsed && !isFullscreen ? 1 : 0,
          pointerEvents: isHudCollapsed && !isFullscreen ? "auto" : "none",
          transform: `translateY(-50%) translateX(${isHudCollapsed && !isFullscreen ? 0 : -10}px)`,
          transition:
            "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms cubic-bezier(0.22, 1, 0.36, 1), filter 120ms ease",
        }}
      >
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
          {/* Status bar */}
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

          {/* Main Screen Content */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden", backgroundColor: "#050B0E" }}>
            {isWizardActive ? (
              <SetupWizard
                adbStatus={adbStatus}
                occupiedSerials={occupiedSerials}
                notice={sessionNotice}
                deviceName={name}
                slotNumber={slotNumber}
                isNameAssigned={isNameAssigned}
                initialMode={connectionMode}
                onDeviceNameChange={onUpdateName}
                onNameAssigned={onNameAssigned}
                onSelectMode={onUpdateConnectionMode}
                onSerialAssigned={onSerialAssigned}
                onComplete={handleStartMirror}
                onDismiss={() => setIsWizardActive(false)}
              />
            ) : isStreaming || isStarting ? (
              <>
                <VideoCanvas
                  screenId={screenId}
                  width={screenWidth}
                  height={screenHeight}
                  isStreaming={isStreaming}
                  dragMode={dragMode}
                  isDragging={isDragging}
                  showDpad={dpadEnabled}
                  onInteractionChange={onInteractionChange}
                  onStreamSizeChange={scheduleStreamOrientation}
                />
                {/* Switch overlay: holds the last frame while the USB stream is
                    re-routed over Wi-Fi, so the view never drops to standby. */}
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 70,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                    padding: "24px 20px",
                    textAlign: "center",
                    backgroundColor: "rgba(5, 11, 14, 0.86)",
                    backdropFilter: "blur(3px)",
                    WebkitBackdropFilter: "blur(3px)",
                    opacity: isSwitchingToWifi ? 1 : 0,
                    pointerEvents: isSwitchingToWifi ? "auto" : "none",
                    transition: "opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  <div
                    style={{
                      width: "46px",
                      height: "46px",
                      borderRadius: "50%",
                      backgroundColor: "var(--ink-900)",
                      border: "1px solid var(--border)",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <RefreshCwIcon size={20} className="spin" />
                  </div>
                  <div>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--mist-100)" }}>
                      Switching to Wi-Fi
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        lineHeight: 1.5,
                        color: "var(--mist-400)",
                        marginTop: "4px",
                        maxWidth: "26ch",
                      }}
                    >
                      Re-routing this stream over your local network. Keep the USB cable plugged in until it reconnects.
                    </div>
                  </div>
                  <div
                    className="mono-data"
                    style={{ fontSize: "9px", letterSpacing: "0.08em", color: "var(--mist-400)" }}
                  >
                    THIS TAKES 3–5 SECONDS
                  </div>
                </div>
                {sessionNotice && (
                  <NoticeBanner message={sessionNotice} style={{ zIndex: 80 }} />
                )}
              </>
            ) : (
              /* Standby view */
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
                  background: "#050B0E",
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
                      : occupiedSerials.length > 0
                      ? "USB PORT OCCUPIED"
                      : "PHONE NOT CONNECTED"}
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
                      ? `Device ready (${activeDevice?.isWireless ? "Wi-Fi" : "Independent Port"}). Click below to start stream.`
                      : occupiedSerials.length > 0
                      ? "Another screen is using this USB port. Connect a phone on another USB port or Wi-Fi."
                      : "Plug in device or use Wi-Fi mode."}
                  </p>
                </div>

                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {isDeviceConnected && (
                    <button
                      onClick={() => handleStartMirror()}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--success)",
                        border: "1px solid var(--success)",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#06141B",
                        cursor: "pointer",
                      }}
                    >
                      Start Stream
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
              </div>
            )}
          </div>
        </div>
      </PhoneFrame>
    </div>
  );
};

