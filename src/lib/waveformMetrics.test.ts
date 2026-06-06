import { describe, it, expect } from "vitest";
import { computeMetrics } from "./waveformMetrics";

describe("computeMetrics", () => {
  it("returns all zeros for an empty array", () => {
    const m = computeMetrics([], 1000);
    expect(m).toEqual({
      min: 0,
      max: 0,
      peakToPeak: 0,
      mean: 0,
      rms: 0,
      frequency: 0,
      period: 0,
      dutyCycle: 0,
    });
  });

  it("handles a single-point constant signal", () => {
    const m = computeMetrics([5], 1000);
    expect(m.min).toBe(5);
    expect(m.max).toBe(5);
    expect(m.peakToPeak).toBe(0);
    expect(m.mean).toBe(5);
    expect(m.rms).toBeCloseTo(5);
    expect(m.frequency).toBe(0);
    expect(m.period).toBe(0);
  });

  it("computes correct stats for a flat line", () => {
    const m = computeMetrics([3, 3, 3, 3], 1000);
    expect(m.min).toBe(3);
    expect(m.max).toBe(3);
    expect(m.mean).toBe(3);
    expect(m.rms).toBeCloseTo(3);
    expect(m.frequency).toBe(0); // no crossings on flat line
  });

  it("detects frequency for a simple sine wave", () => {
    const sr = 10000; // 10 kHz sample rate
    const freq = 500; // 500 Hz signal
    const samples = 200;
    const values = Array.from({ length: samples }, (_, i) =>
      Math.sin((2 * Math.PI * freq * i) / sr),
    );
    const m = computeMetrics(values, sr);
    expect(m.frequency).toBeGreaterThan(0);
    expect(m.frequency).toBeCloseTo(freq, -1); // within ~10%
    expect(m.period).toBeCloseTo(1 / freq, -1);
    expect(m.peakToPeak).toBeCloseTo(2, 1);
  });

  it("computes ~50 % duty cycle for a square wave", () => {
    const sr = 1000;
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(i % 20 < 10 ? 5 : -5);
    }
    const m = computeMetrics(values, sr);
    expect(m.dutyCycle).toBeCloseTo(0.5, 1);
    expect(m.mean).toBeCloseTo(0, 1);
  });

  it("computes correct RMS for a DC offset sine", () => {
    const sr = 1000;
    const values = Array.from({ length: 1000 }, (_, i) =>
      2 + Math.sin((2 * Math.PI * 10 * i) / sr),
    );
    const m = computeMetrics(values, sr);
    // mean should be ~2 (the DC offset)
    expect(m.mean).toBeCloseTo(2, 0);
    // RMS of DC+sin should be sqrt(DC^2 + 0.5) ≈ sqrt(4.5) ≈ 2.12
    expect(m.rms).toBeCloseTo(Math.sqrt(4.5), 1);
  });
});
