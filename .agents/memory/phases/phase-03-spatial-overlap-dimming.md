# Phase 3: Spatial Overlap Collision Engine & Smooth Depth Dimming
**Master Plan:** .agents/memory/plans/main-plan.md
**Status:** PENDING

## Selected Skills for This Phase
- `frontend/dynamic-ui-engine`: Mathematical 2D bounding-box intersection calculations across scaled frames.
- `animation/animation-builder`: Physics-based opacity transition curves within a 16.6ms GPU frame budget.
- `animation/apple-feel`: Tactile spatial depth, spring dynamics, and smooth z-index elevation.

## Input Dependencies
- Phase 2 completed (`ScreenInstance[]` with independent positions and dimensions).
- `src/renderer/App.tsx`: Stage containing the rendered phone frames.

## Step-by-Step Execution
1. **Geometric Bounding-Box Calculation**:
   - For each screen $i$, compute its viewport rectangle:
     `{ left: x - frameWidth/2, right: x + frameWidth/2, top: y - frameHeight/2, bottom: y + frameHeight/2 }`.
2. **Real-Time Overlap Detection Loop**:
   - During pointer move / drag of Screen $A$:
     - Check intersection between Screen $A$'s bounding box and all other screens $B, C, D$.
     - Formula: `!(A.right < B.left || A.left > B.right || A.bottom < B.top || A.top > B.bottom)`.
3. **Smooth Depth Dimming Effect**:
   - The screen being actively dragged rises to the top (`zIndex: 100`).
   - If Screen $A$ overlaps Screen $B$ and Screen $A$ is on top (higher z-index):
     - Screen $B$'s opacity smoothly decreases to `0.40` with subtle blur:
       `filter: "brightness(0.92)"`, `opacity: 0.40`.
   - When Screen $A$ is dragged away and no longer overlaps Screen $B$:
     - Screen $B$'s opacity springs back to `1.0`.
4. **Transition Physics**:
   - Apply hardware-accelerated CSS transition:
     `transition: opacity 280ms cubic-bezier(0.22, 1, 0.36, 1), transform 320ms cubic-bezier(0.16, 1, 0.3, 1), filter 280ms ease`.
   - Respect `prefers-reduced-motion` settings.

## Success & Verification Criteria
- [ ] Dragging one phone over another reduces the underneath phone's opacity.
- [ ] Separating the phones immediately restores full opacity.
- [ ] Smooth 60 FPS transitions with zero layout thrashing or stutter.
- [ ] Build passes cleanly with `npm run build`.

