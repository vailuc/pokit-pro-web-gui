# Plan: Switch Indicator & Auto-Follow — IMPLEMENTED

## Status
**COMPLETE** — All features implemented and pushed to `feat/python-ble-bridge`.

## What Was Built

### 1. `SwitchIndicator` (`src/components/SwitchIndicator.tsx`)
- Single character display: `V`, `A`, `Ω`, or `-` (dash for between detents)
- **Teal** = known position
- **Orange pulse** = transit/idle (`animate-pulse`)
- **Yellow-blue flash** = mismatch with requested mode
- **Small badge** = `Man` when manual override active
- Position changes immediately (no debounce)
- Injected in `ConnectBar` between battery % and torch button

### 2. `getSwitchPosition(statusCode: DeviceStatusCode)` — `src/pokit/types.ts`
- Returns `"V" | "A" | "Ω" | "idle" | "logger"`
- `Idle=0` → `"idle"`
- `DcVoltage, AcVoltage, DsoModeSampling` → `"V"`
- `DcCurrent, AcCurrent` → `"A"`
- `Resistance, Diode, Continuity, Temperature` → `"Ω"`
- `LoggerModeSampling` → `"logger"`

### 3. `isDsoPosition(code)` — `src/pokit/types.ts`
- Returns `true` for `V` and `logger` positions
- Used by DSO/Logger guards

### 4. `deviceStore` updates — `src/store/deviceStore.ts`
- `autoFollowSwitch: boolean` (default `true`)
- `manualOverride: boolean` (default `false`)
- `setAutoFollowSwitch()`, `setManualOverride()`
- Status notification subscription with console logging
- Status **poll fallback**: 2s interval, skipped when notifications active (<3s)

### 5. `ConnectBar` injection — `src/components/ConnectBar.tsx`
- `<SwitchIndicator status={status.status} manualOverride={manualOverride} />`
- Only shown when `connected && status`

### 6. `MultimeterView` auto-follow — `src/views/MultimeterView.tsx`
- Redesigned into **3 switch-position banks**: V, A, Ω
- Active bank highlighted in teal, inactive banks dimmed
- `lastModes` state remembers last-used mode per bank
- Auto-follow triggers **only on switch POSITION CHANGE**, restores last-used mode
- Manual override badge shown when picking from inactive bank
- `0x80` switch-mismatch: silently logged, not toasted
- **Subscribe-first-then-settings** pattern: always gets readings even if settings rejected

### 7. DSO guard — `src/views/OscilloscopeView.tsx`
- Before `start()`: checks `isDsoPosition(status.status)`
- `Idle`: toast `"Verify Switch"`, block
- Not V: toast `"Verify Switch — move to V position"`, block

### 8. Logger guard — `src/views/LoggerView.tsx`
- Same DSO-style guard on `start()`

## Files Modified
| File | Change |
|------|--------|
| `src/pokit/types.ts` | `getSwitchPosition()`, `isDsoPosition()` |
| `src/store/deviceStore.ts` | `autoFollowSwitch`, `manualOverride`, status poll fallback |
| `src/components/SwitchIndicator.tsx` | NEW — single-char switch indicator |
| `src/components/ConnectBar.tsx` | Inject indicator between battery and torch |
| `src/views/MultimeterView.tsx` | 3-bank layout, auto-follow, manual override |
| `src/views/OscilloscopeView.tsx` | DSO guard on `start()` |
| `src/views/LoggerView.tsx` | Logger guard on `start()` |
| `src/index.css` | `mismatchFlash` keyframe animation |

## Toast Messages
- `"Verify Switch"` — switch between detents
- `"Verify Switch — move to V position"` — DSO/Logger on wrong position

## Known Behavior
- Status notifications **do** work (confirmed in testing: `1`→`0`→`3`→`5`)
- The `Idle=0` state is what the device reports when the switch is between detents
- When moving switch through positions, there may be a brief `0` before the target position
- The icon shows `-` immediately for `0`, then the actual position when the device reports it
