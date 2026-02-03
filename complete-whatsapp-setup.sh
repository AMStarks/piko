#!/bin/bash
# Complete WhatsApp Setup - Run this in an interactive terminal
# This script will maintain the connection while you scan the QR code

echo "🦞 OpenClaw WhatsApp Setup"
echo "========================"
echo ""
echo "This will start WhatsApp pairing."
echo "Keep this terminal open while you scan the QR code!"
echo ""
echo "On your iPhone:"
echo "  1. Open WhatsApp"
echo "  2. Go to Settings → Linked Devices"
echo "  3. Tap 'Link a Device'"
echo "  4. Scan the QR code that appears below"
echo ""
read -p "Press Enter to start..."

echo ""
echo "Connecting to Optimus server..."
echo "QR code will appear below - scan it with your iPhone!"
echo ""

ssh -i ~/.ssh/id_optimus -t root@192.168.0.121 "openclaw channels login --channel whatsapp"

echo ""
echo ""
echo "If you see 'Connected' above, WhatsApp is now linked!"
echo "You can now message your OpenClaw agent from your iPhone."
echo ""
