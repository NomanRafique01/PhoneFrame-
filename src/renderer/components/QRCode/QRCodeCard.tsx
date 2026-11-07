import React from "react";
import { UsbIcon, ToggleRightIcon } from "../icons";

interface QRCodeCardProps {
  onSwitchTab?: (tab: "switch" | "pair" | "ip") => void;
}

export const QRCodeCard: React.FC<QRCodeCardProps> = ({ onSwitchTab }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        padding: "14px",
        backgroundColor: "rgba(16, 27, 36, 0.75)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        width: "100%",
        maxWidth: "300px",
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <div
        style={{
          padding: "10px",
          borderRadius: "6px",
          backgroundColor: "rgba(255, 120, 50, 0.12)",
          border: "1px solid rgba(255, 120, 50, 0.3)",
          color: "#FFB088",
          fontSize: "10px",
          lineHeight: "1.4",
          textAlign: "left",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontWeight: 800, color: "#FFA5A5", marginBottom: "4px" }}>
          ⚠️ Why phone cameras disconnect Wi-Fi:
        </div>
        <div style={{ color: "var(--mist-200)", fontSize: "9.5px" }}>
          Standard phone cameras mistake debugging QR codes for Wi-Fi hotspot credentials and disconnect your phone. In addition, Android's QR pairing protocol requires Android Studio's private server.
        </div>
      </div>

      <div style={{ fontSize: "11px", color: "var(--mist-100)", fontWeight: 600 }}>
        Recommended Wireless Connection Methods:
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
        <button
          onClick={() => onSwitchTab?.("switch")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "8px 10px",
            borderRadius: "4px",
            backgroundColor: "var(--accent)",
            color: "#06141B",
            fontWeight: 700,
            fontSize: "10.5px",
            border: "none",
            cursor: "pointer",
          }}
        >
          <UsbIcon size={13} />
          <span>⚡ 1-Click Switch from USB (Fastest)</span>
        </button>

        <button
          onClick={() => onSwitchTab?.("pair")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "8px 10px",
            borderRadius: "4px",
            backgroundColor: "var(--ink-800)",
            color: "var(--mist-100)",
            border: "1px solid var(--border)",
            fontWeight: 600,
            fontSize: "10.5px",
            cursor: "pointer",
          }}
        >
          <ToggleRightIcon size={13} />
          <span>🔢 Pair with 6-Digit Code (No Cable)</span>
        </button>
      </div>
    </div>
  );
};
