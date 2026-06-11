#!/bin/bash
# Stop all Pokit Pro development services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PIDFILE="$PROJECT_DIR/logs/.pids"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [[ ! -f "$PIDFILE" ]]; then
  log "No PID file found. Services may not be running."
  
  # Try to find and kill by port anyway
  for port in 8765 5173; do
    pid=$(lsof -ti :"$port" 2>/dev/null || ss -tlnp | grep ":$port" | sed 's/.*pid=\([0-9]*\).*/\1/' | head -1)
    if [[ -n "$pid" ]]; then
      log "Killing process on port $port (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
  done
  exit 0
fi

log "Stopping services..."
while IFS= read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then
    log "Killing pid $pid"
    kill "$pid" 2>/dev/null || true
    # Give it a moment
    sleep 0.5
    # Force kill if still alive
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
done < "$PIDFILE"

rm -f "$PIDFILE"
log "Stopped."
