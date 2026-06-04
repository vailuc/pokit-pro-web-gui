/**
 * Base class for Pokit GATT services.
 *
 * Provides shared read/write/notify plumbing over a single primary service.
 * Subclasses implement encode/decode of their specific characteristics.
 */

import type { PokitConnection } from "./connection";

export type NotifyHandler = (value: DataView) => void;

export abstract class AbstractPokitService {
  protected service: BluetoothRemoteGATTService | null = null;
  private readonly notifying = new Map<string, BluetoothRemoteGATTCharacteristic>();

  constructor(
    protected readonly connection: PokitConnection,
    protected readonly serviceUuid: BluetoothServiceUUID,
  ) {}

  /** Resolve the underlying GATT service (cached by the connection). */
  protected async ensureService(): Promise<BluetoothRemoteGATTService> {
    if (!this.service) {
      this.service = await this.connection.getService(this.serviceUuid);
    }
    return this.service;
  }

  protected async getCharacteristic(
    uuid: BluetoothCharacteristicUUID,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    const service = await this.ensureService();
    return service.getCharacteristic(uuid);
  }

  protected async read(uuid: BluetoothCharacteristicUUID): Promise<DataView> {
    const ch = await this.getCharacteristic(uuid);
    return ch.readValue();
  }

  protected async write(
    uuid: BluetoothCharacteristicUUID,
    value: ArrayBuffer,
    withoutResponse = false,
  ): Promise<void> {
    const ch = await this.getCharacteristic(uuid);
    if (withoutResponse && ch.properties.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(value);
    } else {
      await ch.writeValueWithResponse(value);
    }
  }

  /** Subscribe to characteristic notifications; returns an unsubscribe fn. */
  protected async subscribe(
    uuid: BluetoothCharacteristicUUID,
    handler: NotifyHandler,
  ): Promise<() => Promise<void>> {
    const ch = await this.getCharacteristic(uuid);
    const listener = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) handler(target.value);
    };
    ch.addEventListener("characteristicvaluechanged", listener);
    await ch.startNotifications();
    this.notifying.set(String(uuid), ch);

    return async () => {
      ch.removeEventListener("characteristicvaluechanged", listener);
      try {
        await ch.stopNotifications();
      } catch {
        /* device may already be gone */
      }
      this.notifying.delete(String(uuid));
    };
  }
}
