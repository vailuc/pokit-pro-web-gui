# Plan: Python BLE Bridge for Pokit Pro

## Objective
Implement a Python BLE bridge that bypasses Web Bluetooth notification batching (135-150ms gaps) by using native BLE (bleak) on Linux, forwarding raw GATT bytes over WebSocket to the web frontend. Target platform: Raspberry Pi 4/5 with Arch Linux (lab bench kiosk).

## Background
- Pokit Pro firmware is **one-shot triggered acquisition only** (no true continuous streaming)
- Each capture: write Settings → device samples N points into RAM → device sends Reading notifications
- Web Bluetooth adds 135-150ms gaps between notification callbacks (Chromium batching)
- Firmware stale data boundary at ~2700 samples (auto-reduce to 2800 for now)
- **Sample limit is temporary** — will re-test 4096 once bridge is operational

---

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐     BLE GATT     ┌────────────┐
│   Frontend      │◄──────────────────►│  Python Server   │◄──────────────►│ Pokit Pro  │
│  (React + uPlot)│   { raw bytes }    │  (bleak + asyncio)│                │  (nRF52)   │
│                 │◄───────────────────│  • Own bleak     │                │            │
│  • Parse bytes  │   { ble_state }    │    client        │                │            │
│  • Render plots │   { ble_error }    │  • Auto-reconnect│                │            │
│  • User actions │───────────────────►│  • BlueZ tuning  │                │            │
│                 │   { ble_connect }  │  • Persist MAC   │                │            │
└─────────────────┘                    └──────────────────┘                └────────────┘
```

**Rule: Server is a dumb pipe.** It does NOT parse Pokit protocol bytes. Frontend keeps all ByteReader/ByteWriter/encode/decode logic. No protocol duplication between TS and Python.

---

## Server Design

### Core Components

| Component | Library | Responsibility |
|-----------|---------|----------------|
| BLE Client | `bleak` (BleakClient, BleakScanner) | Connect, scan, read, write, subscribe |
| WebSocket Server | `websockets` | Accept frontend connections, forward messages |
| Notification Queue | `asyncio.Queue` | Decouple BLE callback from WS consumer |
| Config Store | `~/.config/pokit-bridge/` | last_device.json (MAC + name + auto_reconnect) |
| Reconnect Loop | `asyncio.Task` | Exponential backoff, re-subscribe, notify frontend |

### Notification Handler Pattern (Critical)

```python
# What NOT to do (from bleak issue #1386):
def bad_callback(sender, data):
    await websocket.send(data)  # BLOCKS → hangs under load

# What to do:
def good_callback(sender, data):
    queue.put_nowait(data)  # 1 line, never blocks

# Consumer task:
async def consume():
    while True:
        data = await queue.get()
        await websocket.send(encode_notification(data))
```

### BlueZ Connection Parameter Tuning (Linux Only)

```python
if sys.platform == "linux":
    # Request 7.5-11.25ms connection interval for lower latency
    await client._backend.set_connection_parameters(
        min_interval=6,   # 7.5ms
        max_interval=9,   # 11.25ms
        latency=0,
        timeout=500       # 5s supervision timeout
    )
```

Note: BlueZ may reject; server logs it and continues with default.

---

## WebSocket Protocol Specification

### Connection Lifecycle (Frontend → Server)

```json
{ "type": "ble_scan" }
{ "type": "ble_connect", "address": "xx:xx:xx:xx:xx:xx" }
{ "type": "ble_connect_last" }
{ "type": "ble_disconnect" }
{ "type": "set_auto_reconnect", "enabled": true }
```

### Connection Lifecycle (Server → Frontend)

```json
{ "type": "ble_state", "state": "scanning|connecting|connected|disconnected|reconnecting", 
  "address": "xx:xx:xx:xx:xx:xx", "name": "Pokit Pro", "retry_count": 0 }

{ "type": "ble_error", "error": "Device not found", "recoverable": true, "retry_in": 500 }
```

### GATT Operations (after connect)

```json
// Read
{ "type": "gatt_read", "service": "uuid", "characteristic": "uuid", "req_id": 1 }
{ "type": "gatt_read_response", "req_id": 1, "characteristic": "uuid", "data": "base64" }

// Write
{ "type": "gatt_write", "service": "uuid", "characteristic": "uuid", 
  "data": "base64", "without_response": false, "req_id": 2 }
{ "type": "gatt_write_response", "req_id": 2, "characteristic": "uuid", "success": true }

// Subscribe / Notify / Unsubscribe
{ "type": "gatt_subscribe", "service": "uuid", "characteristic": "uuid", "req_id": 3 }
{ "type": "gatt_subscribed", "req_id": 3, "characteristic": "uuid" }

{ "type": "gatt_notification", "characteristic": "uuid", "data": "base64" }

{ "type": "gatt_unsubscribe", "service": "uuid", "characteristic": "uuid", "req_id": 4 }
{ "type": "gatt_unsubscribed", "req_id": 4, "characteristic": "uuid" }
```

All `data` fields are **base64-encoded bytes**. Frontend decodes with `Uint8Array.from(atob(data), c => c.charCodeAt(0))`.

---

## Frontend Changes

### 1. Extract Connection Interface

Refactor `PokitConnection` from a concrete class to an interface:

```typescript
interface IPokitConnection {
  isConnected: boolean;
  deviceName: string;
  pokitProduct: PokitProduct;
  generation: number;
  canReconnect: boolean;
  wasIntentionalDisconnect: boolean;
  
  requestAndConnect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): void;
  getService(uuid: string): Promise<any>;
  onConnectionChange(listener: (connected: boolean) => void): () => void;
}
```

Two implementations:
- `WebBluetoothConnection` — current code, rename
- `WebSocketConnection` — new, wraps `WebSocketPokitConnection` scaffold

### 2. Runtime Backend Selection

```typescript
// deviceStore or init code
const useBridge = localStorage.getItem('pokit-bridge') === 'true';
const connection = useBridge 
  ? new WebSocketConnection('ws://localhost:8765')
  : new WebBluetoothConnection();
```

Toggle in UI (Settings page): "Use Python BLE Bridge (Linux only)".

### 3. Service Classes Stay Identical

`AbstractPokitService` uses `getService()`, `read()`, `write()`, `subscribe()` from the connection interface. No changes needed for DsoService, MultimeterService, etc.

### 4. DeviceStore Reconnect Logic

Current reconnect logic (`attemptReconnect()`) moves server-side for WebSocket mode. Frontend still shows states: `connecting`, `connected`, `reconnecting`, `disconnected`.

---

## Auto-Reconnect State Machine (Server-Side)

```
States: disconnected → scanning → connecting → connected
                                    │
                                    └──► reconnecting (exponential backoff)
                                         │
                                         └──► connected (on success)
                                         │
                                         └──► disconnected (max retries exceeded)

Config:
  MAX_RETRIES = 10
  BACKOFF = [500, 1000, 2000, 4000, 8000, 10000, 10000, ...] ms
  
On connect success:
  - Re-subscribe all active notification characteristics
  - Request BlueZ connection parameters (Linux)
  - Persist MAC to ~/.config/pokit-bridge/last_device.json
  - Send ble_state: connected to frontend

On disconnect (unintentional):
  - Enter reconnecting state
  - Start retry loop
  - Send ble_state: reconnecting + retry_count to frontend

On disconnect (intentional / ble_disconnect command):
  - Enter disconnected state
  - Stop retry loop
  - Send ble_state: disconnected
```

---

## File Changes

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/pokit_server.py` | ~300 | asyncio BLE bridge |
| `src/pokit/websocketConnection.ts` | ~200 | Frontend WS client (replace scaffold) |
| `src/pokit/webBluetoothConnection.ts` | ~160 | Extract from connection.ts |

### Modified Files

| File | Change |
|------|--------|
| `src/pokit/connection.ts` | Extract interface, keep as factory |
| `src/pokit/abstractService.ts` | Use IPokitConnection interface |
| `src/store/deviceStore.ts` | Runtime backend selection |
| `src/views/SettingsView.tsx` | Add bridge toggle |

---

## Out of Scope (Future Work)

| Feature | Phase |
|---------|-------|
| Rolling buffer visualization | Phase 4 |
| Logger mode Python bridge | Phase 4 |
| Test 4096 samples with bridge | Phase 4 (firmware boundary unknown with native BLE) |
| Windows/Mac support | Phase 5+ |
| CSV stale tail truncation | Known limitation, not needed for bridge |

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| bleak notification queue overflow | Medium | Use asyncio.Queue with maxsize, drop oldest for DSO |
| BlueZ rejects connection params | High (depends on device) | Try/catch, log, continue with default |
| WebSocket disconnect during capture | Medium | Frontend queues ops, reconnects transparently |
| MAC address changes (privacy) | Low | Use name matching as fallback |

---

## Acceptance Criteria

- [ ] Server connects to Pokit Pro via bleak
- [ ] Frontend switches between Web Bluetooth and Python bridge at runtime
- [ ] DSO capture works with <50ms notification gaps (vs current 135-150ms)
- [ ] Auto-reconnect on BLE disconnect with exponential backoff
- [ ] BlueZ connection parameters requested on Linux
- [ ] MAC persisted across server restarts
- [ ] All existing features (multimeter, LED, torch) work via bridge
- [ ] TypeScript compiles with zero errors
