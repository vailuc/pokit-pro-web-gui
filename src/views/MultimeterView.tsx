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
  const { device, connectionState, status, autoFollowSwitch, setManualOverride, setLastMeterReading } = useDeviceStore();
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

  // Adaptive Tare: rolling window noise floor
  const [tareActive, setTareActive] = useState(false);
  const tareWindowRef = useRef<number[]>([]);
  const [tareLiveStats, setTareLiveStats] = useState<{ mean: number; range: number; count: number } | null>(null);
  const { plugins } = useSettingsStore();
  const tareSigma = plugins.meter.tareSigma;
  const TARE_WINDOW_SIZE = 20;

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

  // Reset adaptive tare window on mode/range change.
  useEffect(() => {
    tareWindowRef.current = [];
    setTareLiveStats(null);
    setTareActive(false);
  }, [mode, range]);

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

            // Adaptive tare: maintain rolling window of recent readings
            if (tareActive && mode !== MeterMode.Continuity && r.status !== MeterStatus.Error && Number.isFinite(r.value)) {
              const window = tareWindowRef.current;
              // When REL is active, collect REL-adjusted values so window
              // baseline matches what the user sees. Avoids double-counting.
              const windowValue = rel && relRef.current !== null ? r.value - relRef.current : r.value;
              window.push(windowValue);
              if (window.length > TARE_WINDOW_SIZE) window.shift();
              if (window.length >= 5) {
                const mean = window.reduce((a: number, b: number) => a + b, 0) / window.length;
                const min = Math.min(...window);
                const max = Math.max(...window);
                setTareLiveStats({ mean, range: max - min, count: window.length });
              }
            }

            if (!hold) {
              setReading(r);
              if (r.status !== MeterStatus.Error && mode !== MeterMode.Continuity) {
                setStats((prev) => {
                  const n = prev.count + 1;
                  let v = relRef.current !== null ? r.value - relRef.current : r.value;
                  // Apply tare baseline to stats for consistency with display
                  if (tareActive && tareLiveStats) {
                    v = v - tareLiveStats.mean;
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

    // Adaptive Tare: gate within observed noise range of rolling window
    if (tareActive && tareLiveStats) {
      const centered = tared - tareLiveStats.mean;
      const threshold = (tareLiveStats.range / 2) * tareSigma;
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
    const items = [
      { label: "Min", value: formatSi(stats.min, u) },
      { label: "Max", value: formatSi(stats.max, u) },
      { label: "Avg", value: formatSi(stats.avg, u) },
    ];
    if (tareActive && tareLiveStats) {
      const threshold = (tareLiveStats.range / 2) * tareSigma;
      items.push({ label: "Floor", value: `±${formatSi(threshold, u)}` });
    }
    return items;
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
    if (tareActive) {
      setTareActive(false);
      tareWindowRef.current = [];
      setTareLiveStats(null);
      toast.info("Tare cleared");
    } else {
      setTareActive(true);
      tareWindowRef.current = [];
      setTareLiveStats(null);
      toast.info("Tare active — collecting noise floor…");
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
          {tareActive ? "Tare On" : "Tare"}
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

      {/* Unified mode selector bar */}
      <ModeBar currentMode={mode} onSelect={handleModeClick} switchPos={switchPos} />

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

function ModeBar({
  currentMode,
  onSelect,
  switchPos,
}: {
  currentMode: MeterMode;
  onSelect: (m: MeterMode) => void;
  switchPos: string | null;
}) {
  const banks: { label: string; modes: MeterMode[]; key: "V" | "A" | "Ω" }[] = [
    { label: "V", modes: V_MODES, key: "V" },
    { label: "A", modes: A_MODES, key: "A" },
    { label: "Ω", modes: OHM_MODES, key: "Ω" },
  ];

  return (
    <Card className="border-neutral-800">
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        {banks.map((bank, bankIdx) => (
          <div key={bank.key} className="flex items-center gap-1">
            {bankIdx > 0 && <div className="mx-1 h-6 w-px bg-neutral-700" />}
            <span
              className={[
                "mr-1 text-xs font-bold",
                switchPos === bank.key ? "text-teal-400" : "text-neutral-600",
              ].join(" ")}
            >
              {bank.label}
            </span>
            {bank.modes.map((m) => (
              <Button
                key={m}
                size="sm"
                active={currentMode === m}
                onClick={() => onSelect(m)}
              >
                {modeLabel(m)}
              </Button>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
