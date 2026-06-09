#!/bin/bash
# Run script for Pokit Pro Python Server

cd "$(dirname "$0")"
source venv/bin/activate
python pokit_server.py
