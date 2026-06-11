import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Waveform } from "@/components/Waveform";
import { useDeviceStore } from "@/store/deviceStore";
import { useSettingsStore } from "@/store/settingsStore";
import { saveHistory } from "@/store/historyStore";
import { toast } from "@/store/toastStore";
import {
  DsoCommand,
  DsoStatus,
  MeterMode,
  DsoRanges,
  formatSi,
  getSwitchPosition,
  unitForMode,
  type DsoMetadata,
} from "@/pokit";
import { DsoCaptureBuffer } from "@/pokit";
import { computeMetrics } from "@/lib/waveformMetrics";
import noiseBaseline from "../pokit/noiseBaseline.json";

const CHUNK_SIZE = 2000; // Below Pokit's ~2800 wrap limit
const MIN_RESTART_DELAY_MS = 200; // 256-sample captures may restart faster

const DSO_MODES = [
  { value: MeterMode.DcVoltage, label: "DC Voltage" },
  { value: MeterMode.AcVoltage, label: "AC Voltage" },
  { value: MeterMode.DcCurrent, label: "DC Current" },
  { value: MeterMode.AcCurrent, label: "AC Current" },
];

export function OscilloscopeView() {
  const { device, connectionState, characteristics, status, useBridge } = useDeviceStore();
  const { plugins } = useSettingsStore();
  const connected = connectionState === "connected";
  const deviceMac = characteristics?.macAddress || "default";

  // Read DSO defaults from settings
  const dsoDefaults = plugins.dso;
  const defaultContinuous = dsoDefaults.defaultMode === "continuous";
  const defaultWindowMs = dsoDefaults.defaultWindowMs;

  const [mode, setMode] = useState<MeterMode>(MeterMode.DcVoltage);
  const [range, setRange] = useState<number>(5); // 10V default in DsoRanges
  const [triggerLevel, setTriggerLevel] = useState<number>(0);
  const [command, setCommand] = useState<DsoCommand>(DsoCommand.FreeRunning);
  const [windowMs, setWindowMs] = useState<number>(10);
  const [numSamples, setNumSamples] = useState<number>(1024);
  const [continuousDelayMs, setContinuousDelayMs] = useState<number>(500); // Gap between captures in continuous mode
  const [continuousWindowMs, setContinuousWindowMs] = useState<number>(defaultWindowMs); // Window time from settings

  const [meta, setMeta] = useState<DsoMetadata | null>(null);
  const [values, setValues] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false); // Track running state for restart timer checks
  const [continuous, setContinuous] = useState(defaultContinuous); // Mode from settings
  const continuousRef = useRef(defaultContinuous);
  const bufferRef = useRef<DsoCaptureBuffer | null>(null);
  const pendingRestartRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preMetaQueueRef = useRef<{ gen: number; samples: number[] }[]>([]);
  const captureGenRef = useRef(0);
  const startGenRef = useRef(0); // Generation at which current capture started
  const captureStartTimeRef = useRef<number>(0); // Timestamp when current capture started
  const timeOffsetRef = useRef<number>(0); // Smooth scroll: viewport slides across buffer (ms)
  const lastPacketTimeRef = useRef<number>(Date.now()); // For stall detection - init to now to prevent immediate stall
  const samplesReceivedRef = useRef<number>(0); // Track samples for event-driven restart (decoupled from buffer)
  const effectiveNumSamplesRef = useRef<number>(numSamples); // Keep ref in sync for sample handler
  const continuousWindowMsRef = useRef<number>(defaultWindowMs); // Keep ref in sync for sample handler

  // Hidden continuous: internally chunk large single captures
  const hiddenContinuousRef = useRef(false);
  const targetSamplesRef = useRef(0);
  const chunkSizeRef = useRef(0);
  const isStartingRef = useRef(false); // Lockout to prevent overlapping startDso command writes

  // Overlapping capture: multiple in-flight captures for smooth scrolling
  interface InFlightCapture {
    gen: number;
    buffer: DsoCaptureBuffer;
    expected: number;
    status: 'sampling' | 'complete' | 'failed';
    meta: DsoMetadata | null;
  }
  const inFlightRef = useRef<InFlightCapture[]>([]);
  // Reserved for overlapping capture feature:
  // const MAX_IN_FLIGHT = 2; // 2 concurrent captures for overlap
  // const OVERLAP_THRESHOLD = 0.75; // Start next at 75% completion

  // Keep refs in sync with state so timeout callbacks see latest values
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);

  const isVoltage = mode === MeterMode.DcVoltage || mode === MeterMode.AcVoltage;
  const rangeTable = isVoltage ? DsoRanges.voltage : DsoRanges.current;
  const rangeOptions = rangeTable.map((r) => ({ value: r.value, label: r.label }));
  const unit = unitForMode(mode);

  // Strip-chart display: contiguous time axis, Y scrolls left as new samples arrive.
  // For continuous mode, calculate samples based on window time (maintaining ~25.6kS/s rate).
  // Samples = sampleRate * windowTime = 25600 * (windowMs / 1000) = windowMs * 25.6
  const CONTINUOUS_SAMPLE_RATE = 25600; // 25.6 kS/s typical for Pokit Pro
  const effectiveNumSamples = continuous
    ? Math.max(64, Math.round(continuousWindowMs * CONTINUOUS_SAMPLE_RATE / 1000)) // Min 64 samples
    : numSamples;
  // Keep refs in sync for sample handler (avoids stale closure in onSamples)
  useEffect(() => {
    effectiveNumSamplesRef.current = effectiveNumSamples;
    continuousWindowMsRef.current = continuousWindowMs;
  }, [effectiveNumSamples, continuousWindowMs]);
  const effectiveWindowMs = continuous ? continuousWindowMs : windowMs;

  const sampleRate = meta?.samplingRate ?? (effectiveNumSamples / (effectiveWindowMs / 1000));
  const xs = useMemo(() => values.map((_, i) => (i / (sampleRate || 1)) * 1000), [values, sampleRate]);
  const metrics = useMemo(() => computeMetrics(values, sampleRate || 1), [values, sampleRate]);

  const [capturesVisible, setCapturesVisible] = useState(10); // More captures = smoother scroll

  // Display delay: show data 1 capture behind real-time. The hardware restart
  // gap (between capture N and N+1) is always in the "future" — not displayed.
  const displayDelaySamples = useMemo(() => {
    if (!running) return 0;
    return effectiveNumSamples; // 1 capture behind
  }, [running, effectiveNumSamples]);

  const displaySize = useMemo(() => {
    if (!running) return 0;
    return effectiveNumSamples * capturesVisible; // N captures wide
  }, [running, effectiveNumSamples, capturesVisible]);

  // Smooth scrolling: update display at 30fps during continuous run
  // Advances timeOffsetRef to slide viewport across accumulated buffer
  const [, tickDisplay] = useState(0);
  useEffect(() => {
    if (!continuous || !running) return;
    const interval = setInterval(() => {
      // Advance viewport by 33ms each frame (30fps)
      // At 25.6kS/s, that's ~0.85 samples per frame - smooth sub-pixel scroll
      timeOffsetRef.current += 33;
      // Prevent timeOffset from growing beyond display window (causes empty viewport after trim)
      const dt = 1000 / (sampleRate || 25600);
      const maxOffsetMs = displaySize * dt; // Maximum offset for one display window
      if (timeOffsetRef.current > maxOffsetMs) {
        timeOffsetRef.current = timeOffsetRef.current % maxOffsetMs;
      }
      tickDisplay(v => v + 1);
    }, 33);
    return () => clearInterval(interval);
  }, [continuous, running, displaySize, sampleRate]);

  // Stall guard: DISABLED - See Todo #11
  // Was causing runaway restarts because lastPacketTimeRef initialized to 0
  // caused immediate "stall detected" on first check. Could revisit with:
  // - Proper initialization to Date.now()
  // - Longer timeout (1000ms+)  
  // - Only trigger after N consecutive stalled captures
  // For now, event-driven trigger + timer fallback are sufficient.

  const displayValues = useMemo(() => {
    if (!running) return values; // When stopped, show ALL accumulated data
    if (displaySize === 0) return values;
    // In continuous mode, show rolling trailing window
    if (continuous) {
      return values.slice(-displaySize);
    }
    // One-shot: strip-chart with delay to hide hardware restart gap
    const end = Math.max(0, values.length - displayDelaySamples);
    const start = Math.max(0, end - displaySize);
    return values.slice(start, end);
  }, [values, running, displaySize, displayDelaySamples, continuous]);

  const displayXs = useMemo(() => {
    if (displaySize === 0) return xs;
    const dt = 1000 / (sampleRate || 1);
    // CRT-style strip chart: accumulate 0-inf, then scroll when full
    // Phase 1: Building up (0 to current end time)
    // Phase 2: Rolling window (end - windowSize to end)
    const totalMs = values.length * dt;
    const windowMs = displaySize * dt;
    
    if (totalMs <= windowMs) {
      // Phase 1: Still filling the screen - show 0 to current end
      return Array.from({ length: displayValues.length }, (_, i) => i * dt);
    } else {
      // Phase 2: Rolling window - show (end - window) to end
      const endMs = totalMs;
      return Array.from({ length: displayValues.length }, (_, i) => 
        endMs - (displayValues.length - 1 - i) * dt
      );
    }
  }, [displaySize, displayValues.length, sampleRate, values.length]);

  // REL (relative) mode: subtract baseline from trace to see small deviations
  const [relActive, setRelActive] = useState(false);
  const relRef = useRef<number | null>(null);
  const relDisplayValues = useMemo(() => {
    if (!relActive || relRef.current === null) return displayValues;
    return displayValues.map((v) => v - relRef.current!);
  }, [displayValues, relActive]);

  const toggleRel = () => {
    if (relActive) {
      relRef.current = null;
      setRelActive(false);
    } else if (displayValues.length > 0) {
      // Use mean of current display as baseline
      const mean = displayValues.reduce((a, b) => a + b, 0) / displayValues.length;
      relRef.current = mean;
      setRelActive(true);
    }
  };

  // Noise calibration: load baseline (localStorage first, then repo JSON)
  const [calibratedNoise, setCalibratedNoise] = useState<{ mean: number; stdDev: number; peakToPeak: number } | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem(`noiseBaseline_${deviceMac}`);
    if (saved) {
      try { setCalibratedNoise(JSON.parse(saved)); } catch { /* ignore */ }
    } else {
      setCalibratedNoise({ mean: noiseBaseline.mean, stdDev: noiseBaseline.stdDev, peakToPeak: noiseBaseline.peakToPeak });
    }
  }, [deviceMac]);

  // Gate: snap samples within ±2σ of calibrated noise to zero (or mean)
  const [gateActive, setGateActive] = useState(false);
  const gatedDisplayValues = useMemo(() => {
    if (!gateActive || !calibratedNoise || relDisplayValues.length < 2) return relDisplayValues;
    const threshold = calibratedNoise.stdDev * 2;
    if (relActive) {
      // REL already centered to 0 — snap near-zero to zero
      return relDisplayValues.map((v) => (Math.abs(v) < threshold ? 0 : v));
    }
    const mean = relDisplayValues.reduce((a, b) => a + b, 0) / relDisplayValues.length;
    return relDisplayValues.map((v) => (Math.abs(v - mean) < threshold ? mean : v));
  }, [relDisplayValues, gateActive, calibratedNoise, relActive]);

  const toggleGate = () => {
    setGateActive((g) => !g);
  };

  // SNR cleanup: clamp values within ±Nσ of noise floor to absolute zero
  const [snrActive, setSnrActive] = useState(false);
  const [snrSigma, setSnrSigma] = useState(2);
  const snrDisplayValues = useMemo(() => {
    if (!snrActive || !calibratedNoise || gatedDisplayValues.length < 2) return gatedDisplayValues;
    const threshold = calibratedNoise.stdDev * snrSigma;
    return gatedDisplayValues.map((v) => (Math.abs(v) < threshold ? 0 : v));
  }, [gatedDisplayValues, snrActive, calibratedNoise, snrSigma]);

  const toggleSnr = () => {
    setSnrActive((s) => !s);
  };

  type CalSource = "display" | "buffer" | "reset";
  const [calSource, setCalSource] = useState<CalSource>("display");

  const handleCalibrate = () => {
    if (calSource === "reset") {
      setCalibratedNoise({ mean: noiseBaseline.mean, stdDev: noiseBaseline.stdDev, peakToPeak: noiseBaseline.peakToPeak });
      localStorage.removeItem(`noiseBaseline_${deviceMac}`);
      toast.info("Noise baseline reset to repo default");
      return;
    }
    const source = calSource === "display" ? displayValues : values;
    if (source.length < 2) return;
    const mean = source.reduce((a, b) => a + b, 0) / source.length;
    const min = Math.min(...source);
    const max = Math.max(...source);
    const variance = source.reduce((sum, v) => sum + (v - mean) ** 2, 0) / source.length;
    const result = { mean, stdDev: Math.sqrt(variance), peakToPeak: max - min };
    setCalibratedNoise(result);
    localStorage.setItem(`noiseBaseline_${deviceMac}`, JSON.stringify(result));
    toast.success(`Calibrated from ${calSource === "display" ? "current view" : "full buffer"}`);
  };

  // Clipping detection: any sample near the range limit
  const rangeLimit = rangeTable[range]?.max ?? Infinity;
  const isClipping = useMemo(() => {
    if (!values.length || !rangeLimit || rangeLimit === Infinity) return false;
    const threshold = rangeLimit * 0.98;
    return values.some((v) => Math.abs(v) >= threshold);
  }, [values, rangeLimit]);

  useEffect(() => {
    if (!connected) return;
    let unsubMeta: (() => Promise<void>) | null = null;
    let unsubSamples: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      // Queue samples that arrive before the first metadata packet.
      // Cleared on each new capture start via preMetaQueueRef.
      const preMetaQueue: { gen: number; samples: number[] }[] = [];
      preMetaQueueRef.current = preMetaQueue;

      unsubMeta = await device.dso.onMetadata((m) => {
        if (cancelled) return;
        // console.log(`[DSO] Metadata: status=${m.status}, samples=${m.numberOfSamples}`);
        setMeta(m);

        // In continuous mode, accumulate into large rolling buffer
        if (continuousRef.current) {
          if (!bufferRef.current) {
            // First capture - create buffer with room for multiple captures
            bufferRef.current = new DsoCaptureBuffer(10000, m.scale); // ~40 captures worth
          }
          // Update scale but DON'T reset - we want to accumulate
          bufferRef.current.updateScale(10000, m.scale);
        } else {
          // Legacy single-buffer mode for one-shot
          if (!bufferRef.current) bufferRef.current = new DsoCaptureBuffer(m.numberOfSamples, m.scale);
          else bufferRef.current.reset(m.numberOfSamples, m.scale);
        }

        // Flush any samples that beat the metadata notification.
        if (preMetaQueue.length > 0) {
          for (const entry of preMetaQueue) {
            if (entry.gen === startGenRef.current && bufferRef.current) {
              bufferRef.current.push(entry.samples);
            }
          }
          preMetaQueue.length = 0;
          setValues(bufferRef.current.values());
        }

        if (m.status === DsoStatus.Done) {
          if (continuousRef.current) {
            // Timer fallback only if event-driven didn't fire (rare)
            if (!pendingRestartRef.current) {
              pendingRestartRef.current = true; // Mark as pending restart
              console.log('[DSO] Fallback restart in 200ms');
              const delay = Math.max(continuousDelayMs, MIN_RESTART_DELAY_MS);
              if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
              restartTimeoutRef.current = setTimeout(() => {
                restartTimeoutRef.current = null;
                if (!cancelled && runningRef.current && continuousRef.current) {
                  void start(true);
                }
              }, delay);
            }
          } else if (hiddenContinuousRef.current && bufferRef.current && bufferRef.current.count < targetSamplesRef.current) {
            // Hidden continuous chunking - unchanged
            pendingRestartRef.current = false;
            const delay = Math.max(continuousDelayMs, MIN_RESTART_DELAY_MS);
            restartTimeoutRef.current = setTimeout(() => {
              restartTimeoutRef.current = null;
              if (!cancelled && hiddenContinuousRef.current) void start(true);
            }, delay);
          } else {
            hiddenContinuousRef.current = false;
            setRunning(false);
          }
        }
      });
      // In continuous mode, update immediately for live sweep feel.
      // In one-shot, throttle to rAF to prevent BLE starvation.
      let rafPending = false;
      unsubSamples = await device.dso.onSamples((samples) => {
        if (cancelled) return;
        const receiveGen = startGenRef.current;
        
        // Drop stale packets from previous capture session
        if (receiveGen !== captureGenRef.current) {
          console.log(`[DSO] Stale packet dropped: gen=${receiveGen}, current=${captureGenRef.current}`);
          return;
        }
        
        lastPacketTimeRef.current = Date.now();
        console.log(`[DSO] Samples: received=${samples.length}, gen=${receiveGen}`);

        // Event-driven: Trigger next capture immediately on first packet arrival
        samplesReceivedRef.current += samples.length;
        const expected = effectiveNumSamplesRef.current;
        
        // Event-driven trigger: restart at 90% completion (let capture nearly finish)
        if (continuousRef.current && !pendingRestartRef.current) {
          const threshold = expected * 0.9;  // 90% - wait for capture to complete
          if (samplesReceivedRef.current >= threshold) {
            pendingRestartRef.current = true;
            console.log(`[DSO] Trigger @ ${samplesReceivedRef.current}/${expected}, restart in 200ms`);
            if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
            restartTimeoutRef.current = setTimeout(() => {
              restartTimeoutRef.current = null;
              if (!cancelled && runningRef.current && continuousRef.current) {
                void start(true);
              }
            }, 200);
          }
        }

        // Route samples to display buffer
        if (continuousRef.current && bufferRef.current) {
          bufferRef.current.push(samples);
          const windowMs = continuousWindowMsRef.current;
          const windowSamples = windowMs * 25;
          const maxDisplaySamples = Math.max(256, windowSamples * capturesVisible * 3);
          if (bufferRef.current.count > maxDisplaySamples) {
            bufferRef.current.trim(maxDisplaySamples);
          }
          setValues(bufferRef.current.values());
          return;
        }

        // Legacy single-buffer mode
        if (!bufferRef.current) {
          preMetaQueue.push({ gen: receiveGen, samples });
          return;
        }

        // Stale boundary only applies to non-chunked large captures
        if (!hiddenContinuousRef.current) {
          const currentCount = bufferRef.current.count;
          if (currentCount > 2600 && currentCount < 2900 && numSamples > 3000) {
            console.warn(`[DSO] Detected stale data boundary at sample ${currentCount}, reducing capture to 2800 samples`);
            toast.info("Device limit detected: Reduced to 2800 samples for best quality");
            setNumSamples(2800);
          }
        }

        bufferRef.current.push(samples);

        // Live update: one-shot = rAF throttled
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            if (bufferRef.current && !cancelled && receiveGen === startGenRef.current) {
              if (bufferRef.current.isStale) {
                console.warn(`[DSO] Buffer stalled at ${bufferRef.current.count}/${bufferRef.current["expected"]} samples — packet likely dropped`);
                toast.warning("Capture stalled — packet dropped. Try continuous mode or fewer samples.");
                setRunning(false);
                bufferRef.current = null;
              } else {
                const snap = bufferRef.current.values();
                setValues(snap);
                if (bufferRef.current.isComplete) {
                  setRunning(false);
                }
              }
            }
            rafPending = false;
          });
        }
      });
    })().catch((err) => {
      if (!cancelled) {
        console.error("DSO subscription failed:", err);
        toast.error(err instanceof Error ? err.message : "DSO setup failed");
        setRunning(false);
      }
    });

    return () => {
      cancelled = true;
      void unsubMeta?.();
      void unsubSamples?.();
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
    };
  }, [connected, device]);

  /** Start or auto-restart a DSO capture.
   *  @param autoRestart true when called from the Done handler — preserves accumulated data */
  const start = async (autoRestart = false) => {
    // Guard: only block when the switch is definitively on A or Ω.
    // Idle=0 is allowed (device may be transitional after a prior DSO run).
    if (!autoRestart && device) {
      let currentStatus = status;
      console.log(`[DSO] Guard check: cached status=${currentStatus?.status ?? "null"}`);
      // Cached status may be stale after a prior run; read fresh if it looks wrong.
      const pos = currentStatus ? getSwitchPosition(currentStatus.status) : null;
      if (!currentStatus || pos === "A" || pos === "Ω") {
        try {
          currentStatus = await device.status.readStatus();
          console.log(`[DSO] Guard fresh read: status=${currentStatus.status}`);
        } catch (e) {
          console.warn(`[DSO] Guard fresh read failed:`, e);
          currentStatus = null;
        }
      }
      const freshPos = currentStatus ? getSwitchPosition(currentStatus.status) : null;
      if (freshPos === "A" || freshPos === "Ω") {
        toast.warning("Verify Switch — move to V position");
        return;
      }
      console.log(`[DSO] Guard passed (pos=${freshPos ?? "null"})`);
    }

    // Prevent overlapping startDso commands from racing (caveat #1)
    if (isStartingRef.current) {
      console.log('[DSO] Skip: startDso already in flight');
      return;
    }

    // Clear any pending scheduled restarts immediately
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    console.log(`[DSO] start() called, autoRestart=${autoRestart}, continuous=${continuousRef.current}`);
    captureGenRef.current += 1;
    startGenRef.current = captureGenRef.current;
    captureStartTimeRef.current = Date.now();
    lastPacketTimeRef.current = Date.now();
    samplesReceivedRef.current = 0;
    timeOffsetRef.current = 0;
    preMetaQueueRef.current.length = 0;

    // Clear buffer on fresh start only
    if (!autoRestart) {
      bufferRef.current = null;
      inFlightRef.current = [];
      setValues([]);
      console.log('[DSO] === START ===');
    }
    setRunning(true);

    // Use effective settings (calculated from window time in continuous mode).
    // Compute directly from ref to avoid stale closure with state-derived constants.
    const CONTINUOUS_RATE = 25600; // 25.6 kS/s
    const calculatedSamples = continuousRef.current
      ? Math.max(64, Math.round(continuousWindowMs * CONTINUOUS_RATE / 1000))
      : numSamples;
    const reqSamples = calculatedSamples;
    const reqWindow = continuousRef.current ? continuousWindowMs : windowMs;

    // Hidden continuous: chunk large single captures
    if (!continuousRef.current && reqSamples > 2800) {
      hiddenContinuousRef.current = true;
      targetSamplesRef.current = reqSamples;
      chunkSizeRef.current = CHUNK_SIZE;
      pendingRestartRef.current = true; // auto-restart chunks
    } else {
      hiddenContinuousRef.current = false;
      targetSamplesRef.current = 0;
      // For normal continuous mode, let event-driven trigger handle restarts
      // Only set pendingRestart if we want immediate timer-based restart
      pendingRestartRef.current = false;  // Let event-driven trigger fire!
    }

    // Calculate exact remaining samples for the last hidden-continuous chunk
    let samplesToRequest = reqSamples;
    if (hiddenContinuousRef.current && bufferRef.current) {
      const remaining = targetSamplesRef.current - bufferRef.current.count;
      samplesToRequest = Math.min(CHUNK_SIZE, Math.max(remaining, 1));
    } else if (hiddenContinuousRef.current) {
      samplesToRequest = CHUNK_SIZE;
    }

    const safeWindowMs = Math.max(reqWindow, Math.round(reqSamples / 200));
    console.log(`[DSO] startDso: ${samplesToRequest} samples`);
    isStartingRef.current = true;
    try {
      await device.dso.startDso({
        command,
        triggerLevel,
        mode,
        range,
        samplingWindowUs: Math.round(safeWindowMs * 1000),
        numberOfSamples: samplesToRequest,
      });
      console.log(`[DSO] startDso OK (gen=${startGenRef.current})`);
    } catch (err) {
      console.error(`[DSO] startDso failed (gen=${startGenRef.current}):`, err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("0x80")) {
        toast.error(`Sampling window too short for ${reqSamples} samples. Increase window or reduce samples.`);
      }
      setRunning(false);
      hiddenContinuousRef.current = false;
    } finally {
      isStartingRef.current = false;
      if (!hiddenContinuousRef.current) {
        pendingRestartRef.current = false;
      }
    }
  };

  const stop = () => {
    pendingRestartRef.current = false;
    hiddenContinuousRef.current = false;
    // Note: Don't clear continuousRef.current here - it must match the UI toggle state
    // Restart timers check continuousRef, so new restarts won't be scheduled
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    setRunning(false);
  };

  const handleSave = async () => {
    if (!values.length) return;
    const name = `Scope ${mode === MeterMode.DcVoltage || mode === MeterMode.AcVoltage ? "Voltage" : "Current"} ${new Date().toLocaleTimeString()}`;
    await saveHistory("scope", name, {
      xs,
      ys: values,
      unit,
      mode,
      range,
      sampleRate,
      numSamples,
    });
    toast.success("Saved capture to history");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,35%)]">
      <Card className="relative">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Waveform</CardTitle>
          {running && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              {continuous ? "Continuous" : "Sampling"}
            </span>
          )}
        </CardHeader>
        <CardContent>
          {values.length ? (
            <Waveform
              xs={running ? displayXs : xs}
              ys={running ? snrDisplayValues : relActive || gateActive || snrActive ? snrDisplayValues : values}
              xLabel="Time (ms)"
              yLabel={relActive ? `Δ${unit}` : unit}
            />
          ) : (
            <div className="grid h-80 place-items-center text-sm text-neutral-500">
              {connected ? "Run a capture to see a waveform" : "Connect a device to begin"}
            </div>
          )}
          {/* Measurements panel */}
          {values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-neutral-800/60 p-2">
              <MetricPill label="Vpp" value={formatSi(metrics.peakToPeak, unit)} />
              <MetricPill label="RMS" value={formatSi(metrics.rms, unit)} />
              <MetricPill label="Mean" value={formatSi(metrics.mean, unit)} />
              <MetricPill label="Freq" value={formatSi(metrics.frequency, "Hz")} />
              <MetricPill label="Period" value={formatSi(metrics.period, "s")} />
              <MetricPill label="Duty" value={`${(metrics.dutyCycle * 100).toFixed(1)} %`} />
              {isClipping && (
                <span className="inline-flex items-center rounded-md bg-red-900/60 px-2 py-1 text-xs font-medium text-red-300">
                  ⚠️ Clipping
                </span>
              )}
              {calibratedNoise && (
                <span className="inline-flex items-center rounded-md bg-blue-900/40 px-2 py-1 text-xs font-medium text-blue-300" title="Noise floor (shorted probes)">
                  Noise: {formatSi(calibratedNoise.peakToPeak, unit)} pp
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Mode">
            <Select
              value={mode}
              options={DSO_MODES}
              onValueChange={(v) => setMode(Number(v) as MeterMode)}
              className="w-full"
            />
          </Field>
          <Field label="Range">
            <Select value={range} options={rangeOptions} onValueChange={(v) => setRange(Number(v))} className="w-full" />
          </Field>
          <Field label="Trigger">
            <Select
              value={command}
              options={[
                { value: DsoCommand.FreeRunning, label: "Free running" },
                { value: DsoCommand.RisingEdgeTrigger, label: "Rising edge" },
                { value: DsoCommand.FallingEdgeTrigger, label: "Falling edge" },
              ]}
              onValueChange={(v) => setCommand(Number(v) as DsoCommand)}
              className="w-full"
            />
          </Field>
          <Field label={`Trigger level (${unit}): ${triggerLevel}`}>
            <input
              type="number"
              step="0.1"
              value={triggerLevel}
              onChange={(e) => setTriggerLevel(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
            />
          </Field>
          {!continuous && (() => {
            const effSamples = numSamples;
            const effWin = windowMs;
            const minWindow = Math.max(2, Math.round(effSamples / 200));
            return (
              <Field label={`Window: ${effWin} ms (min ${minWindow} ms for ${effSamples} samples)`}>
                <input
                  type="range"
                  min={minWindow}
                  max={100}
                  value={Math.max(effWin, minWindow)}
                  onChange={(e) => setWindowMs(Number(e.target.value))}
                  className="w-full accent-pokit"
                />
              </Field>
            );
          })()}
          <Field label={`Samples${continuous ? " (auto from window)" : ""}`}>
            <Select
              value={numSamples}
              options={(useBridge ? [256, 512, 1024, 2048, 4096] : [256, 512, 1024, 2048]).map((n) => ({ value: n, label: String(n) }))}
              onValueChange={(v) => setNumSamples(Number(v))}
              disabled={continuous}
              className="w-full"
            />
          </Field>
          {continuous && (
            <>
              <Field label={`Window: ${continuousWindowMs} ms (${effectiveNumSamples} samples)`}>
                <Select
                  value={continuousWindowMs}
                  options={
                    useBridge
                      ? // Python Bridge: Full hardware speed
                        [
                          { value: 2, label: "2 ms (52 samples)" },
                          { value: 5, label: "5 ms (128 samples)" },
                          { value: 10, label: "10 ms (256 samples)" },
                          { value: 20, label: "20 ms (512 samples)" },
                          { value: 50, label: "50 ms 🌐 (1,280 samples)" },
                        ]
                      : // Web Bluetooth: Color-coded performance indicators
                        [
                          { value: 10, label: "10 ms 🔴 (256 samples)" },
                          { value: 20, label: "20 ms 🔴 (512 samples)" },
                          { value: 35, label: "35 ms 🟡 (896 samples)" },
                          { value: 50, label: "50 ms 🌐 (1,280 samples)" },
                          { value: 100, label: "100 ms (2,560 samples)" },
                          { value: 200, label: "200 ms (5,120 samples)" },
                        ]
                  }
                  onValueChange={(v) => setContinuousWindowMs(Number(v))}
                  className="w-full"
                />
              </Field>
              <Field label={`Refresh delay: ${Math.max(continuousDelayMs, MIN_RESTART_DELAY_MS)} ms (~${(1000 / Math.max(continuousDelayMs, MIN_RESTART_DELAY_MS)).toFixed(1)} fps)`}>
                <input
                  type="range"
                  min={MIN_RESTART_DELAY_MS}
                  max={2000}
                  step={50}
                  value={continuousDelayMs}
                  onChange={(e) => setContinuousDelayMs(Number(e.target.value))}
                  className="w-full accent-pokit"
                />
              </Field>
              <Field label={`Captures visible: ${capturesVisible}`}>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={capturesVisible}
                  onChange={(e) => setCapturesVisible(Number(e.target.value))}
                  className="w-full accent-pokit"
                />
              </Field>
            </>
          )}
          <div className="flex gap-2">
            <Button variant="toggle" size="sm" active={continuous} onClick={() => setContinuous((c) => !c)}>
              {continuous ? "Continuous" : "One-shot"}
            </Button>
            <Button variant="toggle" size="sm" active={relActive} onClick={toggleRel} disabled={!values.length}>
              {relActive ? "REL ON" : "REL"}
            </Button>
            <Button variant="toggle" size="sm" active={gateActive} onClick={toggleGate} disabled={!calibratedNoise} title={calibratedNoise ? `Gate ±${formatSi(calibratedNoise.stdDev * 2, unit)}` : "Calibrate first"}>
              {gateActive ? "GATE ON" : "GATE"}
            </Button>
            <Button variant="toggle" size="sm" active={snrActive} onClick={toggleSnr} disabled={!calibratedNoise} title={calibratedNoise ? `SNR clamp ±${snrSigma}σ = ${formatSi(calibratedNoise.stdDev * snrSigma, unit)}` : "Calibrate first"}>
              {snrActive ? "SNR ON" : "SNR"}
            </Button>
            {running ? (
              <Button variant="danger" size="sm" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => start()} disabled={!connected}>
                Run capture
              </Button>
            )}
          </div>
          {snrActive && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">SNR σ:</span>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                value={snrSigma}
                onChange={(e) => setSnrSigma(Number(e.target.value))}
                className="flex-1 accent-pokit"
              />
              <span className="text-xs text-neutral-400 w-8">{snrSigma}σ</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <select
              value={calSource}
              onChange={(e) => setCalSource(e.target.value as CalSource)}
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
              title="Calibration source"
            >
              <option value="display">Current view</option>
              <option value="buffer">Full buffer</option>
              <option value="reset">Reset</option>
            </select>
            <Button variant="secondary" size="sm" onClick={handleCalibrate} disabled={!values.length && calSource !== "reset"}>
              Calibrate
            </Button>
          </div>
          {relActive && relRef.current !== null && (
            <p className="text-xs text-neutral-400">
              Baseline: {formatSi(relRef.current, unit)}
            </p>
          )}
          {calibratedNoise && (
            <p className="text-xs text-neutral-400" title="Mean ± StdDev | Peak-to-Peak">
              Calibrated noise: {formatSi(calibratedNoise.mean, unit)} ± {formatSi(calibratedNoise.stdDev, unit)} | {formatSi(calibratedNoise.peakToPeak, unit)} pp
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={!values.length}>
            Save capture
          </Button>
          {meta && (
            <p className="text-xs text-neutral-500">
              Rate: {formatSi(meta.samplingRate, "Hz")} · {meta.numberOfSamples} samples
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-900/80 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className="ml-1 font-mono text-sm text-neutral-200">{value}</span>
    </div>
  );
}
