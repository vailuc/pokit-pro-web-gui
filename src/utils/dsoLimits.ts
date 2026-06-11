/**
 * DSO Window Time Limits with color-coded performance indicators.
 * 
 * Web Bluetooth has notification batching delays (~135-150ms in Chromium),
 * which limits practical minimum window times.
 */

export interface WindowTimeOption {
  value: number;
  label: string;
  colorClass: string;
  description: string;
}

/**
 * Get color-coded window time options based on connection mode.
 * 
 * Colors indicate expected performance:
 * - 🔴 red (< 20ms): Likely Limited — may drop packets in Web Bluetooth
 * - 🟠 orange (20-35ms): Reduced Performance — approaching limits
 * - 🟡 amber (35-50ms): Generally Usable — acceptable for most use cases
 * - 🟢 green (≥ 50ms): Recommended — optimal performance
 */
export function getWindowTimeOptions(useBridge: boolean): WindowTimeOption[] {
  if (useBridge) {
    // Python bridge has lower practical minimums
    return [
      { value: 2, label: "2 ms", colorClass: "text-orange-400", description: "Fastest" },
      { value: 5, label: "5 ms", colorClass: "text-green-400", description: "Very fast" },
      { value: 10, label: "10 ms", colorClass: "text-green-400", description: "Fast" },
      { value: 20, label: "20 ms", colorClass: "text-green-400", description: "Good" },
      { value: 50, label: "50 ms 🌐", colorClass: "text-green-400", description: "Optimal" },
      { value: 100, label: "100 ms", colorClass: "text-green-400", description: "Standard" },
      { value: 200, label: "200 ms", colorClass: "text-green-400", description: "Long" },
    ];
  }

  // Web Bluetooth has higher practical minimums due to notification batching
  return [
    { value: 10, label: "10 ms 🔴", colorClass: "text-red-400", description: "Likely Limited" },
    { value: 20, label: "20 ms 🔴", colorClass: "text-red-400", description: "Likely Limited" },
    { value: 35, label: "35 ms ⚡", colorClass: "text-amber-400", description: "Reduced Performance" },
    { value: 50, label: "50 ms 🌐", colorClass: "text-green-400", description: "Generally Usable" },
    { value: 100, label: "100 ms", colorClass: "text-green-400", description: "Recommended" },
    { value: 200, label: "200 ms", colorClass: "text-green-400", description: "Recommended" },
  ];
}

/**
 * Get just the label with color indicator for the dropdown.
 * Used for the Select component which expects { value, label }.
 */
export function getWindowTimeSelectOptions(useBridge: boolean): { value: string; label: string }[] {
  return getWindowTimeOptions(useBridge).map((opt) => ({
    value: String(opt.value),
    label: opt.label,
  }));
}

/**
 * Get a human-readable description of the expected performance
 * for a given window time in Web Bluetooth mode.
 */
export function getWebBluetoothPerformanceDescription(windowMs: number): string {
  if (windowMs < 20) return "Likely Limited — notifications may be batched causing gaps";
  if (windowMs < 35) return "Reduced Performance — approaching Web Bluetooth limits";
  if (windowMs < 50) return "Generally Usable — acceptable for most applications";
  return "Recommended — optimal capture rate";
}
