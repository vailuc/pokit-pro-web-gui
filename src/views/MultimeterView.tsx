import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Readout } from "@/components/Readout";
import { useDeviceStore } from "@/store/deviceStore";
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

export function MultimeterView() {
  const { device, connectionState } = useDeviceStore();
  const connected = connectionState === "connected";

  const [mode, setMode] = useState<MeterMode>(MeterMode.DcVoltage);
  const [range, setRange] = useState<number>(AUTO_RANGE_OPTION.value);
  const [intervalMs, setIntervalMs] = useState<number>(500);
  const [reading, setReading] = useState<MeterReading | null>(null);

  const rangeOptions = useMemo(() => {
    const ranges = rangesForMode(mode);
    return ranges.length
      ? [AUTO_RANGE_OPTION, ...ranges].map((r) => ({ value: r.value, label: r.label }))
      : [];
  }, [mode]);

  // Apply settings + subscribe to live readings whenever config changes.
  useEffect(() => {
    if (!connected) return;
    let unsub: (() => Promise<void>) | null = null;
    let cancelled = false;

    (async () => {
      await device.multimeter.setSettings({ mode, range, updateIntervalMs: intervalMs });
      unsub = await device.multimeter.onReading((r) => {
        if (!cancelled) setReading(r);
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
      void unsub?.();
    };
  }, [connected, device, mode, range, intervalMs]);

  const unit = unitForMode(mode);
  const displayValue = (() => {
    if (!reading || reading.status === MeterStatus.Error) return `-- ${unit}`.trim();
    if (mode === MeterMode.Continuity) {
      return reading.status === MeterStatus.AutoRangeOn ? "OPEN" : "SHORT";
    }
    return formatSi(reading.value, unit);
  })();

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent>
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
