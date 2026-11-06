import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  scrollDown,
  scrollLeft,
  scrollRight,
  scrollUp,
  type DPadDirection,
  type DPadScrollTarget,
} from "../../input/dpadScroll";

interface DPadProps {
  // Resolved at click time so the message always matches the latest frame size.
  getScrollTarget: () => DPadScrollTarget | null;
  // Holds the app's "screen interaction" latch during a pad drag so the
  // transparent window cannot turn click-through mid-gesture.
  onDragStateChange?: (active: boolean) => void;
}

interface PadButton {
  direction: DPadDirection;
  label: string;
  row: number;
  column: number;
  rotation: number;
  fire: (target: DPadScrollTarget | null) => void;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenterX: number;
  startCenterY: number;
  width: number;
  height: number;
  clusterSize: number;
}

const PAD_BUTTONS: PadButton[] = [
  { direction: "up", label: "Scroll up", row: 1, column: 2, rotation: 0, fire: scrollUp },
  { direction: "left", label: "Scroll left", row: 2, column: 1, rotation: -90, fire: scrollLeft },
  { direction: "right", label: "Scroll right", row: 2, column: 3, rotation: 90, fire: scrollRight },
  { direction: "down", label: "Scroll down", row: 3, column: 2, rotation: 180, fire: scrollDown },
];

const POSITION_STORAGE_KEY = "phoneframe_dpad_position_v1";
const EDGE_MARGIN = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadSavedCenter(): NormalizedPoint | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<NormalizedPoint>;
    if (
      typeof saved.x !== "number" ||
      typeof saved.y !== "number" ||
      !Number.isFinite(saved.x) ||
      !Number.isFinite(saved.y)
    ) {
      return null;
    }
    return { x: clamp(saved.x, 0, 1), y: clamp(saved.y, 0, 1) };
  } catch {
    return null;
  }
}

function saveCenter(center: NormalizedPoint): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(center));
  } catch {
    // Storage unavailable; the pad simply reopens in its default corner.
  }
}

const ArrowGlyph: React.FC<{ size: number; rotation: number }> = ({ size, rotation }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{ transform: `rotate(${rotation}deg)`, display: "block" }}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M12 4.2 5.8 11.4h3.6v8.4h5.2v-8.4h3.6L12 4.2Z"
      fill="currentColor"
      stroke="rgba(3, 10, 15, 0.55)"
      strokeWidth="0.75"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Floating four-way scroll pad anchored to the phone screen. Its center hub is
 * a drag handle, so the pad can be parked anywhere on the display. Only the
 * four keys and the hub take pointer input; everything else stays click-through.
 */
export const DPad: React.FC<DPadProps> = ({ getScrollTarget, onDragStateChange }) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [center, setCenter] = useState<NormalizedPoint | null>(() => loadSavedCenter());
  const [isDragging, setIsDragging] = useState(false);

  const centerRef = useRef<NormalizedPoint | null>(center);
  const centerPxRef = useRef({ x: 0, y: 0 });
  const boundsRef = useRef({ width: 0, height: 0, clusterSize: 0 });
  const dragRef = useRef<DragState | null>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const measure = () => {
      const rect = overlay.getBoundingClientRect();
      setBox((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  // Release the interaction latch and keep the last pad position if the pad
  // disappears mid-drag (stream ends, HUD toggles it off).
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        dragRef.current = null;
        onDragStateChange?.(false);
      }
      if (centerRef.current) saveCenter(centerRef.current);
    };
  }, [onDragStateChange]);

  // The pad scales with the frame and keeps its default spot above Android's
  // navigation bar.
  const keySize = box.width > 0 ? clamp(box.width * 0.12, 28, 44) : 32;
  const gap = Math.max(2, Math.round(keySize * 0.09));
  const insetLeft = clamp(box.width * 0.055, 10, 26);
  const insetBottom = clamp(box.height * 0.075, 44, 84);
  const radius = Math.round(keySize * 0.3);
  const iconSize = Math.round(keySize * 0.48);

  const clusterSize = keySize * 3 + gap * 2;
  const minCenter = clusterSize / 2 + EDGE_MARGIN;
  const defaultCenterX = insetLeft + clusterSize / 2;
  const defaultCenterY = box.height - insetBottom - clusterSize / 2;
  const rawCenterX = center ? center.x * box.width : defaultCenterX;
  const rawCenterY = center ? center.y * box.height : defaultCenterY;
  const centerX = clamp(rawCenterX, minCenter, Math.max(minCenter, box.width - minCenter));
  const centerY = clamp(rawCenterY, minCenter, Math.max(minCenter, box.height - minCenter));
  const padLeft = centerX - clusterSize / 2;
  const padTop = centerY - clusterSize / 2;

  centerPxRef.current = { x: centerX, y: centerY };
  boundsRef.current = { width: box.width, height: box.height, clusterSize };

  const ready = box.width > 0 && box.height > 0;

  const handleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    button: PadButton
  ) => {
    event.stopPropagation();
    button.fire(getScrollTarget());
  };

  // One physical key press = one scroll. Repeats are suppressed so holding
  // Enter/Space can never scroll continuously.
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    button: PadButton
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) button.fire(getScrollTarget());
  };

  const handleHubPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const bounds = boundsRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenterX: centerPxRef.current.x,
      startCenterY: centerPxRef.current.y,
      width: bounds.width,
      height: bounds.height,
      clusterSize: bounds.clusterSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    onDragStateChange?.(true);
  };

  const handleHubPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (drag.width <= 0 || drag.height <= 0) return;

    const limit = drag.clusterSize / 2 + EDGE_MARGIN;
    const nextX = clamp(
      drag.startCenterX + (event.clientX - drag.startClientX),
      limit,
      Math.max(limit, drag.width - limit)
    );
    const nextY = clamp(
      drag.startCenterY + (event.clientY - drag.startClientY),
      limit,
      Math.max(limit, drag.height - limit)
    );
    const next = { x: nextX / drag.width, y: nextY / drag.height };
    centerRef.current = next;
    setCenter(next);
  };

  const handleHubPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    onDragStateChange?.(false);
    if (centerRef.current) saveCenter(centerRef.current);
  };

  return (
    <div
      ref={overlayRef}
      className="dpad-overlay"
      role="group"
      aria-label="Phone scroll controls"
    >
      {ready && (
        <div
          className="dpad-cluster"
          style={{
            left: `${padLeft}px`,
            top: `${padTop}px`,
            gridTemplateColumns: `repeat(3, ${keySize}px)`,
            gridTemplateRows: `repeat(3, ${keySize}px)`,
            gap: `${gap}px`,
          }}
        >
          {PAD_BUTTONS.map((button) => (
            <button
              key={button.direction}
              type="button"
              className="dpad-button"
              title={button.label}
              aria-label={button.label}
              draggable={false}
              style={{
                gridRow: button.row,
                gridColumn: button.column,
                borderRadius: `${radius}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => event.preventDefault()}
              onClick={(event) => handleClick(event, button)}
              onKeyDown={(event) => handleKeyDown(event, button)}
            >
              <ArrowGlyph size={iconSize} rotation={button.rotation} />
            </button>
          ))}

          {/* Center hub: the grab point for moving the whole pad. */}
          <div
            className={`dpad-hub${isDragging ? " dpad-hub--dragging" : ""}`}
            title="Drag to move the scroll pad"
            style={{ gridRow: 2, gridColumn: 2 }}
            onPointerDown={handleHubPointerDown}
            onPointerMove={handleHubPointerMove}
            onPointerUp={handleHubPointerEnd}
            onPointerCancel={handleHubPointerEnd}
            onLostPointerCapture={handleHubPointerEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="dpad-hub-grip" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
};
