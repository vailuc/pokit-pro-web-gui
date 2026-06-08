import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Readout } from "@/components/Readout";
import { useDeviceStore } from "@/store/deviceStore";
import { saveHistory } from "@/store/historyStore";
import { beep } from "@/lib/beep";
import { toast } from "@/store/toastStore";
import {
  AUTO_RANGE_OPTION,
  MeterMode,
  MeterStatus,
  formatSi,
  modeLabel,
  rangesForMode,
  unitForMode,
  type MeterReading,
} from "@/pokit";

const MODES: MeterMode[] = [
  MeterMode.DcVoltage,
  MeterMode.AcVoltage,
  MeterMode.DcCurrent,
  MeterMode.AcCurrent,
  MeterMode.Resistance,
  MeterMode.Continuity,
  MeterMode.Diode,
  MeterMode.Temperature,
  MeterMode.Capacitance,
];

interface Stats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

export function MultimeterView() {
  const { device, connectionState, setLastMeterReading } = useDeviceStore();
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

  // Apply settings + subscribe to live readings whenever config changes.
  useEffect(() => {
    if (!connected) return;
    let unsub: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      await device.multimeter.setSettings({ mode, range, updateIntervalMs: intervalMs });
      unsub = await device.multimeter.onReading((r) => {
        if (cancelled) return;
        setLastMeterReading(r);
        if (!hold) {
          setReading(r);
          // Update running stats.
          if (r.status !== MeterStatus.Error && mode !== MeterMode.Continuity) {
            setStats((prev) => {
              const n = prev.count + 1;
              const v = relRef.current !== null ? r.value - relRef.current : r.value;
              return {
                min: Math.min(prev.min, v),
                max: Math.max(prev.max, v),
                avg: (prev.avg * prev.count + v) / n,
                count: n,
              };
            });
          }
          // Continuity beep.
          if (mode === MeterMode.Continuity) {
            const isShort = r.status !== MeterStatus.AutoRangeOn;
            if (isShort && !lastShortRef.current) beep();
            lastShortRef.current = isShort;
          }
        }
      });
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

  const displayValue = (() => {
    if (!reading || reading.status === MeterStatus.Error) return `-- ${unit}`.trim();
    if (mode === MeterMode.Continuity) {
      return reading.status === MeterStatus.AutoRangeOn ? "OPEN" : "SHORT";
    }
    const v = rel && relRef.current !== null ? reading.value - relRef.current : reading.value;
    return formatSi(v, unit);
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

  const handleRel = () => {
    if (rel) {
      setRel(false);
      relRef.current = null;
    } else if (rawValue !== null) {
      relRef.current = rawValue;
      setRel(true);
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
          {/* Range badge */}
          <div className="absolute right-4 top-4 rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-neutral-300">
            {currentRangeLabel}
          </div>
          {/* HOLD badge */}
          {hold && (
            <div className="absolute left-4 top-4 rounded-full bg-amber-600/80 px-2.5 py-0.5 text-xs font-bold text-white">
              HOLD
            </div>
          )}
          {/* REL badge */}
          {rel && (
            <div className="absolute left-4 top-10 rounded-full bg-blue-600/80 px-2.5 py-0.5 text-xs font-bold text-white">
              REL
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
                    : undefined
                : connected
                  ? "Waiting for reading…"
                  : "Connect a device to begin"
            }
          />
        </CardContent>
      </Card>

      {/* Function buttons */}
      <div className="flex flex-wrap gap-2">
        <Button variant="toggle" size="sm" active={hold} onClick={() => setHold((h) => !h)}>
          {hold ? "Release" : "Hold"}
        </Button>
        <Button variant="toggle" size="sm" active={rel} onClick={handleRel}>
          {rel ? "REL On" : "REL"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={!connected || !reading || reading.status === MeterStatus.Error}>
          Save
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Button
              key={m}
              size="sm"
              active={mode === m}
              onClick={() => {
                setMode(m);
                setRange(AUTO_RANGE_OPTION.value);
              }}
            >
              {modeLabel(m)}
            </Button>
          ))}
        </CardContent>
      </Card>

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
