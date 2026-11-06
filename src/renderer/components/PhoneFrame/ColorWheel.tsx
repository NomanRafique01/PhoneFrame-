import React, { useEffect, useRef, useState } from "react";

interface ColorWheelProps {
  value: string;
  onChange: (hex: string) => void;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const WHEEL_SIZE = 168;
const MARKER_SIZE = 16;

function hexToHsv(hex: string): Hsv {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return { h: 0, s: 0, v: 0.5 };

  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return `#${rgb
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/**
 * Hue/saturation wheel with a separate brightness rail. The wheel paints the
 * full-value spectrum and dims with the chosen value, so the marker always
 * shows the color that will land on the chassis.
 */
export const ColorWheel: React.FC<ColorWheelProps> = ({ value, onChange }) => {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const wheelRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef(value.toLowerCase());

  useEffect(() => {
    const next = value.toLowerCase();
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    setHsv(hexToHsv(value));
  }, [value]);

  const commit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    lastEmittedRef.current = hex;
    onChange(hex);
  };

  const updateFromPointer = (clientX: number, clientY: number) => {
    const wheel = wheelRef.current;
    if (!wheel) return;

    const rect = wheel.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = clientX - (rect.left + radius);
    const dy = clientY - (rect.top + radius);
    const distance = Math.hypot(dx, dy);
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;

    commit({
      h: (angle + 360) % 360,
      s: Math.min(1, distance / radius),
      v: hsv.v,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event.clientX, event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const markerRadius = (WHEEL_SIZE / 2 - 2) * hsv.s;
  const markerAngle = (hsv.h * Math.PI) / 180;
  const markerX = WHEEL_SIZE / 2 + Math.sin(markerAngle) * markerRadius;
  const markerY = WHEEL_SIZE / 2 - Math.cos(markerAngle) * markerRadius;
  const currentHex = hsvToHex(hsv);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        padding: "10px",
        borderRadius: "var(--radius-sm)",
        backgroundColor: "var(--ink-950)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Custom Finish</span>
        <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
          {currentHex.toUpperCase()}
        </span>
      </div>

      <div
        ref={wheelRef}
        role="slider"
        aria-label="Frame color hue and saturation"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: `${WHEEL_SIZE}px`,
          height: `${WHEEL_SIZE}px`,
          borderRadius: "50%",
          background:
            "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          touchAction: "none",
          cursor: "crosshair",
        }}
      >
        {/* Saturation falls off toward the wheel's center. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at center, #ffffff 0%, rgba(255, 255, 255, 0.82) 16%, rgba(255, 255, 255, 0) 70%)",
            pointerEvents: "none",
          }}
        />
        {/* Brightness preview. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            backgroundColor: `rgba(0, 0, 0, ${1 - hsv.v})`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.18)",
            pointerEvents: "none",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${markerX}px`,
            top: `${markerY}px`,
            width: `${MARKER_SIZE}px`,
            height: `${MARKER_SIZE}px`,
            marginLeft: `${-MARKER_SIZE / 2}px`,
            marginTop: `${-MARKER_SIZE / 2}px`,
            borderRadius: "50%",
            backgroundColor: currentHex,
            border: `2px solid ${hsv.v > 0.62 ? "rgba(6, 20, 27, 0.85)" : "rgba(255, 255, 255, 0.9)"}`,
            boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Brightness</span>
          <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
            {Math.round(hsv.v * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="5"
          max="100"
          value={Math.round(hsv.v * 100)}
          onChange={(event) => commit({ ...hsv, v: Number(event.target.value) / 100 })}
          aria-label="Frame color brightness"
          style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
        />
      </div>
    </div>
  );
};
