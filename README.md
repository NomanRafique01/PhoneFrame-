# FloatingPhone 📱

> A floating, draggable, transparent desktop overlay for Android screen mirroring built with Electron, React, TypeScript, and WebCodecs.

FloatingPhone is designed for Android developers who want a responsive, phone-shaped viewport floating on top of their workspace without the clutter of emulator windows or generic mirroring toolbars.

---

## ✨ Features

- **Floating Borderless Frame:** Transparent, draggable, borderless window with rounded corners and customizable notch/island designs.
- **Parametric SVG Frames:** Dynamically computed phone frames (bezel thickness, corner radii, camera punch-holes) that adapt to any screen aspect ratio.
- **Low-Latency Hardware Decoding:** Direct H.264 video streaming decoded using the native browser **WebCodecs API** with zero-copy GPU canvas rendering.
- **Automated ADB & Device Detection:** Real-time device connection monitoring (`adb track-devices`) and USB debugging setup wizard.
- **Embedded Scrcpy Server:** Bundled `scrcpy-server-v3.1.jar` pushed via ADB for 60fps streaming without requiring a full scrcpy desktop installation.

---

## 🏗️ Project Architecture

```
FloatingPhone/
├── assets/                       # Embedded binaries & server JARs
│   ├── scrcpy-server-v3.1.jar    # Official scrcpy server v3.1 JAR
│   └── scrcpy-server.jar         # Fallback server JAR
├── scripts/                      # Developer utility & diagnostic scripts
│   └── test_stream_diagnostics.ps1 # Standalone PowerShell stream test
├── src/
│   ├── main/                     # Electron Main Process (Node.js)
│   │   ├── adb/                  # ADB device tracking & discovery
│   │   │   ├── AdbTracker.ts     # Process wrapper for `adb track-devices`
│   │   │   └── index.ts
│   │   ├── mirror/               # Scrcpy server lifecycle & socket parser
│   │   │   ├── ScrcpyServerManager.ts # H.264 stream demuxer & IPC emitter
│   │   │   └── index.ts
│   │   └── index.ts              # Electron window lifecycle & IPC handlers
│   ├── preload/                  # Secure Context Isolation Bridge
│   │   └── index.ts              # Typed `window.electronAPI` bridge
│   └── renderer/                 # Frontend React Application (Vite)
│       ├── components/           # UI Components
│       │   ├── HUD/              # Floating overlay controls & FPS badge
│       │   ├── icons/            # Zero-slop SVG icons
│       │   ├── PhoneFrame/       # SVG frame renderer & styling options
│       │   ├── SetupWizard/      # Step-by-step connection guide
│       │   ├── VideoCanvas/      # WebCodecs VideoDecoder & canvas renderer
│       │   └── index.ts          # Unified components barrel export
│       ├── styles/               # CSS Design Tokens & Reset
│       │   ├── tokens.css        # Palette & typography tokens
│       │   └── global.css
│       ├── types/                # Ambient TypeScript definitions
│       │   └── electron.d.ts     # Preload API interface definitions
│       ├── App.tsx               # Primary application state orchestrator
│       └── main.tsx              # React DOM entry point
├── THIRD_PARTY_LICENSES/         # Open-source third-party licenses
├── index.html                    # Vite HTML entry
├── package.json                  # Dependencies & npm scripts
├── tsconfig.json                 # TypeScript config (Renderer)
├── tsconfig.node.json            # TypeScript config (Main & Preload)
└── vite.config.ts                # Vite bundler configuration
```

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js** (v18.0.0 or later) and **npm**
2. **Android SDK Platform-Tools (`adb`)**:
   - Must be installed and accessible either on your system `PATH` or in standard Android SDK locations:
     - Windows: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
     - macOS: `~/Library/Android/sdk/platform-tools/adb`
     - Linux: `~/Android/Sdk/platform-tools/adb`
3. **Android Device**:
   - Developer Options enabled.
   - USB Debugging enabled.
   - Connected via USB cable.

### Installation

```bash
git clone https://github.com/your-username/FloatingPhone.git
cd FloatingPhone
npm install
```

### Development & Running

- **Build and Run App:**
  ```bash
  npm run start:build
  ```

- **Compile Main and Renderer separately:**
  ```bash
  # Compile main process & preload
  npm run build:main

  # Build renderer with Vite
  npm run build:renderer

  # Full build
  npm run build
  ```

- **Launch Electron after build:**
  ```bash
  npm start
  ```

---

## ⚡ How Screen Mirroring Works

1. **Detection:** `AdbTracker` continuously tracks connected devices via `adb track-devices`.
2. **Push & Forward:** `ScrcpyServerManager` pushes `scrcpy-server-v3.1.jar` to `/data/local/tmp/scrcpy-server.jar` on the Android device and executes `adb forward tcp:27183 localabstract:scrcpy_<scid>`.
3. **Server Launch:** The server is spawned via Android's `app_process` with tunnel forwarding enabled.
4. **Demuxing:** Node.js TCP client connects to the forwarded socket, parses the scrcpy v3 video header (codec, width, height), and demuxes individual H.264 NAL units (handling 64-bit PTS timestamps and SPS/PPS config preservation).
5. **GPU Decoding:** Frames are transmitted over Electron IPC to the renderer, where `VideoDecoder` (WebCodecs API) dynamically configures according to the device's SPS profile and draws directly to an HTML5 `<canvas>`.

---

## 📜 License

Licensed under the MIT License. See individual third-party attribution notices in [THIRD_PARTY_LICENSES](file:///c:/Users/pc/Desktop/FloatingPhone/THIRD_PARTY_LICENSES/scrcpy.txt).

