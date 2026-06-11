# Raspberry Pi & Kiosk Notes

> **Status:** Planned but not yet tested. This document describes the intended deployment target, not a verified setup.
>
> The project was built as a lightweight UX for my own Pokit Pro and shared immediately. Pi kiosk mode is the next milestone, not the starting point.

## The Vision

A bench-top kiosk: a Raspberry Pi 4 or 5 running the Pokit GUI in fullscreen Chromium, powered by the Python BLE bridge for maximum DSO performance. No keyboard or mouse required — just the Pi, a display, and the Pokit Pro.

## What Would Be Needed

### Hardware

- Raspberry Pi 4 or 5
- Official 7" touchscreen or HDMI display
- Pokit Pro (BLE 5.0)
- Reliable 5V power supply

### Software Stack (Planned)

| Component | Purpose |
|-----------|---------|
| Arch Linux ARM / Raspberry Pi OS (Bookworm) | Base OS |
| `bluez` + `bluetooth` service | BLE stack |
| `sway` or `labwc` | Wayland compositor (no desktop environment needed) |
| Chromium (with `--kiosk --app=http://localhost:5173`) | Frontend display |
| Python 3.10+ venv | Bridge server |
| systemd service | Auto-start bridge on boot |

### Chromium Flags

```bash
chromium-browser \
  --kiosk \
  --app=http://localhost:5173 \
  --enable-features=WebBluetoothNewPermissionsBackend \
  --enable-experimental-web-platform-features \
  --autoplay-policy=no-user-gesture-required
```

### Auto-Start Service (Template)

`/etc/systemd/system/pokit-bridge.service`:

```ini
[Unit]
Description=Pokit Pro BLE Bridge
After=bluetooth.target network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pokit-pro-web-gui/server
ExecStart=/home/pi/pokit-pro-web-gui/server/venv/bin/python pokit_server.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable --now pokit-bridge
```

## Known Unknowns

These have not been tested and may require debugging:

- **Web Bluetooth on Pi Chromium** — The `WebBluetoothNewPermissionsBackend` flag is required, but device chooser behaviour on Pi OS Bookworm is untested.
- **BLE stability** — The Pi's onboard Bluetooth is adequate for HID but may show different behaviour with sustained BLE notifications (bridge mode is preferred here).
- **Touchscreen UX** — The UI is not yet optimised for touch. Buttons and dropdowns may need size adjustments.
- **Thermal throttling** — Extended DSO use with the bridge may load the Pi's CPU. A heatsink or fan is recommended.
- **Auto-connect flow** — The bridge currently requires a manual `Connect` click. Headless auto-pairing to a known MAC address is on the roadmap but not implemented.

## Why Share This Now?

This project started as a quick tool for my own bench. I wanted a clean, fast way to use my Kickstarter Pokit Pro without installing proprietary apps or creating accounts. Once it worked, I shared it in case others find it useful.

The Pi kiosk vision came later, as a natural fit for a lab bench tool. If you try it and hit issues, open an issue — real-world feedback is the fastest way to stabilise it.

## Related

- [`server/README.md`](../server/README.md) — Bridge server setup and requirements
- [`README.md`](../README.md) — Main project documentation
