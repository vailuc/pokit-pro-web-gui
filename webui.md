Alright — this is where we turn the idea into something Windsurf can actually *build without going off the rails or overfitting complexity onto a Pi*.

I’ll structure this as a **Windsurf-ready implementation plan**: meaning it’s explicit, modular, and assignable as tasks, not just architecture fluff.

---

# 🧠 Windsurf WebUI Build Plan (Pi-Optimized “Bench OS Cockpit”)

## 0. Core Constraint (important framing for Windsurf)

Everything must respect:

* Runs on **Raspberry Pi-class hardware**
* Single-node deploy first (no distributed complexity yet)
* Must use **existing Dokit WebUI as base shell**
* No heavy frameworks unless justified
* Must degrade gracefully if instruments are disconnected

---

# 1. Project Structure (what Windsurf should scaffold)

```
bench-os/
│
├── backend/
│   ├── app.py              # FastAPI entry
│   ├── mqtt/
│   │   ├── client.py
│   │   ├── topics.py
│   ├── devices/
│   │   ├── instrument_bridge.py
│   │   ├── power_controller.py
│   │   ├── serial_manager.py
│   ├── state/
│   │   ├── store.py       # SQLite / in-memory state
│   │   ├── reducer.py     # event → state updates
│   ├── api/
│   │   ├── routes.py      # REST endpoints
│   │   ├── ws.py          # websocket stream
│   ├── config.py
│
├── frontend/
│   ├── dokit/             # existing WebUI base (DO NOT REPLACE)
│   ├── panels/
│   │   ├── instruments/
│   │   ├── power/
│   │   ├── logs/
│   │   ├── workspace/
│   ├── core/
│   │   ├── mqtt_bridge.ts
│   │   ├── state_store.ts
│   │   ├── ws_client.ts
│   ├── layout/
│   │   ├── bench_layout.tsx
│   │   ├── dock_config.ts
│   ├── app.tsx
│
├── services/
│   ├── mosquitto.conf
│   ├── systemd/
│
├── docker-compose.yml
└── README.md
```

---

# 2. Backend Plan (FastAPI “light brain”)

## 2.1 Responsibilities

Windsurf must implement backend as:

* MQTT bridge
* instrument I/O abstraction
* power control abstraction
* websocket fanout to UI
* minimal state store

NO business logic in frontend.

---

## 2.2 Core Services

### A. MQTT Client Layer

Tasks:

* connect to local broker
* subscribe:

```
bench/#  
power/#  
instrument/#  
system/#
```

* publish:

```
ui/events/*
ui/commands/*
```

---

### B. State Reducer (VERY IMPORTANT)

This is the “OS brain” without being heavy.

```python
event → normalized state → broadcast
```

Example state:

```json
{
  "power": {
    "rail_12v": 11.98,
    "rail_48v": 47.6,
    "cutoff": false
  },
  "instruments": {
    "scope1": "connected",
    "tty0": "active"
  }
}
```

Rules:

* stateless reducer function preferred
* no hidden side effects
* logs everything

---

### C. Instrument Bridge

Windsurf should implement:

* serial discovery
* USB enumeration
* Hantek adapter wrapper (basic subprocess bridge OK)

Outputs:

```
instrument/tty0/raw
instrument/scope1/frame
```

---

### D. Power Controller Module

Must include:

* safe toggle API
* watchdog timeout
* fail-safe default = OFF

Endpoints:

```
POST /power/on
POST /power/off
GET /power/state
```

Also MQTT mirror:

```
power/rail/12v/set
```

---

### E. WebSocket Fanout

Single WS channel:

```
/ws/live
```

Streams:

* state updates
* instrument telemetry
* logs
* alerts

Keep it dumb:

> backend pushes, frontend decides rendering

---

# 3. Frontend Plan (Dokit base + extensions)

## 3.1 Core Principle

DO NOT rebuild UI framework.

Instead:

> Dokit = shell
> Bench UI = injected panels

---

## 3.2 Layout System (key part)

Mirror physical bench:

```
┌─────────────────────────────────────────┐
│ LEFT       CENTER            RIGHT      │
│ Instruments Workspace        Power      │
│                                         │
│            LOG STREAM (bottom)          │
└─────────────────────────────────────────┘
```

Implement:

* CSS grid OR flex layout only
* no heavy UI frameworks required

---

## 3.3 Panels (Windsurf tasks)

### A. Instruments Panel

Must include:

* live device list
* serial console viewer
* scope feed placeholder
* “connect / disconnect” buttons

Data source:

```
WS + MQTT bridge
```

---

### B. Power Panel

Must include:

* rail voltages
* toggle switches
* safety lock indicator
* emergency cutoff button

Critical rule:

> UI must require “confirm hold” for power toggles

(no instant clicks)

---

### C. Workspace Panel

This is your “lab brain surface”:

* script runner (bash/python)
* experiment buttons
* saved workflows

Keep simple:

* textarea + run button
* output stream panel

---

### D. Logs Panel

* live event stream
* color-coded:

  * INFO
  * WARN
  * ERROR
* filter toggle

---

## 3.4 MQTT → Frontend Bridge

Implement:

```
MQTT → backend → WS → frontend state store
```

Frontend module:

```ts
mqtt_bridge.ts
```

Responsibilities:

* subscribe WS
* normalize payload
* update local store

---

## 3.5 State Store (frontend)

Keep minimal:

* no Redux unless absolutely necessary
* simple reactive store:

```
bench_state.ts
```

---

# 4. System Integration Layer

## 4.1 Boot sequence (IMPORTANT for Pi stability)

Windsurf should implement:

1. start MQTT broker
2. start backend API
3. start instrument services
4. start frontend server
5. auto-open kiosk mode (optional)

---

## 4.2 Docker Compose (recommended even on Pi)

Services:

```yaml
mosquitto
backend
frontend
instrument-bridge
```

Keep each container lightweight.

---

# 5. Performance Rules (Pi-safe constraints)

Windsurf MUST enforce:

* no canvas-heavy rendering loops
* no 60fps polling of devices
* WS updates throttled (max 10–20 Hz UI)
* instrument polling async + cached

---

# 6. “Fail Gracefully” Design (critical for lab systems)

If anything breaks:

* UI must still load
* panels show “DISCONNECTED”
* backend continues logging
* power system defaults safe OFF

---

# 7. MVP Milestone Breakdown (what Windsurf should implement in order)

### Phase 1 — Skeleton

* FastAPI server
* Dokit UI loads
* WS connection works

### Phase 2 — State loop

* MQTT broker
* backend subscribes
* frontend renders state

### Phase 3 — Instruments

* serial bridge
* fake instrument stream first

### Phase 4 — Power control

* safe toggle API
* simulated rails first

### Phase 5 — UI polish

* bench layout matching physical system
* logs + alerts

### Phase 6 — XR hook (optional later)

* stream UI as video or WebRTC

---

# 8. The Key Design Insight Windsurf must NOT miss

This system only works if:

> backend is event-driven, frontend is dumb renderer, and MQTT is the spine

If Windsurf tries to:

* embed logic in UI ❌
* tightly couple devices ❌
* skip event normalization ❌

…it will collapse into spaghetti quickly.

---

If you want next step, I can generate:

* a **Windsurf task-by-task prompt list (copy/paste ready)**
* or a **minimal working repo (day-1 bootable Pi version)**
* or the **MQTT topic schema + message contracts (very important next)**
