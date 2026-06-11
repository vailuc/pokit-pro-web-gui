/**
 * WebSocket-based Pokit connection — implements IPokitConnection interface.
 *
 * Talks to the Python BLE bridge server (pokit_server.py) over WebSocket.
 * Forwards raw GATT bytes (base64); does NOT parse Pokit protocol.
 *
 * Server handles: scanning, BLE connect/disconnect, auto-reconnect, BlueZ tuning.
 * Frontend handles: all protocol encode/decode (ByteReader, ByteWriter, etc.).
 */

import { PokitProduct } from "./types";

let _reqId = 0;
function nextReqId(): number {
  return ++_reqId;
}

export type WebSocketPokitConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "reconnecting";

export class WebSocketPokitConnection {
  private ws: WebSocket | null = null;
  private _state: WebSocketPokitConnectionState = "disconnected";
  private _deviceName = "";
  private _deviceAddress: string | null = null;
  private _generation = 0;
  private _retryCount = 0;
  private _intentionalDisconnect = false;
  private readonly _listeners = new Set<(connected: boolean) => void>();
  private readonly _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly _notificationHandlers = new Map<string, Set<(value: DataView) => void>>();
  /** Maps characteristic UUID -> service UUID so we can re-subscribe after reconnect. */
  private readonly _subscriptionRegistry = new Map<string, string>();

  constructor(
    private readonly url = import.meta.env.VITE_BRIDGE_URL || "ws://localhost:8765",
  ) {}

  // ── Static ────────────────────────────────────────────────────────────
  static isAvailable(): boolean {
    return typeof WebSocket !== "undefined";
  }

  // ── Getters (IPokitConnection) ────────────────────────────────────────
  get isConnected(): boolean {
    return this._state === "connected";
  }

  get deviceName(): string {
    return this._deviceName;
  }

  get statusServiceUuid(): string {
    return "57d3a771-267c-4394-8872-78223e92aec5"; // Pokit Pro default; server handles product detection
  }

  get pokitProduct(): PokitProduct {
    return PokitProduct.PokitPro; // Server identifies; we trust it
  }

  get generation(): number {
    return this._generation;
  }

  get wasIntentionalDisconnect(): boolean {
    return this._intentionalDisconnect;
  }

  get canReconnect(): boolean {
    return !!this._deviceAddress;
  }

  get state(): WebSocketPokitConnectionState {
    return this._state;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────
  async requestAndConnect(): Promise<void> {
    this._intentionalDisconnect = false;
    await this._ensureWs();
    try {
      // Try cached device first
      await this._sendAndWait("ble_connect_last", {}, "ble_connected", 30000);
    } catch {
      // No cached device — scan and auto-connect to first Pokit found
      console.log("[WS] No cached device, scanning…");
      this._setState("scanning");
      const resp = (await this._sendAndWait(
        "ble_scan",
        {},
        "ble_scan_result",
        20000, // Server scan = 5s, allow headroom
      )) as { devices: Array<{ name: string; address: string }> };
      const devices = resp.devices || [];
      if (devices.length === 0) {
        throw new Error("No Pokit devices found. Make sure your device is on and nearby.");
      }
      const target = devices[0];
      console.log(`[WS] Found ${target.name} (${target.address}), connecting…`);
      await this._sendAndWait(
        "ble_connect",
        { address: target.address },
        "ble_connected",
        30000, // BLE connect + BlueZ tuning can take 10-20s
      );
    }
  }

  async reconnect(): Promise<void> {
    this._intentionalDisconnect = false;
    await this._ensureWs();
    await this._sendAndWait("ble_connect_last", {}, "ble_connected", 30000);
  }

  /** Explicit scan (for UI "Scan" button). */
  async scan(): Promise<Array<{ name: string; address: string }>> {
    await this._ensureWs();
    const resp = (await this._sendAndWait(
      "ble_scan",
      {},
      "ble_scan_result",
      20000,
    )) as { devices: Array<{ name: string; address: string }> };
    return resp.devices || [];
  }

  disconnect(): void {
    this._intentionalDisconnect = true;
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "ble_disconnect" }));
      this.ws.close();
      this.ws = null;
    }
    this._setState("disconnected");
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── GATT proxy methods (used by AbstractPokitService) ─────────────────
  /** Proxy: gatt_read → wait for gatt_read_response */
  async readCharacteristic(serviceUuid: string, charUuid: string): Promise<DataView> {
    const resp = await this._sendAndWait(
      "gatt_read",
      { service: serviceUuid, characteristic: charUuid },
      "gatt_read_response",
      30000, // 30s: reads can stall behind heavy notification floods
    );
    const b64 = (resp as Record<string, string>).data;
    return base64ToDataView(b64);
  }

  /** Proxy: gatt_write → wait for gatt_write_response */
  async writeCharacteristic(
    serviceUuid: string,
    charUuid: string,
    value: ArrayBuffer,
    withoutResponse = false,
  ): Promise<void> {
    await this._sendAndWait(
      "gatt_write",
      {
        service: serviceUuid,
        characteristic: charUuid,
        data: dataViewToBase64(new DataView(value)),
        without_response: withoutResponse,
      },
      "gatt_write_response",
    );
  }

  /** Proxy: gatt_subscribe → server pushes gatt_notification */
  async subscribeCharacteristic(
    serviceUuid: string,
    charUuid: string,
    handler: (value: DataView) => void,
  ): Promise<() => Promise<void>> {
    await this._sendAndWait(
      "gatt_subscribe",
      { service: serviceUuid, characteristic: charUuid },
      "gatt_subscribed",
    );
    this._subscriptionRegistry.set(charUuid, serviceUuid);

    let set = this._notificationHandlers.get(charUuid);
    if (!set) {
      set = new Set();
      this._notificationHandlers.set(charUuid, set);
    }
    set.add(handler);

    return async () => {
      set?.delete(handler);
      if (set && set.size === 0) {
        this._notificationHandlers.delete(charUuid);
        this._subscriptionRegistry.delete(charUuid);
        await this._sendAndWait(
          "gatt_unsubscribe",
          { service: serviceUuid, characteristic: charUuid },
          "gatt_unsubscribed",
        );
      }
    };
  }

  /** Re-subscribe to all known characteristics after a WebSocket reconnect. */
  private async _resubscribeAll(): Promise<void> {
    for (const [charUuid, serviceUuid] of this._subscriptionRegistry) {
      try {
        await this._sendAndWait(
          "gatt_subscribe",
          { service: serviceUuid, characteristic: charUuid },
          "gatt_subscribed",
        );
        console.log(`[WS] Re-subscribed to ${charUuid}`);
      } catch (e) {
        console.warn(`[WS] Re-subscribe failed for ${charUuid}:`, e);
      }
    }
  }

  // ── WebSocket plumbing ──────────────────────────────────────────────
  private async _ensureWs(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[WS] Connected to Pokit bridge server");
        
        // Register sender and sync settings from bridge on connect
        import("@/store/settingsStore").then(({ useSettingsStore }) => {
          const store = useSettingsStore.getState();
          
          // Register the send function for UI-triggered saves
          const sendMessage = (msg: unknown) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify(msg));
            }
          };
          if (store.setSender) {
            store.setSender(sendMessage);
          }
          
          // Sync settings from bridge
          if (store.syncFromBridge) {
            store.syncFromBridge(sendMessage);
          }
        });
        
        resolve();
      };

      this.ws.onerror = (err) => {
        console.error("[WS] Error:", err);
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          this._onMessage(msg);
        } catch (e) {
          console.error("[WS] Invalid JSON:", event.data);
        }
      };

      this.ws.onclose = () => {
        console.log("[WS] Disconnected");
        this._setState("disconnected");
        import("@/store/settingsStore").then(({ useSettingsStore }) => {
          useSettingsStore.getState().setSender(() => {}); // No-op sender
          useSettingsStore.setState({ isSynced: false });
          console.log("[Settings] Bridge disconnected — switched to local-only");
        });
      };
    });
  }

  private _onMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // 1. Resolve pending requests
    const reqId = msg.req_id as number | undefined;
    if (reqId && this._pending.has(reqId)) {
      const { resolve, reject } = this._pending.get(reqId)!;
      this._pending.delete(reqId);
      if (type === "error" || type === "ble_error") {
        reject(new Error((msg.error as string) || "Server error"));
      } else {
        resolve(msg);
      }
      // Fall through: state messages also update UI
    }

    // 2. Handle server-pushed state
    if (type === "ble_state") {
      const state = msg.state as WebSocketPokitConnectionState;
      this._deviceName = (msg.name as string) || this._deviceName;
      this._deviceAddress = (msg.address as string) || this._deviceAddress;
      this._retryCount = (msg.retry_count as number) || 0;
      this._setState(state);
      return;
    }

    // 3. Handle notifications
    if (type === "gatt_notification") {
      const charUuid = msg.characteristic as string;
      const data = base64ToDataView(msg.data as string);
      const handlers = this._notificationHandlers.get(charUuid);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(data);
          } catch (e) {
            console.error("[WS] Notification handler error:", e);
          }
        }
      }
      return;
    }

    // 4. Settings messages (forward to settings store)
    if (type === "settings" || type === "settings_ok" || type === "settings_error") {
      // Import dynamically to avoid circular dependency
      import("@/store/settingsStore").then(({ useSettingsStore }) => {
        const store = useSettingsStore.getState();
        if (store.handleSettingsMessage) {
          store.handleSettingsMessage(msg);
        }
      });
      return;
    }

    // 5. Server errors
    if (type === "ble_error") {
      console.error("[WS] Server error:", msg.error);
      return;
    }
  }

  private async _sendAndWait(
    type: string,
    payload: Record<string, unknown>,
    _expectedResponseType: string,
    timeoutMs = 10000,
  ): Promise<unknown> {
    await this._ensureWs();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket closed");
    }
    const reqId = nextReqId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(reqId);
        reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(reqId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.ws!.send(JSON.stringify({ type, req_id: reqId, ...payload }));
    });
  }

  private _setState(next: WebSocketPokitConnectionState): void {
    const prev = this._state;
    this._state = next;

    // Bump generation on connect
    if (prev !== "connected" && next === "connected") {
      this._generation += 1;
      // Re-subscribe to all known characteristics after reconnect.
      if (this._subscriptionRegistry.size > 0) {
        void this._resubscribeAll();
      }
    }

    // Notify listeners on any change
    if (prev !== next) {
      const connected = next === "connected";
      for (const l of this._listeners) {
        try {
          l(connected);
        } catch (e) {
          console.error("[WS] Listener error:", e);
        }
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function dataViewToBase64(dv: DataView): string {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToDataView(b64: string): DataView {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new DataView(bytes.buffer);
}

