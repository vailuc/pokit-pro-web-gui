/**
 * SI-prefix value formatting for measurement readouts.
 */

const PREFIXES: { factor: number; symbol: string }[] = [
  { factor: 1e9, symbol: "G" },
  { factor: 1e6, symbol: "M" },
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
  { factor: 1e-12, symbol: "p" },
];

/** Format a value with an automatic SI prefix and unit, e.g. 3.300 V. */
export function formatSi(value: number, unit: string, sigFigs = 4): string {
  if (!Number.isFinite(value)) return `-- ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();

  const abs = Math.abs(value);
  let chosen = PREFIXES[PREFIXES.length - 1];
  for (const p of PREFIXES) {
    if (abs >= p.factor) {
      chosen = p;
      break;
    }
  }
  const scaled = value / chosen.factor;
  const text = scaled.toPrecision(sigFigs);
  // Trim trailing zeros but keep at least one decimal place readability.
  const trimmed = parseFloat(text).toString();
  return `${trimmed} ${chosen.symbol}${unit}`.trim();
}

/** Format a battery voltage as a rough percentage label (Li-ion 3.0–4.2V). */
export function batteryPercent(voltage: number): number {
  const pct = ((voltage - 3.0) / (4.2 - 3.0)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
