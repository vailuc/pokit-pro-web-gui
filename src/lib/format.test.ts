import { describe, it, expect } from "vitest";
import { formatSi, batteryPercent } from "../pokit/format";

describe("formatSi", () => {
  it("formats zero without prefix", () => {
    expect(formatSi(0, "V")).toBe("0 V");
  });

  it("formats a simple positive value", () => {
    expect(formatSi(3.3, "V")).toBe("3.3 V");
  });

  it("formats millivolts", () => {
    expect(formatSi(0.005, "V")).toBe("5 mV");
  });

  it("formats kilovolts", () => {
    expect(formatSi(2500, "V")).toBe("2.5 kV");
  });

  it("formats megavolts", () => {
    expect(formatSi(3_000_000, "V")).toBe("3 MV");
  });

  it("formats microamps", () => {
    expect(formatSi(0.000_005, "A")).toBe("5 µA");
  });

  it("formats nanoamps", () => {
    expect(formatSi(5e-9, "A")).toBe("5 nA");
  });

  it("handles negative values", () => {
    expect(formatSi(-0.005, "V")).toBe("-5 mV");
  });

  it("shows -- for non-finite values", () => {
    expect(formatSi(NaN, "V")).toBe("-- V");
    expect(formatSi(Infinity, "V")).toBe("-- V");
    expect(formatSi(-Infinity, "A")).toBe("-- A");
  });

  it("trims unit when empty string", () => {
    expect(formatSi(42, "")).toBe("42");
  });
});

describe("batteryPercent", () => {
  it("returns 0 % below 3.0 V", () => {
    expect(batteryPercent(2.8)).toBe(0);
  });

  it("returns 100 % at 4.2 V", () => {
    expect(batteryPercent(4.2)).toBe(100);
  });

  it("returns 50 % at midpoint", () => {
    expect(batteryPercent(3.6)).toBe(50);
  });

  it("clamps above 4.2 V", () => {
    expect(batteryPercent(4.5)).toBe(100);
  });
});
