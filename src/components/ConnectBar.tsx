import { Bluetooth, BluetoothConnected, Flashlight, BatteryFull, BatteryLow, History, Server } from "lucide-react";
import { Button } from "./ui/Button";
import { SwitchIndicator } from "./SwitchIndicator";
import { useDeviceStore } from "@/store/deviceStore";
import { batteryPercent } from "@/pokit";

interface ConnectBarProps {
  onOpenHistory?: () => void;
}

export function ConnectBar({ onOpenHistory }: ConnectBarProps) {
  const {
    connectionState,
    deviceName,
    status,
    torchOn,
    error,
    useBridge,
    manualOverride,
    connect,
    disconnect,
    toggleTorch,
    setUseBridge,
  } = useDeviceStore();

  const connected = connectionState === "connected";
  const pct = status ? batteryPercent(status.batteryVoltage) : null;

  return (
    <header className="flex flex-col gap-2 border-b border-neutral-800 bg-neutral-900/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-pokit text-neutral-900">
            {connected ? <BluetoothConnected size={20} /> : <Bluetooth size={20} />}
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              {connected ? deviceName || "Pokit" : "Pokit Pro Web GUI"}
            </div>
            <div className="text-xs text-neutral-400">
              {connectionState === "unsupported"
                ? "Web Bluetooth unavailable — use Chromium"
                : connectionState === "connecting"
                  ? "Connecting…"
                  : connectionState === "scanning"
                    ? "Scanning for Pokit…"
                    : connected
                      ? "Connected"
                      : "Disconnected"}
              {useBridge && !connected && connectionState !== "scanning" && " · Bridge"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!connected && (
            <Button
              variant="toggle"
              size="sm"
              active={useBridge}
              onClick={() => setUseBridge(!useBridge)}
              title={useBridge ? "Using Python BLE Bridge" : "Using Web Bluetooth"}
            >
              <Server size={16} />
            </Button>
          )}

          {connected && pct !== null && (
            <div className="flex items-center gap-1 text-sm text-neutral-300">
              {pct < 25 ? (
                <BatteryLow size={18} className="text-red-400" />
              ) : (
                <BatteryFull size={18} className="text-green-400" />
              )}
              <span className="tabular-nums">{pct}%</span>
            </div>
          )}

          {connected && status && (
            <SwitchIndicator
              status={status.status}
              manualOverride={manualOverride}
            />
          )}

          {connected && (
            <Button
              variant="toggle"
              size="sm"
              active={torchOn}
              onClick={toggleTorch}
              title="Torch"
            >
              <Flashlight size={16} />
            </Button>
          )}

          {onOpenHistory && (
            <Button variant="ghost" size="sm" onClick={onOpenHistory} title="History">
              <History size={16} />
            </Button>
          )}
          {connected ? (
            <Button variant="danger" size="sm" onClick={disconnect}>
              Disconnect
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={connect}
              disabled={connectionState === "unsupported" || connectionState === "connecting" || connectionState === "scanning"}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-950/60 px-3 py-1.5 text-xs text-red-300">{error}</div>
      )}
    </header>
  );
}
