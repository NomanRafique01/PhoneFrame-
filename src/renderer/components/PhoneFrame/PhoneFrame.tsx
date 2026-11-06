import React from "react";
import {
  resolveFrameColor,
  type PhoneFrameOptions,
} from "./types";

interface PhoneFrameProps {
  options: PhoneFrameOptions;
  children?: React.ReactNode;
  // While drag mode is armed the bezel must deliver pointer events to the
  // renderer instead of acting as a native window drag region.
  dragMode?: boolean;
  cursor?: string;
}

export const PhoneFrame: React.FC<PhoneFrameProps> = ({ options, children, dragMode, cursor }) => {
  const {
    bezelWidth,
    outerRadius,
    screenRadius,
    color,
    customColorHex,
    notchStyle,
    showSpeaker,
    showHardwareButtons,
    orientation,
    aspectRatio,
    baseScreenWidth,
  } = options;

  const colorDef = resolveFrameColor(color, customColorHex);

  // Calculate pixel-perfect screen dimensions based on device aspect ratio & orientation
  const isPortrait = orientation === "portrait";
  const ratioMultiplier = aspectRatio.height / aspectRatio.width;

  const screenWidth = Math.round(isPortrait ? baseScreenWidth : baseScreenWidth * ratioMultiplier);
  const screenHeight = Math.round(isPortrait ? baseScreenWidth * ratioMultiplier : baseScreenWidth);

  const totalWidth = screenWidth + bezelWidth * 2;
  const totalHeight = screenHeight + bezelWidth * 2;

  // Speaker dimensions & positions
  const speakerWidth = Math.min(56, Math.max(32, Math.round(screenWidth * 0.12)));
  const speakerHeight = 4;
  const speakerX = Math.round((totalWidth - speakerWidth) / 2);
  const speakerY = Math.max(3, Math.round((bezelWidth - speakerHeight) / 2));

  // Hardware buttons positioning
  const buttonThickness = 3;
  const powerButtonLength = Math.round(totalHeight * 0.08);
  const volumeRockerLength = Math.round(totalHeight * 0.14);

  return (
    <div
      className="phone-frame-wrapper"
      style={{
        position: "relative",
        width: `${totalWidth}px`,
        height: `${totalHeight}px`,
        userSelect: "none",
        transition: "width 240ms cubic-bezier(0.16, 1, 0.3, 1), height 240ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Procedural SVG Hardware Frame (Bezel & Chassis) */}
      <svg
        className={dragMode ? undefined : "app-drag-region"}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "auto",
          cursor: cursor ?? "grab",
        }}
        aria-hidden="true"
      >
        <defs>
          {/* Subtle directional bevel gradient (fully opaque — no desktop bleed-through) */}
          <linearGradient id="chassisGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorDef.hex} stopOpacity="1" />
            <stop offset="50%" stopColor={colorDef.hex} stopOpacity="1" />
            <stop offset="100%" stopColor={colorDef.borderHex} stopOpacity="1" />
          </linearGradient>

          {/* Mask to cut out the inner screen hole so drag area is bezel-only */}
          <mask id="bezelMask">
            <rect x="0" y="0" width={totalWidth} height={totalHeight} rx={outerRadius} ry={outerRadius} fill="white" />
            <rect
              x={bezelWidth}
              y={bezelWidth}
              width={screenWidth}
              height={screenHeight}
              rx={screenRadius}
              ry={screenRadius}
              fill="black"
            />
          </mask>
        </defs>

        {/* Hardware Buttons: Power (Right) & Volume (Left) */}
        {showHardwareButtons && (
          <g className="hardware-buttons">
            {/* Power Button */}
            <rect
              x={totalWidth - 1}
              y={Math.round(totalHeight * 0.26)}
              width={buttonThickness}
              height={powerButtonLength}
              rx={1.5}
              ry={1.5}
              fill={colorDef.borderHex}
              opacity="1"
            />
            {/* Volume Up/Down Rocker */}
            <rect
              x={-buttonThickness + 1}
              y={Math.round(totalHeight * 0.22)}
              width={buttonThickness}
              height={volumeRockerLength}
              rx={1.5}
              ry={1.5}
              fill={colorDef.borderHex}
              opacity="1"
            />
          </g>
        )}

        {/* Outer Phone Bezel Chassis (masked so center is completely transparent) */}
        <rect
          x="0"
          y="0"
          width={totalWidth}
          height={totalHeight}
          rx={outerRadius}
          ry={outerRadius}
          fill="url(#chassisGradient)"
          mask="url(#bezelMask)"
        />

        {/* Outer Chamfer Edge Highlight */}
        <rect
          x="0.5"
          y="0.5"
          width={totalWidth - 1}
          height={totalHeight - 1}
          rx={outerRadius - 0.5}
          ry={outerRadius - 0.5}
          fill="none"
          stroke={colorDef.highlightHex}
          strokeWidth="1"
          mask="url(#bezelMask)"
        />

        {/* Inner Screen Bezel Rim Border */}
        <rect
          x={bezelWidth - 0.5}
          y={bezelWidth - 0.5}
          width={screenWidth + 1}
          height={screenHeight + 1}
          rx={screenRadius}
          ry={screenRadius}
          fill="none"
          stroke="rgba(0, 0, 0, 0.45)"
          strokeWidth="1.5"
        />

        {/* Top Speaker Ear Slit (snapped integer coordinates) */}
        {showSpeaker && isPortrait && (
          <rect
            x={speakerX}
            y={speakerY}
            width={speakerWidth}
            height={speakerHeight}
            rx={speakerHeight / 2}
            ry={speakerHeight / 2}
            fill="#05080A"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="0.5"
          />
        )}
      </svg>

      {/* Inner Screen Display Viewport (app-no-drag ensures touch & clicks reach stream) */}
      <div
        className="app-no-drag phone-screen-viewport"
        style={{
          position: "absolute",
          top: `${bezelWidth}px`,
          left: `${bezelWidth}px`,
          width: `${screenWidth}px`,
          height: `${screenHeight}px`,
          borderRadius: `${screenRadius}px`,
          overflow: "hidden",
          backgroundColor: "#000000",
          display: "flex",
          flexDirection: "column",
          // Mirrors the chassis timing so rotation/fullscreen resizes never
          // leave the display detached from the frame mid-transition.
          transition: "width 240ms cubic-bezier(0.16, 1, 0.3, 1), height 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Notch / Punch-hole Overlay */}
        {isPortrait && notchStyle !== "none" && (
          <div
            className="screen-notch-overlay"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: notchStyle === "punch-left" ? "flex-start" : "center",
              paddingTop: notchStyle === "waterdrop" ? 0 : "10px",
              paddingLeft: notchStyle === "punch-left" ? "20px" : 0,
              zIndex: 10,
              pointerEvents: "none",
            }}
          >
            {notchStyle === "punch-center" && (
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: "#030608",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                }}
              />
            )}

            {notchStyle === "punch-left" && (
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: "#030608",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                }}
              />
            )}

            {notchStyle === "pill" && (
              <div
                style={{
                  width: "72px",
                  height: "18px",
                  borderRadius: "9px",
                  backgroundColor: "#030608",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                }}
              />
            )}

            {notchStyle === "waterdrop" && (
              <div
                style={{
                  width: "28px",
                  height: "16px",
                  backgroundColor: colorDef.hex,
                  borderBottomLeftRadius: "14px",
                  borderBottomRightRadius: "14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#000",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Screen Children (Mirroring Canvas / Stream / Telemetry) */}
        <div style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}>
          {children}
        </div>
      </div>
    </div>
  );
};

