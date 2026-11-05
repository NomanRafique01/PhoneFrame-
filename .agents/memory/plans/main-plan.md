# Master Plan: FloatingPhone Desktop UI & System Architecture

## Project Overview
FloatingPhone is a desktop application (Electron + React + TypeScript) that mirrors an Android phone over USB inside a floating, draggable, procedurally generated SVG phone frame.

## Design System Tokens
- Palette:
  - `--ink-950`: `#06141B` (Deep canvas ground, Midnight frame)
  - `--ink-900`: `#11212D` (Primary surface, Navy frame)
  - `--ink-800`: `#253745` (Borders, subtle cards, Slate frame)
  - `--ink-600`: `#4A5C6A` (Muted chrome, control toggles, Steel frame)
  - `--mist-400`: `#9BA8AB` (Secondary text, focus rings, Mist frame)
  - `--mist-200`: `#CCD0CF` (High-contrast typography, primary glyphs, Silver frame)
- Status:
  - `--success`: `#5FBF9A` (Device connected & authorized)
  - `--warning`: `#E0B04A` (Unauthorized / Waiting for user prompt on device)
  - `--danger`: `#E07A7A` (Disconnected / ADB error)

## Frontend Architectural Blueprint ($frontend-planner)
### 1. Subject-Matter Inventory
- Physical Android phone bezels, punch-hole cameras, speaker grills, dynamic aspect ratios (16:9, 19.5:9, 20:9).
- Hardware interaction boundaries: outer frame bezel is the dragging handle (`-webkit-app-region: drag`), inner display canvas handles touch/mouse inputs directly.
- Floating overlay ergonomics: always-on-top, transparent alpha background window, draggable anywhere across multi-monitor setups.
- Real-time diagnostic states: USB cable connected, USB debugging toggled, RSA authorization confirmed.

### 2. Dual-Viewport & Ergonomic Architecture
- **Floating Frame Viewport:** Procedural SVG phone casing calculated dynamically around the target phone resolution. Zero stretch distortion.
- **Desktop Workstation HUD (Companion & Bezel overlay):**
  - Minimal contextual tool belt docked to the phone edge.
  - Setup wizard drawer accessible during initial connection.
  - Bezel controls: Always-on-top toggle, orientation rotate (portrait/landscape), frame color selector, window scale slider.
- **Anti-Slop Compliance:** No generic pill badges, no synthetic purple blurs, no stock 3-column SaaS grids. Crisp hardware geometry and utilitarian developer tooling.

## Phased Implementation Sequence
- [ ] **Phase 1: Project Setup, Design Tokens & App Shell**
  - Initialize Electron + Vite + React + TypeScript workspace.
  - Wire `tokens.css`, normalize styles, and root application layout.
- [ ] **Phase 2: SVG Phone Frame Engine & Style Selector**
  - Procedural SVG generator for bezels, corner radii, punch holes, camera pills, and speaker slits.
  - 6 color presets (Midnight, Navy, Slate, Steel, Mist, Silver) and dynamic aspect ratio scaling.
- [ ] **Phase 3: Floating Transparent Draggable Window & HUD**
  - Frameless Electron transparent window configuration.
  - Bezel-drag region vs inner canvas interaction seam.
  - Hover HUD for scale, rotation, always-on-top, and frame settings.
- [ ] **Phase 4: Setup Wizard & Device Detection UI**
  - Step-by-step interactive onboarding: USB connection -> Developer Options -> USB Debugging -> RSA prompt.
  - Live status pills and device readiness states.
- [ ] **Phase 5: Real ADB Device Engine & Stream Decoder Integration**
  - ADB device tracking backend integration.
  - Scrcpy-server payload push and WebCodecs H.264 canvas renderer.

