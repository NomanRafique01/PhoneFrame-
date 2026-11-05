# Phase 1: Project Setup, Design Tokens & App Shell

## Goal
Establish a clean Electron + Vite + React + TypeScript development and build setup inside the repository, configure standard paths, load `tokens.css`, and create the minimal root application shell.

## Skills Pre-selected
- `frontend-baseline`
- `dynamic-ui-engine`
- `desktop-ui-architect`
- `typography-master`
- `anti-slop-enforcer`

## Implementation Checklist
- [x] Configure `package.json`, TypeScript configs, Vite/Electron build configuration.
- [x] Ensure `tokens.css` is imported and root CSS variables are active.
- [x] Enhance type scales with `typography-master` (Swiss archetype, clamp scale, tabular numbers).
- [x] Apply anti-slop rules (no pill badges, no synthetic blobs, no generic 3-cards, crisp borders).
- [x] Create root layout container with dark mode canvas `#06141B`.
- [x] Verify clean Vite renderer build and Electron main compilation.

## Verification Evidence
- `npm run build:renderer` -> Built in 2.51s with 0 errors.
- `npm run build:main` -> Compiled TypeScript with 0 errors.
