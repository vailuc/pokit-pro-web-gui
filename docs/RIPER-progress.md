# RIPER-5 Progress: DSO Running Window + FOSS Research

## Branch
`feat/python-ble-bridge` — keep as single PR, commits ordered: server fixes first, DSO features after.

## Phase 1: RESEARCH (Complete)
### Analyzed FOSS DSO Software
- **OpenHantek6022**: Qt desktop app with dockable panels, OpenGL scope, zoom view, measurements, cursors, math channels
- **PulseView (sigrok)**: Trace view with protocol decode, tabular output, zoom/pan, annotations

### Recommended Features (prioritized)
1. **Running window display** — 10ms rolling while running, full zoom on stop
2. **Measurements panel** — Vpp, Vrms, DC, freq
3. **Clipping indicator** — flash when ADC hits limit
4. **Trigger position slider** — pre-trigger percentage
5. **Cursors/markers** — draggable vertical lines with delta readout
6. **Zoom + pan** — mouse wheel zoom, drag pan
7. **Math channel** — abs, square, AC/DC split
8. **Spectrum/FFT view** — toggle to frequency domain
9. **Protocol decode** — Logger UART/I2C/SPI decode
10. **Export formats** — PNG screenshot, JSON

## Phase 2: INNOVATE (Complete)
- Running window concept: buffer accumulates all data, display clips to latest N samples while running, shows full on stop
- No bridge changes needed — pure frontend display logic

## Phase 3: PLAN (Complete)
See `docs/PLAN-running-window.md`:
1. Running window: fixed 10ms display while running, full zoom on stop
2. Measurements panel: Vpp, Vrms, DC, freq, clipping indicator
3. Waveform pan/zoom on stop (mouse wheel + drag)
4. Smooth transition animation on stop

## Phase 4: EXECUTE (Complete)
- `OscilloscopeView.tsx`: runningWindowSize computed from sampleRate*0.01, clipping badge
- `Waveform.tsx`: mouse wheel zoom + drag pan when stopped, disabled when running
- Committed and pushed to feat/python-ble-bridge

## Phase 5: REVIEW (Complete)
- Delayed display strip-chart: 1 capture behind real-time, 3 captures wide.
  Hardware restart gap is always in the 'future' — never visible on screen.
  X axis is contiguous time for smooth scrolling.
- **FPS findings:** 256 samples is optimal. Bottleneck is Pokit's ~200ms DSO reset
  delay, not sample count. More samples = longer BLE transfer = worse FPS.
  256-sample: ~10ms sampling + ~30ms BLE + ~200ms reset = ~240ms = **~4.2 fps**
  1024-sample: ~40ms sampling + ~100ms BLE + ~200ms reset = ~340ms = ~2.9 fps
- **REL button:** Subtracts baseline (mean of current trace) from samples.
  Makes small AC ripple visible on large DC offsets. Y label shows ΔV/ΔA.
- **Noise calibration:** `src/pokit/noiseBaseline.json` stores hardcoded baseline.
  Calibrate button captures current trace stats. Shows noise floor in panel.
- **Code review fixes (6 issues):**
  1. Captures-visible slider (1-10) instead of dead time-ms slider
  2. Static JSON import instead of fragile dynamic import
  3. Removed unused `xs` dependency (extra re-renders)
  4. Calibrate menu: Current view / Full buffer / Reset to repo + localStorage by MAC
  5. Kept `windowSize` prop for future use
  6. Fixed misleading strip-chart comment

## Switch Indicator & Auto-Follow (Additional Work)
- `getSwitchPosition()` maps `DeviceStatusCode` → physical switch position `V|A|Ω|idle|logger`
- `isDsoPosition()` guard for DSO/Logger tabs
- `SwitchIndicator` component: single-char `V/A/Ω/-` with teal/orange/yellow-blue colors
- Injected into `ConnectBar` between battery and torch
- Multimeter redesigned into 3 switch-position banks (V/A/Ω) with active bank highlighting
- Auto-follow triggers only on switch **position change**, restores last-used mode per bank
- Manual override badge (`Man`) shown when picking from inactive bank
- DSO/Logger guards block run with `Verify Switch` toast if switch not on V
- Multimeter: subscribe-first-then-settings pattern; `0x80` silently logged not toasted
- Status poll fallback: 2s interval, skipped when notifications active (<3s)

## Commit History (feat/python-ble-bridge)
1. `13ead85` fix: stop BLE flooding — coalesce status poll, simplify indicator, retry meter subscribe
2. `1f9c382` fix: add 500ms status polling fallback for switch detection
3. `49a5935` fix: always subscribe to multimeter readings; redesign multimeter into 3 banks
4. `ae11771` fix: guard multimeter settings against switch mismatch (0x80)
5. `f0a38b1` feat: switch indicator — physical 3-way switch position in UI
6. `2a94281` fix: stop() no longer reverts continuous mode to one-shot
7. `8137123` feat: noise gate — snap samples within ±2σ to zero/mean
8. `2039790` fix: layout overflow — split calibration to separate row
9. `7971bca` docs: update RIPER progress with review findings
10. `13bdfb0` fix: code review issues — captures slider, static import, calibrate menu
11. `072aa90` feat: noise calibration button + repo baseline JSON
12. `8b3b397` fix: stale closure in continuous mode — use ref directly for 256 sample lock
13. `fb9f28d` feat: REL (relative) button for DSO mode
14. `39dc6fb` feat: delayed display strip-chart — 1 capture behind, 3 captures wide
15. `cab6bac` feat: streamlined continuous mode — locked 256 samples, dynamic restart, 50k buffer
