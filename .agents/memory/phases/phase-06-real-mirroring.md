# Phase 6: Real Mirroring Inside the Frame

## Goal
Establish the real Android video stream from the device and render it inside the SVG phone frame:
1. Locate or bundle `scrcpy-server` (jar).
2. Push `scrcpy-server` to the device via ADB: `adb push scrcpy-server /data/local/tmp/scrcpy-server.jar`.
3. Reverse port forward or forward socket via ADB: `adb forward tcp:PORT localabstract:scrcpy` (or reverse tunnel).
4. Run server: `adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server ...`.
5. Connect TCP socket in main process or renderer, read the raw H.264 NAL units / stream header.
6. Decode using WebCodecs `VideoDecoder` API in the renderer and draw onto the inner `<canvas>` inside `PhoneFrame`.

## Skills Pre-selected
- `backend-master`
- `design-engineering`
- `animation-performance`
- `anti-slop-enforcer`

## Implementation Checklist
- [x] Bundled verified `scrcpy-server.jar` in `assets/scrcpy-server.jar` and documented Apache 2.0 license in `THIRD_PARTY_LICENSES/scrcpy.txt`.
- [x] Implemented `ScrcpyServerManager` in Electron main process handling ADB push, port forward tunnel, server process execution, and raw H.264 TCP stream demuxing.
- [x] Built `VideoCanvas` utilizing WebCodecs hardware accelerated `VideoDecoder` (`avc1.42E01E`) with Annex-B NAL unit boundary detection and zero-copy `<canvas>` rendering.
- [x] Integrated real-time stream controls (Start/Stop stream) in both the Phone Display view and the Frame Inspector drawer.
- [x] Displaying live FPS and hardware GPU decoder telemetry.

## Verification Evidence
- `npm run build` -> Compiled main process and Vite renderer bundle cleanly in 2.45s with 0 errors.
