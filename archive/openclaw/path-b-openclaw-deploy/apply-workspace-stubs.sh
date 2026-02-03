#!/usr/bin/env bash
# Re-apply minimal workspace stubs so OpenClaw doesn't inject long defaults.
# Run on Optimus after gateway restart if AGENTS.md etc get overwritten.
# Usage: ./apply-workspace-stubs.sh [WORKSPACE_DIR]

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${1:-/root/.openclaw/workspace}"

echo "Applying minimal stubs to $WORKSPACE"
mkdir -p "$WORKSPACE"
echo '# See SOUL.md and IDENTITY.md.' > "$WORKSPACE/AGENTS.md"
echo '# No heartbeat tasks.' > "$WORKSPACE/HEARTBEAT.md"
echo '# Local notes only.' > "$WORKSPACE/TOOLS.md"
echo '# User: friend.' > "$WORKSPACE/USER.md"
[ -f "$SCRIPT_DIR/workspace/SOUL.md" ] && cp "$SCRIPT_DIR/workspace/SOUL.md" "$WORKSPACE/SOUL.md"
[ -f "$SCRIPT_DIR/workspace/IDENTITY.md" ] && cp "$SCRIPT_DIR/workspace/IDENTITY.md" "$WORKSPACE/IDENTITY.md"
echo "Done. Restart gateway if needed: systemctl --user restart openclaw-gateway.service"
