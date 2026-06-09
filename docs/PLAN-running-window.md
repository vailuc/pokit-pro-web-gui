# PLAN: DSO Running Window + Measurements Panel

## Goal
Implement a "live DSO" feel: while running, show only the latest ~10ms of data as a rolling strip-chart. On stop, zoom out to show the full accumulated trace.

## Files to Modify
- `src/views/OscilloscopeView.tsx` — display logic, running state, measurements
- `src/components/Waveform.tsx` — windowSize handling, maybe pan/zoom props
- `src/components/MeasurementPanel.tsx` — new component for Vpp/Vrms/DC/freq readouts

## Step 1: Running Window in OscilloscopeView

### Current Behavior
- `windowSize` prop on Waveform: `continuous && running ? numSamples * 2 : undefined`
- This shows last N samples growing, not a fixed rolling window

### New Behavior
```
while running (continuous or one-shot):
  displayWindow = fixed 10ms worth of samples (or numSamples, whichever is smaller)
  plot shows only the LAST displayWindow samples
  trace appears to scroll left as new data arrives

on stop:
  displayWindow = undefined (show all accumulated data)
  auto-scale X axis to full capture duration
```

### Implementation
- Replace `windowSize` logic with `displayWindowSamples` ref
- While running: `displayWindowSamples = Math.min(numSamples, Math.round(sampleRate * 0.01))` // 10ms
- On stop: `displayWindowSamples = undefined`
- Pass to Waveform as new prop `windowSize={displayWindowSamples}`
- Waveform already supports slicing via `windowSize`

## Step 2: Measurements Panel

### Layout
Add a small panel below the waveform or in the sidebar:
```
┌─ Measurements ───────────┐
│ Vpp:    2.45 V           │
│ Vrms:   1.12 V           │
│ DC:     1.20 V           │
│ Freq:   1.02 kHz         │
│ Samples: 1024            │
│ Sample Rate: 102.4 kS/s  │
│ ⚠️ Clipping detected!    │
└──────────────────────────┘
```

### Computations
- **Vpp** = max(values) - min(values)
- **Vrms** = sqrt(sum(v^2) / n)
- **DC** = sum(values) / n
- **Freq** = zero-crossing count / (2 * duration) or FFT peak
- **Clipping** = any sample >= rangeLimit * 0.99

### Implementation
- `computeMetrics(values, sampleRate)` already exists — extend it
- New `MeasurementPanel` component, render in sidebar or below plot
- Update on every `setValues()` call (continuous mode already updates per packet)

## Step 3: Waveform Enhancements

### Pan/Zoom on Stop
When stopped (not running), allow:
- Mouse wheel to zoom X axis
- Drag to pan X axis
- Reset zoom button

### Implementation
- Add `zoom` and `pan` state to Waveform
- Track `scaleX` and `offsetX`
- On wheel: adjust `scaleX`
- On drag: adjust `offsetX`
- `windowSize` overrides zoom when running

## Step 4: UI Polish

### Running Indicator
- Keep the green pulsing dot, add "Rolling 10ms" label when in running window mode

### Stop → Full Zoom Transition
- Smooth transition: when stop is pressed, animate from 10ms window to full width over 300ms
- Use CSS transition on plot container or uPlot animation

## Acceptance Criteria
- [ ] Continuous mode shows rolling 10ms window, trace scrolls smoothly
- [ ] One-shot mode shows rolling window while sampling, full trace on completion
- [ ] Stop button zooms out to show all accumulated data
- [ ] Measurements panel shows Vpp, Vrms, DC, freq, clipping status
- [ ] No TypeScript errors
- [ ] No console errors during normal operation

## Git Best Practices
- Commit server changes first (if any)
- Then commit DSO running window
- Then commit measurements panel
- Squash fixups before final merge
