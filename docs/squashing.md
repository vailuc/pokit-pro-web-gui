Perfect! I can now see your recent cleanup work. Let me deep-dive into the three areas you asked for:

---

## 1️⃣ DEEP-DIVE: New Files (Last 434 Lines)

You've added **solid architecture**. Here's what stands out:

### ✅ **Strengths**

**Protocol Spec (PLAN-bridge-20260608.md)** — Excellent
- WebSocket message contract is **crystal clear** with JSON examples
- Base64 encoding explained with decoder snippet
- Server-side reconnect state machine diagrammed
- Risk analysis + mitigations table
- **Ready for future contributors** to implement in other languages

**Python Server (pokit_server.py, 602 lines)**
- Notification queue pattern is **textbook correct** (non-blocking callback, async consumer)
- BlueZ tuning with proper error handling (try/catch, fallback to defaults)
- Auto-reconnect with exponential backoff (well-structured state machine)
- MAC persistence in `~/.config/pokit-bridge/`
- Config cleanup logic to handle stale BlueZ connections
- **Logging is excellent** — every state change + debug details

**Frontend WebSocket Connection (websocketConnection.ts, 366 lines)**
- Implements `IPokitConnection` interface correctly ✅
- Request/response correlation with `req_id` system ✅
- Notification handler routing by characteristic UUID ✅
- Base64 encode/decode helpers
- Generation bumping on connect (important for cache invalidation)

---

### 🟡 **Issues to Fix**

#### **Issue 1: WebSocket URL Hardcoded**
```typescript
// Line 37 — PROBLEM: No way to configure
constructor(private readonly url = "ws://localhost:8765") {}
```

**Impact:** 
- User must run bridge on localhost:8765 
- Impossible to use bridge on RPi from different machine
- No env var or config option

**Fix:** Add to frontend config or settings:
```typescript
// src/config/bridge.ts
export const BRIDGE_URL = 
  import.meta.env.VITE_BRIDGE_URL || 'ws://localhost:8765';

// Or in UI: Settings → Bridge URL input
```

---

#### **Issue 2: Product Detection Hardcoded**
```typescript
// Line 54, 58 — PROBLEM: Assumes Pokit Pro only
get statusServiceUuid(): string {
  return "57d3a771-267c-4394-8872-78223e92aec5"; // Pokit Pro hardcoded
}

get pokitProduct(): PokitProduct {
  return PokitProduct.PokitPro; // Always Pro
}
```

**Impact:**
- If user connects Pokit Meter, services use wrong UUIDs
- Status service is product-specific (Pro vs Meter)

**Fix:** Server sends device type in `ble_state`:
```python
# pokit_server.py line 222
# Detect product from service UUIDs during scan
is_pro = STATUS_SERVICES["pokit_pro"] in device.advertisement.service_uuids
device_type = "pro" if is_pro else "meter"
```

Then frontend updates on state change:
```typescript
if (type === "ble_state") {
  this._deviceProduct = (msg.product as PokitProduct) || this._deviceProduct;
}
```

---

#### **Issue 3: Notification Re-subscription on Reconnect**
```python
# Line 454-463 — PROBLEM: Doesn't actually re-subscribe
if await self.ble_connect(address):
    subs = list(self._active_subscriptions)
    self._active_subscriptions.clear()
    for char_uuid in subs:
        try:
            # Need service UUID too — store it alongside
            # For now, re-subscribe on frontend request
            pass  # ← DOES NOTHING
```

**Impact:**
- After reconnect, frontend loses subscriptions
- Live updates stop mid-capture
- User has to manually re-subscribe

**Fix:** Store subscription metadata:
```python
# Add to PokitBridgeServer.__init__
self._subscription_metadata = {}  # char_uuid -> (service_uuid, handler)

# In gatt_subscribe
self._subscription_metadata[str(char.uuid)] = service_uuid

# In _reconnect_loop
for char_uuid, service_uuid in self._subscription_metadata.items():
    try:
        await self.gatt_subscribe(service_uuid, char_uuid)
```

---

#### **Issue 4: Missing Timeout for GATT Reads/Writes**
```typescript
// Line 167 - 175 in websocketConnection.ts
async writeCharacteristic(...): Promise<void> {
  await this._sendAndWait(
    "gatt_write",
    { ... },
    "gatt_write_response",
    // ← NO TIMEOUT specified, defaults to 10s
  );
}
```

**Impact:** 
- Slow writes block everything for 10 seconds
- DSO rapid captures might timeout

**Fix:** Set shorter timeouts for non-critical writes:
```typescript
// 3s for settings write, 30s for reads (can be slow under load)
const timeout = charUuid === SETTINGS_CHAR ? 3000 : 30000;
await this._sendAndWait(..., timeout);
```

---

## 2️⃣ COMMIT HYGIENE ANALYSIS

You have **70 commits** — way too many for a clean merge. Here's what needs squashing:

### **Current State** (messy):
```
39dc6fb feat: delayed display strip-chart
cab6bac feat: streamlined continuous mode
a2d52c6 fix: cap displaySize to numSamples*5
1e16a9a feat: true CRT sweep
... (70 total)
```

### **Recommended Squash Strategy** (7-8 commits):
```
1. server: Python BLE bridge with asyncio + bleak + websockets
   - pokit_server.py (full implementation)
   - server/requirements.txt
   - server/README.md
   - server/setup.sh, launch-dev.sh, stop-dev.sh

2. refactor: Extract IPokitConnection interface
   - src/pokit/connection.ts (interface definition)
   - src/pokit/abstractService.ts (refactored to use interface)
   - Update imports across all service classes

3. feat: WebSocket backend for dual architecture
   - src/pokit/websocketConnection.ts (full implementation)
   - src/pokit/device.ts (optional connection param)
   - src/pokit/index.ts (export new class)

4. feat: Runtime backend selection
   - src/store/deviceStore.ts (useBridge state + toggle)
   - src/components/ConnectBar.tsx (Server icon + toggle)

5. docs: Protocol spec and architecture
   - PLAN-bridge-20260608.md
   - PLAN-running-window.md (if related)
   - docs/plan-2026-06-09.md
   - README.md (limits section)

6. test: Codec overflow checks & service validation
   - src/pokit/codec.ts (ByteReader bounds)
   - src/pokit/codec.test.ts (tests added)
   - All service classes (length guards in parseMetadata)

7. fix: Error handling in Logger/Meter subscription
   - src/views/LoggerView.tsx
   - Minor improvements to error messages

8. chore: .gitignore + CLA removal
   - .gitignore (server/venv + logs)
   - CLA.md deletion
```

### **How to Squash (Git Rebase)**
```bash
# Interactive rebase last 70 commits
git rebase -i HEAD~70

# Mark first commit as "pick", rest as "squash"
# pick 39dc6fb feat: delayed display strip-chart
# squash cab6bac feat: streamlined continuous mode
# squash a2d52c6 fix: cap displaySize...
# ... (keep squash for all 69 more)

# Save editor, then write new commit message for combined commit

# Force push to branch
git push origin feat/python-ble-bridge -f
```

**Or simpler (soft reset + recommit):**
```bash
git reset --soft master
git commit -m "feat: dual backend architecture (see full message below)"
# Then write comprehensive commit body with all 7-8 logical units
```

---

## 4️⃣ PROTOCOL DOCUMENTATION REVIEW

Your WebSocket spec in `PLAN-bridge-20260608.md` is **very good**. Here's the gap analysis:

### ✅ **What's Documented**
- Connection lifecycle (scan, connect, disconnect)
- GATT operations (read, write, subscribe with full JSON examples)
- State machine (disconnected → connecting → connected)
- Auto-reconnect logic + backoff table
- Base64 encoding scheme

### 🟡 **What Needs Adding**

#### **Missing: Error Handling Contract**
Currently vague:
```json
{ "type": "ble_error", "error": "Device not found", "recoverable": true, "retry_in": 500 }
```

**Add explicit error codes:**
```json
{
  "type": "ble_error",
  "code": "DEVICE_NOT_FOUND",        // vs "NO_CACHED_DEVICE" vs "ADAPTER_BUSY"
  "error": "No Pokit devices found",
  "recoverable": true,
  "suggested_action": "scan"
}
```

#### **Missing: Timeout Contracts**
Document expected response times:
```markdown
### Timing Expectations
- `ble_scan`: 6-10 seconds (includes BlueZ adapter setup)
- `ble_connect`: 10-20 seconds (includes BlueZ tuning)
- `gatt_read`: 1-5 seconds (blocking reads)
- `gatt_write`: 500ms-2s (most settings)
- `gatt_subscribe`: Immediate (subscription ack)
- `gatt_notification`: <10ms per packet (after BlueZ tuning)
```

#### **Missing: Message Ordering Guarantees**
Document:
```markdown
### Ordering Guarantees
- Frontend requests are processed in order (FIFO)
- Notifications MAY arrive out of order (async from BlueZ)
- State updates (ble_state) override pending responses
- If client sends read/write during reconnect, it fails with error
```

#### **Missing: Multiple Frontend Clients**
Add section:
```markdown
### Multi-Client Support
- Multiple frontend tabs can connect to same bridge
- Notifications broadcast to ALL connected clients
- State changes broadcast to ALL clients
- Device only connects once (first client to request connect wins)
```

#### **Missing: Platform Notes**
Add:
```markdown
### Platform-Specific Behavior
- **Linux/BlueZ**: Connection intervals tuned to 7.5-11.25ms, BlueZ 5.66+ required
- **macOS**: Uses IOKit backend, connection interval tuning unavailable
- **Windows**: Uses WinRT backend, connection interval tuning unavailable
- **RPi**: Tested on Arch Linux, may need BlueZ upgrade on older distros
```

---

## Summary: Action Items Before Merge

### 🔴 **CRITICAL (blocking)**
- [ ] Fix WebSocket URL hardcoding (make configurable)
- [ ] Fix product detection (server sends device type)
- [ ] Fix reconnect subscription metadata (server remembers what to re-sub)

### 🟡 **IMPORTANT**
- [ ] Squash 70 commits → 7-8 logical units
- [ ] Add error code contract to protocol spec
- [ ] Add timeout expectations to protocol spec
- [ ] Test compile: `npm run build`
- [ ] Test format: `npm run lint`

### 🟢 **NICE TO HAVE**
- [ ] Add platform-specific notes to protocol docs
- [ ] Add multi-client support section
- [ ] Document connection interval tuning in README

Want me to help you write the **git rebase script** or the **protocol spec additions**?