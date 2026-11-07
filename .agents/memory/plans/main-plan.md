# Master Plan: Multi-Screen Independent Display System (Up to 4 Screens)
**Date:** 2026-11-07
**Status:** IN PROGRESS (Phase 2 of 4)
**Total Phases:** 4

## Goal & Architecture
Allow developers to open up to 4 concurrent, fully functional, independent phone screens in PhoneFrame. Each screen is a completely separate functional entity (USB or Wi-Fi) with isolated dynamic port allocation (zero collisions), independent streaming sessions, drag-and-drop spatial overlap dimming, and centered settings isolation.

## Phase Breakdown
- [x] **Phase 1: Multi-Session Backend & Dynamic Port Allocation**
  - Refactor ScrcpyServerManager registry to `Map<string, ScrcpyServerManager>`.
  - Add session/screen ID parameter to IPC channels (`mirror:start`, `mirror:stop`, `mirror:control`, `video:chunk:{id}`, etc.).
  - Enforce conflict-free dynamic port forwarding with ADB `tcp:0` and unique `scid`.
- [x] **Phase 2: Multi-Screen State Architecture & "Add Screen" HUD Option**
  - Add "Add Screen" action button in `FloatingHUD` (active when screens < 4).
  - Refactor frontend into multi-instance screen registry (`ScreenInstance[]`).
  - Stagger spawn positions and independent frame controls/custom names per screen.
- [x] **Phase 3: Spatial Overlap Collision Engine & Smooth Depth Dimming**
  - Implement 2D bounding-box collision detection between phone frames.
  - Dim underneath screens (opacity down to ~0.35) during overlap.
  - Restore full opacity smoothly when clear with spring transitions.
- [ ] **Phase 4: Setting Isolation Mode & Multi-Screen Polishing**
  - Center active screen when opening Inspector/Settings.
  - Dim all other screens while inspector is active; restore on "Done".
  - Multi-stream testing, independent D-Pad and audio management.

