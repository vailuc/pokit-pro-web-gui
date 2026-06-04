/**
 * Manages the Web Bluetooth connection to a Pokit device.
 *
 * Responsible for device selection (requestDevice), GATT connect/disconnect,
 * product detection, and handing out GATT services to the per-service classes.
 */

import {
  ALL_SERVICE_UUIDS,
  StatusServiceUuids,
} from "./uuids";
import { PokitProduct } from "./types";

export class WebBluetoothUnavailableError extends Error {
  constructor() {
    super(
      "Web Bluetooth is not available. Use a Chromium-based browser (Chrome/Edge) " +
        "over HTTPS or localhost, with Bluetooth enabled.",
    );
    this.name = "WebBluetoothUnavailableError";
  }
}

export type ConnectionListener = (connected: boolean) => void;

export class PokitConnection {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private product: PokitProduct = PokitProduct.PokitPro;
  private readonly services = new Map<string, BluetoothRemoteGATTService>();
  private readonly listeners = new Set<ConnectionListener>();

  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  get isConnected(): boolean {
    return !!this.server?.connected;
  }

  get deviceName(): string {
    return this.device?.name ?? "Unknown";
  }

  get pokitProduct(): PokitProduct {
    return this.product;
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(connected: boolean): void {
    for (const l of this.listeners) l(connected);
  }

  /** Prompt the user to select a Pokit device and connect to its GATT server. */
  async requestAndConnect(): Promise<void> {
    if (!PokitConnection.isAvailable()) {
      throw new WebBluetoothUnavailableError();
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [StatusServiceUuids.pokitPro] },
        { services: [StatusServiceUuids.pokitMeter] },
        { namePrefix: "Pokit" },
      ],
      optionalServices: ALL_SERVICE_UUIDS,
    });

    this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    await this.connectServer();
  }

  private handleDisconnect = (): void => {
    this.server = null;
    this.services.clear();
    this.emit(false);
  };

  private async connectServer(): Promise<void> {
    if (!this.device?.gatt) throw new Error("No GATT interface on device.");
    this.server = await this.device.gatt.connect();
    await this.discoverProduct();
    this.emit(true);
  }

  private async discoverProduct(): Promise<void> {
    // Identify product by which status service is present.
    try {
      await this.getService(StatusServiceUuids.pokitPro);
      this.product = PokitProduct.PokitPro;
      return;
    } catch {
      /* not a Pro */
    }
    try {
      await this.getService(StatusServiceUuids.pokitMeter);
      this.product = PokitProduct.PokitMeter;
    } catch {
      this.product = PokitProduct.PokitPro; // sensible default
    }
  }

  /** Lazily fetch (and cache) a primary GATT service. */
  async getService(uuid: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService> {
    const key = String(uuid);
    const cached = this.services.get(key);
    if (cached) return cached;
    if (!this.server) throw new Error("Not connected.");
    const service = await this.server.getPrimaryService(uuid);
    this.services.set(key, service);
    return service;
  }

  /** The active Pokit Status service UUID for the connected product. */
  get statusServiceUuid(): string {
    return this.product === PokitProduct.PokitPro
      ? StatusServiceUuids.pokitPro
      : StatusServiceUuids.pokitMeter;
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }
}
