export type FrameColor = "midnight" | "navy" | "slate" | "steel" | "mist" | "silver" | "crimson" | "ember" | "forest" | "violet" | "custom";

export type NotchStyle = "punch-center" | "punch-left" | "pill" | "waterdrop" | "none";

export type DeviceOrientation = "portrait" | "landscape";

export interface FrameColorDefinition {
  id: FrameColor;
  name: string;
  hex: string;
  borderHex: string;
  highlightHex: string;
}

export const FRAME_COLOR_DEFINITIONS: Record<FrameColor, FrameColorDefinition> = {
  midnight: {
    id: "midnight",
    name: "Midnight",
    hex: "#06141B",
    borderHex: "#11212D",
    highlightHex: "rgba(255, 255, 255, 0.08)",
  },
  navy: {
    id: "navy",
    name: "Navy",
    hex: "#11212D",
    borderHex: "#253745",
    highlightHex: "rgba(255, 255, 255, 0.12)",
  },
  slate: {
    id: "slate",
    name: "Slate",
    hex: "#253745",
    borderHex: "#4A5C6A",
    highlightHex: "rgba(255, 255, 255, 0.16)",
  },
  steel: {
    id: "steel",
    name: "Steel",
    hex: "#4A5C6A",
    borderHex: "#9BA8AB",
    highlightHex: "rgba(255, 255, 255, 0.22)",
  },
  mist: {
    id: "mist",
    name: "Mist",
    hex: "#9BA8AB",
    borderHex: "#CCD0CF",
    highlightHex: "rgba(255, 255, 255, 0.45)",
  },
  silver: {
    id: "silver",
    name: "Silver",
    hex: "#CCD0CF",
    borderHex: "#FFFFFF",
    highlightHex: "rgba(255, 255, 255, 0.65)",
  },
  crimson: {
    id: "crimson",
    name: "Crimson",
    hex: "#7A1626",
    borderHex: "#A63A4B",
    highlightHex: "rgba(255, 255, 255, 0.16)",
  },
  ember: {
    id: "ember",
    name: "Ember",
    hex: "#8A3A12",
    borderHex: "#B85C2E",
    highlightHex: "rgba(255, 255, 255, 0.16)",
  },
  forest: {
    id: "forest",
    name: "Forest",
    hex: "#14382B",
    borderHex: "#2C5A48",
    highlightHex: "rgba(255, 255, 255, 0.14)",
  },
  violet: {
    id: "violet",
    name: "Violet",
    hex: "#3B2456",
    borderHex: "#5C4480",
    highlightHex: "rgba(255, 255, 255, 0.16)",
  },
  // Placeholder channels — resolveFrameColor() replaces them with the user's pick.
  custom: {
    id: "custom",
    name: "Custom",
    hex: "#2F6F6B",
    borderHex: "#5E9E9A",
    highlightHex: "rgba(255, 255, 255, 0.22)",
  },
};

export const DEFAULT_CUSTOM_FRAME_HEX = FRAME_COLOR_DEFINITIONS.custom.hex;

function lightenHex(hex: string, amount: number): string {
  const channels = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!channels) return hex;
  const value = channels[1];
  const parts = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${parts.join("")}`;
}

// One lookup for both the chassis and the HUD's side key, so a custom finish
// derives its edge and highlight from the pick instead of a stale preset.
export function resolveFrameColor(color: FrameColor, customHex: string): FrameColorDefinition {
  if (color !== "custom") {
    return FRAME_COLOR_DEFINITIONS[color] ?? FRAME_COLOR_DEFINITIONS.slate;
  }

  const hex = /^#[0-9a-f]{6}$/i.test(customHex) ? customHex : DEFAULT_CUSTOM_FRAME_HEX;
  return {
    id: "custom",
    name: "Custom",
    hex,
    borderHex: lightenHex(hex, 0.32),
    highlightHex: "rgba(255, 255, 255, 0.22)",
  };
}

export interface PhoneFrameOptions {
  bezelWidth: number;       // default ~16px
  outerRadius: number;      // default ~42px
  screenRadius: number;     // default ~28px
  color: FrameColor;
  customColorHex: string;   // only read when color === "custom"
  notchStyle: NotchStyle;
  showSpeaker: boolean;
  showHardwareButtons: boolean;
  orientation: DeviceOrientation;
  aspectRatio: {
    width: number;
    height: number;
  };
  baseScreenWidth: number;  // base viewport width, e.g. 360
}

