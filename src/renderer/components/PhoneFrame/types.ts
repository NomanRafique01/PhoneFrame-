export type FrameColor = "midnight" | "navy" | "slate" | "steel" | "mist" | "silver" | "crimson" | "ember" | "forest" | "violet";

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
};

export interface PhoneFrameOptions {
  bezelWidth: number;       // default ~16px
  outerRadius: number;      // default ~42px
  screenRadius: number;     // default ~28px
  color: FrameColor;
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

