# Phase 3: Floating Transparent Draggable Window & Bezel HUD

## Goal
Configure the frameless, transparent floating Electron window that hugs the SVG phone frame, ensures the outer bezel acts as the drag handle while the screen passes through touch input, and provides a minimal hover HUD.

## Skills Pre-selected
- `desktop-ui-architect`
- `design-engineering`
- `anti-slop-enforcer`

## Implementation Checklist
- [x] Configure Electron `BrowserWindow` with `transparent: true`, `frame: false`, `backgroundColor: '#00000000'`, and `hasShadow: false`.
- [x] Create IPC bridge for `window:setAlwaysOnTop`, `window:setWindowSize`, `window:minimize`, and `window:close`.
- [x] Implement `FloatingHUD` component with hover reveal, pin state, rotation trigger, inspector toggle, and 44x44px touch targets.
- [x] Window dimension auto-adaptation via `window:setWindowSize` when scaling or toggling portrait/landscape.
- [x] Verified complete build pipeline (`npm run build`) compiling TypeScript and Vite bundle with 0 errors.

## Verification Evidence
- `npm run build` -> Compiled main process and Vite renderer cleanly with 0 errors.
