/**
 * Pokit `DataLogger` service: long-duration sampling at a fixed interval.
 *
 * Settings (write): command(u8) arguments(u16) mode(u8) range(u8)
 *                   updateInterval(u32 ms) timestamp(u32 epoch).
 * Metadata (read/notify): status(u8) scale(f32) mode(u8) range(u8)
 *                   updateInterval(u32) numberOfSamples(u16) timestamp(u32).
 * Reading (notify): stream of int16 samples; value = sample * scale.
 */

import { AbstractPokitService } from "./abstractService";
import { ByteReader, ByteWriter } from "./codec";
import type { PokitConnection } from "./connection";
import { LoggerServiceUuids } from "./uuids";
import {
  LoggerCommand,
  LoggerStatus,
  MeterMode,
  type LoggerMetadata,
} from "./types";

export interface LoggerSettings {
  command: LoggerCommand;
  arguments: number;
  mode: MeterMode;
  range: number;
  updateIntervalMs: number;
  timestamp: number;
}

export class LoggerService extends AbstractPokitService {
  constructor(connection: PokitConnection) {
    super(connection, LoggerServiceUuids.service);
  }

  private get chars() {
    return LoggerServiceUuids.characteristics;
  }

  static encodeSettings(s: LoggerSettings): ArrayBuffer {
    return new ByteWriter()
      .u8(s.command)
      .u16(s.arguments)
      .u8(s.mode)
      .u8(s.range)
      .u32(s.updateIntervalMs)
      .u32(s.timestamp)
      .toBuffer();
  }

  static parseMetadata(view: DataView): LoggerMetadata {
    // status(1) + scale(4) + mode(1) + range(1) + interval(4) + samples(2) + timestamp(4) = 17 bytes
    if (view.byteLength < 17) {
      throw new Error(`Logger metadata too short: ${view.byteLength} bytes (need >= 17)`);
    }
    const r = new ByteReader(view);
    return {
      status: r.u8() as LoggerStatus,
      scale: r.f32(),
      mode: r.u8() as MeterMode,
      range: r.u8(),
      updateIntervalMs: r.u32(),
      numberOfSamples: r.u16(),
      timestamp: r.u32(),
    };
  }

  static parseSamples(view: DataView): number[] {
    const r = new ByteReader(view);
    const out: number[] = [];
    while (r.remaining >= 2) out.push(r.i16());
    return out;
  }

  /** Start logging. Defaults timestamp to now (seconds). */
  async startLogger(
    settings: Omit<LoggerSettings, "command" | "arguments" | "timestamp"> &
      Partial<Pick<LoggerSettings, "timestamp">>,
  ): Promise<void> {
    const full: LoggerSettings = {
      command: LoggerCommand.Start,
      arguments: 0,
      timestamp: settings.timestamp ?? Math.floor(Date.now() / 1000),
      mode: settings.mode,
      range: settings.range,
      updateIntervalMs: settings.updateIntervalMs,
    };
    await this.write(this.chars.settings, LoggerService.encodeSettings(full));
  }

  async stopLogger(): Promise<void> {
    const stop: LoggerSettings = {
      command: LoggerCommand.Stop,
      arguments: 0,
      mode: MeterMode.Idle,
      range: 0,
      updateIntervalMs: 0,
      timestamp: 0,
    };
    await this.write(this.chars.settings, LoggerService.encodeSettings(stop));
  }

  /**
   * Request the device to download its buffered log. The Pokit records samples
   * to internal memory; sending Refresh causes it to emit a Metadata update
   * followed by a stream of Reading notifications with the stored samples.
   */
  async refreshData(): Promise<void> {
    const refresh: LoggerSettings = {
      command: LoggerCommand.Refresh,
      arguments: 0,
      mode: MeterMode.Idle,
      range: 0,
      updateIntervalMs: 0,
      timestamp: 0,
    };
    await this.write(this.chars.settings, LoggerService.encodeSettings(refresh));
  }

  async readMetadata(): Promise<LoggerMetadata> {
    const view = await this.read(this.chars.metadata);
    return LoggerService.parseMetadata(view);
  }

  async onMetadata(handler: (meta: LoggerMetadata) => void): Promise<() => Promise<void>> {
    return this.subscribe(this.chars.metadata, (view) =>
      handler(LoggerService.parseMetadata(view)),
    );
  }

  async onSamples(handler: (samples: number[]) => void): Promise<() => Promise<void>> {
    return this.subscribe(this.chars.reading, (view) =>
      handler(LoggerService.parseSamples(view)),
    );
  }
}
