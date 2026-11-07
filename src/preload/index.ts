import { contextBridge, ipcRenderer } from "electron";

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
  refreshDevices: () => Promise<AdbStatusPayload>;
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

const api: FloatingPhoneAPI = {
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke("window:setAlwaysOnTop", flag),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:getAlwaysOnTop"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke("window:setWindowSize", width, height),
  setIgnoreMouseEvents: (flag: boolean) => ipcRenderer.invoke("window:setIgnoreMouseEvents", flag),
  setFullscreen: (flag: boolean) => ipcRenderer.invoke("window:setFullscreen", flag),
  getFullscreen: () => ipcRenderer.invoke("window:getFullscreen"),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on("window:fullscreen-changed", handler);
    return () => {
      ipcRenderer.removeListener("window:fullscreen-changed", handler);
    };
  },

  getAdbStatus: () => ipcRenderer.invoke("adb:getStatus"),
  refreshDevices: () => ipcRenderer.invoke("adb:refreshDevices"),
  onAdbStatusChange: (callback: (status: AdbStatusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AdbStatusPayload) => callback(status);
    ipcRenderer.on("adb:status-changed", handler);
    return () => {
      ipcRenderer.removeListener("adb:status-changed", handler);
    };
  },
  getAdbScreenSize: (serial: string) => ipcRenderer.invoke("adb:getScreenSize", serial),
  getDeviceIp: (serial: string) => ipcRenderer.invoke("adb:getDeviceIp", serial),
  enableWireless: (serial: string) => ipcRenderer.invoke("adb:enableWireless", serial),
  connectWireless: (target: string) => ipcRenderer.invoke("adb:connectWireless", target),
  disconnectWireless: (target: string) => ipcRenderer.invoke("adb:disconnectWireless", target),
  pairWireless: (target: string, code: string, connectPort?: string) => ipcRenderer.invoke("adb:pairWireless", target, code, connectPort),

  startMirror: (serial: string, screenId: string = "primary") =>
    ipcRenderer.invoke("mirror:start", { serial, screenId }),
  stopMirror: (screenId: string = "primary") =>
    ipcRenderer.invoke("mirror:stop", screenId),
  getMirrorState: (screenId: string = "primary") =>
    ipcRenderer.invoke("mirror:getState", screenId),
  onMirrorStateChange: (callback: (payload: MirrorStatePayload) => void, screenId?: string) => {
    const channel = screenId ? `mirror:state-changed:${screenId}` : "mirror:state-changed";
    const handler = (_event: Electron.IpcRendererEvent, payload: MirrorStatePayload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onVideoChunk: (callback: (chunk: Uint8Array) => void, screenId?: string) => {
    const channel = screenId ? `video:chunk:${screenId}` : "video:chunk";
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onVideoInit: (callback: (meta: { codec: string; width: number; height: number }) => void, screenId?: string) => {
    const channel = screenId ? `video:init:${screenId}` : "video:init";
    const handler = (_event: Electron.IpcRendererEvent, meta: { codec: string; width: number; height: number }) => callback(meta);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onVideoCodec: (callback: (codec: string) => void, screenId?: string) => {
    const channel = screenId ? `video:codec:${screenId}` : "video:codec";
    const handler = (_event: Electron.IpcRendererEvent, codec: string) => callback(codec);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onAudioInit: (callback: (meta: { codec: string }) => void, screenId?: string) => {
    const channel = screenId ? `audio:init:${screenId}` : "audio:init";
    const handler = (_event: Electron.IpcRendererEvent, meta: { codec: string }) => callback(meta);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onAudioChunk: (callback: (chunk: Uint8Array) => void, screenId?: string) => {
    const channel = screenId ? `audio:chunk:${screenId}` : "audio:chunk";
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  setAudioSettings: (settings: { muted: boolean; level: number; screenId?: string }) => {
    ipcRenderer.send("audio:settings", settings);
  },

  sendControl: (input: ScreenControlInput, screenId: string = "primary") => {
    ipcRenderer.send("mirror:control", input, screenId);
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

declare global {
  interface Window {
    electronAPI?: FloatingPhoneAPI;
  }
}
