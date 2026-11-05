# Phase 5: Real Phone Detection with ADB

## Goal
Implement real device detection and status tracking via ADB (`adb track-devices`) in the Electron main process, piping real-time connection state (`no-device` | `unauthorized` | `device`) and device metadata (model, screen resolution) to the React renderer over IPC.

## Skills Pre-selected
- `backend-master`
- `design-engineering`
- `anti-slop-enforcer`

## Implementation Checklist
- [x] Implement `AdbTracker` in Electron main process with automatic binary resolution across SDK directories, `track-devices` streaming, and periodic `adb devices -l` polling.
- [x] Expose IPC channels `adb:getStatus`, `adb:getScreenSize`, and real-time push event `adb:status-changed`.
- [x] Connected `SetupWizard` to auto-advance to Step 4 on `unauthorized` (prompt on phone) and to Step 5 on `device` (authorized).
- [x] Dynamic screen resolution detection (`wm size`) that automatically computes aspect ratio and adapts the SVG phone frame to the real connected device.
- [x] Real-time ADB status card in the Inspector drawer displaying serial, model, display dimensions, and link state.

## Verification Evidence
- `npm run build` -> Main process and renderer bundle compiled cleanly in 3.09s with 0 errors.
- Discovered active ADB at `C:\Users\pc\AppData\Local\Android\Sdk\platform-tools\adb.exe` (v1.0.41).
