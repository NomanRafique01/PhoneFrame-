# Phase 1: Multi-Session Backend & Conflict-Free Dynamic Port Allocation
**Master Plan:** .agents/memory/plans/main-plan.md
**Status:** FINISHED

## Selected Skills for This Phase
- `backend/backend-master`: Category orchestrator for API contracts, lifecycle management, and isolated session architecture.
- `backend/responsive-contract-enforcer`: Ensures dynamic aspect ratio and screen dimension payload contracts without hardcoded pixel limits.
- `karpathy/karpathy-coder`: Surgical, minimal-diff implementation channeling simplicity with zero bloated external dependencies.

## Input Dependencies
- `src/main/mirror/ScrcpyServerManager.ts`: Underlying scrcpy engine with ADB socket binding.
- `src/main/index.ts`: Electron main process and IPC dispatchers.
- `src/preload/index.ts`: Context bridge defining `window.electronAPI`.
- `src/renderer/types/electron.d.ts`: Renderer TypeScript typings.

## Step-by-Step Execution
1. **Multi-Session Registry in Main Process**:
   - Convert singleton `mirrorManager: ScrcpyServerManager | null` into `mirrorSessions: Map<string, ScrcpyServerManager>`.
   - Maintain a helper `getOrCreateSession(screenId: string): ScrcpyServerManager`.
2. **Channel Protocol Expansion (with Backward Compatibility)**:
   - Update IPC handlers in `src/main/index.ts`:
     - `mirror:start(screenId, serial)`
     - `mirror:stop(screenId)`
     - `mirror:getState(screenId)`
     - `mirror:control(screenId, input)`
     - Stream dispatchers: `video:chunk:{screenId}`, `video:init:{screenId}`, `audio:chunk:{screenId}`, `mirror:state-changed:{screenId}`.
     - Fallback: If `screenId` is omitted, default to `"primary"` for seamless backward compatibility.
3. **Dynamic Port Conflict Immunity**:
   - Each `ScrcpyServerManager` instance generates its own unique 32-bit hex `scid` and requests `tcp:0` from ADB (`adb forward tcp:0 localabstract:scrcpy_{scid}`).
   - ADB automatically allocates distinct host loopback ports (e.g., 51234, 51235) with zero port clashes across up to 4 concurrent USB and Wi-Fi streaming sessions.
4. **ContextBridge & Preload Typing**:
   - Update `src/preload/index.ts` and `src/renderer/types/electron.d.ts` to support optional/explicit `screenId` parameters and screen-scoped event listeners.
5. **Session Teardown on Window Close**:
   - In `app.on("window-all-closed")`, iterate over all active sessions in `mirrorSessions` and stop them cleanly.

## Success & Verification Criteria
- [ ] TypeScript compilation `npm run build:main` completes with 0 errors.
- [ ] Renderer compilation `npm run build:renderer` completes with 0 errors.
- [ ] Full build `npm run build` exits with code 0.
