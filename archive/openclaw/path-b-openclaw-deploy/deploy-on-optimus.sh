#!/usr/bin/env bash
# Path B OpenClaw deploy on Optimus.
# Run as root on Optimus (e.g. after copying this directory to /root/path-b-openclaw-deploy).
# Prereqs: Node, OpenClaw, Ollama (or Docker legion-ollama), systemd user session for root.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-/root/.openclaw}"
WORKSPACE="${OPENCLAW_ROOT}/workspace"
CONFIG="${OPENCLAW_ROOT}/openclaw.json"
BACKUP_SUFFIX="path-b-backup-$(date +%Y%m%d-%H%M%S)"
OLLAMA_PULL_CMD="${OLLAMA_PULL_CMD:-ollama pull}"
MODEL_NAME="qwen2.5:32b-instruct-q4_K_M"
GATEWAY_SERVICE="${GATEWAY_SERVICE:-$HOME/.config/systemd/user/openclaw-gateway.service}"

echo "[Path B] OpenClaw deploy (32B Qwen, soul cleanse)"
echo "  OPENCLAW_ROOT=$OPENCLAW_ROOT"
echo "  OLLAMA_PULL_CMD=$OLLAMA_PULL_CMD"
echo ""

# 1. Backups
echo "[1/7] Backing up workspace and config..."
mkdir -p "$OPENCLAW_ROOT"
[ -d "$WORKSPACE" ] && cp -a "$WORKSPACE" "${WORKSPACE}.${BACKUP_SUFFIX}" && echo "  Workspace backed up." || echo "  No workspace to back up."
[ -f "$CONFIG" ] && cp -a "$CONFIG" "${CONFIG}.${BACKUP_SUFFIX}" && echo "  Config backed up." || echo "  No config to back up."

# 2. Workspace soul cleanse
echo "[2/7] Workspace soul cleanse..."
mkdir -p "$WORKSPACE"
for f in AGENTS.md HEARTBEAT.md TOOLS.md USER.md; do
  [ -f "$WORKSPACE/$f" ] && rm -f "$WORKSPACE/$f" && echo "  Removed $f"
done
cp "$SCRIPT_DIR/workspace/SOUL.md" "$WORKSPACE/SOUL.md"
cp "$SCRIPT_DIR/workspace/IDENTITY.md" "$WORKSPACE/IDENTITY.md"
echo "  Installed SOUL.md, IDENTITY.md"

# 3. Config patch (32B, openai-chat, bootstrapMaxChars)
echo "[3/7] Patching openclaw.json..."
node "$SCRIPT_DIR/update-openclaw-config.js" "$CONFIG"

# 4. Pull 32B model
echo "[4/7] Pulling model $MODEL_NAME (this may take several minutes)..."
if $OLLAMA_PULL_CMD "$MODEL_NAME"; then
  echo "  Model pulled."
else
  echo "  WARN: Pull failed or timed out. If Ollama runs in Docker, set OLLAMA_PULL_CMD='docker exec legion-ollama ollama pull' and re-run step 4."
fi

# 5. Gateway service: add OLLAMA_NUM_GPU_LAYERS if missing
echo "[5/7] Gateway service GPU layers..."
if [ -f "$GATEWAY_SERVICE" ] && ! grep -q 'OLLAMA_NUM_GPU_LAYERS' "$GATEWAY_SERVICE"; then
  sed -i '/\[Service\]/a Environment="OLLAMA_NUM_GPU_LAYERS=40"' "$GATEWAY_SERVICE"
  echo "  Added OLLAMA_NUM_GPU_LAYERS=40"
else
  echo "  Already set or service not found."
fi

# 6. Restart gateway
echo "[6/7] Restarting OpenClaw gateway..."
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service || true
sleep 3
echo "  Gateway restarted."

# 7. Validate
echo "[7/7] Validation..."
export HOME="${HOME:-/root}"
if command -v openclaw >/dev/null 2>&1; then
  openclaw health    || true
  openclaw models list || true
  echo ""
  echo "Agent test (openclaw agent --message \"Hello\"):"
  openclaw agent --message "Hello" || true
else
  echo "  openclaw CLI not in PATH; run openclaw health and openclaw agent --message \"Hello\" manually."
fi

echo ""
echo "[Path B] Deploy complete. Test on Telegram: send 'Hello' to your bot."
