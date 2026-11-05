# PhoneFrame: Project Context

## What we are building
PhoneFrame is a desktop app (Electron + React + TypeScript) that mirrors a USB-connected
Android phone inside a floating, draggable, phone-shaped frame. It is meant to sit over
the screen while the user develops apps.

## Goals
- Users choose from different phone frames. Frames are generated as SVG by code
  (bezel thickness, corner radius, notch style, color), so they fit any screen size and
  aspect ratio without stretching.
- The mirrored screen appears inside the frame. The window is transparent and borderless,
  so it looks like a floating phone with no app UI visible.
- The frame is draggable by the bezel only. The screen area stays free for touch input later.
- The frame adapts automatically to the phone's screen size and rotation.
- A setup wizard guides the user: connect USB -> enable Developer options -> enable USB
  debugging. The app then detects whether each step is done, using adb.
- Android only for now.

## Architecture plan
- Device detection: adb (`adb track-devices`). States: no device, unauthorized, device.
- Mirroring: reuse scrcpy's server (reference/scrcpy/server), push it to the phone with adb,
  receive the H.264 stream, decode with WebCodecs, draw on a <canvas> inside the frame.
- Study these reference files to understand the stream protocol:
  - reference/scrcpy/server/src/main/java/com/genymobile/scrcpy/Server.java
  - reference/scrcpy/app/src/demuxer.c and decoder.c
  - reference/scrcpy/doc/develop.md

## Design tokens
Defined in src/renderer/styles/tokens.css. Do not change the palette values.
Palette: #06141B, #11212D, #253745, #4A5C6A, #9BA8AB, #CCD0CF.
Default frame colors (same palette): Midnight, Navy, Slate, Steel, Mist, Silver.

## Rules for the agent
- Work one step at a time. Do only what the current prompt asks, then stop and list what changed.
- Keep code simple and readable, with short comments.
- reference/scrcpy is READ-ONLY. Never edit it, never import it into the app build.
- When we bundle scrcpy-server or adb, add their Apache 2.0 licenses and copyright notices
  to a THIRD_PARTY_LICENSES folder.

## Roadmap (mark each step [x] when finished)
- [x] Step 1  Project setup, design tokens, app shell
- [x] Step 2  SVG frame engine + color/style options
- [x] Step 3  Floating transparent draggable window
- [x] Step 4  Setup wizard screens
- [x] Step 5  Real phone detection with adb
- [x] Step 6  Real mirroring inside the frame
- [ ] Step 7  Polish, packaging, licenses
