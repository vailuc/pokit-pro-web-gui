/**
 * Global connection/device state. Holds the single PokitDevice instance and
 * exposes connect/disconnect plus live device info & status.
 */

import { create } from "zustand";
import {
  PokitDevice,
  type DeviceCharacteristics,
  type DeviceStatus,
} from "@/pokit";

export type ConnectionState =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected";

interface DeviceState {
  device: PokitDevice;
  connectionState: ConnectionState;
  deviceName: string;
  characteristics: DeviceCharacteristics | null;
  status: DeviceStatus | null;
  torchOn: boolean;
  error: string | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  refreshInfo: () => Promise<void>;
  flashLed: () => Promise<void>;
  toggleTorch: () => Promise<void>;
  setName: (name: string) => Promise<void>;
}

const device = new PokitDevice();

export const useDeviceStore = create<DeviceState>((set, get) => {
  // Reflect unexpected disconnects in the UI.
  device.connection.onConnectionChange((connected) => {
    if (!connected) {
      set({
        connectionState: "disconnected",
        characteristics: null,
        status: null,
      });
    }
  });

  return {
    device,
    connectionState: PokitDevice.isSupported() ? "disconnected" : "unsupported",
    deviceName: "",
    characteristics: null,
    status: null,
    torchOn: false,
    error: null,

    async connect() {
      set({ connectionState: "connecting", error: null });
      try {
        await device.connect();
        set({ connectionState: "connected", deviceName: device.name });
        await get().refreshInfo();
        // Subscribe to live status updates.
        await device.status.onStatus((status) => set({ status }));
      } catch (err) {
        set({
          connectionState: device.isConnected ? "connected" : "disconnected",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    disconnect() {
      device.disconnect();
      set({ connectionState: "disconnected", characteristics: null, status: null });
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
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async toggleTorch() {
      const next = !get().torchOn;
      try {
        await device.status.setTorch(next);
        set({ torchOn: next });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
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
  };
});
