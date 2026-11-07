# Phase 4: Setting Isolation Mode & Multi-Screen Polishing
**Master Plan:** .agents/memory/plans/main-plan.md
**Status:** PENDING

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
     - Screen $X$ glides smoothly toward the center or left of the workspace to accommodate the right inspector drawer.
     - All other screens ($Y, Z$) reduce opacity down to `0.25` and set `pointerEvents: "none"`, entering an inert background state.
   - When the user clicks "Done" (or closes Settings):
     - The inspector closes.
     - Screen $X$ returns to its user-defined position.
     - All other screens smoothly restore full `1.0` opacity and `pointerEvents: "auto"`.
2. **Audio & D-Pad Independent Routing**:
   - Ensure D-Pad scroll commands and audio streams are routed strictly to the active screen instance without leaking into neighboring screens.
3. **Multi-Stream Hardware Conflict Audit**:
   - Verify that 2 to 4 screens can mirror concurrently:
     - Screen 1 over USB.
     - Screen 2 over Wi-Fi.
     - Screen 3 / 4 over independent ports.
   - Ensure zero ADB port collisions or state leaks.
4. **Final Packaging & Regression Checks**:
   - Full regression test across single-screen and multi-screen workflows.
   - Verify `npm run build` compiles with zero warnings or errors.

## Success & Verification Criteria
- [ ] Opening Settings on any screen dims all other screens and centers the focused screen.
- [ ] Closing Settings restores all screens to their original opacity and positions.
- [ ] Independent D-Pad and audio streams function without crosstalk.
- [ ] Production build passes with `npm run build`.

