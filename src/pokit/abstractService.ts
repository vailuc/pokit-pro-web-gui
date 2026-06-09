/**
 * Base class for Pokit GATT services.
 *
 * Provides shared read/write/notify plumbing over a single primary service.
 * Delegates to IPokitConnection which may be Web Bluetooth or WebSocket backend.
 * Subclasses implement encode/decode of their specific characteristics.
 */

import type { IPokitConnection } from "./connection";

export type NotifyHandler = (value: DataView) => void;

export abstract class AbstractPokitService {
  constructor(
    protected readonly connection: IPokitConnection,
    protected readonly serviceUuid: string,
  ) {}

  protected async read(charUuid: string): Promise<DataView> {
    return this.connection.readCharacteristic(this.serviceUuid, charUuid);
  }

  protected async write(
    charUuid: string,
    value: ArrayBuffer,
    withoutResponse = false,
  ): Promise<void> {
    return this.connection.writeCharacteristic(this.serviceUuid, charUuid, value, withoutResponse);
  }

  /** Subscribe to characteristic notifications; returns an unsubscribe fn. */
  protected async subscribe(
    charUuid: string,
    handler: NotifyHandler,
  ): Promise<() => Promise<void>> {
    return this.connection.subscribeCharacteristic(this.serviceUuid, charUuid, handler);
  }
}
