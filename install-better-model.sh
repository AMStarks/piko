#!/bin/bash
# Install a Better Free Model for OpenClaw on Optimus
# This script helps you upgrade from llama3.1:8b to a stronger model

set -e

echo "🚀 Better Free Model Installer for OpenClaw"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Model recommendations based on use case
echo "Recommended models for OpenClaw (all FREE):"
echo ""
echo "1. ${GREEN}mistral-large:latest${NC} (RECOMMENDED - Best for 'Friend' + Nuance)"
echo "   - Size: ~13GB"
echo "   - Best for: Conversation, personality, general knowledge, coding"
echo "   - RAM needed: ~18GB (fits easily ✅)"
echo "   - Origin: Mistral AI (French company, privacy-focused) ✅"
echo ""
echo "2. ${BLUE}llama3.1:70b-q4_K_M${NC} (Best quality overall)"
echo "   - Size: ~40GB"
echo "   - Best for: Best conversation, nuance, reasoning"
echo "   - RAM needed: ~45GB (tight, may need to close services ⚠️)"
echo "   - Origin: Meta (US company) ✅"
echo ""
echo "3. ${YELLOW}codellama:34b${NC} (Best for coding only)"
echo "   - Size: ~20GB"
echo "   - Best for: Cursor integration, code generation"
echo "   - RAM needed: ~25GB (fits ✅)"
echo "   - Origin: Meta (US company) ✅"
echo "   - Note: Less conversational, more technical"
echo ""

read -p "Which model do you want to install? (1/2/3) [1]: " choice
choice=${choice:-1}

case $choice in
    1)
        MODEL="mistral-large:latest"
        echo -e "${GREEN}→${NC} Installing mistral-large:latest (best for 'friend' + nuance + coding)..."
        ;;
    2)
        MODEL="llama3.1:70b-q4_K_M"
        echo -e "${BLUE}→${NC} Installing llama3.1:70b-q4_K_M (best quality overall, tight RAM)..."
        ;;
    3)
        MODEL="codellama:34b"
        echo -e "${YELLOW}→${NC} Installing codellama:34b (best for coding, less conversational)..."
        ;;
    *)
        echo "Invalid choice. Using default: deepseek-coder:33b"
        MODEL="deepseek-coder:33b"
        ;;
esac

echo ""
echo "This will download the model (may take 10-30 minutes depending on size)..."
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo -e "${GREEN}→${NC} Pulling model from Ollama..."
docker exec legion-ollama ollama pull "$MODEL"

echo ""
echo -e "${GREEN}✓${NC} Model installed!"
echo ""
echo "Testing the model..."
docker exec legion-ollama ollama run "$MODEL" "Hello! Can you help with coding tasks?"

echo ""
echo -e "${GREEN}✓${NC} Model is working!"
echo ""
echo "📝 Next steps:"
echo "  1. Update OpenClaw config to use: $MODEL"
echo "  2. Edit: ~/.openclaw/config.yaml"
echo "  3. Change model name to: $MODEL"
echo "  4. Restart OpenClaw: systemctl restart openclaw"
echo ""
echo "Or test it manually:"
echo "  docker exec legion-ollama ollama run $MODEL 'Your question here'"
echo ""
