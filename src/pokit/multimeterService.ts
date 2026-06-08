/**
 * Pokit `Multimeter` service: configure mode/range and stream live readings.
 *
 * Settings characteristic (write, 6 bytes LE): mode(u8) range(u8) interval(u32 ms).
 * Reading characteristic (read/notify, 7 bytes): status(u8) value(f32) mode(u8) range(u8).
 */

import { AbstractPokitService } from "./abstractService";
import { ByteReader, ByteWriter } from "./codec";
import type { PokitConnection } from "./connection";
import { MultimeterServiceUuids } from "./uuids";
import {
  MeterMode,
  MeterStatus,
  type MeterReading,
} from "./types";

export interface MultimeterSettings {
  mode: MeterMode;
  range: number;
  updateIntervalMs: number;
}

export class MultimeterService extends AbstractPokitService {
  constructor(connection: PokitConnection) {
    super(connection, MultimeterServiceUuids.service);
  }

  private get chars() {
    return MultimeterServiceUuids.characteristics;
  }

  static encodeSettings(s: MultimeterSettings): ArrayBuffer {
    return new ByteWriter()
      .u8(s.mode)
      .u8(s.range)
      .u32(s.updateIntervalMs)
      .toBuffer();
  }

  static parseReading(view: DataView): MeterReading {
    // status(1) + value(4) + mode(1) + range(1) = 7 bytes
    if (view.byteLength < 7) {
      throw new Error(`Meter reading too short: ${view.byteLength} bytes (need >= 7)`);
    }
    const r = new ByteReader(view);
    return {
      status: r.u8() as MeterStatus,
      value: r.f32(),
      mode: r.u8() as MeterMode,
      range: r.u8(),
    };
  }

  /** Write the desired mode/range/update interval. */
  async setSettings(settings: MultimeterSettings): Promise<void> {
    await this.write(this.chars.settings, MultimeterService.encodeSettings(settings));
  }

  /** One-shot read of the current reading. */
  async readReading(): Promise<MeterReading> {
    const view = await this.read(this.chars.reading);
    return MultimeterService.parseReading(view);
  }

  /** Subscribe to live readings. Returns unsubscribe fn. */
  async onReading(handler: (reading: MeterReading) => void): Promise<() => Promise<void>> {
    return this.subscribe(this.chars.reading, (view) =>
      handler(MultimeterService.parseReading(view)),
    );
  }
}
