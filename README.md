# Pokit Pro Web GUI

[![Version](https://img.shields.io/badge/version-v0.2.0-blue)](https://github.com/vailuc/pokit-pro-web-gui)
[![License](https://img.shields.io/badge/license-GPL--3.0%20%2F%20Commercial-blue)]()

A browser-based multimeter, oscilloscope and data logger for the [**Pokit Pro**](https://www.pokitmeter.com/), talking directly to the device over **Web Bluetooth**.

**No cloud services. No account required.** All communication stays local to your machine.

Supports direct **Web Bluetooth** and an optional **Python BLE bridge** for improved performance. No data leaves your device in either mode.

The BLE protocol is an independent TypeScript implementation based on interoperability observations. The [**pcolby/dokit**](https://github.com/pcolby/dokit) Qt/C++ library served as an architectural reference for protocol understanding, but is **not bundled, translated, or distributed** with this project.

## Privacy & Data

- **No cloud services.** No accounts. No telemetry.
- **Web Bluetooth mode** communicates directly between your browser and the device.
- **Bridge mode** uses a local Python process on `localhost`. No data leaves your machine.

## Project Status

Early alpha (v0.2.0) — Settings persistence & theme system added.

Core functionality implemented and verified:
- BLE connection, pairing, and auto-reconnect
- Multimeter live readings with HOLD/REL/MinMaxAvg
- Oscilloscope capture with waveform metrics
- Data logger with CSV export
- IndexedDB measurement history

Still under active development and protocol validation.

## Features

- **Multimeter** — live DC/AC voltage, current, resistance, continuity, diode, temperature and capacitance with mode/range/interval controls, HOLD/REL/MinMaxAvg, and continuity beep.
- **Oscilloscope (DSO)** — triggered or free-running capture with a uPlot waveform, one-shot/continuous modes with adjustable window times, rolling buffer display, and computed metrics (Vpp, RMS, mean, frequency, period, duty cycle).
- **Data Logger** — interval logging over time with CSV export and auto-save.
- **Device** — firmware info, limits, live status & battery, flash LED, torch, rename.
- **Settings & Themes** — persistent settings with dark/light/auto theme support, accent colors, and DSO defaults.
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

### Settings

![Settings view](docs/screenshots/settings.png)

*(Device Information screenshot coming soon.)*

## Requirements

> ⚠️ **Web Bluetooth is Chromium-only.** Use Chrome, Edge, Brave, or Chromium. Firefox and Safari are **not** supported.

| Requirement | Version / Notes |
|-------------|-----------------|
| Browser | Chrome ≥ 89, Edge ≥ 89, Brave, Chromium |
| Context | Secure (`http://localhost` or HTTPS) |
| Host OS | Linux, macOS, Windows, Raspberry Pi OS |
| Hardware | Pokit Pro multimeter (BLE 5.0) |
| Node.js | ≥ 18 (for build) |

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

### Quick Start (Web Bluetooth — default)

```bash
git clone https://github.com/vailuc/pokit-pro-web-gui.git
cd pokit-pro-web-gui
npm install
npm run dev
```

Open the printed `http://localhost:5173`, click **Connect**, and choose your Pokit device from the Chromium device chooser.

### Python Bridge Mode (better DSO performance)

For continuous oscilloscope monitoring without Web Bluetooth's ~150ms notification gaps, use the Python BLE bridge:

```bash
# One-command launcher (starts both bridge + frontend)
cd server
./launch-dev.sh
```

This starts:
- **BLE Bridge** on `ws://localhost:8765` (Python backend with native Bluetooth)
- **Vite Frontend** on `http://localhost:5173`

Then in the browser, click **Settings** → toggle **Use Python Bridge** before connecting.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm test` | Run unit tests (Vitest) |
| `server/launch-dev.sh` | Start Python bridge + Vite together (dev stack) |

## Architecture

```
src/
  pokit/        Framework-agnostic protocol layer
    uuids.ts          Service/characteristic UUIDs
    types.ts          Enums, structs, Pokit Pro range tables
    codec.ts          Little-endian ByteReader/ByteWriter
    connection.ts     PokitConnection: requestDevice + GATT
    websocketConnection.ts  WebSocket bridge client
    abstractService.ts  Base class (read/write/notify)
    statusService.ts / multimeterService.ts / dsoService.ts / loggerService.ts
    device.ts         PokitDevice facade
  store/          Zustand state
    deviceStore.ts    Connection, reconnect, status, LED/torch
    settingsStore.ts  Persistent settings, themes, bridge sync
    historyStore.ts   IndexedDB saved measurements
    toastStore.ts     Toast notifications
  components/     UI primitives, ConnectBar, Readout, Waveform (uPlot), Toast, HistoryDrawer
    ThemeProvider.tsx  CSS theme application
  views/          MultimeterView, OscilloscopeView, LoggerView, DeviceInfoView, SettingsView
  App.tsx         Tabbed shell

server/         Optional Python BLE bridge
  pokit_server.py   WebSocket bridge + bleak BLE backend
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

## Why Two Backends?

**Web Bluetooth** provides maximum portability — open the page in Chromium and connect directly. No installation required.

**The Python Bridge** provides native BLE performance. It bypasses browser notification batching, giving faster DSO updates and more reliable continuous mode. Ideal for lab bench setups where the extra setup is acceptable.

Both share the same protocol implementation and UI. You can switch between them without changing your workflow.

## Settings & Persistence

Settings are stored in three layers:

| Layer | Scope | Backend |
|-------|-------|---------|
| **localStorage** | Browser-only | Web Bluetooth mode |
| **settings.json** | `~/.config/pokit-pro/` | Python bridge mode |
| **Bridge sync** | Live bidirectional | Both (when bridge connected) |

In bridge mode, the frontend syncs with the Python server on connect. In Web Bluetooth mode, settings are preserved in `localStorage` and survive page reloads.

## Known Limitations

### Oscilloscope (DSO)

The Pokit Pro **does not support true continuous streaming** in any mode (this is a firmware limitation, not a Web Bluetooth issue). The official Pokit app achieves "continuous" by rapidly re-triggering single-shot captures with native Bluetooth APIs.

**Web Bluetooth adds additional constraints:**

- **Notification Gaps**: 135-150ms batching delays in Chromium's Web Bluetooth implementation
- **No Connection Control**: Cannot set MTU or connection intervals (native apps can)

The Pokit Pro firmware supports capture sizes up to 4096 samples, but testing has identified firmware behaviors under some conditions that can result in stale or repeated sample data during larger captures. Additional validation is ongoing. Requests above 3000 samples are currently reduced to 2800 as a conservative safeguard.

**Workarounds:**
- UI updates are throttled to `requestAnimationFrame` cadence
- Continuous mode re-triggers single-shot captures with adjustable window times (2/5/10/20ms)
- Use **Python Bridge mode** for improved DSO performance

### Browser Support

- **No iOS / iPadOS / Safari support** — Web Bluetooth is not available on Apple platforms.
- **Browser permission prompts required** — Chromium will ask for Bluetooth access on first connect.
- **Host OS Bluetooth stack** — Linux requires BlueZ; Windows and macOS generally work out of the box.

## Roadmap

- [ ] Improve DSO performance and reliability
- [ ] Additional instrument integrations
- [ ] Session recording and replay
- [ ] Multi-device support
- [ ] Mobile-friendly responsive layouts
- [ ] Offline PWA support

## Acknowledgements

- [**pcolby/dokit**](https://github.com/pcolby/dokit) — Qt/C++ Pokit library that served as an architectural reference for protocol understanding. This project does not contain Dokit source code; it is an independent TypeScript implementation.
- **Pokit Innovations** — For the Pokit Pro hardware.
- [**uPlot**](https://github.com/leeoniya/uPlot) — Lightweight plotting library used for the oscilloscope.

## Contributing

Contributions are welcome. By submitting a pull request, you agree to the terms in [`CLA.md`](CLA.md), which grants the project maintainer the right to use your contributions under both the open-source and commercial licenses.

## License

Dual-licensed under GPL-3.0 (open source) and a commercial license. See [`LICENSING.md`](LICENSING.md) for details. Full GPL-3.0 text is in [`LICENSE`](LICENSE).
