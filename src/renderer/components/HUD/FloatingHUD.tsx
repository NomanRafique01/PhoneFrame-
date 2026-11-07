import React, { useRef, useState } from "react";
import {
  ChevronLeftIcon,
  DPadIcon,
  HandIcon,
  PinIcon,
  RefreshCwIcon,
  RotateIcon,
  SettingsIcon,
  MinimizeIcon,
  CloseIcon,
  VolumeIcon,
  VolumeOffIcon,
  WifiIcon,
  WifiOffIcon,
  AddScreenIcon,
} from "../icons";

interface FloatingHUDProps {
  onAddScreen?: () => void;
  canAddScreen?: boolean;
  totalScreens?: number;
  onCloseScreen?: () => void;
  canCloseScreen?: boolean;
  connectionMode?: "usb" | "wifi" | null;
  dragMode: boolean;
  onToggleDragMode: () => void;
  dpadEnabled: boolean;
  onToggleDpad: () => void;
  onCollapse: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onRotate: () => void;
  audioMuted: boolean;
  onToggleAudio: () => void;
  audioVolume: number;
  onAudioVolumeChange: (volume: number) => void;
  isWireless?: boolean;
  isStreaming?: boolean;
  wifiBusy?: boolean;
  onSwitchToWifi?: () => void;
  onDisconnectWifi?: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

interface VolumeSliderProps {
  value: number;
  onChange: (volume: number) => void;
}

/**
 * Vertical 0–100% rail. The whole column is the hit area, and pointer capture
 * keeps the drag alive even when the cursor leaves the rail.
 */
const VolumeSlider: React.FC<VolumeSliderProps> = ({ value, onChange }) => {
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const updateFromPointer = (clientY: number) => {
    const slider = sliderRef.current;
    if (!slider) return;
    const rect = slider.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    onChange(Math.min(1, Math.max(0, ratio)));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    updateFromPointer(event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      onChange(Math.min(1, value + 0.05));
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      onChange(Math.max(0, value - 0.05));
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      onChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      onChange(1);
    }
  };

  return (
    <div
      ref={sliderRef}
      className="hud-volume-slider"
      role="slider"
      aria-label="Sound level"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)}%`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      style={{
        position: "relative",
        width: "28px",
        height: "132px",
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: "4px",
          transform: "translateX(-50%)",
          borderRadius: "2px",
          backgroundColor: "var(--border)",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 0,
          width: "4px",
          height: `${value * 100}%`,
          transform: "translateX(-50%)",
          borderRadius: "2px",
          backgroundColor: "var(--mist-200)",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          bottom: `${value * 100}%`,
          width: "12px",
          height: "12px",
          transform: "translate(-50%, 50%)",
          borderRadius: "50%",
          backgroundColor: "var(--mist-200)",
          border: "1px solid var(--ink-950)",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.55)",
        }}
      />
    </div>
  );
};

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  connectionMode,
  dragMode,
  onToggleDragMode,
  dpadEnabled,
  onToggleDpad,
  onCollapse,
  isPinned,
  onTogglePin,
  onRotate,
  audioMuted,
  onToggleAudio,
  audioVolume,
  onAudioVolumeChange,
  isWireless,
  isStreaming,
  wifiBusy,
  onSwitchToWifi,
  onDisconnectWifi,
  showInspector,
  onToggleInspector,
  onMinimize,
  onClose,
  onAddScreen,
  canAddScreen = true,
  totalScreens = 1,
  onCloseScreen,
  canCloseScreen = false,
}) => {
  const [wifiHover, setWifiHover] = useState(false);

  return (
    <nav
      className="app-no-drag floating-hud"
      aria-label="Window and device controls"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        padding: "6px 4px",
        backgroundColor: "rgba(17, 33, 45, 0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-hud)",
        transition: "opacity 160ms cubic-bezier(0.16, 1, 0.3, 1), transform 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Collapse HUD */}
      <button
        onClick={onCollapse}
        title="Collapse HUD"
        aria-label="Collapse HUD"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
      >
        <ChevronLeftIcon size={16} />
      </button>

      {/* Hand / Phone Drag Mode */}
      <button
        onClick={onToggleDragMode}
        title={dragMode ? "Disable drag mode" : "Enable drag mode (press and hold the phone)"}
        aria-pressed={dragMode}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: dragMode ? "var(--ink-800)" : "transparent",
          color: dragMode ? "var(--mist-200)" : "var(--mist-400)",
          border: dragMode ? "1px solid var(--border)" : "1px solid transparent",
        }}
      >
        <HandIcon size={16} />
      </button>

      {/* On-screen D-Pad / directional scroll controls */}
      <button
        onClick={onToggleDpad}
        title={dpadEnabled ? "Hide scroll pad" : "Show scroll pad"}
        aria-label={dpadEnabled ? "Hide scroll pad" : "Show scroll pad"}
        aria-pressed={dpadEnabled}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: dpadEnabled ? "var(--ink-800)" : "transparent",
          color: dpadEnabled ? "var(--mist-200)" : "var(--mist-400)",
          border: dpadEnabled ? "1px solid var(--border)" : "1px solid transparent",
        }}
      >
        <DPadIcon size={16} />
      </button>

      {/* Pin Always-on-Top */}
      <button
        onClick={onTogglePin}
        title={isPinned ? "Unpin window (floating on top)" : "Pin window always on top"}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: isPinned ? "var(--ink-800)" : "transparent",
          color: isPinned ? "var(--mist-200)" : "var(--mist-400)",
          border: isPinned ? "1px solid var(--border)" : "1px solid transparent",
        }}
      >
        <PinIcon size={16} />
      </button>

      {/* Rotate Orientation */}
      <button
        onClick={onRotate}
        title="Rotate phone orientation (Portrait / Landscape)"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
      >
        <RotateIcon size={16} />
      </button>

      {/* Phone audio routed to the PC — hover reveals the level rail */}
      <div
        className="hud-audio-control"
        style={{ position: "relative", display: "flex", width: "36px", height: "36px" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          onClick={onToggleAudio}
          title={audioMuted ? "Unmute phone sound on this PC" : "Mute phone sound on this PC"}
          aria-label={audioMuted ? "Unmute phone sound on this PC" : "Mute phone sound on this PC"}
          aria-pressed={!audioMuted}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: audioMuted ? "transparent" : "var(--ink-800)",
            color: audioMuted ? "var(--mist-400)" : "var(--mist-200)",
            border: audioMuted ? "1px solid transparent" : "1px solid var(--border)",
          }}
        >
          {audioMuted ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />}
        </button>

        <div
          className="hud-volume-flyout"
          style={{
            position: "absolute",
            top: "50%",
            left: "100%",
            zIndex: 10,
            paddingLeft: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "6px",
              padding: "8px 6px 6px",
              backgroundColor: "rgba(17, 33, 45, 0.96)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-hud)",
            }}
          >
            <span
              className="mono-data"
              aria-hidden="true"
              style={{ fontSize: "9px", lineHeight: 1, color: "var(--mist-400)" }}
            >
              {Math.round(audioVolume * 100)}
            </span>
            <VolumeSlider value={audioVolume} onChange={onAudioVolumeChange} />
          </div>
        </div>
      </div>

      {/* 1-Click Switch to Wi-Fi button (available in USB mode / wired mode) */}
      {!isWireless && onSwitchToWifi && (
        <button
          onClick={onSwitchToWifi}
          disabled={wifiBusy}
          aria-busy={wifiBusy}
          title={wifiBusy ? "Switching to Wi-Fi…" : "1-Click: Switch stream to Wi-Fi mode"}
          aria-label="Switch to Wi-Fi mode"
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: wifiBusy ? "rgba(138, 230, 196, 0.2)" : "rgba(138, 230, 196, 0.08)",
            color: "var(--accent)",
            border: "1px solid rgba(138, 230, 196, 0.35)",
            cursor: wifiBusy ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "2px",
            transition: "all 0.15s ease",
          }}
        >
          {wifiBusy ? <RefreshCwIcon size={15} className="spin" /> : <WifiIcon size={16} />}
        </button>
      )}

      {/* Wireless Active Indicator & Disconnect Wi-Fi Button */}
      {isWireless && (
        <button
          onClick={onDisconnectWifi}
          onMouseEnter={() => setWifiHover(true)}
          onMouseLeave={() => setWifiHover(false)}
          disabled={wifiBusy}
          title={
            wifiBusy
              ? "Disconnecting Wi-Fi…"
              : "Wi-Fi stream connected • Click to disconnect"
          }
          aria-label="Disconnect Wi-Fi stream"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: wifiHover
              ? "rgba(239, 68, 68, 0.2)"
              : "rgba(138, 230, 196, 0.14)",
            border: wifiHover
              ? "1px solid rgba(239, 68, 68, 0.55)"
              : "1px solid rgba(138, 230, 196, 0.35)",
            color: wifiHover ? "#ef4444" : "var(--accent)",
            cursor: wifiBusy ? "not-allowed" : "pointer",
            marginBottom: "2px",
            transition: "all 0.18s ease",
          }}
        >
          {wifiBusy ? (
            <RefreshCwIcon size={15} className="spin" />
          ) : wifiHover ? (
            <WifiOffIcon size={16} />
          ) : (
            <WifiIcon size={16} />
          )}
        </button>
      )}

      {/* Add Screen (Multi-display up to 4 independent screens) */}
      {onAddScreen && (
        <button
          onClick={onAddScreen}
          disabled={!canAddScreen}
          title={
            canAddScreen
              ? `Add new phone screen (${totalScreens}/4 active)`
              : "Maximum 4 screens reached"
          }
          aria-label="Add new phone screen"
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "transparent",
            color: canAddScreen ? "var(--accent)" : "var(--ink-600)",
            border: "1px solid transparent",
            opacity: canAddScreen ? 1 : 0.45,
            cursor: canAddScreen ? "pointer" : "not-allowed",
          }}
        >
          <AddScreenIcon size={16} />
        </button>
      )}

      {/* Inspector / Frame Customizer Drawer */}
      <button
        onClick={onToggleInspector}
        // Lets the global dismiss-on-click handler leave this toggle alone.
        data-inspector-toggle="true"
        title={showInspector ? "Close Frame Inspector" : "Open Frame Inspector"}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: showInspector ? "var(--ink-800)" : "transparent",
          color: showInspector ? "var(--mist-200)" : "var(--mist-400)",
          border: showInspector ? "1px solid var(--border)" : "1px solid transparent",
        }}
      >
        <SettingsIcon size={16} />
      </button>

      {/* Divider */}
      <div
        style={{
          width: "20px",
          height: "1px",
          backgroundColor: "var(--border)",
          margin: "2px 0",
        }}
      />

      {/* Minimize Window */}
      <button
        onClick={onMinimize}
        title="Minimize window"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
      >
        <MinimizeIcon size={16} />
      </button>

      {/* Close Window / Close Screen */}
      <button
        onClick={onClose}
        title={canCloseScreen ? "Close this phone screen" : "Close FloatingPhone"}
        aria-label={canCloseScreen ? "Close this phone screen" : "Close FloatingPhone"}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ef4444";
          e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--mist-400)";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <CloseIcon size={16} />
      </button>
    </nav>
  );
};

