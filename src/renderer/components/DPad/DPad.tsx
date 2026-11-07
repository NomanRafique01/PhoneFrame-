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

  // The parent re-creates this callback on every render, so hold the latest one
  // in a ref. Depending on the callback directly would re-run this cleanup after
  // every parent render and cancel an in-progress pad drag.
  const onDragStateChangeRef = useRef(onDragStateChange);
  useEffect(() => {
    onDragStateChangeRef.current = onDragStateChange;
  }, [onDragStateChange]);

  // Release the interaction latch and keep the last pad position if the pad
  // disappears mid-drag (stream ends, HUD toggles it off).
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        dragRef.current = null;
        onDragStateChangeRef.current?.(false);
      }
      if (centerRef.current) saveCenter(centerRef.current);
    };
  }, []);

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

  const pendingButtonRef = useRef<{
    button: PadButton;
    pointerId: number;
    startX: number;
    startY: number;
    hasDragged: boolean;
  } | null>(null);

  const startPadDrag = (pointerId: number, clientX: number, clientY: number, targetEl: Element) => {
    if (dragRef.current) return;
    const bounds = boundsRef.current;
    dragRef.current = {
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      startCenterX: centerPxRef.current.x,
      startCenterY: centerPxRef.current.y,
      width: bounds.width,
      height: bounds.height,
      clusterSize: bounds.clusterSize,
    };
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {}
    setIsDragging(true);
    onDragStateChange?.(true);
  };

  const handleButtonPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    button: PadButton
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    pendingButtonRef.current = {
      button,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hasDragged: false,
    };
    startPadDrag(event.pointerId, event.clientX, event.clientY, event.currentTarget);
  };

  const handleHubPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    startPadDrag(event.pointerId, event.clientX, event.clientY, event.currentTarget);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    // Check 4px drag threshold if initiated from a button
    if (pendingButtonRef.current && pendingButtonRef.current.pointerId === event.pointerId) {
      const dist = Math.hypot(
        event.clientX - pendingButtonRef.current.startX,
        event.clientY - pendingButtonRef.current.startY
      );
      if (dist > 4) {
        pendingButtonRef.current.hasDragged = true;
      }
    }

    if (drag.width <= 0 || drag.height <= 0) return;

    // Generous boundaries: allow parking anywhere across the visible phone screen
    const halfCluster = drag.clusterSize / 2;
    const nextX = clamp(
      drag.startCenterX + (event.clientX - drag.startClientX),
      halfCluster,
      Math.max(halfCluster, drag.width - halfCluster)
    );
    const nextY = clamp(
      drag.startCenterY + (event.clientY - drag.startClientY),
      halfCluster,
      Math.max(halfCluster, drag.height - halfCluster)
    );
    const next = { x: nextX / drag.width, y: nextY / drag.height };
    centerRef.current = next;
    setCenter(next);
  };

  const handleButtonPointerUp = (
    event: React.PointerEvent<HTMLButtonElement>,
    button: PadButton
  ) => {
    event.stopPropagation();
    const pending = pendingButtonRef.current;
    if (pending && pending.pointerId === event.pointerId) {
      if (!pending.hasDragged) {
        // Quick tap without dragging: execute scroll
        button.fire(getScrollTarget());
      }
      pendingButtonRef.current = null;
    }
    handlePointerEnd(event);
  };

  const handlePointerEnd = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    dragRef.current = null;
    pendingButtonRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
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
          className={`dpad-cluster${isDragging ? " dpad-cluster--dragging" : ""}`}
          style={{
            left: `${padLeft}px`,
            top: `${padTop}px`,
            gridTemplateColumns: `repeat(3, ${keySize}px)`,
            gridTemplateRows: `repeat(3, ${keySize}px)`,
            gap: `${gap}px`,
            cursor: isDragging ? "grabbing" : "grab",
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
                cursor: isDragging ? "grabbing" : "pointer",
              }}
              onPointerDown={(event) => handleButtonPointerDown(event, button)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handleButtonPointerUp(event, button)}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
              onMouseDown={(event) => event.preventDefault()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => event.preventDefault()}
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
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onLostPointerCapture={handlePointerEnd}
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
