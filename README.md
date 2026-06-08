# Pokit Pro Web GUI

[![Version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/vailuc/pokit-pro-web-gui)
[![License](https://img.shields.io/badge/license-GPL--3.0%20%2F%20Commercial-blue)]()

A browser-based multimeter, oscilloscope and data logger for the [**Pokit Pro**](https://www.pokitmeter.com/), talking directly to the device over **Web Bluetooth**.

**No cloud services. No account required. No backend.** All communication occurs directly between your browser and the Pokit Pro over Bluetooth LE.

The BLE protocol is an independent TypeScript implementation based on interoperability observations. The [**pcolby/dokit**](https://github.com/pcolby/dokit) Qt/C++ library served as an architectural reference for protocol understanding, but is **not bundled, translated, or distributed** with this project.

## Project Status

Early alpha (v0.1.0).

Core functionality implemented and verified:
- BLE connection, pairing, and auto-reconnect
- Multimeter live readings with HOLD/REL/MinMaxAvg
- Oscilloscope capture with waveform metrics
- Data logger with CSV export
- IndexedDB measurement history

Still under active development and protocol validation.

## Features

- **Multimeter** — live DC/AC voltage, current, resistance, continuity, diode, temperature and capacitance with mode/range/interval controls, HOLD/REL/MinMaxAvg, and continuity beep.
- **Oscilloscope (DSO)** — triggered or free-running capture with a uPlot waveform, one-shot/continuous modes, and computed metrics (Vpp, RMS, mean, frequency, period, duty cycle).
- **Data Logger** — interval logging over time with CSV export and auto-save.
- **Device** — firmware info, limits, live status & battery, flash LED, torch, rename.
- **IndexedDB History** — saved measurements with searchable history drawer.
- **Toast Feedback** — non-blocking status notifications.
- **Auto-reconnect** — automatically restores connection on page reload or transient BLE drop.

## Screenshots

### Multimeter

![Multimeter view](docs/screenshots/multimeter.png)

### Oscilloscope

![Oscilloscope view](docs/screenshots/dso.png)

### Data Logger

![Data Logger view](docs/screenshots/datalogger.png)

### Device Information

![Device Information view](docs/screenshots/settings.png)

## Requirements

> ⚠️ **Web Bluetooth is Chromium-only.** Use Chrome, Edge, Brave, or Chromium. Firefox and Safari are **not** supported.

| Requirement | Version / Notes |
|-------------|-----------------|
| Browser | Chrome ≥ 89, Edge ≥ 89, Brave, Chromium |
| Context | Secure (`http://localhost` or HTTPS) |
| Host OS | Linux, macOS, Windows, Raspberry Pi OS |
| Hardware | Pokit Pro multimeter (BLE 5.0) |
| Node.js | ≥ 18 (for build) |

### Known limitations

- **No iOS / iPadOS / Safari support** — Web Bluetooth is not available on Apple platforms.
- **Browser permission prompts required** — Chromium will ask for Bluetooth access on first connect.
- **Host OS Bluetooth stack** — Linux requires BlueZ; Windows and macOS generally work out of the box.
- **DSO sample count capped at 4096** — the Pokit Pro firmware silently clamps `numberOfSamples` to 4096 regardless of what is requested. Values above this (8192, 16384) are accepted by the GATT write but the device returns 4096 samples, producing repeated identical waveforms. The sample-count selector is therefore limited to 256–4096.

### Linux / Raspberry Pi notes

Web Bluetooth on Linux uses BlueZ and may require enabling the experimental flag:

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
git clone https://github.com/vailuc/pokit-pro-web-gui.git
cd pokit-pro-web-gui
npm install
npm run dev
```

Open the printed `http://localhost:5173`, click **Connect**, and choose your Pokit device from the Chromium device chooser.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm test` | Run unit tests (Vitest) |

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

The `pokit/` layer has **no React dependency** and is covered by unit tests in:
- `src/pokit/codec.test.ts`
- `src/lib/waveformMetrics.test.ts`
- `src/lib/format.test.ts`

## Protocol summary

| Service | UUID | Purpose |
|---------|------|---------|
| Pokit Status (Pro) | `57d3a771-…aec5` | device info, status, name, LED, torch |
| Multimeter | `e7481d2f-…dadc` | settings (write) + reading (notify) |
| DSO | `1569801e-…9de6` | settings + metadata + sample stream |
| Data Logger | `a5ff3566-…4121` | settings + metadata + sample stream |

All multi-byte values are little-endian; floats are 32-bit. See `src/pokit/` for full byte layouts.

## Roadmap

- [ ] Multi-device support
- [ ] Session recording and replay
- [ ] Mobile-friendly responsive layouts
- [ ] Dark theme polish and custom color skins
- [ ] Offline PWA support

## Acknowledgements

- [**pcolby/dokit**](https://github.com/pcolby/dokit) — Qt/C++ Pokit library that served as an architectural reference for protocol understanding. This project does not contain Dokit source code; it is an independent TypeScript implementation.
- **Pokit Innovations** — For the Pokit Pro hardware.
- [**uPlot**](https://github.com/leeoniya/uPlot) — Lightweight plotting library used for the oscilloscope.

## Contributing

Contributions are welcome. By submitting a pull request, you agree to the terms in [`CLA.md`](CLA.md), which grants the project maintainer the right to use your contributions under both the open-source and commercial licenses.

## License

Dual-licensed under GPL-3.0 (open source) and a commercial license. See [`LICENSING.md`](LICENSING.md) for details. Full GPL-3.0 text is in [`LICENSE`](LICENSE).
