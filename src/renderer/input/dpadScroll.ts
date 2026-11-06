import type { ScreenControlInput } from "../types/electron";

export type DPadDirection = "up" | "down" | "left" | "right";

/**
 * Position and frame size in the encoded video's pixel space. scrcpy expects
 * scroll coordinates relative to the stream it is sending, not CSS pixels.
 */
export interface DPadScrollTarget {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

// scrcpy encodes scroll deltas as 16-bit fixed point where 1.0 is one wheel
// notch, so one click of the pad is exactly one discrete scroll action.
const ONE_NOTCH = 1;

/**
 * Android treats a positive vScroll as wheel-up and a positive hScroll as
 * wheel-right (the same convention VideoCanvas inverts for mouse wheel input).
 */
function sendScroll(target: DPadScrollTarget | null, hScroll: number, vScroll: number): void {
  if (!target) return;
  if (target.screenWidth <= 0 || target.screenHeight <= 0) return;

  const input: ScreenControlInput = {
    type: "scroll",
    x: target.x,
    y: target.y,
    screenWidth: target.screenWidth,
    screenHeight: target.screenHeight,
    hScroll,
    vScroll,
  };
  window.electronAPI?.sendControl?.(input);
}

export function scrollUp(target: DPadScrollTarget | null): void {
  sendScroll(target, 0, ONE_NOTCH);
}

export function scrollDown(target: DPadScrollTarget | null): void {
  sendScroll(target, 0, -ONE_NOTCH);
}

export function scrollLeft(target: DPadScrollTarget | null): void {
  sendScroll(target, -ONE_NOTCH, 0);
}

export function scrollRight(target: DPadScrollTarget | null): void {
  sendScroll(target, ONE_NOTCH, 0);
}
