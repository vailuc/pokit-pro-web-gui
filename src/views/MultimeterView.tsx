import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Readout } from "@/components/Readout";
import { useDeviceStore } from "@/store/deviceStore";
import { useSettingsStore } from "@/store/settingsStore";
import { saveHistory } from "@/store/historyStore";
import { beep } from "@/lib/beep";
import { toast } from "@/store/toastStore";
import {
  AUTO_RANGE_OPTION,
  MeterMode,
  MeterStatus,
  formatSi,
  getSwitchPosition,
  modeLabel,
  rangesForMode,
  unitForMode,
  type MeterReading,
} from "@/pokit";

const V_MODES: MeterMode[] = [MeterMode.DcVoltage, MeterMode.AcVoltage];
const A_MODES: MeterMode[] = [MeterMode.DcCurrent, MeterMode.AcCurrent];
const OHM_MODES: MeterMode[] = [MeterMode.Resistance, MeterMode.Diode, MeterMode.Continuity, MeterMode.Temperature, MeterMode.Capacitance];

function modeBank(mode: MeterMode): "V" | "A" | "Ω" {
  if (V_MODES.includes(mode)) return "V";
  if (A_MODES.includes(mode)) return "A";
  return "Ω";
}

interface Stats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

interface LastModes {
  V: MeterMode;
  A: MeterMode;
  Ω: MeterMode;
}

export function MultimeterView() {
  const { device, connectionState, status, characteristics, autoFollowSwitch, setManualOverride, setLastMeterReading } = useDeviceStore();
  const connected = connectionState === "connected";

  const [mode, setMode] = useState<MeterMode>(MeterMode.DcVoltage);
  const [range, setRange] = useState<number>(AUTO_RANGE_OPTION.value);
  const [intervalMs, setIntervalMs] = useState<number>(500);
  const [reading, setReading] = useState<MeterReading | null>(null);

  const [hold, setHold] = useState(false);
  const [rel, setRel] = useState(false);
  const relRef = useRef<number | null>(null);
  const [stats, setStats] = useState<Stats>({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
  const lastShortRef = useRef(false);

  // Tare: statistical noise calibration
  const [tareActive, setTareActive] = useState(false);
  const [tareCalibrating, setTareCalibrating] = useState(false);
  const [tareBaseline, setTareBaseline] = useState<{ mean: number; stdDev: number } | null>(null);
  const autoCalReadingsRef = useRef<number[]>([]);
  const autoCalCompleteRef = useRef(false);
  const { plugins } = useSettingsStore();
  const tareSigma = plugins.meter.tareSigma;

  // Track last-used mode per switch position.
  const [lastModes, setLastModes] = useState<LastModes>({
    V: MeterMode.DcVoltage,
    A: MeterMode.DcCurrent,
    Ω: MeterMode.Resistance,
  });

  const prevSwitchRef = useRef<string | null>(null);

  const switchPos = status ? getSwitchPosition(status.status) : null;

  const rangeOptions = useMemo(() => {
    const ranges = rangesForMode(mode);
    return ranges.length
      ? [AUTO_RANGE_OPTION, ...ranges].map((r) => ({ value: r.value, label: r.label }))
      : [];
  }, [mode]);

  const currentRangeLabel = useMemo(() => {
    if (range === AUTO_RANGE_OPTION.value) return "Auto";
    const r = rangesForMode(mode).find((x) => x.value === range);
    return r?.label ?? "Auto";
  }, [mode, range]);

  // Reset stats on mode/range change.
  useEffect(() => {
    setStats({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
    relRef.current = null;
    setRel(false);
    setHold(false);
    lastShortRef.current = false;
  }, [mode, range]);

  // Load tare baseline from localStorage on mode/range change.
  const deviceMac = characteristics?.macAddress ?? "default";
  const tareKey = `meterBaseline_${deviceMac}_${mode}_${range}`;
  useEffect(() => {
    setTareActive(false);
    setTareCalibrating(false);
    setTareBaseline(null);
    autoCalCompleteRef.current = false;
    autoCalReadingsRef.current = [];
    const saved = localStorage.getItem(tareKey);
    if (saved) {
      try {
        const b = JSON.parse(saved);
        setTareBaseline({ mean: b.mean, stdDev: b.stdDev });
        setTareActive(true);
      } catch { /* ignore */ }
    }
  }, [mode, range, tareKey]);

  // Apply settings + subscribe to live readings whenever config changes.
  useEffect(() => {
    if (!connected) return;
    let unsub: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      // Retry subscribe up to 3 times with backoff.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          unsub = await device.multimeter.onReading((r) => {
            if (cancelled) return;
            setLastMeterReading(r);

            // Auto-calibration: collect first 20 readings silently
            if (!autoCalCompleteRef.current && !tareActive && r.status !== MeterStatus.Error) {
              autoCalReadingsRef.current.push(r.value);
              if (autoCalReadingsRef.current.length >= 20) {
                const vals = autoCalReadingsRef.current.filter((v) => Number.isFinite(v));
                if (vals.length < 5) {
                  autoCalCompleteRef.current = true;
                  setTareCalibrating(false);
                  toast.error("Tare failed: unstable readings");
                } else {
                  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                  const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length;
                  const baseline = { mean, stdDev: Math.sqrt(variance), sampleCount: vals.length, date: new Date().toISOString() };
                  setTareBaseline({ mean, stdDev: baseline.stdDev });
                  setTareActive(true);
                  setTareCalibrating(false);
                  autoCalCompleteRef.current = true;
                  localStorage.setItem(tareKey, JSON.stringify(baseline));
                  toast.success(`Auto-tared ±${formatSi(baseline.stdDev * tareSigma, unit)}`);
                }
              }
            }

            if (!hold) {
              setReading(r);
              if (r.status !== MeterStatus.Error && mode !== MeterMode.Continuity) {
                setStats((prev) => {
                  const n = prev.count + 1;
                  let v = relRef.current !== null ? r.value - relRef.current : r.value;
                  if (tareActive && tareBaseline) {
                    v = v - tareBaseline.mean;
                  }
                  return {
                    min: Math.min(prev.min, v),
                    max: Math.max(prev.max, v),
                    avg: (prev.avg * prev.count + v) / n,
                    count: n,
                  };
                });
              }
              if (mode === MeterMode.Continuity) {
                const isShort = r.status !== MeterStatus.AutoRangeOn;
                if (isShort && !lastShortRef.current) beep();
                lastShortRef.current = isShort;
              }
            }
          });
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }

      try {
        await device.multimeter.setSettings({ mode, range, updateIntervalMs: intervalMs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("0x80")) {
          console.warn("[Multimeter] Settings rejected (0x80): switch position mismatch");
        } else {
          throw err;
        }
      }
    })().catch((err) => {
      if (!cancelled) {
        console.error("Multimeter setup failed:", err);
        toast.error(err instanceof Error ? err.message : "Meter setup failed");
      }
    });

    return () => {
      cancelled = true;
      void unsub?.();
    };
  }, [connected, device, mode, range, intervalMs, hold]);

  const unit = unitForMode(mode);
  const rawValue = (() => {
    if (!reading || reading.status === MeterStatus.Error) return null;
    if (mode === MeterMode.Continuity) return null;
    return reading.value;
  })();

  const { displayValue, isGated } = (() => {
    if (!reading || reading.status === MeterStatus.Error) return { displayValue: `-- ${unit}`.trim(), isGated: false };
    if (mode === MeterMode.Continuity) {
      return { displayValue: reading.status === MeterStatus.AutoRangeOn ? "OPEN" : "SHORT", isGated: false };
    }

    // REL offset first
    const relOffset = rel && relRef.current !== null ? relRef.current : 0;
    const tared = reading.value - relOffset;

    // Tare: center around calibrated mean, gate within ±Nσ
    if (tareActive && tareBaseline) {
      const centered = tared - tareBaseline.mean;
      const threshold = tareBaseline.stdDev * tareSigma;
      if (Math.abs(centered) < threshold) {
        return { displayValue: "0.000", isGated: true };
      }
      return { displayValue: formatSi(centered, unit), isGated: false };
    }

    return { displayValue: formatSi(tared, unit), isGated: false };
  })();

  const statsDisplay = (() => {
    if (!stats.count || mode === MeterMode.Continuity) return null;
    const u = unitForMode(mode);
    return [
      { label: "Min", value: formatSi(stats.min, u) },
      { label: "Max", value: formatSi(stats.max, u) },
      { label: "Avg", value: formatSi(stats.avg, u) },
    ];
  })();

  // Auto-follow: only trigger when switch position CHANGES, not on every status update.
  useEffect(() => {
    if (!connected || !status || !autoFollowSwitch) return;
    const pos = getSwitchPosition(status.status);
    if (pos === "idle" || pos === "logger") return;

    if (prevSwitchRef.current !== pos) {
      prevSwitchRef.current = pos;
      const target = lastModes[pos as keyof LastModes];
      if (mode !== target) {
        setMode(target);
        setRange(AUTO_RANGE_OPTION.value);
        setManualOverride(false);
      }
    }
  }, [connected, status, autoFollowSwitch, lastModes, mode, setManualOverride]);

  const handleModeClick = (m: MeterMode) => {
    const bank = modeBank(m);
    setLastModes((prev) => ({ ...prev, [bank]: m }));
    if (bank !== switchPos && switchPos !== null && switchPos !== "idle" && switchPos !== "logger") {
      setManualOverride(true);
    }
    setMode(m);
    setRange(AUTO_RANGE_OPTION.value);
  };

  const handleRel = () => {
    if (rel) {
      setRel(false);
      relRef.current = null;
    } else if (rawValue !== null) {
      relRef.current = rawValue;
      setRel(true);
    }
  };

  const handleTare = () => {
    if (tareActive || tareCalibrating) {
      // Clear tare
      setTareActive(false);
      setTareCalibrating(false);
      setTareBaseline(null);
      autoCalCompleteRef.current = true; // stop auto-cal
      autoCalReadingsRef.current = [];
      localStorage.removeItem(tareKey);
      toast.info("Tare cleared");
    } else {
      // Manual calibration: collect from current stats window
      if (stats.count < 5) {
        toast.error("Need more readings to calibrate");
        return;
      }
      // Use accumulated stats as proxy, or collect fresh
      setTareCalibrating(true);
      // Quick calibration from recent readings — in practice we'd collect
      // a fresh window, but stats.avg gives us a reasonable center.
      // For better accuracy, do a short collection burst:
      autoCalCompleteRef.current = false;
      autoCalReadingsRef.current = [];
      toast.info("Calibrating… keep probes steady");
      // Auto-cal will pick up in the next ~20 readings via onReading
    }
  };

  const handleSave = async () => {
    if (!reading || reading.status === MeterStatus.Error) return;
    const name = `${modeLabel(mode)} ${new Date().toLocaleTimeString()}`;
    await saveHistory("meter", name, {
      value: displayValue,
      mode: modeLabel(mode),
      unit,
      raw: reading.value,
      range: currentRangeLabel,
    });
    toast.success("Saved to history");
  };

  const bankActive = (bank: "V" | "A" | "Ω") => {
    if (!switchPos || switchPos === "idle" || switchPos === "logger") return false;
    return switchPos === bank;
  };

  return (
    <div className="grid gap-4">
      {/* Stats strip */}
      {statsDisplay && (
        <div className="flex justify-center gap-4">
          {statsDisplay.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">{s.label}</div>
              <div className="font-mono text-sm text-neutral-300">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <Card className="relative">
        <CardContent>
          <div className="absolute right-4 top-4 rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-neutral-300">
            {currentRangeLabel}
          </div>
          {hold && (
            <div className="absolute left-4 top-4 rounded-full bg-amber-600/80 px-2.5 py-0.5 text-xs font-bold text-white">
              HOLD
            </div>
          )}
          {rel && (
            <div className="absolute left-4 top-10 rounded-full bg-blue-600/80 px-2.5 py-0.5 text-xs font-bold text-white">
              REL
            </div>
          )}
          {tareActive && (
            <div className="absolute left-4 top-[4.5rem] rounded-full bg-red-600/80 px-2.5 py-0.5 text-xs font-bold text-white">
              Tare {tareSigma}σ
            </div>
          )}
          <Readout
            value={displayValue}
            label={modeLabel(mode)}
            sub={
              reading
                ? reading.status === MeterStatus.AutoRangeOn
                  ? "Auto-range"
                  : reading.status === MeterStatus.Error
                    ? "Error / out of range"
                    : isGated
                      ? "Gated"
                      : undefined
                : connected
                  ? "Waiting for reading…"
                  : "Connect a device to begin"
            }
            gated={isGated}
          />
        </CardContent>
      </Card>

      {/* Function buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="toggle" size="sm" active={hold} onClick={() => setHold((h) => !h)}>
          {hold ? "Release" : "Hold"}
        </Button>
        <Button variant="toggle" size="sm" active={rel} onClick={handleRel}>
          {rel ? "REL On" : "REL"}
        </Button>
        <Button variant="toggle" size="sm" active={tareActive} onClick={handleTare}>
          {tareActive ? "Tare On" : tareCalibrating ? "Tare…" : "Tare"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={!connected || !reading || reading.status === MeterStatus.Error}>
          Save
        </Button>
        {tareActive && (
          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <span>σ</span>
            {[1, 2, 3, 4].map((s) => (
              <button
                key={s}
                className={`h-6 w-6 rounded text-center leading-6 ${tareSigma === s ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`}
                onClick={() => useSettingsStore.getState().updatePlugin("meter", "tareSigma", s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3 switch-position banks */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ModeBank
          title="V"
          modes={V_MODES}
          active={bankActive("V")}
          currentMode={mode}
          onSelect={handleModeClick}
        />
        <ModeBank
          title="A"
          modes={A_MODES}
          active={bankActive("A")}
          currentMode={mode}
          onSelect={handleModeClick}
        />
        <ModeBank
          title="Ω"
          modes={OHM_MODES}
          active={bankActive("Ω")}
          currentMode={mode}
          onSelect={handleModeClick}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Range</CardTitle>
          </CardHeader>
          <CardContent>
            {rangeOptions.length ? (
              <Select
                value={range}
                options={rangeOptions}
                onValueChange={(v) => setRange(Number(v))}
                className="w-full"
              />
            ) : (
              <p className="text-sm text-neutral-500">No range selection for this mode.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Update interval: {intervalMs} ms</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="range"
              min={100}
              max={2000}
              step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="w-full accent-pokit"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ModeBank({
  title,
  modes,
  active,
  currentMode,
  onSelect,
}: {
  title: string;
  modes: MeterMode[];
  active: boolean;
  currentMode: MeterMode;
  onSelect: (m: MeterMode) => void;
}) {
  return (
    <Card
      className={[
        "transition-colors",
        active
          ? "border-teal-500/50 bg-teal-950/10"
          : "border-neutral-800 opacity-60",
      ].join(" ")}
    >
      <CardHeader className="pb-2">
        <CardTitle className={active ? "text-teal-400" : "text-neutral-500"}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <Button
            key={m}
            size="sm"
            active={currentMode === m}
            onClick={() => onSelect(m)}
          >
            {modeLabel(m)}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
