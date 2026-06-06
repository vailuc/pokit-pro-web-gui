# RIPER Phase 3: PLAN — Post-Review Hardening

## Context

This codebase is the Pokit Pro Web GUI (v0.004). It will later be ported to run on Raspberry Pi 4/5/6 and expanded into a multi-instrument dashboard (Hantek scope, webcams, etc.) with an LCARS-style theme. Every fix must preserve modularity so new instrument pages slot in easily.

## Issues Found During Review

1. **Toast system is broken** — `ToastContainer` is never rendered in `App.tsx`. Toasts are pushed into Zustand but never reach the DOM.
2. **Missing `tailwindcss-animate`** — `Toast.tsx` uses `animate-in`, `slide-in-from-right-4`, `fade-in`; these classes silently fail because the plugin is not installed.
3. **Toast pointer-events bug** — The container div uses `pointer-events-none`, which in some browsers prevents clicks on child `pointer-events-auto` toasts.
4. **Status subscription leak** — `deviceStore.ts` calls `subscribeStatus()` on connect/reconnect but never stores or invokes the unsubscribe function. Multiple handlers accumulate.
5. **No README** — Step 6 of original PLAN.md requires a README with Chromium/Linux setup notes.
6. **Missing unit tests** — `waveformMetrics.ts` and `format.ts` have zero test coverage.
7. **Hardcoded theme** — Colors are scattered (Tailwind config, index.css). Future LCARS port needs a CSS-variable-driven theme system.

## Proposed Changes

### 1. Fix Toast System
- Render `<ToastContainer />` in `App.tsx`.
- Install `tailwindcss-animate` and add to `tailwind.config.js` plugins array.
- Fix `ToastContainer` pointer-events: remove `pointer-events-none` from container, keep it on individual toasts or use a wrapper approach.

### 2. Fix deviceStore Subscription Leak
- Store the status-unsubscribe function in a module-level or store-scoped variable.
- On `connect()` and `attemptReconnect()`, call previous unsubscribe before registering a new one.
- On `disconnect()`, call unsubscribe and clear reference.

### 3. Add Unit Tests
- `src/lib/waveformMetrics.test.ts`: empty array, flat line, sine wave, single-point edge cases.
- `src/lib/format.test.ts`: zero, negative, SI prefix boundaries, non-finite inputs.

### 4. Add README
- `README.md`: project description, stack, setup, Chromium flags for Linux/RPi, build commands, hardware verification notes.

### 5. Theme Foundation (RPi/LCARS future-proofing)
- Convert Tailwind `colors.pokit` to CSS custom properties (`--color-accent`, `--color-accent-dark`, `--color-bg`, `--color-surface`, `--color-border`).
- Update `index.css` to define the variables.
- Update `tailwind.config.js` to read from CSS variables.
- Update `Button.tsx` variant classes to reference CSS vars for accent colors.
- Keep the current visual look identical; only the mechanism changes.

### 6. Minor Polish
- Add `ToastContainer` import in `App.tsx`.
- Add `noUnusedLocals: true` already set — verify no new violations after changes.

## Acceptance Criteria
- [ ] `npm run test` passes all tests (8 existing + new ones).
- [ ] `npm run build` succeeds.
- [ ] Toast notifications render correctly and are dismissible by click.
- [ ] No TypeScript errors.
- [ ] README exists and is accurate.
- [ ] Visual appearance of the app is unchanged (theme vars map to same colors).
- [ ] `deviceStore` does not accumulate status listeners across reconnect cycles.

## Build Order
1. Theme foundation (CSS vars + Tailwind config + Button) — no visual change.
2. Fix Toast system (install dep, fix ToastContainer, add to App.tsx).
3. Fix deviceStore subscription leak.
4. Add unit tests (waveformMetrics, format).
5. Add README.
6. Verify build + tests.
