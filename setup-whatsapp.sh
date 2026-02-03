#!/bin/bash
# WhatsApp Channel Setup Script for OpenClaw
# Run this script interactively to pair WhatsApp

echo "🦞 OpenClaw WhatsApp Channel Setup"
echo "=================================="
echo ""
echo "This script will set up WhatsApp channel for OpenClaw."
echo "You'll need to scan a QR code with your iPhone."
echo ""
echo "Make sure you have:"
echo "  - Your iPhone with WhatsApp installed"
echo "  - WhatsApp open and ready to scan QR code"
echo ""
read -p "Press Enter to continue..."

echo ""
echo "Starting WhatsApp login process..."
echo "A QR code will appear - scan it with your iPhone:"
echo "  WhatsApp → Settings → Linked Devices → Link a Device"
echo ""

ssh -i ~/.ssh/id_optimus root@192.168.0.121 "openclaw channels login --channel whatsapp"

echo ""
echo "If the QR code timed out, you can run this command directly on the server:"
echo "  ssh -i ~/.ssh/id_optimus root@192.168.0.121"
echo "  openclaw channels login --channel whatsapp"
echo ""
