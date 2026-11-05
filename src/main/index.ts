import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";
import { AdbTracker } from "./adb/AdbTracker";
import { ScrcpyServerManager } from "./mirror/ScrcpyServerManager";

let mainWindow: BrowserWindow | null = null;
const adbTracker = new AdbTracker();
let mirrorManager: ScrcpyServerManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 880,
    minWidth: 320,
    minHeight: 400,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const resolvedAdb = await adbTracker.resolveAdbPath();
  mirrorManager = new ScrcpyServerManager(resolvedAdb);

  createWindow();
  await adbTracker.start();

  // Wire up ADB status → renderer (bound once after window exists)
  adbTracker.on("status-changed", (status) => {
    mainWindow?.webContents.send("adb:status-changed", status);
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
  mainWindow.setAlwaysOnTop(flag, "floating");
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

ipcMain.handle("window:setWindowSize", (_event, width: number, height: number) => {
  if (!mainWindow) return;
  const currentBounds = mainWindow.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const maxW = Math.min(width, primaryDisplay.workAreaSize.width);
  const maxH = Math.min(height, primaryDisplay.workAreaSize.height);

  mainWindow.setBounds({
    x: currentBounds.x,
    y: currentBounds.y,
    width: Math.round(maxW),
    height: Math.round(maxH),
  });
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
  await mirrorManager.start({ serial });
  return true;
});

ipcMain.handle("mirror:stop", async () => {
  if (!mirrorManager) return false;
  await mirrorManager.stop();
  return true;
});

ipcMain.handle("mirror:getState", () => {
  return mirrorManager?.getState() ?? "stopped";
});
