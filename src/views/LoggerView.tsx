import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Waveform } from "@/components/Waveform";
import { useDeviceStore } from "@/store/deviceStore";
import { saveHistory } from "@/store/historyStore";
import { toast } from "@/store/toastStore";
import {
  LoggerStatus,
  MeterMode,
  PokitProRanges,
  formatSi,
  modeLabel,
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
  const [downloading, setDownloading] = useState(false);
  const scaleRef = useRef<number>(1);
  const intervalSecRef = useRef<number>(1);
  const countRef = useRef<number>(0);

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
        // Prefer the device-reported interval for the time axis.
        intervalSecRef.current = (m.updateIntervalMs || intervalMs) / 1000;
        if (m.status === LoggerStatus.Done || m.status === LoggerStatus.BufferFull) {
          setDownloading(false);
        }
      });
      unsubSamples = await device.logger.onSamples((raw) => {
        if (cancelled) return;
        setSamples((prev) => {
          const next = [...prev];
          for (const s of raw) {
            next.push({ t: countRef.current * intervalSecRef.current, v: s * scaleRef.current });
            countRef.current += 1;
          }
          return next;
        });
      });
    })().catch((err) => {
      if (!cancelled) {
        console.error("Logger subscription failed:", err);
        toast.error(err instanceof Error ? err.message : "Logger setup failed");
      }
    });

    return () => {
      cancelled = true;
      void unsubMeta?.();
      void unsubSamples?.();
    };
  }, [connected, device, intervalMs]);

  const start = async () => {
    setLogging(true);
    try {
      await device.logger.startLogger({ mode, range, updateIntervalMs: intervalMs });
    } catch (err) {
      setLogging(false);
      toast.error(err instanceof Error ? err.message : "Failed to start logger");
    }
  };

  const stop = async () => {
    try {
      await device.logger.stopLogger();
    } finally {
      setLogging(false);
      // Auto-save completed session.
      if (samples.length > 0) {
        const name = `Logger ${modeLabel(mode)} ${new Date().toLocaleTimeString()}`;
        await saveHistory("logger", name, [...samples]);
        toast.success("Logger session saved to history");
      }
    }
  };

  const handleSave = async () => {
    if (!samples.length) return;
    const name = `Logger ${modeLabel(mode)} ${new Date().toLocaleTimeString()}`;
    await saveHistory("logger", name, [...samples]);
    toast.success("Saved to history");
  };

  // Download the buffered log from the device (Refresh command).
  const download = async () => {
    setSamples([]);
    countRef.current = 0;
    intervalSecRef.current = intervalMs / 1000;
    setDownloading(true);
    try {
      await device.logger.refreshData();
    } catch {
      setDownloading(false);
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
      <Card className="relative">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Logged data {meta ? `· ${samples.length} samples` : ""}</CardTitle>
          {logging && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              REC
            </span>
          )}
        </CardHeader>
        <CardContent>
          {samples.length ? (
            <Waveform xs={xs} ys={ys} xLabel="Time (s)" yLabel={unit} />
          ) : (
            <div className="grid h-80 place-items-center text-sm text-neutral-500">
              {connected
                ? "Start logging, then Download data to plot the device's recorded log"
                : "Connect a device to begin"}
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
          <Button variant="secondary" onClick={download} disabled={!connected || downloading}>
            {downloading ? "Downloading…" : "Download data"}
          </Button>
          <Button variant="ghost" onClick={exportCsv} disabled={!samples.length}>
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={!samples.length}>
            Save to history
          </Button>
          {meta && (
            <p className="text-xs text-neutral-500">Scale: {formatSi(meta.scale, "")} · interval {meta.updateIntervalMs} ms</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
