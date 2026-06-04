import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Waveform } from "@/components/Waveform";
import { useDeviceStore } from "@/store/deviceStore";
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
  const bufferRef = useRef<DsoCaptureBuffer | null>(null);

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
      unsubMeta = await device.dso.onMetadata((m) => {
        if (cancelled) return;
        setMeta(m);
        if (!bufferRef.current) bufferRef.current = new DsoCaptureBuffer(m.numberOfSamples, m.scale);
        else bufferRef.current.reset(m.numberOfSamples, m.scale);
        if (m.status === DsoStatus.Done) setRunning(false);
      });
      unsubSamples = await device.dso.onSamples((samples) => {
        if (cancelled || !bufferRef.current) return;
        bufferRef.current.push(samples);
        setValues(bufferRef.current.values());
        if (bufferRef.current.isComplete) setRunning(false);
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
      void unsubMeta?.();
      void unsubSamples?.();
    };
  }, [connected, device]);

  const start = async () => {
    setValues([]);
    setRunning(true);
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
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Waveform</CardTitle>
        </CardHeader>
        <CardContent>
          {values.length ? (
            <Waveform xs={xs} ys={values} xLabel="Time (ms)" yLabel={unit} />
          ) : (
            <div className="grid h-80 place-items-center text-sm text-neutral-500">
              {connected ? "Run a capture to see a waveform" : "Connect a device to begin"}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric label="Vpp" value={formatSi(metrics.peakToPeak, unit)} />
            <Metric label="RMS" value={formatSi(metrics.rms, unit)} />
            <Metric label="Mean" value={formatSi(metrics.mean, unit)} />
            <Metric label="Frequency" value={formatSi(metrics.frequency, "Hz")} />
            <Metric label="Period" value={formatSi(metrics.period, "s")} />
            <Metric label="Duty" value={`${(metrics.dutyCycle * 100).toFixed(1)} %`} />
          </div>
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
              options={[256, 512, 1024, 2048, 4096, 8192, 16384].map((n) => ({ value: n, label: String(n) }))}
              onValueChange={(v) => setNumSamples(Number(v))}
              className="w-full"
            />
          </Field>
          <Button variant="primary" onClick={start} disabled={!connected || running}>
            {running ? "Sampling…" : "Run capture"}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-800/60 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="font-mono text-lg text-neutral-100">{value}</div>
    </div>
  );
}
