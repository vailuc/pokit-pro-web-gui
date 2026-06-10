# PLAN: Web Bluetooth Aggressive Polling

## Goal
Implement event-driven DSO capture triggering for Web Bluetooth to minimize restart latency while respecting browser BLE limitations.

## Background

### Current Implementation
- Uses `setTimeout` with `MIN_RESTART_DELAY_MS = 200ms`
- Restart triggers on `onMetadata` (Done status)
- Same code path for Web Bluetooth and Python Bridge

### Physical Limits
| Backend | Bottleneck | Practical Max Rate |
|---------|-----------|------------------|
| Web Bluetooth | Chromium 135-150ms notification batching | ~6-7 fps |
| Python Bridge | Native BLE + hardware response | ~10+ fps |

## Implementation

### 1. Event-Driven Trigger (src/views/OscilloscopeView.tsx)

**Change:** Move restart trigger from `onMetadata` to `onSamples`

```typescript
// Current: Restart on Done status
const onMetadata = (m: DsoMetadata) => {
  if (m.status === DsoStatus.Done) {
    scheduleRestart(); // 200ms delay
  }
};

// New: Restart on first sample packet arrival
const onSamples = (samples: number[]) => {
  bufferRef.current?.push(samples);
  
  // Event-driven: Trigger next capture immediately on packet arrival
  if (continuousRef.current && !pendingRestartRef.current) {
    pendingRestartRef.current = true;
    void start(true); // autoRestart = true
  }
  
  setValues(bufferRef.current.values());
};
```

**Rationale:** Sample packet arrival indicates hardware is ready. Eliminates unnecessary 200ms wait.

### 2. Adaptive Window Options

**Backend-specific limits:**

```typescript
const getWindowOptions = (useBridge: boolean) => {
  if (useBridge) {
    // Python Bridge: Full hardware speed
    return [
      { value: 2, label: "2 ms" },
      { value: 5, label: "5 ms" },
      { value: 10, label: "10 ms" },
      { value: 20, label: "20 ms" },
      { value: 50, label: "50 ms" },
    ];
  } else {
    // Web Bluetooth: Chromium IPC limit
    return [
      { value: 10, label: "10 ms" },
      { value: 20, label: "20 ms" },
      { value: 50, label: "50 ms" },
      { value: 100, label: "100 ms" },
      { value: 200, label: "200 ms" },
    ];
  }
};
```

### 3. UI Warning System

**Warning badge when Web BT + window < 150ms:**

```tsx
{!useBridge && continuousWindowMs < 150 && (
  <Badge variant="warning" className="mt-1">
    ⚠️ Web Bluetooth: 150ms minimum for stable captures. 
    Use Python Bridge for faster rates.
  </Badge>
)}
```

### 4. Stall Guard

**Fallback timeout if packets stall:**

```typescript
// In continuous mode, if no packet arrives within 500ms, force restart
const STALL_TIMEOUT_MS = 500;

useEffect(() => {
  if (!continuous || !running) return;
  
  const stallCheck = setInterval(() => {
    const lastPacketAge = Date.now() - lastPacketTimeRef.current;
    if (lastPacketAge > STALL_TIMEOUT_MS && !pendingRestartRef.current) {
      console.warn('[DSO] Stall detected, forcing restart');
      void start(true);
    }
  }, 100);
  
  return () => clearInterval(stallCheck);
}, [continuous, running]);
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/views/OscilloscopeView.tsx` | Event-driven trigger, stall guard |
| `src/views/OscilloscopeView.tsx` | Adaptive window options |
| `src/views/OscilloscopeView.tsx` | Warning UI |

## Testing Checklist

- [ ] Web Bluetooth: ~6-7 fps capture rate
- [ ] Python Bridge: ~10+ fps capture rate
- [ ] Stop button remains responsive
- [ ] Warning shows for Web BT + 10ms window
- [ ] Stall recovery works (unplug device mid-capture)

## Future Enhancements

- Overlapping captures (requires packet generation tagging)
- Python server-side `START_CONTINUOUS` command
- UI throttling with `requestAnimationFrame` decoupling

---

**Status:** Ready for implementation  
**Priority:** Medium  
**Estimated effort:** 2-3 hours
