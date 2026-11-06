import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";
import { AdbTracker } from "./adb/AdbTracker";
import { ScrcpyServerManager } from "./mirror/ScrcpyServerManager";

let mainWindow: BrowserWindow | null = null;
const adbTracker = new AdbTracker();
let mirrorManager: ScrcpyServerManager | null = null;

// The floating phone must stay above every other app; re-assert topmost
// whenever focus changes, because new apps can otherwise rise above it.
let pinned = true;
const PIN_LEVEL = "screen-saver";

function applyPin(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(pinned, PIN_LEVEL);
}

// Fullscreen bounds minus the auto-hidden-taskbar reserve, shared by window
// creation and the setWindowSize IPC so the window never appears at any
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
    minWidth: 200,
    minHeight: 300,
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

  // Never flash the window at a half-loaded position: reveal it only once the
  // renderer is ready to paint the centered frame.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Floating phone stays above other apps; it only minimizes/closes via the HUD
  applyPin();
  mainWindow.on("blur", applyPin);
  mainWindow.on("restore", applyPin);

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
