# Technical Plan: Server Fix + Commit Squash

## Part 1: Server Subscription Metadata Fix (CRITICAL)

### Problem
`pokit_server.py` stores `_active_subscriptions: set[str]` (just char UUIDs).
On reconnect, we need `service_uuid` to call `gatt_subscribe(service, char)`.
Current code has `pass` — subscriptions don't restore.

### Solution
Change storage from `set[str]` to `dict[str, str]` mapping `char_uuid -> service_uuid`.

### Implementation
1. **Line 95**: Change `self._active_subscriptions: set[str] = set()` to `self._active_subscriptions: dict[str, str] = {}`
2. **Line 402**: Change `self._active_subscriptions.add(str(char.uuid))` to `self._active_subscriptions[str(char.uuid)] = service_uuid`
3. **Line 411**: Change `self._active_subscriptions.discard(str(char.uuid))` to `self._active_subscriptions.pop(str(char.uuid), None)`
4. **Lines 454-464**: Implement actual re-subscription loop:
   ```python
   for char_uuid, service_uuid in subs:
       try:
           await self.gatt_subscribe(service_uuid, char_uuid)
       except Exception as e:
           logger.warning(f"Re-subscribe failed for {char_uuid}: {e}")
   ```
5. **Line 265**: Update disconnect cleanup (already `list()` iterator, works with dict)

### Verification
- WebSocket drops mid-capture → reconnects → notifications resume without frontend action
- Log shows: `[WS] Re-subscribed to {char_uuid}`

---

## Part 2: 8-Commit Squash Strategy

### Commit 1: server - Python BLE bridge
Files: `server/pokit_server.py`, `server/requirements.txt`, `server/README.md`, `server/setup.sh`, `server/launch-dev.sh`, `server/stop-dev.sh`, `server/run-server.sh`
Message: `server: Python BLE bridge with asyncio + bleak + websockets`

### Commit 2: refactor - Extract IPokitConnection interface  
Files: `src/pokit/connection.ts` (interface + WebBluetooth impl), `src/pokit/abstractService.ts`
Message: `refactor: Extract IPokitConnection interface for dual backend support`

### Commit 3: feat - WebSocket backend implementation
Files: `src/pokit/websocketConnection.ts`, `src/vite-env.d.ts`
Message: `feat: WebSocket backend with configurable URL via VITE_BRIDGE_URL`

### Commit 4: feat - Runtime backend selection UI
Files: `src/store/deviceStore.ts`, `src/components/ConnectBar.tsx`
Message: `feat: Runtime backend selection toggle in ConnectBar`

### Commit 5: feat - Notification re-subscription on reconnect
Files: `src/pokit/websocketConnection.ts` (_subscriptionRegistry), `server/pokit_server.py` (_subscription_metadata)
Message: `feat: Notification re-subscription on WebSocket reconnect`

### Commit 6: feat - DSO continuous mode + noise handling
Files: `src/views/OscilloscopeView.tsx`, `src/components/Waveform.tsx`, `src/pokit/types.ts` (DsoRanges)
Message: `feat: DSO continuous mode, SNR cleanup, and APK-matching ranges`

### Commit 7: feat - Switch indicator + auto-follow
Files: `src/components/SwitchIndicator.tsx`, `src/views/MultimeterView.tsx`, `src/pokit/types.ts` (getSwitchPosition)
Message: `feat: Physical switch indicator with auto-follow and 3-bank multimeter`

### Commit 8: docs - Architecture documentation
Files: `docs/PLAN-bridge-20260608.md`, `docs/PLAN-running-window.md`, `docs/plan-2026-06-09.md`, `docs/plan-switch-indicator.md`, `docs/RIPER-progress.md`
Message: `docs: Protocol specs and architecture documentation`

---

## Execution Order

1. **First**: Implement server fix (Part 1)
2. **Second**: Soft reset to master + staged commits (Part 2)
3. **Finally**: Force push to `feat/python-ble-bridge`

## Risk Mitigation
- Backup branch before force push: `git branch backup/pre-squash`
- Test each commit builds: `npx tsc --noEmit`
- Verify server fix with reconnect test

## Post-Squash Verification
- [ ] TypeScript builds cleanly
- [ ] Server re-subscription works on reconnect
- [ ] DSO ranges show 10mV-200V in dropdown
- [ ] All 8 commits have clear messages
