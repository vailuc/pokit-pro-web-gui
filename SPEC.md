# UX Alignment Spec — Pokit Pro Web GUI v0.004

## 1. IndexedDB History Store (`src/store/historyStore.ts`)
- **Schema**: `id` (auto), `type: "meter" | "scope" | "logger"`, `timestamp`, `name` (user label), `data` (JSON blob)
- **API**: `save(type, name, data)`, `list(type?)`, `get(id)`, `delete(id)`, `clear()`, `exportCsv(id)`
- Uses `idb-keyval` (lightweight wrapper) or raw IndexedDB.

## 2. Multimeter Polish
- **HOLD**: Lock current value display, freeze updates, show "HOLD" badge.
- **Min/Max/Avg**: Track running stats since mode change or last reset. Display as compact strip above readout.
- **REL**: Relative mode — subtract reference value, show delta. Toggle on/off.
- **Range badge**: Overlay current range (e.g., "10 V") on readout corner.
- **Continuity beep**: Web Audio API oscillator beep when reading goes LOW (short) in continuity mode.
- **Save button**: Push current reading to history store.

## 3. Oscilloscope Polish
- **One-shot vs continuous**: Toggle button. One-shot = send `FreeRunning`, capture once, stop. Continuous = auto-restart after each capture.
- **Run/Pause**: Clear state indicator (running = green dot, paused = gray).
- **Metrics overlay**: Move metrics from grid-below to floating strip inside/over the waveform card.
- **uPlot zoom/pan**: Enable `cursor.drag` and `cursor.lock` for basic zoom.

## 4. Logger Polish
- **Global REC indicator**: Red pulsing dot in `ConnectBar` when logger is actively sampling. Reads from `deviceStore` status or `loggerStore`.
- **Prominent start/stop**: Large primary button, color-accented when running.
- **Auto-save**: Option to auto-push completed logger session to history.

## 5. History UI
- **History drawer/page**: Accessible from all views (maybe a modal or dedicated tab section). List saved measurements with type, timestamp, name. Eye icon to replay, download CSV, delete.

## 6. Disconnected State
- All views show a consistent "Connect a device to begin" placeholder with the Pokit logo.

---
