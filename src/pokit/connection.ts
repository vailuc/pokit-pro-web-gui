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

/** Shared contract implemented by both Web Bluetooth and WebSocket backends. */
export interface IPokitConnection {
  isConnected: boolean;
  deviceName: string;
  pokitProduct: PokitProduct;
  generation: number;
  wasIntentionalDisconnect: boolean;
  canReconnect: boolean;
  /** Status service UUID for the connected product (Pro vs Meter). */
  statusServiceUuid: string;

  requestAndConnect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): void;
  onConnectionChange(listener: (connected: boolean) => void): () => void;

  // GATT proxy methods (service + characteristic UUID required)
  readCharacteristic(serviceUuid: string, charUuid: string): Promise<DataView>;
  writeCharacteristic(serviceUuid: string, charUuid: string, value: ArrayBuffer, withoutResponse?: boolean): Promise<void>;
  subscribeCharacteristic(
    serviceUuid: string,
    charUuid: string,
    handler: (value: DataView) => void,
  ): Promise<() => Promise<void>>;
}

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
  /** Bumped on every successful (re)connect so services can drop stale handles. */
  private _generation = 0;
  /** True while a user-requested disconnect is in progress (suppresses reconnect). */
  private _intentionalDisconnect = false;

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

  /** Increments on each successful connect; used to invalidate cached services. */
  get generation(): number {
    return this._generation;
  }

  /** Whether the most recent disconnect was user-initiated. */
  get wasIntentionalDisconnect(): boolean {
    return this._intentionalDisconnect;
  }

  /** Whether we have a previously-selected device we can silently reconnect to. */
  get canReconnect(): boolean {
    return !!this.device?.gatt;
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
    this._generation += 1;
    this.services.clear();
    await this.discoverProduct();
    this.emit(true);
  }

  /** Reconnect to the already-selected device without re-prompting the user. */
  async reconnect(): Promise<void> {
    if (!this.device?.gatt) throw new Error("No device to reconnect to.");
    this._intentionalDisconnect = false;
    await this.connectServer();
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

  // ── GATT proxy methods (used by AbstractPokitService) ─────────────────
  /** Read a characteristic value. */
  async readCharacteristic(serviceUuid: string, charUuid: string): Promise<DataView> {
    const service = await this.getService(serviceUuid);
    const ch = await service.getCharacteristic(charUuid);
    return ch.readValue();
  }

  /** Write a characteristic value. */
  async writeCharacteristic(
    serviceUuid: string,
    charUuid: string,
    value: ArrayBuffer,
    withoutResponse = false,
  ): Promise<void> {
    const service = await this.getService(serviceUuid);
    const ch = await service.getCharacteristic(charUuid);
    if (withoutResponse && ch.properties.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(value);
    } else {
      await ch.writeValueWithResponse(value);
    }
  }

  /** Subscribe to characteristic notifications. */
  async subscribeCharacteristic(
    serviceUuid: string,
    charUuid: string,
    handler: (value: DataView) => void,
  ): Promise<() => Promise<void>> {
    const service = await this.getService(serviceUuid);
    const ch = await service.getCharacteristic(charUuid);

    const listener = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) handler(target.value);
    };

    ch.addEventListener("characteristicvaluechanged", listener);
    await ch.startNotifications();

    return async () => {
      ch.removeEventListener("characteristicvaluechanged", listener);
      try {
        await ch.stopNotifications();
      } catch {
        /* device may already be gone */
      }
    };
  }

  disconnect(): void {
    this._intentionalDisconnect = true;
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }
}
