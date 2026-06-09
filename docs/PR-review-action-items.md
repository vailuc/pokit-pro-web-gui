# PR Review Action Items: feat/python-ble-bridge

**Review source:** GH Agent (Copilot) — Jun 9, 2026
**PR scope:** 32 files, +2,631 -178, 64 commits
**Status:** Draft — NOT ready for merge

---

## Critical Issues (must fix before merge)

### 1. WebSocket URL hardcoded
- `ws://localhost:8765` is hardcoded in `WebSocketPokitConnection`
- No way to configure from UI or env var
- **Fix:** Add URL input in Settings page or `VITE_BRIDGE_URL` env var fallback

### 2. Notification re-subscription on reconnect
- Server tracks `_active_subscriptions` but doesn't preserve across reconnect
- Frontend loses subscriptions mid-stream when WebSocket drops
- **Fix:** Re-broadcast active subscriptions on reconnect, or frontend re-subscribes automatically

### 3. Error recovery during capture
- DSO capture: write settings -> wait for notifications
- If WebSocket drops mid-capture, frontend hangs
- **Expected:** Auto-reconnect + queue pending operations
- **Current:** Likely silently loses data
- **Fix:** Add connection state handling in DSO continuous mode loop

### 4. IPokitConnection interface verification
- `statusServiceUuid` getter exists but services use `readCharacteristic()` etc.
- `AbstractPokitService` refactored to pass service UUID explicitly
- **Fix:** Verify all 4 service classes (DSO, Meter, Logger, Status) use the interface correctly

---

## Medium Concerns

### 5. WebSocket heartbeat/ping
- Server sends ping every 25s, but frontend doesn't show keepalive handling
- Network drop detection relies on WebSocket errors only
- **Fix:** Add frontend ping/pong or connection health check

### 6. Device product detection
- `pokitProduct` hardcoded as `PokitPro` in WebSocket connection
- Server should send this; frontend shouldn't guess
- **Fix:** Server sends product type in `ble_state` message

### 7. WebSocket error messages
- Currently generic "connection failed"
- **Fix:** Distinguish between server down, device not found, BLE error, etc.

### 8. Network assumptions
- Currently assumes localhost/LAN only
- **Fix:** Document that bridge must be on same network; tunnel support is future work

---

## Nice to Have

### 9. Base64 overhead monitoring
- ~33% data overhead on every notification
- At high DSO notification rates, this adds latency
- **Fix:** Add optional metrics logging (notification count, bytes, latency)

### 10. DevTools documentation
- Add notes on using Chrome DevTools Network tab -> WS filter
- Useful for debugging protocol issues

---

## Testing Checklist (blocking)

- [ ] TypeScript builds cleanly: `npm run build`
- [ ] All 4 services work via bridge with real Pokit Pro
- [ ] DSO capture on RPi — no 135ms notification gaps
- [ ] Disconnect during capture — frontend doesn't hang
- [ ] UI backend toggle — `useBridge` persists to localStorage
- [ ] Bridge auto-reconnects after transient disconnect

---

## Commits to reference

| Commit | Description |
|--------|-------------|
| `13ead85` | fix: stop BLE flooding — coalesce status poll |
| `49a5935` | fix: always subscribe to multimeter readings; 3 banks |
| `f0a38b1` | feat: switch indicator — physical 3-way switch position in UI |
| `8137123` | feat: noise gate — snap samples within ±2σ |
| `39dc6fb` | feat: delayed display strip-chart |

---

## Next Steps

1. Address critical issues 1-4 in order
2. Run full test checklist on Raspberry Pi with real device
3. Update PR description with test results
4. Mark PR as ready for human review

**Branch:** `feat/python-ble-bridge`
**Target:** Single PR to main
**Risk:** High surface area — detailed testing required

---

*Generated from GH Agent review, organized by priority.*
