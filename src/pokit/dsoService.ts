/**
 * Pokit `DSO` (digital storage oscilloscope) service.
 *
 * Flow: write Settings (start acquisition) -> read/notify Metadata (scale, count,
 * rate) -> notify Reading (stream of int16 samples). Real volts/amps = sample * scale.
 *
 * Settings (write): command(u8) triggerLevel(f32) mode(u8) range(u8)
 *                   samplingWindow(u32 µs) numberOfSamples(u16).
 * Metadata (read/notify): status(u8) scale(f32) mode(u8) range(u8)
 *                   samplingWindow(u32) numberOfSamples(u16) samplingRate(u32).
 */

import { AbstractPokitService } from "./abstractService";
import { ByteReader, ByteWriter } from "./codec";
import type { IPokitConnection } from "./connection";
import { DsoServiceUuids } from "./uuids";
import {
  DsoCommand,
  DsoStatus,
  MeterMode,
  type DsoMetadata,
} from "./types";

export interface DsoSettings {
  command: DsoCommand;
  triggerLevel: number;
  mode: MeterMode;
  range: number;
  samplingWindowUs: number;
  numberOfSamples: number;
}

export class DsoService extends AbstractPokitService {
  constructor(connection: IPokitConnection) {
    super(connection, DsoServiceUuids.service);
  }

  private get chars() {
    return DsoServiceUuids.characteristics;
  }

  static encodeSettings(s: DsoSettings): ArrayBuffer {
    return new ByteWriter()
      .u8(s.command)
      .f32(s.triggerLevel)
      .u8(s.mode)
      .u8(s.range)
      .u32(s.samplingWindowUs)
      .u16(s.numberOfSamples)
      .toBuffer();
  }

  static parseMetadata(view: DataView): DsoMetadata {
    // status(1) + scale(4) + mode(1) + range(1) + window(4) + samples(2) + rate(4) = 17 bytes
    if (view.byteLength < 17) {
      throw new Error(`DSO metadata too short: ${view.byteLength} bytes (need >= 17)`);
    }
    const r = new ByteReader(view);
    return {
      status: r.u8() as DsoStatus,
      scale: r.f32(),
      mode: r.u8() as MeterMode,
      range: r.u8(),
      samplingWindowUs: r.u32(),
      numberOfSamples: r.u16(),
      samplingRate: r.u32(),
    };
  }

  /** Parse a Reading notification into raw int16 samples. */
  static parseSamples(view: DataView): number[] {
    const r = new ByteReader(view);
    const out: number[] = [];
    while (r.remaining >= 2) out.push(r.i16());
    return out;
  }

  async setSettings(settings: DsoSettings): Promise<void> {
    await this.write(this.chars.settings, DsoService.encodeSettings(settings));
  }

  /** Begin a capture with the given settings. */
  async startDso(settings: DsoSettings): Promise<void> {
    await this.setSettings(settings);
  }

  async readMetadata(): Promise<DsoMetadata> {
    const view = await this.read(this.chars.metadata);
    return DsoService.parseMetadata(view);
  }

  async onMetadata(handler: (meta: DsoMetadata) => void): Promise<() => Promise<void>> {
    return this.subscribe(this.chars.metadata, (view) =>
      handler(DsoService.parseMetadata(view)),
    );
  }

  /** Subscribe to raw sample packets (caller reassembles up to numberOfSamples). */
  async onSamples(handler: (samples: number[]) => void): Promise<() => Promise<void>> {
    return this.subscribe(this.chars.reading, (view) =>
      handler(DsoService.parseSamples(view)),
    );
  }
}

/**
 * Accumulates streamed int16 sample packets until the expected count is reached,
 * applying the metadata scale to yield real measurement values.
 */
export class DsoCaptureBuffer {
  private raw: number[] = [];

  constructor(private expected: number, private scale: number) {}

  reset(expected: number, scale: number): void {
    this.raw = [];
    this.expected = expected;
    this.scale = scale;
  }

  /** Update scale/expected without clearing accumulated samples (for hidden continuous). */
  updateScale(expected: number, scale: number): void {
    this.expected = expected;
    this.scale = scale;
  }

  push(samples: number[]): void {
    for (let i = 0; i < samples.length && this.raw.length < this.expected; i++) this.raw.push(samples[i]);
  }

  get isComplete(): boolean {
    return this.raw.length >= this.expected;
  }

  get count(): number {
    return this.raw.length;
  }

  /** Remove oldest samples, keeping only the last N. For continuous mode. */
  trim(keep: number): void {
    if (this.raw.length > keep) {
      this.raw = this.raw.slice(-keep);
    }
  }

  /** Scaled values (volts/amps). */
  values(): number[] {
    return this.raw.slice(0, this.expected).map((s) => s * this.scale);
  }
}
