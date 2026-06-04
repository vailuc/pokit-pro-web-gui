/**
 * IndexedDB-based measurement history store.
 * Persists saved multimeter readings, oscilloscope captures, and logger sessions.
 */

import { get, set, del, keys, createStore } from "idb-keyval";

export type HistoryType = "meter" | "scope" | "logger";

export interface HistoryEntry {
  id: string;
  type: HistoryType;
  timestamp: number;
  name: string;
  data: unknown;
}

const store = createStore("pokit-history", "entries");

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveHistory(type: HistoryType, name: string, data: unknown): Promise<HistoryEntry> {
  const entry: HistoryEntry = { id: genId(), type, timestamp: Date.now(), name, data };
  await set(entry.id, entry, store);
  return entry;
}

export async function listHistory(type?: HistoryType): Promise<HistoryEntry[]> {
  const allKeys = await keys(store) as string[];
  const entries = (await Promise.all(allKeys.map((k) => get<HistoryEntry>(k, store))))
    .filter((e): e is HistoryEntry => !!e);
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return type ? entries.filter((e) => e.type === type) : entries;
}

export async function getHistory(id: string): Promise<HistoryEntry | undefined> {
  return get<HistoryEntry>(id, store);
}

export async function deleteHistory(id: string): Promise<void> {
  await del(id, store);
}

export async function clearHistory(): Promise<void> {
  const allKeys = await keys(store) as string[];
  await Promise.all(allKeys.map((k) => del(k, store)));
}

export function exportCsv(entry: HistoryEntry): string {
  if (entry.type === "logger" && Array.isArray(entry.data)) {
    const rows = entry.data as { t: number; v: number }[];
    const header = "time_s,value\n";
    return header + rows.map((r) => `${r.t.toFixed(3)},${r.v}`).join("\n");
  }
  if (entry.type === "meter" && typeof entry.data === "object" && entry.data) {
    const d = entry.data as { value: string; mode: string; unit: string };
    return "timestamp,mode,value,unit\n" + `${new Date(entry.timestamp).toISOString()},${d.mode},${d.value},${d.unit}`;
  }
  if (entry.type === "scope" && typeof entry.data === "object" && entry.data) {
    const d = entry.data as { xs: number[]; ys: number[]; unit: string };
    const header = `time_s,${d.unit}\n`;
    return header + d.xs.map((x, i) => `${x.toFixed(6)},${d.ys[i]}`).join("\n");
  }
  return "";
}

export function downloadBlob(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
