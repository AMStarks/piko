#!/bin/bash
# OpenClaw Setup Script for Optimus Server
# This script configures OpenClaw on the Optimus server for remote control via WhatsApp/Telegram

set -e

echo "🦞 OpenClaw Setup for Optimus Server"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration variables (set these before running)
USE_OLLAMA="${USE_OLLAMA:-true}"  # Use free local Ollama by default
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:latest}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-$(openssl rand -hex 32)}"
AGENT_NAME="${AGENT_NAME:-Optimus}"

# Check if we're on the server
if [ ! -f "/usr/bin/openclaw" ]; then
    echo -e "${RED}Error: OpenClaw is not installed. Run the installer first:${NC}"
    echo "  curl -fsSL https://openclaw.ai/install.sh | bash"
    exit 1
fi

echo -e "${GREEN}✓${NC} OpenClaw is installed"
echo ""

# Check for Ollama (free option)
if [ "$USE_OLLAMA" = "true" ]; then
    if curl -s "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Ollama is running at $OLLAMA_URL"
        echo -e "${GREEN}→${NC} Using FREE local model: $OLLAMA_MODEL"
        echo ""
        echo -e "${YELLOW}Note:${NC} OpenClaw will be configured to use Ollama's OpenAI-compatible API."
        echo "  This means $0 cost for API usage!"
        echo ""
        AUTH_CHOICE="openai-api-key"  # Ollama uses OpenAI-compatible API
        API_KEY_FLAG="--openai-api-key"
        API_KEY_VALUE="ollama"  # Placeholder, will configure endpoint in config file
        USE_OLLAMA_SETUP=true
    else
        echo -e "${YELLOW}⚠${NC}  Ollama not accessible at $OLLAMA_URL"
        echo "  Falling back to paid API options..."
        USE_OLLAMA_SETUP=false
    fi
else
    USE_OLLAMA_SETUP=false
fi

# Check for paid API key if not using Ollama
if [ "$USE_OLLAMA_SETUP" != "true" ]; then
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${YELLOW}⚠${NC}  No API key provided. Please set one of:"
        echo "  export ANTHROPIC_API_KEY='your-key-here'"
        echo "  export OPENAI_API_KEY='your-key-here'"
        echo "  OR use free Ollama: export USE_OLLAMA=true"
        echo ""
        read -p "Do you want to continue with manual API key setup later? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        AUTH_CHOICE="skip"
        API_KEY_FLAG=""
        API_KEY_VALUE=""
    else
        # Determine auth choice for paid APIs
        if [ -n "$ANTHROPIC_API_KEY" ]; then
            AUTH_CHOICE="anthropic-api-key"
            API_KEY_FLAG="--anthropic-api-key"
            API_KEY_VALUE="$ANTHROPIC_API_KEY"
        elif [ -n "$OPENAI_API_KEY" ]; then
            AUTH_CHOICE="openai-api-key"
            API_KEY_FLAG="--openai-api-key"
            API_KEY_VALUE="$OPENAI_API_KEY"
        fi
    fi
fi

echo -e "${GREEN}→${NC} Running OpenClaw onboarding (non-interactive mode)..."
echo ""

# Run onboarding
if [ -n "$API_KEY_VALUE" ]; then
    openclaw onboard \
        --non-interactive \
        --accept-risk \
        --flow quickstart \
        --mode local \
        --auth-choice "$AUTH_CHOICE" \
        $API_KEY_FLAG "$API_KEY_VALUE" \
        --gateway-port "$GATEWAY_PORT" \
        --gateway-bind lan \
        --gateway-auth token \
        --gateway-token "$GATEWAY_TOKEN" \
        --install-daemon
else
    openclaw onboard \
        --non-interactive \
        --accept-risk \
        --flow quickstart \
        --mode local \
        --auth-choice skip \
        --gateway-port "$GATEWAY_PORT" \
        --gateway-bind lan \
        --gateway-auth token \
        --gateway-token "$GATEWAY_TOKEN" \
        --install-daemon
fi

echo ""
echo -e "${GREEN}✓${NC} OpenClaw onboarding complete!"
echo ""

# Configure Ollama if using it
if [ "$USE_OLLAMA_SETUP" = "true" ]; then
    echo -e "${GREEN}→${NC} Configuring Ollama integration..."
    CONFIG_FILE="$HOME/.openclaw/config.yaml"
    if [ -f "$CONFIG_FILE" ]; then
        # Add Ollama configuration (OpenAI-compatible endpoint)
        # This will need to be done via OpenClaw's config or after first run
        echo "  Ollama endpoint: $OLLAMA_URL"
        echo "  Model: $OLLAMA_MODEL"
        echo ""
        echo -e "${YELLOW}Note:${NC} After onboarding, you may need to configure the OpenAI-compatible"
        echo "  endpoint in OpenClaw config to point to Ollama at $OLLAMA_URL"
        echo "  Check OpenClaw docs for 'custom OpenAI endpoint' configuration"
    fi
fi

echo "📝 Configuration Summary:"
echo "  Gateway Port: $GATEWAY_PORT"
echo "  Gateway Token: $GATEWAY_TOKEN"
echo "  Gateway URL: http://192.168.0.121:$GATEWAY_PORT"
if [ "$USE_OLLAMA_SETUP" = "true" ]; then
    echo "  AI Model: Ollama ($OLLAMA_MODEL) - FREE!"
else
    echo "  AI Model: $AUTH_CHOICE"
fi
echo ""
echo "🔐 Save your gateway token securely!"
echo ""
echo "Next steps:"
echo "  1. Set up WhatsApp channel: openclaw channels login --channel whatsapp"
echo "  2. Set up Telegram channel: openclaw channels login --channel telegram"
echo "  3. Install cursor-agent skill for Cursor integration"
echo "  4. Configure SSH access to MacBook for Cursor CLI commands"
if [ "$USE_OLLAMA_SETUP" = "true" ]; then
    echo "  5. Verify Ollama integration in OpenClaw config"
fi
echo ""
