export type AdbDeviceState = "device" | "unauthorized" | "offline" | "no-device";

export interface AdbDeviceInfo {
  serial: string;
  state: AdbDeviceState;
  model?: string;
  product?: string;
  device?: string;
  width?: number;
  height?: number;
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
}

export interface FloatingPhoneAPI {
  // Window controls
  setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  getAlwaysOnTop: () => Promise<boolean>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  setWindowSize: (width: number, height: number) => Promise<void>;

  // ADB device tracking
  getAdbStatus: () => Promise<AdbStatusPayload>;
  onAdbStatusChange: (callback: (status: AdbStatusPayload) => void) => () => void;
  getAdbScreenSize: (serial: string) => Promise<{ width: number; height: number } | null>;

  // Real Mirroring
  startMirror: (serial: string) => Promise<boolean>;
  stopMirror: () => Promise<boolean>;
  getMirrorState: () => Promise<MirrorState>;
  onMirrorStateChange: (callback: (payload: MirrorStatePayload) => void) => () => void;
  onVideoChunk: (callback: (chunk: Uint8Array) => void) => () => void;
  onVideoInit?: (callback: (meta: { codec: string; width: number; height: number }) => void) => () => void;
  onVideoCodec?: (callback: (codec: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: FloatingPhoneAPI;
  }
}
