import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";

// Suppress ADB mDNS / network discovery to prevent Windows Firewall permission prompts.
// PhoneFrame communicates over USB or pre-connected TCP via localhost loopback, so mDNS
// discovery is unnecessary and triggers Windows Defender Firewall alerts on 0.0.0.0:5353.
process.env.ADB_MDNS = "0";
process.env.ADB_MDNS_OPENSCREEN = "0";
process.env.ADB_MDNS_AUTO_CONNECT = "0";
process.env.ADB_SERVER_SOCKET = "tcp:127.0.0.1:5037";

import { AdbTracker, type AdbStatusPayload } from "./adb/AdbTracker";
import { ScrcpyServerManager } from "./mirror/ScrcpyServerManager";
import { assetPath } from "./assets";

let mainWindow: BrowserWindow | null = null;
const adbTracker = new AdbTracker();
let mirrorManager: ScrcpyServerManager | null = null;

// Windows picks the window/taskbar/shortcut icon from this path.
const APP_ICON_PATH = assetPath("phoneframe-icon.ico");

// The floating phone must stay above every other app; re-assert topmost
// whenever focus changes, because new apps can otherwise rise above it.
let pinned = true;
const PIN_LEVEL = "screen-saver";

// Windowed geometry captured as immersive mode begins, so leaving it restores
// exactly the overlay the user had (including the auto-hidden-taskbar reserve).
let fullscreenRestoreBounds: Electron.Rectangle | null = null;

function applyPin(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(pinned, PIN_LEVEL);
}

function notifyFullscreenChanged(flag: boolean): void {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("window:fullscreen-changed", flag);
  }
}

/**
 * Transparent windows cannot enter native fullscreen on Windows — Electron only
 * resizes them to the monitor while isFullScreen() stays false, so the native
 * state can never be exited. Immersive mode is therefore explicit bounds plus
 * the saved windowed geometry. Immersive covers the whole display including
 * the taskbar area, so the black backdrop is edge-to-edge; windowed mode keeps
 * the taskbar reveal strip free instead.
 */
function setImmersive(active: boolean): boolean {
  if (!mainWindow) return false;
  if (active === (fullscreenRestoreBounds !== null)) return active;

  if (active) {
    fullscreenRestoreBounds = mainWindow.getBounds();
    mainWindow.setResizable(false);
    mainWindow.setBounds(computeImmersiveBounds());
  } else {
    const restore = fullscreenRestoreBounds ?? computeWindowBounds();
    fullscreenRestoreBounds = null;
    mainWindow.setBounds(restore);
    mainWindow.setResizable(true);
  }

  applyPin();
  notifyFullscreenChanged(active);
  return active;
}

// The whole monitor, taskbar included. Immersive mode must paint over every
// desktop edge, and the saved windowed geometry is restored on exit.
function computeImmersiveBounds(): { x: number; y: number; width: number; height: number } {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  return { x, y, width, height };
}

// Windowed bounds (work area minus the auto-hidden-taskbar reserve), shared by
// window creation and the setWindowSize IPC so the window never appears at any
// intermediate position.
function computeWindowBounds(): { x: number; y: number; width: number; height: number } {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const w = workArea.width;
  let h = workArea.height;
  const taskbarThickness = display.bounds.height - workArea.height;
  const reserveBottom = taskbarThickness < 4 ? 48 : 0;
  h = Math.max(200, h - reserveBottom);
  return {
    x: workArea.x + Math.round((workArea.width - w) / 2),
    y: reserveBottom > 0 ? workArea.y : workArea.y + Math.round((workArea.height - h) / 2),
    width: w,
    height: h,
  };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...computeWindowBounds(),
    show: false,
    icon: APP_ICON_PATH,
    minWidth: 200,
    minHeight: 300,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Never flash the window at a half-loaded position: reveal it only once the
  // renderer is ready to paint the centered frame.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Floating phone stays above other apps; it only minimizes/closes via the HUD
  applyPin();
  mainWindow.on("blur", applyPin);
  mainWindow.on("restore", applyPin);

  mainWindow.on("closed", () => {
    fullscreenRestoreBounds = null;
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Give the app its own taskbar identity so Windows groups the window (and a
  // pinned shortcut) under PhoneFrame instead of the generic Electron entry.
  app.setAppUserModelId("com.phoneframe.app");

  const resolvedAdb = await adbTracker.resolveAdbPath();
  mirrorManager = new ScrcpyServerManager(resolvedAdb);

  createWindow();
  await adbTracker.start();

  // Wire up ADB status → renderer (bound once after window exists)
  adbTracker.on("status-changed", (status: AdbStatusPayload) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("adb:status-changed", status);
    }

    // If the device behind the active stream disappears (unplug, ADB loss,
    // authorization revoked), tear the session down instead of waiting for
    // a socket error. ADB tracking itself keeps running.
    if (!mirrorManager) return;
    const mirrorState = mirrorManager.getState();
    if (mirrorState !== "starting" && mirrorState !== "running") return;

    const serial = mirrorManager.getActiveSerial();
    if (!serial) return;

    const stillOnline = status.devices.some(
      (device) => device.serial === serial && device.state === "device"
    );
    if (!stillOnline) {
      console.log(`[main] Device ${serial} is no longer online; stopping mirror.`);
      void mirrorManager.stop();
    }
  });

  // Wire up mirror events → renderer (bound once after mirrorManager + window exist)
  mirrorManager.on("video-init", (meta) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("video:init", meta);
    }
  });

  mirrorManager.on("video-codec", (codec: string) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("video:codec", codec);
    }
  });

  mirrorManager.on("video-chunk", (chunk: Buffer) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("video:chunk", chunk);
    }
  });

  mirrorManager.on("audio-init", (meta) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("audio:init", meta);
    }
  });

  mirrorManager.on("audio-chunk", (chunk: Buffer) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("audio:chunk", chunk);
    }
  });

  mirrorManager.on("state-changed", (state: string, err?: string) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("mirror:state-changed", { state, error: err });
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  if (mirrorManager) {
    await mirrorManager.stop();
  }
  adbTracker.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers for window control
ipcMain.handle("window:setAlwaysOnTop", (_event, flag: boolean) => {
  if (!mainWindow) return false;
  pinned = flag;
  applyPin();
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle("window:getAlwaysOnTop", () => {
  return mainWindow?.isAlwaysOnTop() ?? false;
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:setWindowSize", (_event, _width: number, _height: number) => {
  if (!mainWindow) return;
  // The renderer only ever requests the fullscreen overlay, so creation and
  // this resize resolve to the same bounds and the window never shifts.
  mainWindow.setBounds(computeWindowBounds());
});

ipcMain.handle("window:setIgnoreMouseEvents", (_event, flag: boolean) => {
  mainWindow?.setIgnoreMouseEvents(flag, { forward: true });
});

ipcMain.handle("window:setFullscreen", (_event, flag: boolean) => {
  return setImmersive(Boolean(flag));
});

ipcMain.handle("window:getFullscreen", () => {
  return fullscreenRestoreBounds !== null;
});

// ADB IPC handlers
ipcMain.handle("adb:getStatus", () => {
  return adbTracker.getStatus();
});

ipcMain.handle("adb:getScreenSize", async (_event, serial: string) => {
  return adbTracker.getScreenSize(serial);
});

// Mirroring IPC handlers
ipcMain.handle("mirror:start", async (_event, serial: string) => {
  if (!mirrorManager) return false;
  try {
    // Resolves only once the stream is live (or the start failed).
    await mirrorManager.start({ serial });
  } catch (err) {
    console.error("[main] mirror:start failed:", err);
  }
  return mirrorManager.getState() === "running";
});

ipcMain.handle("mirror:stop", async () => {
  if (!mirrorManager) return false;
  await mirrorManager.stop();
  return true;
});

ipcMain.handle("mirror:getState", () => {
  return mirrorManager?.getState() ?? "stopped";
});

// High-frequency pointer/scroll/key stream: fire-and-forget to keep input latency low.
ipcMain.on("mirror:control", (_event, input: unknown) => {
  mirrorManager?.injectInput(input);
});

// HUD audio state: the renderer owns the desktop gain, the main process owns
// the phone's real media volume (exclusive routing).
ipcMain.on("audio:settings", (_event, settings: { muted?: boolean; level?: number }) => {
  if (!settings || typeof settings !== "object") return;
  mirrorManager?.setDesktopAudio(
    Boolean(settings.muted),
    typeof settings.level === "number" ? settings.level : 1
  );
});
