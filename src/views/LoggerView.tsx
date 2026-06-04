import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Waveform } from "@/components/Waveform";
import { useDeviceStore } from "@/store/deviceStore";
import {
  LoggerStatus,
  MeterMode,
  PokitProRanges,
  formatSi,
  unitForMode,
  type LoggerMetadata,
} from "@/pokit";

const LOGGER_MODES = [
  { value: MeterMode.DcVoltage, label: "DC Voltage" },
  { value: MeterMode.AcVoltage, label: "AC Voltage" },
  { value: MeterMode.DcCurrent, label: "DC Current" },
  { value: MeterMode.AcCurrent, label: "AC Current" },
  { value: MeterMode.Temperature, label: "Temperature" },
];

interface Sample {
  t: number; // seconds since start
  v: number;
}

export function LoggerView() {
  const { device, connectionState } = useDeviceStore();
  const connected = connectionState === "connected";

  const [mode, setMode] = useState<MeterMode>(MeterMode.DcVoltage);
  const [range, setRange] = useState<number>(2);
  const [intervalMs, setIntervalMs] = useState<number>(1000);
  const [meta, setMeta] = useState<LoggerMetadata | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [logging, setLogging] = useState(false);
  const startRef = useRef<number>(0);
  const scaleRef = useRef<number>(1);

  const isVoltage = mode === MeterMode.DcVoltage || mode === MeterMode.AcVoltage;
  const isCurrent = mode === MeterMode.DcCurrent || mode === MeterMode.AcCurrent;
  const rangeTable = isVoltage
    ? PokitProRanges.voltage
    : isCurrent
      ? PokitProRanges.current
      : [];
  const rangeOptions = rangeTable.map((r) => ({ value: r.value, label: r.label }));
  const unit = unitForMode(mode);

  const xs = useMemo(() => samples.map((s) => s.t), [samples]);
  const ys = useMemo(() => samples.map((s) => s.v), [samples]);

  useEffect(() => {
    if (!connected) return;
    let unsubMeta: (() => Promise<void>) | null = null;
    let unsubSamples: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      unsubMeta = await device.logger.onMetadata((m) => {
        if (cancelled) return;
        setMeta(m);
        scaleRef.current = m.scale;
        if (m.status === LoggerStatus.Done || m.status === LoggerStatus.BufferFull) {
          setLogging(false);
        }
      });
      unsubSamples = await device.logger.onSamples((raw) => {
        if (cancelled) return;
        const now = (Date.now() - startRef.current) / 1000;
        setSamples((prev) => {
          const next = [...prev];
          raw.forEach((s, i) => next.push({ t: now + i * (intervalMs / 1000), v: s * scaleRef.current }));
          return next;
        });
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
      void unsubMeta?.();
      void unsubSamples?.();
    };
  }, [connected, device, intervalMs]);

  const start = async () => {
    setSamples([]);
    startRef.current = Date.now();
    setLogging(true);
    try {
      await device.logger.startLogger({ mode, range, updateIntervalMs: intervalMs });
    } catch {
      setLogging(false);
    }
  };

  const stop = async () => {
    try {
      await device.logger.stopLogger();
    } finally {
      setLogging(false);
    }
  };

  const exportCsv = () => {
    const header = `time_s,value_${unit}\n`;
    const rows = samples.map((s) => `${s.t.toFixed(3)},${s.v}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pokit-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Logged data {meta ? `· ${samples.length} samples` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {samples.length ? (
            <Waveform xs={xs} ys={ys} xLabel="Time (s)" yLabel={unit} />
          ) : (
            <div className="grid h-80 place-items-center text-sm text-neutral-500">
              {connected ? "Start logging to record data over time" : "Connect a device to begin"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-neutral-400">Mode</span>
            <Select
              value={mode}
              options={LOGGER_MODES}
              onValueChange={(v) => setMode(Number(v) as MeterMode)}
              className="w-full"
            />
          </label>
          {rangeOptions.length > 0 && (
            <label className="grid gap-1">
              <span className="text-neutral-400">Range</span>
              <Select value={range} options={rangeOptions} onValueChange={(v) => setRange(Number(v))} className="w-full" />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-neutral-400">Interval: {intervalMs} ms</span>
            <input
              type="range"
              min={200}
              max={10000}
              step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="w-full accent-pokit"
            />
          </label>

          {logging ? (
            <Button variant="danger" onClick={stop}>
              Stop logging
            </Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={!connected}>
              Start logging
            </Button>
          )}
          <Button variant="secondary" onClick={exportCsv} disabled={!samples.length}>
            Export CSV
          </Button>
          {meta && (
            <p className="text-xs text-neutral-500">Scale: {formatSi(meta.scale, "")} · interval {meta.updateIntervalMs} ms</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
