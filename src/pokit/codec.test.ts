import { describe, it, expect } from "vitest";
import { ByteReader, ByteWriter, formatMac } from "./codec";
import { MultimeterService } from "./multimeterService";
import { DsoService } from "./dsoService";
import { LoggerService } from "./loggerService";
import {
  DsoCommand,
  LoggerCommand,
  MeterMode,
  MeterStatus,
} from "./types";

const u8 = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf));

describe("ByteWriter / ByteReader", () => {
  it("round-trips little-endian primitives", () => {
    const buf = new ByteWriter().u8(0x12).u16(0x3456).u32(0x789abcde).toBuffer();
    expect(u8(buf)).toEqual([0x12, 0x56, 0x34, 0xde, 0xbc, 0x9a, 0x78]);

    const r = new ByteReader(buf);
    expect(r.u8()).toBe(0x12);
    expect(r.u16()).toBe(0x3456);
    expect(r.u32()).toBe(0x789abcde);
  });

  it("encodes float32 little-endian", () => {
    const buf = new ByteWriter().f32(1.0).toBuffer();
    expect(u8(buf)).toEqual([0x00, 0x00, 0x80, 0x3f]);
    expect(new ByteReader(buf).f32()).toBeCloseTo(1.0);
  });

  it("formats MAC addresses in reversed display order", () => {
    const mac = formatMac(new Uint8Array([0xa8, 0x03, 0x2c, 0x14, 0x2e, 0x84]));
    expect(mac).toBe("84:2E:14:2C:03:A8");
  });
});

describe("MultimeterService settings/reading", () => {
  it("encodes settings as 6 LE bytes (mode, range, interval)", () => {
    const buf = MultimeterService.encodeSettings({
      mode: MeterMode.DcVoltage,
      range: 2,
      updateIntervalMs: 1000,
    });
    expect(u8(buf)).toEqual([1, 2, 0xe8, 0x03, 0x00, 0x00]);
  });

  it("parses a 7-byte reading", () => {
    const buf = new ByteWriter()
      .u8(MeterStatus.AutoRangeOn)
      .f32(3.3)
      .u8(MeterMode.DcVoltage)
      .u8(2)
      .toBuffer();
    const reading = MultimeterService.parseReading(new DataView(buf));
    expect(reading.status).toBe(MeterStatus.AutoRangeOn);
    expect(reading.value).toBeCloseTo(3.3);
    expect(reading.mode).toBe(MeterMode.DcVoltage);
    expect(reading.range).toBe(2);
  });
});

describe("DsoService", () => {
  it("encodes settings in declared field order", () => {
    const buf = DsoService.encodeSettings({
      command: DsoCommand.RisingEdgeTrigger,
      triggerLevel: 1.5,
      mode: MeterMode.DcVoltage,
      range: 2,
      samplingWindowUs: 10000,
      numberOfSamples: 1024,
    });
    const bytes = u8(buf);
    expect(bytes[0]).toBe(DsoCommand.RisingEdgeTrigger);
    // 12 bytes total: 1 + 4 + 1 + 1 + 4 + 2 = 13
    expect(bytes.length).toBe(13);
  });

  it("parses int16 sample packets", () => {
    const buf = new ByteWriter().u16(0x0001).u16(0xffff).toBuffer();
    const samples = DsoService.parseSamples(new DataView(buf));
    expect(samples).toEqual([1, -1]);
  });
});

describe("LoggerService", () => {
  it("encodes settings (13 bytes)", () => {
    const buf = LoggerService.encodeSettings({
      command: LoggerCommand.Start,
      arguments: 0,
      mode: MeterMode.DcVoltage,
      range: 2,
      updateIntervalMs: 1000,
      timestamp: 0,
    });
    expect(u8(buf).length).toBe(13);
    expect(u8(buf)[0]).toBe(LoggerCommand.Start);
  });
});

describe("ByteReader bounds checking", () => {
  it("throws on u8 overflow", () => {
    const r = new ByteReader(new ArrayBuffer(0));
    expect(() => r.u8()).toThrow("ByteReader overflow");
  });

  it("throws on u16 overflow", () => {
    const r = new ByteReader(new ArrayBuffer(1));
    expect(() => r.u16()).toThrow("ByteReader overflow");
  });

  it("throws on u32 overflow", () => {
    const r = new ByteReader(new ArrayBuffer(3));
    expect(() => r.u32()).toThrow("ByteReader overflow");
  });

  it("throws on i16 overflow", () => {
    const r = new ByteReader(new ArrayBuffer(1));
    expect(() => r.i16()).toThrow("ByteReader overflow");
  });

  it("throws on f32 overflow", () => {
    const r = new ByteReader(new ArrayBuffer(3));
    expect(() => r.f32()).toThrow("ByteReader overflow");
  });

  it("throws on bytes() overflow", () => {
    const r = new ByteReader(new ArrayBuffer(2));
    expect(() => r.bytes(3)).toThrow("ByteReader overflow");
  });

  it("throws on skip() overflow", () => {
    const r = new ByteReader(new ArrayBuffer(2));
    expect(() => r.skip(3)).toThrow("ByteReader overflow");
  });

  it("does not throw when reading exactly to boundary", () => {
    const buf = new ByteWriter().u8(1).u16(2).u32(3).toBuffer();
    const r = new ByteReader(buf);
    expect(() => { r.u8(); r.u16(); r.u32(); }).not.toThrow();
    expect(r.remaining).toBe(0);
  });
});

describe("Parser length guards", () => {
  it("DsoService.parseMetadata throws on short packet", () => {
    expect(() => DsoService.parseMetadata(new DataView(new ArrayBuffer(16))))
      .toThrow("DSO metadata too short");
  });

  it("MultimeterService.parseReading throws on short packet", () => {
    expect(() => MultimeterService.parseReading(new DataView(new ArrayBuffer(6))))
      .toThrow("Meter reading too short");
  });

  it("LoggerService.parseMetadata throws on short packet", () => {
    expect(() => LoggerService.parseMetadata(new DataView(new ArrayBuffer(16))))
      .toThrow("Logger metadata too short");
  });
});
