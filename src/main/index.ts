import { app, BrowserWindow, ipcMain, screen, nativeImage } from "electron";
import * as path from "node:path";

// Suppress ADB mDNS / network discovery to prevent Windows Firewall permission prompts.
// PhoneFrame communicates over USB or pre-connected TCP via localhost loopback, so mDNS
// discovery is unnecessary and triggers Windows Defender Firewall alerts on 0.0.0.0:5353.
process.env.ADB_MDNS = "0";
process.env.ADB_MDNS_OPENSCREEN = "0";
process.env.ADB_MDNS_AUTO_CONNECT = "0";

import { AdbTracker, type AdbStatusPayload } from "./adb/AdbTracker";
import { ScrcpyServerManager } from "./mirror/ScrcpyServerManager";
import { assetPath } from "./assets";

let mainWindow: BrowserWindow | null = null;
const adbTracker = new AdbTracker();
// Multi-session registry: supports up to 4 concurrent independent screens without conflict
const mirrorSessions = new Map<string, ScrcpyServerManager>();
let cachedResolvedAdb = "adb";

function getOrCreateMirrorSession(screenId: string = "primary"): ScrcpyServerManager {
  let session = mirrorSessions.get(screenId);
  if (!session) {
    session = new ScrcpyServerManager(cachedResolvedAdb);
    mirrorSessions.set(screenId, session);

    // Wire up screen-scoped and legacy fallback events to mainWindow
    session.on("video-init", (meta) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`video:init:${screenId}`, meta);
        if (screenId === "primary") {
          mainWindow.webContents.send("video:init", meta);
        }
      }
    });

    session.on("video-codec", (codec: string) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`video:codec:${screenId}`, codec);
        if (screenId === "primary") {
          mainWindow.webContents.send("video:codec", codec);
        }
      }
    });

    session.on("video-chunk", (chunk: Buffer) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        // Renderers always subscribe to the screen-scoped channel; mirroring a
        // 60 fps stream to a second channel doubled IPC copies for no consumer.
        mainWindow.webContents.send(`video:chunk:${screenId}`, chunk);
      }
    });

    session.on("audio-init", (meta) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`audio:init:${screenId}`, meta);
        if (screenId === "primary") {
          mainWindow.webContents.send("audio:init", meta);
        }
      }
    });

    session.on("audio-chunk", (chunk: Buffer) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`audio:chunk:${screenId}`, chunk);
      }
    });

    session.on("state-changed", (state: string, err?: string) => {
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`mirror:state-changed:${screenId}`, { screenId, state, error: err });
        mainWindow.webContents.send("mirror:state-changed", { screenId, state, error: err });
      }
      // Keep periodic ADB property/shell queries off the link while streaming.
      const anyStreaming = [...mirrorSessions.values()].some((s) => {
        const sessionState = s.getState();
        return sessionState === "running" || sessionState === "starting";
      });
      adbTracker.setStreamingActive(anyStreaming);
    });
  }
  return session;
}

// Windows picks the window/taskbar/shortcut icon from this path.
const APP_ICON_ICO = assetPath("phoneframe-icon.ico");
const APP_ICON_PNG = assetPath("phoneframe-icon.png");

function getAppIcon(): Electron.NativeImage {
  // Try ICO first for native multi-res (16-256px), fallback to high-res master PNG
  const ico = nativeImage.createFromPath(APP_ICON_ICO);
  if (!ico.isEmpty()) return ico;
  return nativeImage.createFromPath(APP_ICON_PNG);
}

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
  const appIcon = getAppIcon();

  mainWindow = new BrowserWindow({
    ...computeWindowBounds(),
    show: false,
    icon: appIcon,
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

  // Explicitly apply window icon for Windows taskbar and Alt+Tab overlay
  mainWindow.setIcon(appIcon);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Never flash the window at a half-loaded position: reveal it only once the
  // renderer is ready to paint the centered frame, and re-assert the taskbar icon.
  mainWindow.once("ready-to-show", () => {
    mainWindow?.setIcon(appIcon);
    mainWindow?.show();
  });

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
  // Give the app its own taskbar identity when packaged so Windows groups the window
  // with the installed Start Menu shortcut. In development mode (npm start), do NOT bind
  // to the installed shortcut's AppID to prevent Windows Taskbar from pulling any stale
  // cached icon from a previously installed older build.
  if (app.isPackaged) {
    app.setAppUserModelId("com.phoneframe.app");
  }

  cachedResolvedAdb = await adbTracker.resolveAdbPath();
  getOrCreateMirrorSession("primary");

  createWindow();
  await adbTracker.start();

  // Wire up ADB status → renderer (bound once after window exists)
  adbTracker.on("status-changed", (status: AdbStatusPayload) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("adb:status-changed", status);
    }

    // For every active mirror session, if its device goes offline, tear it down
    for (const [screenId, session] of mirrorSessions.entries()) {
      const mirrorState = session.getState();
      if (mirrorState !== "starting" && mirrorState !== "running") continue;

      const serial = session.getActiveSerial();
      if (!serial) continue;

      const stillOnline = status.devices.some(
        (device) => device.serial === serial && device.state === "device"
      );
      if (!stillOnline) {
        console.log(`[main] Device ${serial} for screen ${screenId} is no longer online; stopping mirror.`);
        void session.stop();
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  for (const session of mirrorSessions.values()) {
    try {
      await session.stop();
    } catch {
      // ignore
    }
  }
  mirrorSessions.clear();
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

ipcMain.handle("adb:refreshDevices", async () => {
  return adbTracker.refreshDevices();
});

ipcMain.handle("adb:getScreenSize", async (_event, serial: string) => {
  return adbTracker.getScreenSize(serial);
});

ipcMain.handle("adb:getDeviceIp", async (_event, serial: string) => {
  return adbTracker.getDeviceIp(serial);
});

ipcMain.handle("adb:enableWireless", async (_event, serial: string) => {
  return adbTracker.enableWireless(serial);
});

ipcMain.handle("adb:connectWireless", async (_event, target: string) => {
  return adbTracker.connectWireless(target);
});

ipcMain.handle("adb:disconnectWireless", async (_event, target: string) => {
  return adbTracker.disconnectWireless(target);
});

ipcMain.handle("adb:pairWireless", async (_event, target: string, code: string, connectPort?: string) => {
  return adbTracker.pairWireless(target, code, connectPort);
});

// Mirroring IPC handlers: multi-session enabled, conflict-free
ipcMain.handle(
  "mirror:start",
  async (_event, serialOrOptions: string | { serial: string; screenId?: string }, screenIdArg?: string) => {
    const serial = typeof serialOrOptions === "object" ? serialOrOptions.serial : serialOrOptions;
    const screenId =
      typeof serialOrOptions === "object"
        ? (serialOrOptions.screenId ?? "primary")
        : (screenIdArg ?? "primary");
    const session = getOrCreateMirrorSession(screenId);
    try {
      // Resolves only once the stream is live (or the start failed).
      await session.start({ serial });
    } catch (err) {
      console.error(`[main] mirror:start for screen ${screenId} failed:`, err);
    }
    return session.getState() === "running";
  }
);

ipcMain.handle("mirror:stop", async (_event, screenId: string = "primary") => {
  const session = mirrorSessions.get(screenId);
  if (!session) return false;
  await session.stop();
  return true;
});

ipcMain.handle("mirror:getState", (_event, screenId: string = "primary") => {
  return mirrorSessions.get(screenId)?.getState() ?? "stopped";
});

// High-frequency pointer/scroll/key stream: fire-and-forget to keep input latency low.
ipcMain.on("mirror:control", (_event, input: unknown, screenIdArg?: string) => {
  let screenId = screenIdArg ?? "primary";
  if (input && typeof input === "object" && "screenId" in input && typeof (input as any).screenId === "string") {
    screenId = (input as any).screenId;
  }
  const session = mirrorSessions.get(screenId);
  session?.injectInput(input);
});

// HUD audio state: exclusive routing per session
ipcMain.on(
  "audio:settings",
  (_event, settings: { muted?: boolean; level?: number; screenId?: string }, screenIdArg?: string) => {
    if (!settings || typeof settings !== "object") return;
    const screenId = settings.screenId ?? screenIdArg ?? "primary";
    const session = mirrorSessions.get(screenId);
    session?.setDesktopAudio(
      Boolean(settings.muted),
      typeof settings.level === "number" ? settings.level : 1
    );
  }
);
