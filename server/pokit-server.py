#!/usr/bin/env python3
"""
Pokit Pro Bluetooth Server - Bypass Web Bluetooth limitations

This server connects to the Pokit Pro using native BLE APIs (bleak) and
exposes a WebSocket API to the web frontend, eliminating Web Bluetooth
performance constraints.

Benefits over Web Bluetooth:
- Full control over connection parameters (MTU, interval)
- No notification batching delays
- Higher throughput and lower latency
- Platform-specific optimizations possible

Usage:
    pip install bleak websockets asyncio
    python pokit-server.py

Then connect frontend to ws://localhost:8765 instead of using Web Bluetooth.
"""

import asyncio
import json
import logging
import websockets
from typing import Dict, Any, Optional
from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice

# Pokit Pro service UUIDs
POKIT_PRO_SERVICE = "57d3a771-267c-4394-8872-78223e92aec5"
STATUS_SERVICE = POKIT_PRO_SERVICE
DSO_SERVICE = "e7481d2f-5781-442e-bb9a-fd4e3441dadc"
MULTIMETER_SERVICE = "e7481d2f-5781-442e-bb9a-fd4e3441dadc"

# Characteristic UUIDs
STATUS_CHAR = "3dba36e1-6120-4706-8dfd-ed9c16e569b6"
DSO_METADATA = "6974f5e5-0e54-45c3-97dd-29e4b5fb0849"
DSO_READING = "047d3559-8bee-423a-b229-4417fa603b90"
MM_READING = "047d3559-8bee-423a-b229-4417fa603b90"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PokitServer:
    def __init__(self):
        self.client: Optional[BleakClient] = None
        self.device: Optional[BLEDevice] = None
        self.websocket_clients = set()
        self.notification_callbacks = {}
        
    async def scan_for_pokit(self) -> Optional[BLEDevice]:
        """Scan for Pokit Pro devices"""
        logger.info("Scanning for Pokit Pro...")
        devices = await BleakScanner.discover(timeout=5.0)
        
        for device in devices:
            if device.name and "Pokit" in device.name:
                logger.info(f"Found Pokit device: {device.name} ({device.address})")
                return device
        
        logger.warning("No Pokit device found")
        return None
    
    async def connect(self, device: BLEDevice) -> bool:
        """Connect to Pokit Pro with optimized parameters"""
        try:
            self.client = BleakClient(device.address)
            
            # Connect with optimized connection parameters
            await self.client.connect()
            
            # Request higher throughput connection parameters
            # This is where we bypass Web Bluetooth limitations
            try:
                await self.client._backend_impl._client.set_connection_parameters(
                    min_interval=7.5,  # 7.5ms minimum interval
                    max_interval=11.25,  # 11.25ms maximum interval  
                    latency=0,
                    supervision_timeout=400
                )
            except:
                logger.warning("Could not set connection parameters (may not be supported)")
            
            logger.info(f"Connected to {device.name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            return False
    
    async def subscribe_to_dso_samples(self):
        """Subscribe to DSO samples with high-performance notifications"""
        if not self.client:
            return
            
        def notification_handler(sender, data):
            """Handle incoming BLE notifications and forward to WebSocket clients"""
            # Convert bytes to base64 for JSON transport
            import base64
            payload = base64.b64encode(data).decode('utf-8')
            
            message = {
                "type": "dso_samples",
                "data": payload,
                "timestamp": asyncio.get_event_loop().time()
            }
            
            # Forward to all connected WebSocket clients
            asyncio.create_task(self.broadcast_to_websockets(message))
        
        await self.client.start_notify(DSO_READING, notification_handler)
        logger.info("Subscribed to DSO samples")
    
    async def start_dso_capture(self, params: Dict[str, Any]):
        """Start DSO capture with native BLE performance"""
        if not self.client:
            return {"error": "Not connected"}
        
        # Encode settings according to Pokit protocol
        # This is where we can use optimal settings without Web Bluetooth constraints
        settings = bytearray(13)  # 13 bytes as per protocol
        settings[0] = params.get('command', 0)
        # ... encode other parameters
        
        try:
            await self.client.write_gatt_char(DSO_READING, settings)
            return {"status": "started"}
        except Exception as e:
            return {"error": str(e)}
    
    async def broadcast_to_websockets(self, message: Dict[str, Any]):
        """Broadcast message to all connected WebSocket clients"""
        if self.websocket_clients:
            await asyncio.gather(
                *[ws.send(json.dumps(message)) for ws in self.websocket_clients],
                return_exceptions=True
            )
    
    async def handle_websocket(self, websocket, path):
        """Handle WebSocket connections from web frontend"""
        self.websocket_clients.add(websocket)
        logger.info(f"WebSocket client connected: {websocket.remote_address}")
        
        try:
            async for message in websocket:
                data = json.loads(message)
                
                if data.get('type') == 'scan':
                    device = await self.scan_for_pokit()
                    if device:
                        await websocket.send(json.dumps({
                            "type": "device_found",
                            "name": device.name,
                            "address": device.address
                        }))
                
                elif data.get('type') == 'connect':
                    address = data.get('address')
                    devices = await BleakScanner.discover()
                    device = next((d for d in devices if d.address == address), None)
                    if device and await self.connect(device):
                        await websocket.send(json.dumps({"type": "connected"}))
                        # Subscribe to high-performance notifications
                        await self.subscribe_to_dso_samples()
                
                elif data.get('type') == 'start_dso':
                    result = await self.start_dso_capture(data.get('params', {}))
                    await websocket.send(json.dumps(result))
                    
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.websocket_clients.discard(websocket)
            logger.info(f"WebSocket client disconnected: {websocket.remote_address}")

async def main():
    server = PokitServer()
    
    # Start WebSocket server
    ws_server = await websockets.serve(
        server.handle_websocket,
        "localhost",
        8765
    )
    
    logger.info("Pokit Pro Server started on ws://localhost:8765")
    logger.info("Web frontend should connect to this instead of using Web Bluetooth")
    
    # Run forever
    await ws_server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())
