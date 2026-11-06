/**
 * Encoders for scrcpy-server's client → device control protocol (v3.1).
 *
 * Layouts mirror app/src/control_msg.c and
 * server/.../control/ControlMessageReader.java: every field is big-endian.
 */

export type ControlAction = "down" | "up" | "move";

export interface TouchControlInput {
  type: "touch";
  action: ControlAction;
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

export interface ScrollControlInput {
  type: "scroll";
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  hScroll: number;
  vScroll: number;
}

export interface KeyControlInput {
  type: "key";
  action: "down" | "up";
  keycode: number;
  repeat?: number;
  metaState?: number;
}

export interface TextControlInput {
  type: "text";
  text: string;
}

export type ScreenControlInput =
  | TouchControlInput
  | ScrollControlInput
  | KeyControlInput
  | TextControlInput;

const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_INJECT_TOUCH_EVENT = 2;
const TYPE_INJECT_SCROLL_EVENT = 3;

const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;

// scrcpy's SC_POINTER_ID_GENERIC_FINGER: makes the server inject real touch
// events (source TOUCHSCREEN) instead of mouse events.
const POINTER_ID_FINGER = 0xfffffffffffffffen;

const INJECT_TEXT_MAX_BYTES = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toI16Fixed(value: number): number {
  const scaled = Math.trunc(clamp(value, -1, 1) * 0x8000);
  return clamp(scaled, -0x8000, 0x7fff);
}

function writePosition(
  buffer: Buffer,
  offset: number,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number
): void {
  buffer.writeInt32BE(Math.round(clamp(x, 0, screenWidth - 1)), offset);
  buffer.writeInt32BE(Math.round(clamp(y, 0, screenHeight - 1)), offset + 4);
  buffer.writeUInt16BE(screenWidth, offset + 8);
  buffer.writeUInt16BE(screenHeight, offset + 10);
}

function normalizeSize(value: number): number {
  return Math.round(clamp(value, 1, 0xffff));
}

function encodeTouch(input: TouchControlInput): Buffer {
  const screenWidth = normalizeSize(input.screenWidth);
  const screenHeight = normalizeSize(input.screenHeight);
  const action =
    input.action === "up" ? ACTION_UP : input.action === "move" ? ACTION_MOVE : ACTION_DOWN;

  const buffer = Buffer.alloc(32);
  buffer.writeUInt8(TYPE_INJECT_TOUCH_EVENT, 0);
  buffer.writeUInt8(action, 1);
  buffer.writeBigUInt64BE(POINTER_ID_FINGER, 2);
  writePosition(buffer, 10, input.x, input.y, screenWidth, screenHeight);
  buffer.writeUInt16BE(action === ACTION_UP ? 0 : 0xffff, 22);
  buffer.writeUInt32BE(0, 24); // action button
  buffer.writeUInt32BE(0, 28); // buttons
  return buffer;
}

function encodeScroll(input: ScrollControlInput): Buffer {
  const screenWidth = normalizeSize(input.screenWidth);
  const screenHeight = normalizeSize(input.screenHeight);

  const buffer = Buffer.alloc(21);
  buffer.writeUInt8(TYPE_INJECT_SCROLL_EVENT, 0);
  writePosition(buffer, 1, input.x, input.y, screenWidth, screenHeight);
  buffer.writeInt16BE(toI16Fixed(input.hScroll), 13);
  buffer.writeInt16BE(toI16Fixed(input.vScroll), 15);
  buffer.writeUInt32BE(0, 17); // buttons
  return buffer;
}

function encodeKey(input: KeyControlInput): Buffer {
  const buffer = Buffer.alloc(14);
  buffer.writeUInt8(TYPE_INJECT_KEYCODE, 0);
  buffer.writeUInt8(input.action === "up" ? ACTION_UP : ACTION_DOWN, 1);
  buffer.writeUInt32BE(Math.round(clamp(input.keycode, 0, 0x7fffffff)), 2);
  buffer.writeUInt32BE(Math.round(clamp(input.repeat ?? 0, 0, 0xffffffff)), 6);
  buffer.writeUInt32BE((input.metaState ?? 0) >>> 0, 10);
  return buffer;
}

function encodeText(text: string): Buffer | null {
  const raw = Buffer.from(text, "utf8");
  if (raw.length === 0) return null;

  let length = Math.min(raw.length, INJECT_TEXT_MAX_BYTES);
  // Never cut a multi-byte UTF-8 sequence in half.
  while (length > 0 && length < raw.length && (raw[length] & 0xc0) === 0x80) {
    length -= 1;
  }
  if (length === 0) return null;

  const buffer = Buffer.alloc(5 + length);
  buffer.writeUInt8(TYPE_INJECT_TEXT, 0);
  buffer.writeUInt32BE(length, 1);
  raw.copy(buffer, 5, 0, length);
  return buffer;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Validates an IPC payload and returns the wire message, or null if invalid. */
export function encodeControlInput(input: unknown): Buffer | null {
  if (!input || typeof input !== "object") return null;
  const message = input as Record<string, unknown>;

  switch (message.type) {
    case "touch": {
      const action = message.action;
      if (action !== "down" && action !== "up" && action !== "move") return null;
      const x = readNumber(message, "x");
      const y = readNumber(message, "y");
      const screenWidth = readNumber(message, "screenWidth");
      const screenHeight = readNumber(message, "screenHeight");
      if (x === null || y === null || screenWidth === null || screenHeight === null) return null;
      return encodeTouch({ type: "touch", action, x, y, screenWidth, screenHeight });
    }

    case "scroll": {
      const x = readNumber(message, "x");
      const y = readNumber(message, "y");
      const screenWidth = readNumber(message, "screenWidth");
      const screenHeight = readNumber(message, "screenHeight");
      const hScroll = readNumber(message, "hScroll");
      const vScroll = readNumber(message, "vScroll");
      if (
        x === null ||
        y === null ||
        screenWidth === null ||
        screenHeight === null ||
        hScroll === null ||
        vScroll === null
      ) {
        return null;
      }
      return encodeScroll({ type: "scroll", x, y, screenWidth, screenHeight, hScroll, vScroll });
    }

    case "key": {
      const action = message.action;
      if (action !== "down" && action !== "up") return null;
      const keycode = readNumber(message, "keycode");
      if (keycode === null) return null;
      return encodeKey({
        type: "key",
        action,
        keycode,
        repeat: readNumber(message, "repeat") ?? 0,
        metaState: readNumber(message, "metaState") ?? 0,
      });
    }

    case "text": {
      if (typeof message.text !== "string") return null;
      return encodeText(message.text);
    }

    default:
      return null;
  }
}
