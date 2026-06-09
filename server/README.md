# Pokit Pro Python Server

High-performance Bluetooth server for Pokit Pro that bypasses Web Bluetooth limitations.

## Why Use This Server?

Web Bluetooth has significant performance constraints:
- **Notification delays**: 135-150ms gaps in data delivery
- **No connection control**: Cannot set MTU or connection intervals
- **Platform batching**: iOS/Android buffer BLE packets
- **Sample limits**: Device stops live data acquisition at ~2700 samples

This server provides:
- **Native BLE access** with full connection parameter control
- **Real-time performance** without notification batching
- **Higher throughput** and lower latency
- **Platform optimizations** for Linux/Windows/macOS

## Installation

### Quick Setup
```bash
# Run the setup script (creates venv and installs deps)
./setup.sh
```

### Development Launcher (Recommended)
Starts both the Python BLE bridge and Vite frontend in the correct order:
```bash
# From the server/ directory
./launch-dev.sh

# This will:
# 1. Start the Python BLE bridge on ws://localhost:8765
# 2. Start Vite dev server on http://localhost:5173
# 3. Open your browser automatically
# 4. Log everything to logs/ directory

# To stop:
./stop-dev.sh
```

### Manual Setup
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server only
./run-server.sh
```

## Usage

1. Start the server:
```bash
./run-server.sh          # Server only (logs to stdout)
# OR
./launch-dev.sh          # Server + Vite frontend (logs to files)
```

2. In the web UI, click the **Server icon** in the ConnectBar to switch to Python bridge mode
3. Click **Connect** — the frontend will connect via WebSocket instead of Web Bluetooth

## Architecture

```
Pokit Pro ←→ Python Server ←→ WebSocket ←→ Web Frontend
   (BLE)        (Native BLE)      (Low Latency)     (Browser)
```

## Benefits

- **7.5ms connection intervals** (vs 30ms on iOS)
- **No notification batching**
- **Full MTU control**
- **Cross-platform** (Linux, Windows, macOS)
- **Asyncio-based** for high concurrency

## Protocol

The server exposes the same Pokit Pro protocol over WebSocket:
- Device scanning and connection
- DSO capture with high-performance streaming
- Multimeter readings
- Data logging

## Frontend Integration

Replace `PokitConnection` with `WebSocketPokitConnection` in your frontend code to switch between Web Bluetooth and the high-performance server.
