import React from "react";
import {
  ChevronLeftIcon,
  HandIcon,
  PinIcon,
  RotateIcon,
  SettingsIcon,
  MinimizeIcon,
  CloseIcon,
} from "../icons";

interface FloatingHUDProps {
  dragMode: boolean;
  onToggleDragMode: () => void;
  onCollapse: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  onRotate: () => void;
  showInspector: boolean;
  onToggleInspector: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  dragMode,
  onToggleDragMode,
  onCollapse,
  isPinned,
  onTogglePin,
  onRotate,
  showInspector,
  onToggleInspector,
  onMinimize,
  onClose,
}) => {
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

      {/* Inspector / Frame Customizer Drawer */}
      <button
        onClick={onToggleInspector}
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

      {/* Close Window */}
      <button
        onClick={onClose}
        title="Close FloatingPhone"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--radius-sm)",
          color: "var(--mist-400)",
        }}
      >
        <CloseIcon size={16} />
      </button>
    </nav>
  );
};

