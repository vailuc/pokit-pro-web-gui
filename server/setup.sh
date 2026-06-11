#!/bin/bash
# Setup script for Pokit Pro Python Server

set -e

echo "Setting up Pokit Pro Python Server..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

echo "Setup complete!"
echo ""
echo "To run the server:"
echo "  source venv/bin/activate"
echo "  python pokit-server.py"
echo ""
echo "Or simply run:"
echo "  ./run-server.sh"
