#!/usr/bin/env python3
"""
Pokit Pro BLE Bridge - Native BLE proxy for Linux/RPi

Bypasss Web Bluetooth notification batching (135-150ms gaps) by using
bleak (native BlueZ) and forwarding raw GATT bytes over WebSocket.

Architecture: Dumb pipe. Does NOT parse Pokit protocol bytes.
Frontend keeps all encode/decode logic (ByteReader, ByteWriter, etc.)

Target: Raspberry Pi 4/5 with Arch Linux + BlueZ 5.66+
"""

import asyncio
import base64
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

import websockets
from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Pokit UUIDs (match frontend src/pokit/uuids.ts) ──────────────────────────
STATUS_SERVICES = {
    "pokit_meter": "57d3a771-267c-4394-8872-78223e92aec4",
    "pokit_pro":   "57d3a771-267c-4394-8872-78223e92aec5",
}
DSO_SERVICE      = "1569801e-1425-4a7a-b617-a4f4ed719de6"
MULTIMETER_SERV  = "e7481d2f-5781-442e-bb9a-fd4e3441dadc"
LOGGER_SERV      = "a5ff3566-1fd8-4e10-8362-590a578a4121"
DEVICE_INFO_SERV = "0000180a-0000-1000-8000-00805f9b34fb"
BATTERY_SERV     = "0000180f-0000-1000-8000-00805f9b34fb"

ALL_SERVICES = [
    STATUS_SERVICES["pokit_meter"],
    STATUS_SERVICES["pokit_pro"],
    DSO_SERVICE,
    MULTIMETER_SERV,
    LOGGER_SERV,
    DEVICE_INFO_SERV,
    BATTERY_SERV,
]

# ── Config ──────────────────────────────────────────────────────────────────
CONFIG_DIR = Path.home() / ".config" / "pokit-bridge"
CONFIG_FILE = CONFIG_DIR / "last_device.json"
MAX_RECONNECT_RETRIES = 10
RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000, 10000]
WS_HOST = os.environ.get("POKIT_WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("POKIT_WS_PORT", "8765"))


# ── Connection State ────────────────────────────────────────────────────────
class ConnectionState:
    DISCONNECTED = "disconnected"
    SCANNING     = "scanning"
    CONNECTING   = "connecting"
    CONNECTED    = "connected"
    RECONNECTING = "reconnecting"


# ── PokitBridgeServer ───────────────────────────────────────────────────────
class PokitBridgeServer:
    """
    Owns the bleak client lifecycle:
      • Scan → connect → persist MAC
      • Auto-reconnect on disconnect
      • Subscribe/unsubscribe characteristics
      • Forward raw GATT bytes (base64) over WebSocket
    """

    def __init__(self):
        self.client: Optional[BleakClient] = None
        self.device_info: Optional[dict] = None   # {name, address}
        self.state = ConnectionState.DISCONNECTED
        self.auto_reconnect = False
        self.retry_count = 0
        self._reconnect_task: Optional[asyncio.Task] = None
        self._notification_queue: asyncio.Queue = asyncio.Queue(maxsize=5000)
        self._consumer_task: Optional[asyncio.Task] = None
        self._ws_clients: set[websockets.WebSocketServerProtocol] = set()
        self._active_subscriptions: dict[str, str] = {}   # char_uuid -> service_uuid
        self._req_counter = 0

    # ── Config persistence ──────────────────────────────────────────────────
    def _load_config(self) -> Optional[dict]:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text())
            except json.JSONDecodeError:
                logger.warning("Corrupt config file, ignoring")
        return None

    def _save_config(self, address: str, name: str) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps({"address": address, "name": name, "auto_reconnect": self.auto_reconnect}))

    # ── State broadcast ─────────────────────────────────────────────────────
    async def _broadcast_state(self) -> None:
        payload = {
            "type": "ble_state",
            "state": self.state,
            "address": self.device_info.get("address") if self.device_info else None,
            "name": self.device_info.get("name") if self.device_info else None,
            "retry_count": self.retry_count,
        }
        await self._broadcast_ws(payload)

    async def _broadcast_ws(self, payload: dict) -> None:
        """Send JSON to all connected WebSocket clients."""
        if not self._ws_clients:
            return
        message = json.dumps(payload)
        dead = set()
        for ws in self._ws_clients:
            try:
                await ws.send(message)
            except websockets.ConnectionClosed:
                dead.add(ws)
        self._ws_clients -= dead

    # ── BLE notification callback (MUST be non-blocking) ────────────────────
    def _on_notification(self, sender: Any, data: bytearray) -> None:
        """
        bleak callback — runs on BlueZ thread.
        ONLY enqueue; never do I/O here.
        """
        try:
            self._notification_queue.put_nowait((str(sender.uuid), bytes(data)))
        except asyncio.QueueFull:
            logger.warning("Notification queue full, dropping oldest packet")
            # Drop oldest and retry
            try:
                self._notification_queue.get_nowait()
                self._notification_queue.put_nowait((str(sender.uuid), bytes(data)))
            except asyncio.QueueEmpty:
                pass

    # ── Notification consumer (runs in asyncio loop) ────────────────────────
    async def _consume_notifications(self) -> None:
        """
        Pull from queue, forward to WebSocket clients.
        This is the slow path — async I/O is safe here.
        """
        while True:
            char_uuid, raw = await self._notification_queue.get()
            payload = {
                "type": "gatt_notification",
                "characteristic": char_uuid,
                "data": base64.b64encode(raw).decode("ascii"),
            }
            await self._broadcast_ws(payload)

    # ── Connection parameter tuning (Linux/BlueZ only) ────────────────────
    async def _tune_connection_params(self) -> None:
        if sys.platform != "linux":
            return
        try:
            # BlueZ backend: set 7.5-11.25ms interval for lowest latency
            backend = self.client._backend
            if hasattr(backend, "_client"):
                await backend._client.set_connection_parameters(
                    min_interval=6,      # 7.5ms
                    max_interval=9,      # 11.25ms
                    latency=0,
                    timeout=500,         # 5s supervision timeout
                )
                logger.info("BlueZ connection parameters set to 7.5-11.25ms")
        except Exception as e:
            logger.warning(f"Could not set BlueZ connection parameters: {e}")

    # ── Connect ─────────────────────────────────────────────────────────────
    async def ble_connect(self, address: Optional[str] = None) -> bool:
        if self.client and self.client.is_connected:
            logger.info("Already connected")
            return True

        self.state = ConnectionState.CONNECTING
        await self._broadcast_state()

        # If no address given, try config
        if not address:
            cfg = self._load_config()
            if cfg:
                address = cfg.get("address")
                logger.info(f"Using cached device: {address}")

        if not address:
            logger.error("No device address provided and no cached config")
            self.state = ConnectionState.DISCONNECTED
            await self._broadcast_state()
            return False

        # Pre-emptively disconnect stale connections so device can advertise
        await self._force_disconnect_existing(address)

        for attempt in range(1, 4):
            try:
                self.client = BleakClient(address)
                await self.client.connect()
                if not self.client.is_connected:
                    raise RuntimeError("Connection failed")

                # Tune params for speed
                await self._tune_connection_params()

                # Identify device
                name = self.client._backend._device_info.get("Name", "Pokit Pro")
                self.device_info = {"name": name, "address": address}
                self._save_config(address, name)

                self.state = ConnectionState.CONNECTED
                self.retry_count = 0
                await self._broadcast_state()

                # Start notification consumer if not running
                if not self._consumer_task or self._consumer_task.done():
                    self._consumer_task = asyncio.create_task(self._consume_notifications())

                logger.info(f"Connected to {name} ({address})")
                return True

            except BleakError as e:
                err_msg = str(e)
                if "InProgress" in err_msg and attempt < 3:
                    logger.warning(f"BLE adapter busy (attempt {attempt}/3), retrying in 3s...")
                    await asyncio.sleep(3.0)
                    continue
                logger.error(f"Connection failed: {e}")
                break
            except Exception as e:
                logger.error(f"Connection failed: {e}")
                break

        self.state = ConnectionState.DISCONNECTED
        await self._broadcast_state()
        # Keep cached config so we can disconnect stale connections on retry
        if self.auto_reconnect:
            self._start_reconnect(address)
        return False

    # ── Disconnect ────────────────────────────────────────────────────────
    async def ble_disconnect(self) -> None:
        self.auto_reconnect = False
        self._stop_reconnect()

        if self._consumer_task:
            self._consumer_task.cancel()
            self._consumer_task = None

        # Unsubscribe all active notifications
        for char_uuid in list(self._active_subscriptions):
            try:
                await self.client.stop_notify(char_uuid)
            except Exception:
                pass
        self._active_subscriptions.clear()

        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

        self.state = ConnectionState.DISCONNECTED
        self.device_info = None
        await self._broadcast_state()
        logger.info("Disconnected")

    # ── Force disconnect any existing BlueZ connections ─────────────────────
    async def _force_disconnect_existing(self, address: Optional[str] = None) -> None:
        """Disconnect stale BlueZ connections so device can advertise again.
        Only disconnects the target Pokit device, never headphones etc."""
        try:
            import subprocess

            # If no address given, try cached config
            if not address:
                cfg = self._load_config()
                if cfg:
                    address = cfg.get("address")

            # Disconnect specific device if address known
            if address:
                subprocess.run(
                    ["bluetoothctl", "disconnect", address],
                    capture_output=True, text=True, timeout=5
                )
                logger.info(f"Disconnected existing BlueZ connection to {address}")
                await asyncio.sleep(3.0)  # Wait for BlueZ cleanup + device to resume advertising
                return

            # Fallback: disconnect any device with "pokit" in the name (fast, no UUID checks)
            result = subprocess.run(
                ["bluetoothctl", "devices"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 3:
                    mac = parts[1]
                    name = " ".join(parts[2:]).lower()
                    if "pokit" in name:
                        subprocess.run(
                            ["bluetoothctl", "disconnect", mac],
                            capture_output=True, text=True, timeout=5
                        )
                        logger.info(f"Disconnected existing Pokit: {mac}")
            await asyncio.sleep(0.5)
        except Exception as e:
            logger.debug(f"Could not disconnect existing: {e}")

    # ── Scan ────────────────────────────────────────────────────────────────
    async def ble_scan(self) -> list[dict]:
        self.state = ConnectionState.SCANNING
        await self._broadcast_state()

        # Disconnect any existing connections so Pokit can advertise
        await self._force_disconnect_existing()

        # Use callback-based scanning for better real-time detection
        pokit_devices = []
        seen = set()

        def on_detect(device: BLEDevice, advertisement_data):
            # Match by name (case-insensitive) or known service UUIDs
            name = (device.name or advertisement_data.local_name or "").lower()
            uuids = advertisement_data.service_uuids or []
            is_pokit = (
                "pokit" in name
                or any(u.upper() in [s.upper() for s in ALL_SERVICES] for u in uuids)
            )
            if is_pokit and device.address not in seen:
                seen.add(device.address)
                display_name = device.name or advertisement_data.local_name or "Pokit Device"
                pokit_devices.append({"name": display_name, "address": device.address})
                logger.info(f"Found Pokit: {display_name} ({device.address})")

        logger.info("Starting BLE scan (6s)...")
        for attempt in range(1, 4):
            try:
                async with BleakScanner(on_detect) as scanner:
                    await asyncio.sleep(6.0)
                    # Log all discovered devices for debugging
                    all_devs = scanner.discovered_devices if hasattr(scanner, 'discovered_devices') else []
                    logger.info(f"Scan complete. Total devices seen: {len(all_devs)}, Pokit devices: {len(pokit_devices)}")
                    for dev in all_devs:
                        uuids = dev.metadata.get('uuids', []) if hasattr(dev, 'metadata') and dev.metadata else []
                        logger.info(f"  Discovered: {dev.name or 'Unknown'} ({dev.address}) UUIDs={uuids}")
                break  # Success
            except BleakError as e:
                if "InProgress" in str(e) and attempt < 3:
                    logger.warning(f"BLE adapter busy (attempt {attempt}/3), retrying in 2s...")
                    await asyncio.sleep(2.0)
                else:
                    raise

        if not self.client or not self.client.is_connected:
            self.state = ConnectionState.DISCONNECTED
        else:
            self.state = ConnectionState.CONNECTED
        await self._broadcast_state()
        return pokit_devices

    # ── GATT read ───────────────────────────────────────────────────────────
    async def gatt_read(self, service_uuid: str, char_uuid: str) -> bytes:
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Not connected")
        char = await self._get_characteristic(service_uuid, char_uuid)
        return await self.client.read_gatt_char(char)

    # ── GATT write ──────────────────────────────────────────────────────────
    async def gatt_write(self, service_uuid: str, char_uuid: str, data: bytes, without_response: bool = False) -> None:
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Not connected")
        char = await self._get_characteristic(service_uuid, char_uuid)
        if without_response and "write-without-response" in char.properties:
            await self.client.write_gatt_char(char, data, response=False)
        else:
            await self.client.write_gatt_char(char, data, response=True)

    # ── GATT subscribe ──────────────────────────────────────────────────────
    async def gatt_subscribe(self, service_uuid: str, char_uuid: str) -> None:
        if not self.client or not self.client.is_connected:
            raise RuntimeError("Not connected")
        char = await self._get_characteristic(service_uuid, char_uuid)
        await self.client.start_notify(char, self._on_notification)
        self._active_subscriptions[str(char.uuid)] = service_uuid
        logger.info(f"Subscribed to {char.uuid}")

    # ── GATT unsubscribe ──────────────────────────────────────────────────
    async def gatt_unsubscribe(self, service_uuid: str, char_uuid: str) -> None:
        if not self.client or not self.client.is_connected:
            return
        char = await self._get_characteristic(service_uuid, char_uuid)
        await self.client.stop_notify(char)
        self._active_subscriptions.pop(str(char.uuid), None)
        logger.info(f"Unsubscribed from {char.uuid}")

    # ── Helper: resolve characteristic ──────────────────────────────────────
    async def _get_characteristic(self, service_uuid: str, char_uuid: str):
        # bleak 3.x: services are auto-cached, use client.services
        if self.client.services:
            svc = self.client.services.get_service(service_uuid)
            if svc:
                for char in svc.characteristics:
                    if str(char.uuid).lower() == char_uuid.lower():
                        return char
        # bleak 3.x accepts UUID strings directly for all GATT ops
        return char_uuid

    # ── Auto-reconnect ──────────────────────────────────────────────────────
    def _start_reconnect(self, address: str) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            return
        self._reconnect_task = asyncio.create_task(self._reconnect_loop(address))

    def _stop_reconnect(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        self._reconnect_task = None
        self.retry_count = 0

    async def _reconnect_loop(self, address: str) -> None:
        for attempt in range(1, MAX_RECONNECT_RETRIES + 1):
            if not self.auto_reconnect:
                break
            if self.client and self.client.is_connected:
                break

            self.state = ConnectionState.RECONNECTING
            self.retry_count = attempt
            await self._broadcast_state()

            delay_ms = RECONNECT_BACKOFF_MS[min(attempt - 1, len(RECONNECT_BACKOFF_MS) - 1)]
            logger.info(f"Reconnect attempt {attempt}/{MAX_RECONNECT_RETRIES} in {delay_ms}ms")
            await asyncio.sleep(delay_ms / 1000.0)

            if await self.ble_connect(address):
                # Re-subscribe all active characteristics
                subs = list(self._active_subscriptions.items())
                self._active_subscriptions.clear()
                for char_uuid, service_uuid in subs:
                    try:
                        await self.gatt_subscribe(service_uuid, char_uuid)
                        logger.info(f"Re-subscribed to {char_uuid}")
                    except Exception as e:
                        logger.warning(f"Failed to re-subscribe {char_uuid}: {e}")
                return

        # Failed after max retries
        self.state = ConnectionState.DISCONNECTED
        self.retry_count = 0
        await self._broadcast_state()
        await self._broadcast_ws({
            "type": "ble_error",
            "error": "Could not reconnect after maximum retries",
            "recoverable": False,
        })

    # ── WebSocket message handlers ────────────────────────────────────────
    async def handle_ws_message(self, ws: websockets.WebSocketServerProtocol, msg: dict) -> None:
        msg_type = msg.get("type")
        req_id = msg.get("req_id")

        try:
            if msg_type == "ble_scan":
                devices = await self.ble_scan()
                await ws.send(json.dumps({"type": "ble_scan_result", "devices": devices, "req_id": req_id}))

            elif msg_type == "ble_connect":
                address = msg.get("address")
                ok = await self.ble_connect(address)
                await ws.send(json.dumps({"type": "ble_connected" if ok else "ble_error", "req_id": req_id, "error": None if ok else "Connection failed"}))

            elif msg_type == "ble_connect_last":
                ok = await self.ble_connect()
                await ws.send(json.dumps({"type": "ble_connected" if ok else "ble_error", "req_id": req_id, "error": None if ok else "Connection failed"}))

            elif msg_type == "ble_disconnect":
                await self.ble_disconnect()
                try:
                    await ws.send(json.dumps({"type": "ble_disconnected", "req_id": req_id}))
                except websockets.ConnectionClosed:
                    pass

            elif msg_type == "set_auto_reconnect":
                self.auto_reconnect = msg.get("enabled", False)
                # Update config
                cfg = self._load_config() or {}
                cfg["auto_reconnect"] = self.auto_reconnect
                CONFIG_DIR.mkdir(parents=True, exist_ok=True)
                CONFIG_FILE.write_text(json.dumps(cfg))
                await ws.send(json.dumps({"type": "auto_reconnect_set", "enabled": self.auto_reconnect, "req_id": req_id}))

            elif msg_type == "gatt_read":
                data = await self.gatt_read(msg["service"], msg["characteristic"])
                await ws.send(json.dumps({
                    "type": "gatt_read_response",
                    "req_id": req_id,
                    "characteristic": msg["characteristic"],
                    "data": base64.b64encode(data).decode("ascii"),
                }))

            elif msg_type == "gatt_write":
                raw = base64.b64decode(msg["data"])
                await self.gatt_write(msg["service"], msg["characteristic"], raw, msg.get("without_response", False))
                await ws.send(json.dumps({
                    "type": "gatt_write_response",
                    "req_id": req_id,
                    "characteristic": msg["characteristic"],
                    "success": True,
                }))

            elif msg_type == "gatt_subscribe":
                await self.gatt_subscribe(msg["service"], msg["characteristic"])
                await ws.send(json.dumps({
                    "type": "gatt_subscribed",
                    "req_id": req_id,
                    "characteristic": msg["characteristic"],
                }))

            elif msg_type == "gatt_unsubscribe":
                await self.gatt_unsubscribe(msg["service"], msg["characteristic"])
                await ws.send(json.dumps({
                    "type": "gatt_unsubscribed",
                    "req_id": req_id,
                    "characteristic": msg["characteristic"],
                }))

            else:
                logger.warning(f"Unknown message type: {msg_type}")
                await ws.send(json.dumps({"type": "error", "req_id": req_id, "error": f"Unknown type: {msg_type}"}))

        except Exception as e:
            logger.exception(f"Error handling {msg_type}")
            await ws.send(json.dumps({"type": "error", "req_id": req_id, "error": str(e)}))

    # ── WebSocket connection handler ────────────────────────────────────────
    async def handle_websocket(self, ws: websockets.WebSocketServerProtocol) -> None:
        self._ws_clients.add(ws)
        logger.info(f"WebSocket client connected from {ws.remote_address}")

        # Send current state immediately
        await ws.send(json.dumps({
            "type": "ble_state",
            "state": self.state,
            "address": self.device_info.get("address") if self.device_info else None,
            "name": self.device_info.get("name") if self.device_info else None,
            "retry_count": self.retry_count,
        }))

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    await self.handle_ws_message(ws, msg)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON from client")
        except websockets.ConnectionClosed:
            pass
        finally:
            self._ws_clients.discard(ws)
            logger.info(f"WebSocket client disconnected")


# ── Main ────────────────────────────────────────────────────────────────────
async def main() -> None:
    server = PokitBridgeServer()

    ws_server = await websockets.serve(
        server.handle_websocket,
        WS_HOST,
        WS_PORT,
        ping_interval=25,   # Send ping every 25s
        ping_timeout=10,  # Wait 10s for pong response
    )

    logger.info(f"Pokit Bridge Server started on ws://{WS_HOST}:{WS_PORT}")
    logger.info(f"Config directory: {CONFIG_DIR}")
    logger.info("Connect frontend WebSocket to this address instead of Web Bluetooth")

    await ws_server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
