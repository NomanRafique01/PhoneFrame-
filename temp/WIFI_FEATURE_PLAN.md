# PhoneFrame: Wi-Fi Wireless Mirroring & Dual-Mode Setup Wizard

## Overview
Enable seamless wireless mirroring over Wi-Fi alongside the existing USB data cable connection. When PhoneFrame launches, users can choose between **USB Cable** or **Wi-Fi Wireless** with a dedicated step-by-step setup guide for each, interactive QR code pairing for Android 11+, copyable pairing commands, and one-click USB-to-Wi-Fi switching.

---

## Phases Breakdown

### Phase 1: ADB Backend & IPC Foundation for Wireless Operations
- **`AdbTracker.ts` Enhancements**:
  - `getDeviceIp(serial)`: Query device Wi-Fi IP address across Android versions (`ip -f inet addr`, `ip route`, `dhcp.wlan0.ipaddress`).
  - `enableWireless(serial)`: Automatically enable `adb tcpip 5555`, query phone IP, and connect via `adb connect <ip>:5555`.
  - `connectWireless(target)`: Connect to any `ip:port` (handles auto-appending `:5555`).
  - `disconnectWireless(target)`: Disconnect active wireless session.
  - `pairWireless(target, code)`: Run `adb pair <target> <code>` for Android 11+ wireless debugging.
  - Mark `isWireless?: boolean` on `AdbDeviceInfo` so the UI instantly distinguishes Wi-Fi from USB connections.
- **IPC Handlers (`src/main/index.ts`)**:
  - Expose `adb:enableWireless`, `adb:connectWireless`, `adb:disconnectWireless`, `adb:pairWireless`, `adb:getDeviceIp`.
- **Typed Preload Bridge (`src/preload/index.ts` & `src/renderer/types/electron.d.ts`)**:
  - Expose async methods on `window.electronAPI`.

---

### Phase 2: Icons, QR Code & Clipboard Utilities
- **Vector Icons (`src/renderer/components/icons/index.tsx`)**:
  - `WifiIcon`: Clean 24×24 stroke-aligned vector icon.
  - `QrCodeIcon`: Vector representation for scan tab.
  - `CopyIcon`: Clean copy icon with feedback.
- **Procedural SVG QR Code Renderer**:
  - Self-contained SVG QR code generator component that renders directly inside the phone screen without heavy external dependencies.
  - Generates the standard Android Wireless Debugging QR code payload: `WIFI:T:ADB;S:PhoneFrame;P:<pairing_code>;;` recognizable by Android 11+ developer settings.
- **Copy-to-Clipboard Utility**:
  - Quick action with visual "Copied!" badge for IP:Port, pairing codes, and `adb connect` commands.

---

### Phase 3: Setup Wizard Redesign (Dual-Mode USB / Wi-Fi)
- **Top Mode Selector Bar**:
  - Segmented toggle at the top of the wizard: `[ 🔌 USB Cable ]` | `[ 📶 Wi-Fi Wireless ]`.
  - Remembers user's preferred mode or defaults intelligently based on connected hardware.
- **USB Setup Guide**:
  - Retain the existing 5-step interactive guide (Connect USB → Developer Options → USB Debugging → RSA Key → Ready).
- **Wi-Fi Setup Guide (New)**:
  - **Step 1 (Network)**: Verify Phone & PC are on the same Wi-Fi router / SSID.
  - **Step 2 (Settings)**: Enable Developer Options → Wireless Debugging on the phone.
  - **Step 3 (Pairing / Connect)**:
    - **Tab A — Instant Switch**: Plug USB in for 2 seconds, click "Switch to Wi-Fi", then unplug cable.
    - **Tab B — Scan QR Code**: Displays dynamic QR code right inside PhoneFrame screen for Android 11+ phones to scan directly from *Settings → Developer Options → Pair device with QR code*.
    - **Tab C — Manual IP / Code**: Direct input for `192.168.x.x:port` and 6-digit pairing code with copy button.
  - **Step 4 (Ready)**: Live confirmation and one-click "Start Wireless Stream".

---

### Phase 4: Frame Inspector Integration & Live Controls
- **ADB Link Telemetry Card**:
  - Shows connection badge: `[USB Hardware]` vs `[Wi-Fi Link (192.168.1.x)]`.
  - If connected via USB: show a one-click **"Switch to Wi-Fi"** action.
  - If connected via Wi-Fi: show a **"Disconnect Wi-Fi"** action.
  - Manual connection drawer for quick reconnects without reopening the wizard.

---

### Phase 5: Testing, Validation & Packaging
- Full TypeScript type-check and Vite build.
- Test connection switching, unplug detection, stream continuity, and error cases (wrong IP, Wi-Fi off).
- Rebuild installer with updated assets.

