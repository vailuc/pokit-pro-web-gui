/**
 * Settings management with layered persistence:
 * - localStorage: Always-available cache and fallback
 * - settings.json (via WebSocket): Bridge-authoritative storage when connected
 * 
 * Architecture:
 * - UI settings: Client-authoritative (theme, accent, startup tab)
 * - Plugin settings: Bridge-authoritative when connected (DSO defaults, meter config)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@/store/toastStore";

// ── Types ────────────────────────────────────────────────────────────────────

interface UISettings {
  theme: "dark" | "light" | "auto";
  accent: "blue" | "red" | "green" | "amber" | "purple";
  startupTab: "meter" | "scope" | "logger" | "device" | "settings";
  connectionMode: "web-bluetooth" | "bridge";
  bridgeUrl: string;
  sidebarCollapsed: boolean;
}

interface PluginSettings {
  dso: {
    version: number;
    defaultWindowMs: number;
    defaultMode: "one-shot" | "continuous";
    performanceHints: boolean;
  };
  meter: {
    version: number;
    autoRange: boolean;
    operationalWarnings: boolean;
  };
  logger: {
    version: number;
    defaultSampleRate: number;
    defaultDuration: number;
  };
  device: {
    version: number;
    showAdvanced: boolean;
  };
}

interface SettingsEnvelope {
  version: number;
  lastModified: number;
  ui: UISettings;
  plugins: PluginSettings;
}

interface SettingsState extends SettingsEnvelope {
  isLoading: boolean;
  isSynced: boolean;
  error: string | null;
  sendMessage: ((msg: unknown) => void) | null;
  
  // Actions
  loadFromLocal: () => void;
  setSender: (sendMessage: (msg: unknown) => void) => void;
  syncFromBridge: (sendMessage: (msg: unknown) => void) => Promise<void>;
  updateUI: <K extends keyof UISettings>(key: K, value: UISettings[K]) => Promise<void>;
  updatePlugin: <P extends keyof PluginSettings, K extends keyof PluginSettings[P]>(
    plugin: P,
    key: K,
    value: PluginSettings[P][K]
  ) => Promise<void>;
  patchSettings: (patch: Partial<SettingsEnvelope>, sendMessage?: (msg: unknown) => void) => Promise<void>;
  handleSettingsMessage: (message: unknown) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: SettingsEnvelope = {
  version: 1,
  lastModified: 0,
  ui: {
    theme: "dark",
    accent: "blue",
    startupTab: "meter",
    connectionMode: "bridge",
    bridgeUrl: "ws://localhost:8765",
    sidebarCollapsed: false,
  },
  plugins: {
    dso: { version: 1, defaultWindowMs: 50, defaultMode: "one-shot", performanceHints: true },
    meter: { version: 1, autoRange: true, operationalWarnings: true },
    logger: { version: 1, defaultSampleRate: 10, defaultDuration: 60 },
    device: { version: 1, showAdvanced: false },
  },
};

const SETTINGS_STORAGE_KEY = "pokit-ui-settings";

// Request ID generator for WebSocket
let reqIdCounter = 1;
const getReqId = () => reqIdCounter++;

// Pending requests map for WebSocket responses
const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

// ── Helper Functions ──────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const output = { ...target };
  for (const key in source) {
    const value = source[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key in target &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>) as T[Extract<keyof T, string>];
    } else if (value !== undefined) {
      output[key] = value as T[Extract<keyof T, string>];
    }
  }
  return output;
}

// ── Store Creation ─────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      isLoading: false,
      isSynced: false,
      error: null,
      sendMessage: null,

      setSender: (sendMessage) => {
        set({ sendMessage });
        console.log("[Settings] WebSocket sender registered");
      },

      loadFromLocal: () => {
        // Hydration happens automatically via Zustand persist
        console.log("[Settings] Loaded from localStorage");
      },

      syncFromBridge: async (sendMessage) => {
        set({ isLoading: true, error: null });

        try {
          const reqId = getReqId();
          const response = await new Promise<unknown>((resolve, reject) => {
            pendingRequests.set(reqId, { resolve, reject });
            sendMessage({ type: "settings_get", req_id: reqId });

            // 8 second timeout (generous for busy server)
            setTimeout(() => {
              if (pendingRequests.has(reqId)) {
                // Don't delete — let late response still be processed
                // Just reject the promise so caller isn't blocked
                reject(new Error("Settings sync timeout (will retry)"));
              }
            }, 8000);
          });

          const msg = response as { type: string; data?: SettingsEnvelope; message?: string };

          if (msg.type === "settings" && msg.data) {
            // Merge: Bridge authoritative for plugins, keep local UI settings
            const current = get();
            const merged: SettingsEnvelope = {
              ...msg.data,
              ui: {
                ...current.ui,
                ...msg.data.ui,
              },
            };

            set({ ...merged, isLoading: false, isSynced: true });
            console.log("[Settings] Synced from bridge");
          } else if (msg.type === "settings_error") {
            throw new Error(msg.message || "Settings sync failed");
          }
        } catch (err) {
          console.error("[Settings] Sync failed:", err);
          set({ isLoading: false, error: (err as Error).message });
        }
      },

      updateUI: async (key, value) => {
        const current = get();
        const newUI = { ...current.ui, [key]: value };
        const newState = { ...current, ui: newUI };
        set(newState);

        // Send to bridge if we have a send function available
        const sender = current.sendMessage;
        if (sender) {
          await get().patchSettings({ ui: newUI }, sender);
        }
        console.log(`[Settings] UI ${key} updated: ${value}`);
      },

      updatePlugin: async (plugin, key, value) => {
        const current = get();
        const newPlugin = { ...current.plugins[plugin], [key]: value } as PluginSettings[typeof plugin];
        const newPlugins = { ...current.plugins, [plugin]: newPlugin };
        const newState = { ...current, plugins: newPlugins };
        set(newState);

        // Send to bridge if we have a send function available
        const sender = current.sendMessage;
        if (sender) {
          await get().patchSettings({ plugins: newPlugins }, sender);
        }
        console.log(`[Settings] Plugin ${plugin} updated: ${String(key)} = ${value}`);
      },

      patchSettings: async (patch, sendMessage) => {
        const current = get() as unknown as Record<string, unknown>;
        const merged = deepMerge(current, patch) as unknown as SettingsState;
        set(merged);

        // Send to bridge if sendMessage provided
        if (sendMessage) {
          const reqId = getReqId();
          
          // Create promise to await response
          const promise = new Promise((resolve, reject) => {
            pendingRequests.set(reqId, { resolve, reject });
          });
          
          sendMessage({
            type: "settings_set",
            req_id: reqId,
            patch,
          });
          
          // Await response with timeout
          try {
            await Promise.race([
              promise,
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Settings save timeout")), 8000)
              ),
            ]);
            console.log("[Settings] Saved to bridge successfully");
          } catch (err) {
            // Don't delete pending request — late response will still be handled
            const errorMsg = err instanceof Error ? err.message : "Settings save failed";
            // Only show error if it's not a timeout (late response will still arrive)
            if (!errorMsg.includes("timeout")) {
              toast.error(`Settings not saved: ${errorMsg}`);
            }
            console.error("[Settings] Save failed:", err);
          }
        }

      },

      handleSettingsMessage: (message) => {
        const msg = message as { type: string; req_id?: number; data?: unknown; message?: string };

        // Handle responses to pending requests AND apply settings data
        if (
          msg.type === "settings" ||
          msg.type === "settings_ok" ||
          msg.type === "settings_error"
        ) {
          const reqId = msg.req_id;
          
          // Resolve pending request if present
          if (reqId && pendingRequests.has(reqId)) {
            const pending = pendingRequests.get(reqId)!;
            pendingRequests.delete(reqId);

            if (msg.type === "settings_error") {
              pending.reject(new Error(msg.message || "Settings error"));
            } else {
              pending.resolve(msg);
            }
          }
          
          // Apply settings data from server (for settings_get response)
          if (msg.type === "settings" && msg.data) {
            const current = get();
            const serverSettings = msg.data as SettingsEnvelope;
            // Merge server data but preserve local UI settings
            const merged: SettingsEnvelope = {
              version: serverSettings.version,
              lastModified: serverSettings.lastModified,
              ui: { ...current.ui, ...serverSettings.ui },
              plugins: { ...current.plugins, ...serverSettings.plugins },
            };
            set({ ...merged, isLoading: false, isSynced: true, error: null });
          }
        }

        // Handle server-initiated settings push (if implemented later)
        if (msg.type === "settings_push" && msg.data) {
          const current = get();
          const merged: SettingsEnvelope = {
            ...(msg.data as SettingsEnvelope),
            ui: {
              ...current.ui,
              ...(msg.data as SettingsEnvelope).ui,
            },
          };
          set(merged);
          console.log("[Settings] Received push from server");
        }
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      partialize: (state: SettingsState) => {
        // Only persist the settings data, not the meta state
        const { isLoading, isSynced, error, ...settings } = state;
        return settings as Record<string, unknown>;
      },
    }
  )
);

// ── Hook for Components ─────────────────────────────────────────────────────

export function useSettings() {
  const store = useSettingsStore();
  return {
    ui: store.ui,
    plugins: store.plugins,
    isSynced: store.isSynced,
    updateUI: store.updateUI,
    updatePlugin: store.updatePlugin,
    patchSettings: store.patchSettings,
  };
}

// ── Re-export Types ─────────────────────────────────────────────────────────

export type { UISettings, PluginSettings, SettingsEnvelope };
