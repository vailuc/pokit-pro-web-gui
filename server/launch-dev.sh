#!/bin/bash
# Launcher for Pokit Pro development stack
# Starts Python BLE bridge + Vite frontend in correct order with log capture

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_LOG="$PROJECT_DIR/logs/server.log"
FRONTEND_LOG="$PROJECT_DIR/logs/frontend.log"
PIDFILE="$PROJECT_DIR/logs/.pids"
SERVER_PORT=8765
FRONTEND_PORT=5173

# ── Helpers ────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cleanup() {
  log "Shutting down..."
  if [[ -f "$PIDFILE" ]]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-30}
  log "Waiting for $name on port $port..."
  for ((i=0; i<timeout*10; i++)); do
    if (exec 2>/dev/null; bash -c "exec 3<>/dev/tcp/localhost/$port"); then
      log "$name ready on port $port"
      return 0
    fi
    sleep 0.1
  done
  log "ERROR: $name did not start on port $port within ${timeout}s"
  return 1
}

# ── Setup ──────────────────────────────────────────────────────────────────
mkdir -p "$PROJECT_DIR/logs"

# ── Start Python BLE Bridge ────────────────────────────────────────────────
log "Starting Python BLE Bridge server..."
cd "$SCRIPT_DIR"
source venv/bin/activate 2>/dev/null || {
  log "Virtual environment not found. Run ./setup.sh first."
  exit 1
}

nohup python pokit_server.py >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >> "$PIDFILE"

if ! wait_for_port "$SERVER_PORT" "BLE Bridge" 10; then
  log "Failed to start BLE bridge. Check $SERVER_LOG"
  exit 1
fi

# ── Start Vite Frontend ──────────────────────────────────────────────────
log "Starting Vite dev server..."
cd "$PROJECT_DIR"

nohup npx vite --host --port "$FRONTEND_PORT" >> "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PIDFILE"

if ! wait_for_port "$FRONTEND_PORT" "Vite" 30; then
  log "Failed to start Vite. Check $FRONTEND_LOG"
  exit 1
fi

# ── Open browser (optional) ────────────────────────────────────────────────
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 &
fi

# ── Status ─────────────────────────────────────────────────────────────────
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Pokit Pro Dev Stack Running"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  BLE Bridge:  ws://localhost:$SERVER_PORT   (pid $SERVER_PID)"
log "  Frontend:    http://localhost:$FRONTEND_PORT (pid $FRONTEND_PID)"
log "  Server logs:  $SERVER_LOG"
log "  Frontend:     $FRONTEND_LOG"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "Press Ctrl+C to stop both services."
log ""

# Keep script alive until interrupted
wait
