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
}

const api: FloatingPhoneAPI = {
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke("window:setAlwaysOnTop", flag),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:getAlwaysOnTop"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke("window:setWindowSize", width, height),

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
};

contextBridge.exposeInMainWorld("electronAPI", api);

declare global {
  interface Window {
    electronAPI?: FloatingPhoneAPI;
  }
}
