import React from "react";
import { SmartphoneIcon, UsbIcon, WifiIcon } from "../icons";

interface DeviceNameHUDProps {
  name: string;
  isStreaming: boolean;
  isDeviceConnected: boolean;
  isWireless: boolean;
  frameScale: number;
  visible: boolean;
  onClick?: () => void;
}

export const DeviceNameHUD: React.FC<DeviceNameHUDProps> = ({
  name,
  isStreaming,
  isDeviceConnected,
  isWireless,
  frameScale,
  visible,
  onClick,
}) => {
  const scaledPaddingY = Math.max(3, Math.round(5 * frameScale));
  const scaledPaddingX = Math.max(8, Math.round(14 * frameScale));
  const scaledFontSize = Math.max(10, Math.round(11.5 * frameScale));
  const scaledSubFontSize = Math.max(8, Math.round(9 * frameScale));
  const scaledGap = Math.max(5, Math.round(7 * frameScale));
  const scaledRadius = Math.max(5, Math.round(8 * frameScale));
  const scaledIconSize = Math.max(10, Math.round(13 * frameScale));
  const scaledDotSize = Math.max(5, Math.round(6.5 * frameScale));
  const scaledMaxWidth = Math.max(140, Math.round(280 * frameScale));

  const statusColor = isStreaming
    ? "var(--success)"
    : isDeviceConnected
    ? "var(--success)"
    : "var(--mist-400)";

  return (
    <div
      className="app-no-drag device-name-hud"
      onClick={onClick}
      style={{
        position: "absolute",
        bottom: "calc(100% + 10px)",
        left: "50%",
        zIndex: 100,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(-12px)",
        transition: visible
          ? "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)"
          : "transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: `${scaledGap}px`,
          padding: `${scaledPaddingY}px ${scaledPaddingX}px`,
          backgroundColor: "rgba(17, 33, 45, 0.94)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: `${scaledRadius}px`,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-hud)",
          color: "var(--mist-100)",
          cursor: onClick ? "pointer" : "default",
          userSelect: "none",
          whiteSpace: "nowrap",
          transition: "border-color 160ms ease, background-color 160ms ease",
        }}
        onMouseEnter={(e) => {
          if (onClick) {
            e.currentTarget.style.borderColor = "var(--mist-400)";
          }
        }}
        onMouseLeave={(e) => {
          if (onClick) {
            e.currentTarget.style.borderColor = "var(--border)";
          }
        }}
      >
        {/* Status indicator dot */}
        <span
          style={{
            width: `${scaledDotSize}px`,
            height: `${scaledDotSize}px`,
            borderRadius: "50%",
            backgroundColor: statusColor,
            flexShrink: 0,
            boxShadow: isStreaming ? `0 0 8px ${statusColor}` : "none",
            animation: isStreaming ? "stream-starting-pulse 1.4s ease-in-out infinite" : "none",
          }}
        />

        {/* Link mode icon */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: isWireless ? "var(--accent)" : "var(--mist-400)",
            flexShrink: 0,
          }}
        >
          {isWireless ? (
            <WifiIcon size={scaledIconSize} />
          ) : isDeviceConnected ? (
            <UsbIcon size={scaledIconSize} />
          ) : (
            <SmartphoneIcon size={scaledIconSize} />
          )}
        </span>

        {/* Device Custom Name */}
        <span
          className="mono-data"
          style={{
            fontSize: `${scaledFontSize}px`,
            fontWeight: 600,
            color: "var(--mist-100)",
            letterSpacing: "0.02em",
            maxWidth: `${scaledMaxWidth}px`,
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.2,
          }}
          title={name}
        >
          {name || "Android Device"}
        </span>

        {/* State Tag */}
        <span
          style={{
            fontSize: `${scaledSubFontSize}px`,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: `1px ${Math.max(4, Math.round(5 * frameScale))}px`,
            borderRadius: `${Math.max(3, Math.round(4 * frameScale))}px`,
            backgroundColor: isStreaming
              ? "rgba(95, 191, 154, 0.16)"
              : "rgba(155, 168, 171, 0.12)",
            color: isStreaming ? "var(--success)" : "var(--mist-400)",
            border: isStreaming
              ? "1px solid rgba(95, 191, 154, 0.3)"
              : "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          {isStreaming ? "LIVE" : isWireless ? "WI-FI" : "USB"}
        </span>
      </div>
    </div>
  );
};

