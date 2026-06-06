/**
 * Global connection/device state. Holds the single PokitDevice instance and
 * exposes connect/disconnect plus live device info & status.
 */

import { create } from "zustand";
import {
  PokitDevice,
  type DeviceCharacteristics,
  type DeviceStatus,
  type MeterReading,
} from "@/pokit";
import { toast } from "./toastStore";
import { saveHistory } from "./historyStore";

const MAX_RECONNECT_ATTEMPTS = 5;

export type ConnectionState =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected";

interface DeviceState {
  device: PokitDevice;
  connectionState: ConnectionState;
  deviceName: string;
  characteristics: DeviceCharacteristics | null;
  status: DeviceStatus | null;
  torchOn: boolean;
  error: string | null;
  lastMeterReading: MeterReading | null;

  reconnectAttempt: number;

  connect: () => Promise<void>;
  disconnect: () => void;
  attemptReconnect: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  flashLed: () => Promise<void>;
  toggleTorch: () => Promise<void>;
  setName: (name: string) => Promise<void>;
  setLastMeterReading: (r: MeterReading | null) => void;
}

const device = new PokitDevice();

export const useDeviceStore = create<DeviceState>((set, get) => {
  let statusUnsub: (() => Promise<void>) | null = null;
  let buttonUnsub: (() => Promise<void>) | null = null;

  // React to connection drops: auto-reconnect unless the user asked to disconnect.
  device.connection.onConnectionChange((connected) => {
    if (connected) return;
    if (buttonUnsub) { try { void buttonUnsub(); } catch { /* ignore */ } buttonUnsub = null; }
    set({ characteristics: null, status: null });
    if (device.connection.wasIntentionalDisconnect) {
      set({ connectionState: "disconnected" });
    } else if (device.connection.canReconnect) {
      void get().attemptReconnect();
    } else {
      set({ connectionState: "disconnected" });
      toast.error("Device disconnected");
    }
  });

  const subscribeStatus = async () => {
    if (statusUnsub) {
      try { await statusUnsub(); } catch { /* device may be gone */ }
      statusUnsub = null;
    }
    statusUnsub = await device.status.onStatus((status) => set({ status }));
  };

  const subscribeButton = async () => {
    if (buttonUnsub) {
      try { await buttonUnsub(); } catch { /* device may be gone */ }
      buttonUnsub = null;
    }
    try {
      buttonUnsub = await device.status.onButtonPress((raw) => {
        const isRelease = raw.length >= 2 && raw[1] === 0x00;
        if (isRelease) {
          const reading = get().lastMeterReading;
          if (reading) {
            void saveHistory("meter", `Button ${new Date().toLocaleTimeString()}`, {
              value: reading.value,
              mode: reading.mode,
              range: reading.range,
              status: reading.status,
            });
            toast.success("Saved to history");
          } else {
            toast.info("No meter reading to save");
          }
        }
      });
    } catch {
      /* button press characteristic may not exist on all firmwares */
    }
  };

  return {
    device,
    connectionState: PokitDevice.isSupported() ? "disconnected" : "unsupported",
    deviceName: "",
    characteristics: null,
    status: null,
    torchOn: false,
    error: null,
    lastMeterReading: null,
    reconnectAttempt: 0,

    async connect() {
      set({ connectionState: "connecting", error: null, reconnectAttempt: 0 });
      try {
        await device.connect();
        set({ connectionState: "connected", deviceName: device.name });
        await get().refreshInfo();
        await subscribeStatus();
        await subscribeButton();
        toast.success(`Connected to ${device.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          connectionState: device.isConnected ? "connected" : "disconnected",
          error: message,
        });
        if (!/cancelled|user gesture|chooser/i.test(message)) {
          toast.error(message);
        }
      }
    },

    disconnect() {
      if (statusUnsub) {
        try { void statusUnsub(); } catch { /* ignore */ }
        statusUnsub = null;
      }
      if (buttonUnsub) {
        try { void buttonUnsub(); } catch { /* ignore */ }
        buttonUnsub = null;
      }
      device.disconnect();
      set({ connectionState: "disconnected", characteristics: null, status: null });
      toast.info("Disconnected");
    },

    async attemptReconnect() {
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (device.isConnected) return;
        set({ connectionState: "reconnecting", reconnectAttempt: attempt });
        if (attempt === 1) toast.warning("Connection lost — reconnecting…");
        try {
          await device.connection.reconnect();
          set({ connectionState: "connected", deviceName: device.name, reconnectAttempt: 0 });
          await get().refreshInfo();
          await subscribeStatus();
          await subscribeButton();
          toast.success("Reconnected");
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
      set({ connectionState: "disconnected", reconnectAttempt: 0 });
      toast.error("Could not reconnect to the device");
    },

    async refreshInfo() {
      try {
        const [characteristics, status, deviceName] = await Promise.all([
          device.status.readDeviceCharacteristics(),
          device.status.readStatus(),
          device.status.readName().catch(() => device.name),
        ]);
        set({ characteristics, status, deviceName });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async flashLed() {
      try {
        await device.status.flashLed();
        toast.info("Flashed LED");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Flash LED failed: ${msg}`);
        set({ error: `Flash LED failed: ${msg}` });
      }
    },

    async toggleTorch() {
      const next = !get().torchOn;
      try {
        await device.status.setTorch(next);
        set({ torchOn: next });
        toast.info(next ? "Torch on" : "Torch off");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Torch failed: ${msg}`);
        set({ error: `Torch failed: ${msg}` });
      }
    },

    async setName(name: string) {
      try {
        await device.status.setName(name);
        set({ deviceName: name });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    setLastMeterReading(r: MeterReading | null) {
      set({ lastMeterReading: r });
    },
  };
});
