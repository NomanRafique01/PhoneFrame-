# Phase 4: Setting Isolation Mode & Multi-Screen Polishing
**Master Plan:** .agents/memory/plans/main-plan.md
**Status:** FINISHED

## Selected Skills for This Phase
- `frontend/desktop-ui-architect`: Wide desktop workstation multi-pane density and modal focus management.
- `frontend/design-taste-frontend`: Anti-slop craft consistency across multiple concurrent frames and inspectors.
- `frontend/ui-stress-tester`: Stress testing concurrent streams, multi-device connect/disconnect, and edge-case collisions.

## Input Dependencies
- Phase 1, Phase 2, and Phase 3 completed.
- `src/renderer/App.tsx`: Inspector panel, HUD controls, and stage management.

## Step-by-Step Execution
1. **Settings / Inspector Focus Isolation**:
   - When the user opens "Settings" on Screen $X$:
     - Screen $X$ saves its current offset in `savedOffsetsRef.current[screenId]` and glides smoothly to the center (`{ x: 0, y: 0 }`) with elevated `zIndex: maxZ + 10`.
     - All other screens ($Y, Z$) enter backgrounded mode with reduced opacity (`0.25`), dimming filter (`brightness(0.92)`), and `pointerEvents: "none"` so they do not receive pointer input or steal focus.
   - When the user clicks "Done" (or closes Settings via outside click or toggle):
     - The inspector closes.
     - Screen $X$ smoothly glides back to its user-defined position (`savedOffsetsRef.current[screenId]`).
     - All other screens smoothly restore full `1.0` opacity (or `0.35` if overlapping) and re-enable `pointerEvents: "auto"`.
2. **Audio & D-Pad Independent Routing**:
   - D-Pad scroll commands and audio streams are scoped strictly per screen instance (`screenId`), preventing crosstalk.
3. **Multi-Stream Hardware Conflict Audit**:
   - Zero ADB port collisions guaranteed via dynamic OS assignment (`tcp:0`) and unique 32-bit `scid` per session.
4. **Final Packaging & Regression Checks**:
   - Full build passes cleanly with `npm run build` (0 TypeScript / Vite errors).

## Success & Verification Criteria
- [x] Opening Settings on any screen dims all other screens and centers the focused screen.
- [x] Closing Settings restores all screens to their original opacity and positions.
- [x] Independent D-Pad and audio streams function without crosstalk.
- [x] Production build passes with `npm run build`.
