import React from "react";
import {
  type PhoneFrameOptions,
  type FrameColor,
  type NotchStyle,
  FRAME_COLOR_DEFINITIONS,
} from "./types";
import { CameraIcon, CheckIcon, SlidersIcon } from "../icons";

interface FrameControlsProps {
  options: PhoneFrameOptions;
  onChange: (options: PhoneFrameOptions) => void;
}

const NOTCH_OPTIONS: { id: NotchStyle; label: string }[] = [
  { id: "punch-center", label: "Center Hole" },
  { id: "punch-left", label: "Left Hole" },
  { id: "pill", label: "Pill Cutout" },
  { id: "waterdrop", label: "Waterdrop" },
  { id: "none", label: "Full Screen" },
];

const ASPECT_RATIO_OPTIONS = [
  { label: "20:9 (Modern Android)", width: 9, height: 20 },
  { label: "19.5:9 (Flagship)", width: 9, height: 19.5 },
  { label: "16:9 (Standard)", width: 9, height: 16 },
];

export const FrameControls: React.FC<FrameControlsProps> = ({ options, onChange }) => {
  const updateOption = <K extends keyof PhoneFrameOptions>(key: K, value: PhoneFrameOptions[K]) => {
    onChange({
      ...options,
      [key]: value,
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        color: "var(--text)",
      }}
    >
      {/* Frame Finish Swatches */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <SlidersIcon size={14} style={{ color: "var(--text-muted)" }} />
          <h4
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Chassis Color
          </h4>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-2)" }}>
          {(Object.keys(FRAME_COLOR_DEFINITIONS) as FrameColor[]).map((colorKey) => {
            const def = FRAME_COLOR_DEFINITIONS[colorKey];
            const isSelected = options.color === colorKey;
            return (
              <button
                key={colorKey}
                onClick={() => updateOption("color", colorKey)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: isSelected ? "var(--ink-800)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--mist-400)" : "var(--border)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: def.hex,
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                    }}
                  />
                  <span style={{ fontSize: "11px", color: isSelected ? "var(--mist-200)" : "var(--text-muted)" }}>
                    {def.name}
                  </span>
                </div>
                {isSelected && <CheckIcon size={12} style={{ color: "var(--mist-200)" }} />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Notch & Camera Style */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <CameraIcon size={14} style={{ color: "var(--text-muted)" }} />
          <h4
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Front Camera Cutout
          </h4>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px" }}>
          {NOTCH_OPTIONS.map((item) => {
            const isSelected = options.notchStyle === item.id;
            return (
              <button
                key={item.id}
                onClick={() => updateOption("notchStyle", item.id)}
                style={{
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: isSelected ? "var(--ink-800)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--mist-400)" : "var(--border)"}`,
                  fontSize: "11px",
                  color: isSelected ? "var(--mist-200)" : "var(--text-muted)",
                  justifyContent: "flex-start",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Hardware Geometry Sliders */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          borderTop: "1px solid var(--border)",
          paddingTop: "var(--space-3)",
        }}
      >
        {/* Bezel Thickness */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Bezel Thickness</span>
            <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
              {options.bezelWidth}px
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="28"
            value={options.bezelWidth}
            onChange={(e) => updateOption("bezelWidth", Number(e.target.value))}
            style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
          />
        </div>

        {/* Outer Corner Radius */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Chassis Radius</span>
            <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
              {options.outerRadius}px
            </span>
          </div>
          <input
            type="range"
            min="24"
            max="52"
            value={options.outerRadius}
            onChange={(e) => updateOption("outerRadius", Number(e.target.value))}
            style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
          />
        </div>

        {/* Screen Corner Radius */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Screen Radius</span>
            <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
              {options.screenRadius}px
            </span>
          </div>
          <input
            type="range"
            min="8"
            max="36"
            value={options.screenRadius}
            onChange={(e) => updateOption("screenRadius", Number(e.target.value))}
            style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
          />
        </div>
      </section>

      {/* Aspect Ratio Selector */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          borderTop: "1px solid var(--border)",
          paddingTop: "var(--space-3)",
        }}
      >
        <h4
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Aspect Ratio Target
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {ASPECT_RATIO_OPTIONS.map((ratio) => {
            const isSelected =
              options.aspectRatio.width === ratio.width && options.aspectRatio.height === ratio.height;
            return (
              <button
                key={ratio.label}
                onClick={() => updateOption("aspectRatio", { width: ratio.width, height: ratio.height })}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: isSelected ? "var(--ink-800)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--mist-400)" : "var(--border)"}`,
                  fontSize: "11px",
                  color: isSelected ? "var(--mist-200)" : "var(--text-muted)",
                }}
              >
                <span>{ratio.label}</span>
                {isSelected && <CheckIcon size={12} style={{ color: "var(--mist-200)" }} />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Hardware Accents Toggles */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          borderTop: "1px solid var(--border)",
          paddingTop: "var(--space-3)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          <span>Speaker Ear Grille</span>
          <input
            type="checkbox"
            checked={options.showSpeaker}
            onChange={(e) => updateOption("showSpeaker", e.target.checked)}
            style={{ accentColor: "var(--mist-200)" }}
          />
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          <span>Side Hardware Buttons</span>
          <input
            type="checkbox"
            checked={options.showHardwareButtons}
            onChange={(e) => updateOption("showHardwareButtons", e.target.checked)}
            style={{ accentColor: "var(--mist-200)" }}
          />
        </label>
      </section>
    </div>
  );
};

