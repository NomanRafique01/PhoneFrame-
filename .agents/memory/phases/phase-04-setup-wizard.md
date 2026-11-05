# Phase 4: Setup Wizard Screens

## Goal
Implement the interactive setup wizard screens inside the floating phone frame and companion drawer: guiding the user step-by-step through:
1. Connect phone via USB cable
2. Enable Developer options (Settings > About phone > tap Build number 7 times)
3. Enable USB debugging (Settings > Developer options > USB debugging)
4. Allow USB debugging prompt (RSA key fingerprint verification on phone)
5. Ready state & device detection feedback

## Skills Pre-selected
- `design-engineering`
- `frontend-baseline`
- `anti-slop-enforcer`
- `svg-icon-craftsman`

## Implementation Checklist
- [x] Create `SetupWizard` component viewable both on the phone screen and as an expandable guide drawer.
- [x] Implement interactive step progression with clear hardware iconography and instructions (USB, Developer Options, USB Debugging, RSA Auth, Ready).
- [x] Added interactive Build Number tap simulator (tap 7 times) and RSA fingerprint prompt card.
- [x] Comply with anti-slop rules (no generic SaaS pill badges, high-contrast typography, crisp status indicators).
- [x] Verified build (`npm run build`) passing with 0 TypeScript/React errors.

## Verification Evidence
- `npm run build` -> Compiled main process and Vite bundle cleanly in 3.01s with 0 errors.
