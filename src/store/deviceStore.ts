/**
 * Global connection/device state. Holds the single PokitDevice instance and
 * exposes connect/disconnect plus live device info & status.
 * Supports runtime switching between Web Bluetooth and Python BLE bridge.
 */

import { create } from "zustand";
import {
  PokitDevice,
  PokitConnection,
  WebSocketPokitConnection,
  type DeviceCharacteristics,
  type DeviceStatus,
  type MeterReading,
} from "@/pokit";
import { toast } from "./toastStore";
import { saveHistory } from "./historyStore";

const MAX_RECONNECT_ATTEMPTS = 5;
const BRIDGE_KEY = "pokit-use-bridge";

export type ConnectionState =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "scanning"
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
  useBridge: boolean;
  reconnectAttempt: number;
  autoFollowSwitch: boolean;
  manualOverride: boolean;

  connect: () => Promise<void>;
  disconnect: () => void;
  attemptReconnect: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  flashLed: () => Promise<void>;
  toggleTorch: () => Promise<void>;
  setName: (name: string) => Promise<void>;
  setLastMeterReading: (r: MeterReading | null) => void;
  setUseBridge: (enabled: boolean) => void;
  setAutoFollowSwitch: (enabled: boolean) => void;
  setManualOverride: (enabled: boolean) => void;
}

function createDevice(preferBridge: boolean): PokitDevice {
  if (preferBridge && WebSocketPokitConnection.isAvailable()) {
    return new PokitDevice(new WebSocketPokitConnection());
  }
  return new PokitDevice();
}

function isBackendAvailable(useBridge: boolean): boolean {
  if (useBridge) {
    return WebSocketPokitConnection.isAvailable();
  }
  return PokitConnection.isAvailable();
}

function initialState() {
  const useBridge = localStorage.getItem(BRIDGE_KEY) === "true";
  const device = createDevice(useBridge);
  return {
    device,
    connectionState: (isBackendAvailable(useBridge) ? "disconnected" : "unsupported") as ConnectionState,
    deviceName: "",
    characteristics: null,
    status: null,
    torchOn: false,
    error: null,
    lastMeterReading: null,
    useBridge,
    reconnectAttempt: 0,
    autoFollowSwitch: true,
    manualOverride: false,
  };
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  let state = initialState();
  let statusUnsub: (() => Promise<void>) | null = null;
  let buttonUnsub: (() => Promise<void>) | null = null;
  let statusPollInterval: ReturnType<typeof setInterval> | null = null;
  let lastStatusNotifyAt = 0;

  function attachListeners(device: PokitDevice) {
    device.connection.onConnectionChange((connected) => {
      if (connected) return;
      if (statusUnsub) { try { void statusUnsub(); } catch { /* ignore */ } statusUnsub = null; }
      if (buttonUnsub) { try { void buttonUnsub(); } catch { /* ignore */ } buttonUnsub = null; }
      if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; }
      lastStatusNotifyAt = 0;
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
  }

  attachListeners(state.device);

  const subscribeStatus = async (device: PokitDevice) => {
    if (statusUnsub) {
      try { await statusUnsub(); } catch { /* device may be gone */ }
      statusUnsub = null;
    }
    try {
      statusUnsub = await device.status.onStatus((status) => {
        lastStatusNotifyAt = Date.now();
        console.log(`[Status] Notification: code=${status.status} at ${new Date().toISOString().slice(11, 23)}`);
        set({ status });
      });
    } catch (e) {
      console.warn("[DeviceStore] Status notify subscription failed:", e);
    }
  };

  const startStatusPoll = (device: PokitDevice) => {
    if (statusPollInterval) clearInterval(statusPollInterval);
    statusPollInterval = setInterval(async () => {
      if (!device.isConnected) return;
      // Skip poll if we got a notification in the last 3 seconds.
      if (Date.now() - lastStatusNotifyAt < 3000) return;
      console.log(`[Status] Polling (last notify ${Date.now() - lastStatusNotifyAt}ms ago)`);
      try {
        const status = await device.status.readStatus();
        console.log(`[Status] Poll result: code=${status.status}`);
        const current = get().status;
        if (!current || current.status !== status.status || current.batteryVoltage !== status.batteryVoltage) {
          set({ status });
        }
      } catch (e) {
        console.warn("[Status] Poll failed:", e);
      }
    }, 2000);
  };

  const subscribeButton = async (device: PokitDevice) => {
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
    ...state,

    async connect() {
      const { device, useBridge } = get();
      set({ connectionState: "connecting", error: null, reconnectAttempt: 0 });
      if (useBridge) {
        toast.info("Scanning for Pokit devices (6s)...", 6000);
      }
      try {
        await device.connect();
        set({ connectionState: "connected", deviceName: device.name });
        await get().refreshInfo();
        await subscribeStatus(device);
        startStatusPoll(device);
        await subscribeButton(device);
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
      const { device } = get();
      if (statusUnsub) {
        try { void statusUnsub(); } catch { /* ignore */ }
        statusUnsub = null;
      }
      if (buttonUnsub) {
        try { void buttonUnsub(); } catch { /* ignore */ }
        buttonUnsub = null;
      }
      if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
      }
      device.disconnect();
      set({ connectionState: "disconnected", characteristics: null, status: null });
      toast.info("Disconnected");
    },

    async attemptReconnect() {
      const { device } = get();
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (device.isConnected) return;
        set({ connectionState: "reconnecting", reconnectAttempt: attempt });
        if (attempt === 1) toast.warning("Connection lost — reconnecting…");
        try {
          await device.connection.reconnect();
          set({ connectionState: "connected", deviceName: device.name, reconnectAttempt: 0 });
          await get().refreshInfo();
          await subscribeStatus(device);
          startStatusPoll(device);
          await subscribeButton(device);
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
      const { device } = get();
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
      const { device } = get();
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
      const { device } = get();
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
      const { device } = get();
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

    setAutoFollowSwitch(enabled: boolean) {
      set({ autoFollowSwitch: enabled });
    },

    setManualOverride(enabled: boolean) {
      set({ manualOverride: enabled });
    },

    setUseBridge(enabled: boolean) {
      const { device: oldDevice } = get();
      if (oldDevice.isConnected) {
        toast.warning("Disconnect before switching backends");
        return;
      }
      // Stop any pending reconnects on the old device
      oldDevice.disconnect();
      localStorage.setItem(BRIDGE_KEY, String(enabled));
      const device = createDevice(enabled);
      attachListeners(device);
      const newState: ConnectionState = isBackendAvailable(enabled) ? "disconnected" : "unsupported";
      set({ device, useBridge: enabled, connectionState: newState });
      toast.info(enabled ? "Python bridge enabled" : "Web Bluetooth enabled");
    },
  };
});
