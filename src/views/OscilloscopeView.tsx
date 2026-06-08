import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Waveform } from "@/components/Waveform";
import { useDeviceStore } from "@/store/deviceStore";
import { saveHistory } from "@/store/historyStore";
import { toast } from "@/store/toastStore";
import {
  DsoCommand,
  DsoStatus,
  MeterMode,
  PokitProRanges,
  formatSi,
  unitForMode,
  type DsoMetadata,
} from "@/pokit";
import { DsoCaptureBuffer } from "@/pokit";
import { computeMetrics } from "@/lib/waveformMetrics";

const DSO_MODES = [
  { value: MeterMode.DcVoltage, label: "DC Voltage" },
  { value: MeterMode.AcVoltage, label: "AC Voltage" },
  { value: MeterMode.DcCurrent, label: "DC Current" },
  { value: MeterMode.AcCurrent, label: "AC Current" },
];

export function OscilloscopeView() {
  const { device, connectionState } = useDeviceStore();
  const connected = connectionState === "connected";

  const [mode, setMode] = useState<MeterMode>(MeterMode.DcVoltage);
  const [range, setRange] = useState<number>(2); // 10V default index
  const [triggerLevel, setTriggerLevel] = useState<number>(0);
  const [command, setCommand] = useState<DsoCommand>(DsoCommand.FreeRunning);
  const [windowMs, setWindowMs] = useState<number>(10);
  const [numSamples, setNumSamples] = useState<number>(1024);

  const [meta, setMeta] = useState<DsoMetadata | null>(null);
  const [values, setValues] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const bufferRef = useRef<DsoCaptureBuffer | null>(null);
  const pendingRestartRef = useRef(false);
  const preMetaQueueRef = useRef<number[][]>([]);
  const captureGenRef = useRef(0);

  const isVoltage = mode === MeterMode.DcVoltage || mode === MeterMode.AcVoltage;
  const rangeTable = isVoltage ? PokitProRanges.voltage : PokitProRanges.current;
  const rangeOptions = rangeTable.map((r) => ({ value: r.value, label: r.label }));
  const unit = unitForMode(mode);

  const sampleRate = meta?.samplingRate ?? (numSamples / (windowMs / 1000));
  const xs = useMemo(() => values.map((_, i) => (i / (sampleRate || 1)) * 1000), [values, sampleRate]);
  const metrics = useMemo(() => computeMetrics(values, sampleRate || 1), [values, sampleRate]);

  useEffect(() => {
    if (!connected) return;
    let unsubMeta: (() => Promise<void>) | null = null;
    let unsubSamples: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      // Queue samples that arrive before the first metadata packet.
      // Cleared on each new capture start via preMetaQueueRef.
      const preMetaQueue: number[][] = [];
      preMetaQueueRef.current = preMetaQueue;

      unsubMeta = await device.dso.onMetadata((m) => {
        if (cancelled) return;
        const myGen = captureGenRef.current;
        setMeta(m);
        if (!bufferRef.current) bufferRef.current = new DsoCaptureBuffer(m.numberOfSamples, m.scale);
        else bufferRef.current.reset(m.numberOfSamples, m.scale);
        // Flush any samples that beat the metadata notification (same generation only).
        if (preMetaQueue.length > 0) {
          for (const s of preMetaQueue) bufferRef.current.push(s);
          preMetaQueue.length = 0;
          setValues(bufferRef.current.values());
        }
        if (m.status === DsoStatus.Done) {
          bufferRef.current = null;
          if (continuous && pendingRestartRef.current && myGen === captureGenRef.current) {
            // Auto-restart for continuous mode.
            pendingRestartRef.current = false;
            setTimeout(() => {
              if (!cancelled) void start();
            }, 100);
          } else {
            setRunning(false);
          }
        }
      });
      unsubSamples = await device.dso.onSamples((samples) => {
        if (cancelled) return;
        if (!bufferRef.current) { preMetaQueue.push(samples); return; }
        bufferRef.current.push(samples);
        setValues(bufferRef.current.values());
        if (bufferRef.current.isComplete) {
          bufferRef.current = null;
          setRunning(false);
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
    };
  }, [connected, device]);

  const start = async () => {
    captureGenRef.current += 1;
    bufferRef.current = null;
    preMetaQueueRef.current.length = 0;
    setValues([]);
    setRunning(true);
    pendingRestartRef.current = continuous;
    try {
      await device.dso.startDso({
        command,
        triggerLevel,
        mode,
        range,
        samplingWindowUs: Math.round(windowMs * 1000),
        numberOfSamples: numSamples,
      });
    } catch {
      setRunning(false);
      pendingRestartRef.current = false;
    }
  };

  const stop = () => {
    pendingRestartRef.current = false;
    setContinuous(false);
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
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
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
            <Waveform xs={xs} ys={values} xLabel="Time (ms)" yLabel={unit} />
          ) : (
            <div className="grid h-80 place-items-center text-sm text-neutral-500">
              {connected ? "Run a capture to see a waveform" : "Connect a device to begin"}
            </div>
          )}
          {/* Floating metrics strip */}
          {values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-neutral-800/60 p-2">
              <MetricPill label="Vpp" value={formatSi(metrics.peakToPeak, unit)} />
              <MetricPill label="RMS" value={formatSi(metrics.rms, unit)} />
              <MetricPill label="Mean" value={formatSi(metrics.mean, unit)} />
              <MetricPill label="Freq" value={formatSi(metrics.frequency, "Hz")} />
              <MetricPill label="Period" value={formatSi(metrics.period, "s")} />
              <MetricPill label="Duty" value={`${(metrics.dutyCycle * 100).toFixed(1)} %`} />
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
          <Field label={`Window: ${windowMs} ms`}>
            <input
              type="range"
              min={1}
              max={100}
              value={windowMs}
              onChange={(e) => setWindowMs(Number(e.target.value))}
              className="w-full accent-pokit"
            />
          </Field>
          <Field label="Samples">
            <Select
              value={numSamples}
              options={[256, 512, 1024, 2048, 4096].map((n) => ({ value: n, label: String(n) }))}
              onValueChange={(v) => setNumSamples(Number(v))}
              className="w-full"
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="toggle" size="sm" active={continuous} onClick={() => setContinuous((c) => !c)}>
              {continuous ? "Continuous" : "One-shot"}
            </Button>
            {running ? (
              <Button variant="danger" size="sm" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={start} disabled={!connected}>
                Run capture
              </Button>
            )}
          </div>
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
