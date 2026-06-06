# Pokit Pro Web GUI

A browser-based multimeter, oscilloscope and data logger for the **Pokit Pro**,
talking directly to the device over **Web Bluetooth**. No backend, no app store —
just a static web app.

The BLE protocol is a clean-room reimplementation based on the excellent
[pcolby/dokit](https://github.com/pcolby/dokit) project.

## Features

- **Multimeter** — live DC/AC voltage, current, resistance, continuity, diode,
  temperature and capacitance with mode/range/interval controls.
- **Oscilloscope (DSO)** — triggered/free-running capture with a uPlot waveform
  and computed metrics (Vpp, RMS, mean, frequency, period, duty cycle).
- **Data Logger** — interval logging over time with CSV export.
- **Device** — firmware/limits/MAC, live status & battery, flash LED, torch, rename.

## Requirements

> ⚠️ **Web Bluetooth is Chromium-only.** Use Chrome, Edge, Brave, or Chromium.
> Firefox and Safari are **not** supported.

- A Chromium-based browser.
- A **secure context**: `http://localhost` (dev) or HTTPS (production).
- Bluetooth enabled on the host.

### Linux / Raspberry Pi notes
Web Bluetooth on Linux uses BlueZ and may require enabling:

```
chrome://flags/#enable-experimental-web-platform-features
```

Ensure the `bluetooth` service is running:

```bash
sudo systemctl enable --now bluetooth
```

On Raspberry Pi OS (Bookworm), use Chromium (not Firefox ESR). If the device chooser is empty, check that the Pokit is powered on and within range, then refresh the browser.

For kiosk or headless use on a Pi, launch Chromium with:

```bash
chromium-browser --enable-features=WebBluetoothNewPermissionsBackend
```

## Getting started

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173`, click **Connect**, and choose your
Pokit device (e.g. "Sparky").

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check and build for production.
- `npm run preview` — preview the production build.
- `npm test` — run codec unit tests (Vitest).

## Architecture

```
src/
  pokit/        Framework-agnostic Web Bluetooth protocol layer
    uuids.ts          Service/characteristic UUIDs
    types.ts          Enums, structs, Pokit Pro range tables
    codec.ts          Little-endian ByteReader/ByteWriter
    connection.ts     PokitConnection: requestDevice + GATT
    abstractService.ts  Base class (read/write/notify)
    statusService.ts / multimeterService.ts / dsoService.ts / loggerService.ts
    device.ts         PokitDevice facade
  store/          Zustand state
    deviceStore.ts    Connection, reconnect, status, LED/torch
    historyStore.ts   IndexedDB saved measurements
    toastStore.ts     Toast notifications
  components/     UI primitives, ConnectBar, Readout, Waveform (uPlot), Toast, HistoryDrawer
  views/          MultimeterView, OscilloscopeView, LoggerView, DeviceInfoView
  App.tsx         Tabbed shell
```

The `pokit/` layer has no React dependency and is covered by unit tests in
`src/pokit/codec.test.ts`, `src/lib/waveformMetrics.test.ts`, and `src/lib/format.test.ts`.

## Protocol summary

| Service | UUID | Purpose |
|---------|------|---------|
| Pokit Status (Pro) | `57d3a771-…aec5` | device info, status, name, LED, torch |
| Multimeter | `e7481d2f-…dadc` | settings (write) + reading (notify) |
| DSO | `1569801e-…9de6` | settings + metadata + sample stream |
| Data Logger | `a5ff3566-…4121` | settings + metadata + sample stream |

All multi-byte values are little-endian; floats are 32-bit. See `src/pokit/` and
`PLAN.md` for full byte layouts.

## Status

Core features implemented and verified against a Pokit Pro ("Sparky").

- Multimeter, DSO, and Logger views are functional with live BLE notifications.
- Auto-reconnect, IndexedDB history, CSV export, and toast feedback are active.
- CSS custom properties in `index.css` provide a theme foundation for future
  LCARS-style skins and multi-instrument dashboards (Hantek, webcams, etc.).

Known limitations:
- Web Bluetooth is Chromium-only; Firefox/Safari will never work.
- DSO sample reassembly relies on `numberOfSamples` from metadata; very large
  buffers may stream across multiple notifications — validate on your device.
