# Overlapping DSO Capture Loop — Technical Plan

## Goal
Transform "jerk between captures" into "smooth CRT-like scrolling trace".

## Strategy: Overlapped Async Captures

Instead of: `start → wait complete → restart`  
We do: `start N → at 80% progress → start N+1`  

This hides the 200ms hardware reset inside the previous capture's data stream.

## Implementation

### 1. Multi-Capture State Management

```typescript
// Track 2-3 concurrent captures
interface InFlightCapture {
  gen: number;
  buffer: DsoCaptureBuffer;
  meta: DsoMetadata;
  samplesReceived: number;
  expectedSamples: number;
  status: 'sampling' | 'complete' | 'failed';
}

const inFlightRef = useRef<InFlightCapture[]>([]);
const MAX_IN_FLIGHT = 3;
```

### 2. Overlap Trigger Logic

```typescript
// When samples hit 80% of expected, fire next capture
if (current.samplesReceived > current.expectedSamples * 0.8 && 
    inFlight.length < MAX_IN_FLIGHT) {
  void startOverlappingCapture();
}
```

### 3. Rolling Display Buffer

```typescript
// Concatenate last N captures for seamless display
const displayBuffer = useMemo(() => {
  const completed = inFlight
    .filter(c => c.status === 'complete')
    .slice(-3); // Last 3 captures
  
  return completed.flatMap(c => c.buffer.values());
}, [inFlight]);
```

### 4. Visual: CRT Sweep Effect

- Old data scrolls left continuously
- New data appends on right
- No "jump" between captures — overlap smooths it

## Key Constants

| Parameter | Value | Reason |
|-----------|-------|--------|
| `MAX_IN_FLIGHT` | 3 | 2 sampling + 1 draining |
| `OVERLAP_THRESHOLD` | 80% | Start next before current ends |
| `CIRCULAR_BUFFER_SIZE` | 768 samples | 3 × 256 samples |

## Files to Modify

1. `src/views/OscilloscopeView.tsx` — Overlap logic, multi-capture tracking
2. `src/pokit/DsoCaptureBuffer.ts` — Optional: circular buffer mode
3. `src/components/Waveform.tsx` — Handle larger display buffers

## Success Criteria

- [ ] No visible gap between captures
- [ ] ~8-10 fps effective rate
- [ ] Smooth left-scrolling trace
- [ ] No dropped samples in overlap region
