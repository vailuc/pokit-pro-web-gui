/**
 * Lightweight toast notification store.
 */

import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error" | "warning";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: ToastVariant, durationMs?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(message, variant = "info", durationMs = 4000) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs);
    }
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Imperative helper for non-React modules (e.g. stores). */
export const toast = {
  info: (m: string, d?: number) => useToastStore.getState().push(m, "info", d),
  success: (m: string, d?: number) => useToastStore.getState().push(m, "success", d),
  error: (m: string, d?: number) => useToastStore.getState().push(m, "error", d),
  warning: (m: string, d?: number) => useToastStore.getState().push(m, "warning", d),
};
