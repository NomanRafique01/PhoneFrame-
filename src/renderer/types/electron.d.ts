export type AdbDeviceState = "device" | "unauthorized" | "offline" | "no-device";

export interface AdbDeviceInfo {
  serial: string;
  state: AdbDeviceState;
  model?: string;
  product?: string;
  device?: string;
  width?: number;
  height?: number;
  isWireless?: boolean;
}

export interface AdbStatusPayload {
  state: AdbDeviceState;
  devices: AdbDeviceInfo[];
  activeDevice: AdbDeviceInfo | null;
}

export type MirrorState = "stopped" | "starting" | "running" | "error";

export interface MirrorStatePayload {
  state: MirrorState;
  error?: string;
  screenId?: string;
}

export type ScreenControlInput =
  | {
      type: "touch";
      action: "down" | "up" | "move";
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: "scroll";
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
      hScroll: number;
      vScroll: number;
    }
  | { type: "key"; action: "down" | "up"; keycode: number; repeat?: number; metaState?: number }
  | { type: "text"; text: string };

export interface FloatingPhoneAPI {
  // Window controls
  setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  getAlwaysOnTop: () => Promise<boolean>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  setIgnoreMouseEvents: (flag: boolean) => Promise<void>;
  setFullscreen: (flag: boolean) => Promise<boolean>;
  getFullscreen: () => Promise<boolean>;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;

  // ADB device tracking
  getAdbStatus: () => Promise<AdbStatusPayload>;
  onAdbStatusChange: (callback: (status: AdbStatusPayload) => void) => () => void;
  getAdbScreenSize: (serial: string) => Promise<{ width: number; height: number } | null>;
  getDeviceIp: (serial: string) => Promise<string | null>;
  enableWireless: (serial: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
  connectWireless: (target: string) => Promise<{ success: boolean; message: string }>;
  disconnectWireless: (target: string) => Promise<{ success: boolean; message: string }>;
  pairWireless: (target: string, code: string, connectPort?: string) => Promise<{ success: boolean; message: string }>;

  // Real Mirroring (multi-session enabled, default screenId = "primary")
  startMirror: (serial: string, screenId?: string) => Promise<boolean>;
  stopMirror: (screenId?: string) => Promise<boolean>;
  getMirrorState: (screenId?: string) => Promise<MirrorState>;
  onMirrorStateChange: (callback: (payload: MirrorStatePayload) => void, screenId?: string) => () => void;
  onVideoChunk: (callback: (chunk: Uint8Array) => void, screenId?: string) => () => void;
  onVideoInit?: (callback: (meta: { codec: string; width: number; height: number }) => void, screenId?: string) => () => void;
  onVideoCodec?: (callback: (codec: string) => void, screenId?: string) => () => void;
  onAudioInit?: (callback: (meta: { codec: string }) => void, screenId?: string) => () => void;
  onAudioChunk?: (callback: (chunk: Uint8Array) => void, screenId?: string) => () => void;
  setAudioSettings?: (settings: { muted: boolean; level: number; screenId?: string }) => void;

  // Screen input (pointer, scroll, keyboard)
  sendControl: (input: ScreenControlInput, screenId?: string) => void;
}

declare global {
  interface Window {
    electronAPI?: FloatingPhoneAPI;
  }
}
