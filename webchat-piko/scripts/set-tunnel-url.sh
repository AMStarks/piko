#!/usr/bin/env bash
# Start Cloudflare tunnel for Gmail OAuth (avoids "private IP" block) and update .env.
# Run from webchat-piko: ./scripts/set-tunnel-url.sh [upstream_url]
# Default upstream: http://localhost:3000. Use http://192.168.0.121:3000 if server is on Optimus.
set -e
UPSTREAM="${1:-http://localhost:3000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/.env"

echo "Starting Cloudflare tunnel to $UPSTREAM ..."
TMP=$(mktemp -d)
cloudflared tunnel --url "$UPSTREAM" > "$TMP/cloudflared.log" 2>&1 &
CF_PID=$!
trap "kill $CF_PID 2>/dev/null || true; rm -rf $TMP" EXIT

for i in $(seq 1 15); do
  sleep 1
  URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TMP/cloudflared.log" 2>/dev/null | head -1)
  if [[ -n "$URL" ]]; then
    break
  fi
done

if [[ -z "$URL" ]]; then
  echo "Could not get tunnel URL. Check $TMP/cloudflared.log"
  exit 1
fi

echo "Tunnel URL: $URL"

# Update .env
if grep -q '^PIKO_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i.bak "s|^PIKO_BASE_URL=.*|PIKO_BASE_URL=$URL|" "$ENV_FILE"
else
  echo "" >> "$ENV_FILE"
  echo "# Gmail OAuth tunnel URL (set by set-tunnel-url.sh)" >> "$ENV_FILE"
  echo "PIKO_BASE_URL=$URL" >> "$ENV_FILE"
fi
echo "Updated $ENV_FILE with PIKO_BASE_URL=$URL"

CALLBACK="${URL}/api/oauth/gmail/callback"
echo ""
echo "=========================================="
echo "GMAIL OAUTH – next steps"
echo "=========================================="
echo "1. Restart Piko server so it picks up PIKO_BASE_URL"
echo ""
echo "2. Add this redirect URI in Google Cloud Console:"
echo "   $CALLBACK"
echo "   → https://console.cloud.google.com/apis/credentials"
echo "   → Edit your OAuth 2.0 Client ID → Authorized redirect URIs"
echo ""
echo "3. In Piko app: Settings → Base URL → set to:"
echo "   $URL"
echo ""
echo "4. Try Add account (Gmail) again"
echo "=========================================="

# Keep tunnel running
echo ""
echo "Tunnel is running (PID $CF_PID). Press Ctrl+C to stop."
wait $CF_PID
