import React from "react";
import { DPadIcon, ExitFullscreenIcon, RotateIcon } from "../icons";

interface FullscreenControlsProps {
  onExit: () => void;
  onRotate: () => void;
  dpadEnabled: boolean;
  onToggleDpad: () => void;
}

/**
 * Minimal immersive-mode panel. It stays out of the way (dimmed until hovered)
 * and keeps the controls that matter while the rest of the workspace is hidden.
 */
export const FullscreenControls: React.FC<FullscreenControlsProps> = ({
  onExit,
  onRotate,
  dpadEnabled,
  onToggleDpad,
}) => {
  return (
    <div
      className="app-no-drag fullscreen-controls"
      role="toolbar"
      aria-label="Fullscreen controls"
      style={{
        position: "fixed",
        top: "14px",
        right: "14px",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "5px",
        backgroundColor: "rgba(17, 33, 45, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-hud)",
      }}
    >
      <button
        type="button"
        onClick={onExit}
        title="Exit fullscreen (Esc)"
        aria-label="Exit fullscreen"
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: "var(--ink-800)",
          color: "var(--mist-200)",
          border: "1px solid var(--border)",
        }}
      >
        <ExitFullscreenIcon size={16} />
      </button>

      <button
        type="button"
        onClick={onRotate}
        title="Rotate display orientation"
        aria-label="Rotate display orientation"
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
      >
        <RotateIcon size={16} />
      </button>

      <button
        type="button"
        onClick={onToggleDpad}
        title={dpadEnabled ? "Hide scroll pad" : "Show scroll pad"}
        aria-label={dpadEnabled ? "Hide scroll pad" : "Show scroll pad"}
        aria-pressed={dpadEnabled}
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: dpadEnabled ? "var(--ink-800)" : "transparent",
          color: dpadEnabled ? "var(--mist-200)" : "var(--mist-400)",
          border: dpadEnabled ? "1px solid var(--border)" : "1px solid transparent",
        }}
      >
        <DPadIcon size={16} />
      </button>

      <span
        className="mono-data"
        aria-hidden="true"
        style={{
          padding: "0 6px",
          fontSize: "9px",
          letterSpacing: "0.08em",
          color: "var(--mist-400)",
          opacity: 0.7,
        }}
      >
        ESC
      </span>
    </div>
  );
};
