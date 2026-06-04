# UX Redesign Plan (branch: `ux-redesign`)

Scope agreed with Marcus. Priority order: **A → B → C → D**, then **E** last.

## A. Full-width fluid layout (foundational)
- Remove `max-w-*` centering constraints in all views (`MultimeterView`,
  `DeviceInfoView`, etc.). Use full-width responsive grids.
- App shell: full-bleed header/nav/main; responsive padding (`px-4 sm:px-6 lg:px-8`).
- Multimeter readout spans full width; controls reflow in a responsive grid.
- Scope/Logger: widen chart area to use available horizontal space.

## B. (#1) Connection & status feedback
- Add `"reconnecting"` connection state.
- **Auto-reconnect** on unexpected `gattserverdisconnected` (bounded retries w/
  backoff); surface attempts in the UI.
- **Status pill** in ConnectBar: disconnected / connecting / reconnecting /
  connected, each with color + icon.
- Battery: show voltage **and** %, with low-battery warning color/icon.
- **Toast notifications** replacing the inline red error bar (success/info/error).
- Remember last device name for display; attempt silent reconnect via
  `navigator.bluetooth.getDevices()` when available (best-effort, flagged).

## C. (#2) Multimeter polish
- Larger, touch-friendly readout with **unit + active-range badges**.
- **Auto-range** by default with manual override; clearly show the active range.
- **HOLD** button (freeze reading).
- **Min / Max / Avg** tracking with a reset.
- **REL (relative/zero)** mode — subtract a captured reference.
- Mode buttons grouped with icons; smoother value transitions.

## D. (#4) Logger active indicator
- Global **"REC" badge** in the top bar (pulsing dot) visible from *any* tab
  whenever the logger is running.
- Move logger session state into a **Zustand store** (`loggerStore`) so it
  survives tab switches and drives the global indicator.
- On connect, read logger metadata; if `status == Sampling`, reflect
  "already logging" and enable **Download** immediately.
- Logger tab shows an active badge + sample count / elapsed indicator.

## E. (#3) Oscilloscope polish — LAST
- Run/Pause, autoscale, draggable trigger level on the chart, cursor
  measurements, time/div + V/div controls. (Deferred until A–D land.)

## Tech notes
- New: lightweight `Toast` component + `toastStore` (Zustand).
- New: `loggerStore` (Zustand) holding logging/downloading/meta/samples.
- Light persistence via `localStorage` for UI prefs (active tab, MM settings).
- Keep the framework-agnostic `pokit/` layer unchanged where possible; UX lives
  in `components/`, `views/`, `store/`.
