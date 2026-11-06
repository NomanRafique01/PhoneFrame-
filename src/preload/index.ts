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
  onAudioInit?: (callback: (meta: { codec: string }) => void) => () => void;
  onAudioChunk?: (callback: (chunk: Uint8Array) => void) => () => void;
  setAudioSettings?: (settings: { muted: boolean; level: number }) => void;

  // Screen input (pointer, scroll, keyboard)
  sendControl: (input: ScreenControlInput) => void;
}

const api: FloatingPhoneAPI = {
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke("window:setAlwaysOnTop", flag),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:getAlwaysOnTop"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke("window:setWindowSize", width, height),
  setIgnoreMouseEvents: (flag: boolean) => ipcRenderer.invoke("window:setIgnoreMouseEvents", flag),

  getAdbStatus: () => ipcRenderer.invoke("adb:getStatus"),
  onAdbStatusChange: (callback: (status: AdbStatusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AdbStatusPayload) => callback(status);
    ipcRenderer.on("adb:status-changed", handler);
    return () => {
      ipcRenderer.removeListener("adb:status-changed", handler);
    };
  },
  getAdbScreenSize: (serial: string) => ipcRenderer.invoke("adb:getScreenSize", serial),

  startMirror: (serial: string) => ipcRenderer.invoke("mirror:start", serial),
  stopMirror: () => ipcRenderer.invoke("mirror:stop"),
  getMirrorState: () => ipcRenderer.invoke("mirror:getState"),
  onMirrorStateChange: (callback: (payload: MirrorStatePayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: MirrorStatePayload) => callback(payload);
    ipcRenderer.on("mirror:state-changed", handler);
    return () => {
      ipcRenderer.removeListener("mirror:state-changed", handler);
    };
  },
  onVideoChunk: (callback: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
    ipcRenderer.on("video:chunk", handler);
    return () => {
      ipcRenderer.removeListener("video:chunk", handler);
    };
  },
  onVideoInit: (callback: (meta: { codec: string; width: number; height: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, meta: { codec: string; width: number; height: number }) => callback(meta);
    ipcRenderer.on("video:init", handler);
    return () => {
      ipcRenderer.removeListener("video:init", handler);
    };
  },
  onVideoCodec: (callback: (codec: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, codec: string) => callback(codec);
    ipcRenderer.on("video:codec", handler);
    return () => {
      ipcRenderer.removeListener("video:codec", handler);
    };
  },
  onAudioInit: (callback: (meta: { codec: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, meta: { codec: string }) => callback(meta);
    ipcRenderer.on("audio:init", handler);
    return () => {
      ipcRenderer.removeListener("audio:init", handler);
    };
  },
  onAudioChunk: (callback: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => callback(chunk);
    ipcRenderer.on("audio:chunk", handler);
    return () => {
      ipcRenderer.removeListener("audio:chunk", handler);
    };
  },
  setAudioSettings: (settings: { muted: boolean; level: number }) => {
    ipcRenderer.send("audio:settings", settings);
  },

  sendControl: (input: ScreenControlInput) => {
    ipcRenderer.send("mirror:control", input);
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

declare global {
  interface Window {
    electronAPI?: FloatingPhoneAPI;
  }
}
