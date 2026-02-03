#!/usr/bin/env bash
#
# OpenClaw on Optimus: reset + install (non-interactive parts).
# Run ON OPTIMUS (SSH to your server). Interactive steps (onboard, WhatsApp QR) you do after.
#
# Usage:
#   scp scripts/optimus-openclaw-reset-and-install.sh root@192.168.0.121:/tmp/
#   ssh root@192.168.0.121 'bash /tmp/optimus-openclaw-reset-and-install.sh'
#
set -e

echo "=== Phase 0: Reset ==="

# Stop Piko/ClawFriend bot if present
if systemctl list-units --full -all 2>/dev/null | grep -q clawfriend-bot; then
  echo "Stopping clawfriend-bot..."
  systemctl stop clawfriend-bot 2>/dev/null || true
  systemctl disable clawfriend-bot 2>/dev/null || true
fi

# Stop OpenClaw gateway if CLI is present
if command -v openclaw &>/dev/null; then
  echo "Stopping OpenClaw gateway..."
  openclaw gateway stop 2>/dev/null || true
  openclaw gateway uninstall 2>/dev/null || true
fi

# Remove systemd user unit if present (when running as root, user = root)
if [ -f /root/.config/systemd/user/openclaw-gateway.service ]; then
  echo "Removing OpenClaw user service..."
  systemctl --user disable --now openclaw-gateway.service 2>/dev/null || true
  rm -f /root/.config/systemd/user/openclaw-gateway.service
  systemctl --user daemon-reload 2>/dev/null || true
fi

# Remove state (root or current user)
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
if [ -d "$STATE_DIR" ]; then
  echo "Removing OpenClaw state at $STATE_DIR..."
  rm -rf "$STATE_DIR"
fi

# Optional: uninstall CLI to get a truly fresh install
# Uncomment the next two lines if you want to remove the CLI as well:
# npm rm -g openclaw 2>/dev/null || true
# echo "OpenClaw CLI removed. Re-run this script to install again, or run Phase 2 manually."

echo "=== Phase 1: Prerequisites ==="

NODE_VER=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 22 ]; then
  echo "WARNING: Node >= 22 required. Current: $(node -v 2>/dev/null || echo 'not found')"
  echo "Install Node 22+ and re-run. See OPENCLAW_OPTIMUS_WHATSAPP_FRESH_DEPLOY.md Phase 1."
  exit 1
fi
echo "Node: $(node -v)"

if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "WARNING: Ollama not reachable at http://localhost:11434"
  echo "Start Ollama (e.g. Docker container) and ensure it is on localhost:11434. See Phase 1."
  exit 1
fi
echo "Ollama: reachable"

echo "=== Phase 2: Install OpenClaw ==="

if ! command -v openclaw &>/dev/null; then
  echo "Installing OpenClaw CLI..."
  npm install -g openclaw@latest
else
  echo "OpenClaw CLI already installed: $(openclaw --version 2>/dev/null || true)"
  echo "To upgrade: npm install -g openclaw@latest"
fi

openclaw doctor 2>/dev/null || true

echo ""
echo "=== Next steps (do these interactively on Optimus) ==="
echo "1. Run onboarding (Telegram, Skip auth, Node, daemon):"
echo "   openclaw onboard --install-daemon"
echo ""
echo "2. Set Ollama for the gateway:"
echo "   - Add OLLAMA_API_KEY=ollama-local to the gateway service environment (see Phase 4 in the guide)."
echo "   - Remove any explicit models.providers.ollama from ~/.openclaw/openclaw.json."
echo "   - Set agents.defaults.model.primary to e.g. ollama/llama3.1:latest."
echo "   - Restart: openclaw gateway restart (or systemctl --user restart openclaw-gateway)."
echo ""
echo "3. Telegram: send a message to your bot; approve pairing with:"
echo "   openclaw pairing approve telegram <CODE>"
echo ""
echo "4. Create workspace SOUL.md and IDENTITY.md in ~/.openclaw/workspace/ (see Phase 6)."
echo ""
echo "Full guide: OPENCLAW_OPTIMUS_TELEGRAM_FRESH_DEPLOY.md"
