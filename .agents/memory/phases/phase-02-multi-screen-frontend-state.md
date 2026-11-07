# Phase 2: Multi-Screen Frontend State Architecture & "Add Screen" HUD Control
**Master Plan:** .agents/memory/plans/main-plan.md
**Status:** FINISHED

## Selected Skills for This Phase
- `frontend/frontend-master`: Apex orchestrator enforcing UI baseline, responsiveness, and component integration.
- `frontend/design-engineering`: Crafts the 9-state interactive "Add Screen" button in FloatingHUD with tactile feedback.
- `frontend/svg-icon-craftsman`: Snaps a clean 24×24 dual-display/plus icon to a 1.5px vector grid.

## Input Dependencies
- Phase 1 completed (`src/main/index.ts`, `src/preload/index.ts` supporting `screenId`).
- `src/renderer/components/HUD/FloatingHUD.tsx`: Floating drawer controls.
- `src/renderer/App.tsx`: Main canvas and frame orchestrator.
- `src/renderer/components/PhoneFrame/PhoneFrame.tsx`: Procedural frame chassis.

## Step-by-Step Execution
1. **Craft Multi-Screen Icon in `src/renderer/components/icons/index.tsx`**:
   - Create `AddScreenIcon` (or `DualScreenIcon` with a `+` badge) adhering to 24×24 viewBox, 1.5px stroke, snapped geometry.
2. **Add "Add Screen" Action in `FloatingHUD.tsx`**:
   - Add button to HUD drawer: disabled when `totalScreens >= 4`, showing clear title tooltip `"Add phone screen (up to 4 screens)"`.
   - Passes `onAddScreen` callback up to `App.tsx`.
3. **Refactor Single-Screen State into Multi-Screen Array (`ScreenInstance[]`) in `App.tsx`**:
   - Define `ScreenInstance`:
     - `id: string` (e.g. `primary`, `screen-2`, `screen-3`, `screen-4`)
     - `name: string` (custom device nickname)
     - `options: PhoneFrameOptions`
     - `scale: number`
     - `offset: { x: number; y: number }`
     - `zIndex: number`
     - `opacity: number`
     - `isDragging: boolean`
     - `isHovered: boolean`
     - `dragMode: boolean`
     - `isScreenInteracting: boolean`
   - Initial state starts with 1 primary screen at `{ x: 0, y: 0 }`.
   - On clicking "Add Screen", spawns a new screen with a staggered offset (`+140px, +50px`), capped at 4 screens.
4. **Independent Screen Rendering & Lifecycle**:
   - Render each screen in the stage with its own independent wrapper, `DeviceNameHUD`, `SetupWizard`, and `VideoCanvas`.
   - Provide a close affordance (`onCloseScreen(id)`) for auxiliary screens ($2–4$), ensuring clean stop of mirror sessions.

## Success & Verification Criteria
- [x] User can click "Add Screen" in the HUD to spawn a new screen.
- [x] Maximum 4 screens can be added; button disables when 4 screens are present.
- [x] Each screen can be dragged independently across the stage.
- [x] Build passes with `npm run build`.

