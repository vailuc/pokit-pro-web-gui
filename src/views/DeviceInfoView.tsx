import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useDeviceStore } from "@/store/deviceStore";
import { DeviceStatusCode, formatSi } from "@/pokit";

function statusLabel(code: DeviceStatusCode): string {
  return DeviceStatusCode[code] ?? `Unknown (${code})`;
}

export function DeviceInfoView() {
  const { characteristics, status, deviceName, connectionState, refreshInfo, setName } =
    useDeviceStore();
  const connected = connectionState === "connected";
  const [newName, setNewName] = useState("");

  if (!connected) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-neutral-500">
              Connect a Pokit device to view its details.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows: [string, string][] = characteristics
    ? [
        ["Device name", deviceName || "—"],
        ["Firmware", characteristics.firmwareVersion],
        ["MAC address", characteristics.macAddress],
        ["Max voltage", `${characteristics.maximumVoltage} V`],
        ["Max current", `${characteristics.maximumCurrent} A`],
        ["Max resistance", formatSi(characteristics.maximumResistance, "Ω")],
        ["Max sampling rate", formatSi(characteristics.maximumSamplingRate, "Hz")],
        ["Sampling buffer", `${characteristics.samplingBufferSize} samples`],
      ]
    : [];

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Device characteristics</CardTitle>
          <Button size="sm" variant="ghost" onClick={refreshInfo}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-neutral-800">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 text-sm">
                <dt className="text-neutral-400">{k}</dt>
                <dd className="font-mono text-neutral-100">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="State" value={statusLabel(status.status)} />
              <Info label="Battery" value={`${status.batteryVoltage.toFixed(2)} V`} />
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No status yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rename device</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={deviceName || "New name"}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
          />
          <Button
            variant="primary"
            disabled={!newName.trim()}
            onClick={() => {
              void setName(newName.trim());
              setNewName("");
            }}
          >
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-800/60 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="font-mono text-neutral-100">{value}</div>
    </div>
  );
}
