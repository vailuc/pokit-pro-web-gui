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

# Start the server
./run-server.sh
```

### Manual Setup
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
python pokit-server.py
```

## Usage

1. Start the server:
```bash
python pokit-server.py
```

2. Modify frontend to use WebSocket connection instead of Web Bluetooth
3. Connect to `ws://localhost:8765`

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
