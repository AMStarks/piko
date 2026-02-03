# Using Ollama with OpenClaw (FREE Option!)

**Great news:** You already have Ollama running on Optimus with llama3.1 and llama3.2 models. This means you can use OpenClaw **completely free** without paying for OpenAI or Anthropic APIs!

## Why Use Ollama?

- ✅ **100% FREE** - No API costs
- ✅ **Already installed** - Running in Docker on Optimus
- ✅ **Privacy** - All processing happens locally on your server
- ✅ **No rate limits** - Use as much as you want
- ✅ **OpenAI-compatible API** - Works with OpenClaw

## Current Setup

Your Ollama instance:
- **URL**: `http://localhost:11434` (or `http://127.0.0.1:11434`)
- **Models available**:
  - `llama3.1:latest` (8B parameters, 4.9 GB) - **Recommended**
  - `llama3.2:latest` (3.2B parameters, 2.0 GB)

## How to Configure OpenClaw with Ollama

Ollama provides an **OpenAI-compatible API**, so OpenClaw can use it as if it were OpenAI. Here's how:

### Option 1: Configure After Onboarding

1. **Run onboarding** (skip API key):
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   openclaw onboard --non-interactive --accept-risk \
     --flow quickstart --mode local \
     --auth-choice skip \
     --gateway-port 8080 --gateway-bind lan \
     --gateway-auth token --gateway-token $(openssl rand -hex 32) \
     --install-daemon
   ```

2. **Edit OpenClaw config** to use Ollama:
   ```bash
   nano ~/.openclaw/config.yaml
   ```

3. **Add/modify the OpenAI provider** to point to Ollama:
   ```yaml
   providers:
     openai:
       apiKey: "ollama"  # Placeholder, not used
       baseURL: "http://localhost:11434/v1"  # Ollama's OpenAI-compatible endpoint
       model: "llama3.1:latest"
   ```

4. **Restart OpenClaw**:
   ```bash
   systemctl restart openclaw
   ```

### Option 2: Use Environment Variables

Some OpenClaw versions support custom endpoints via environment variables:

```bash
export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="llama3.1:latest"
```

Then run onboarding normally.

### Option 3: Test Ollama API First

Verify Ollama's OpenAI-compatible endpoint works:

```bash
# On Optimus server
curl http://localhost:11434/v1/models

# Test a completion
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:latest",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

If this works, OpenClaw should be able to use it.

## Performance Considerations

**llama3.1 (8B)** is recommended for OpenClaw because:
- Better reasoning capabilities
- Supports tool/function calling (needed for OpenClaw features)
- Good balance of speed and quality

**llama3.2 (3.2B)** is faster but:
- Less capable for complex tasks
- May struggle with some OpenClaw features

## Troubleshooting

### Ollama not accessible
```bash
# Check if Ollama container is running
docker ps | grep ollama

# Check Ollama logs
docker logs legion-ollama

# Test API
curl http://localhost:11434/api/tags
```

### OpenClaw can't connect to Ollama
- Ensure Ollama is accessible at `http://localhost:11434`
- Check OpenClaw config has correct `baseURL`
- Verify model name matches exactly: `llama3.1:latest`

### Slow responses
- llama3.1 is slower than cloud APIs but free
- Consider using llama3.2 for faster (but less capable) responses
- Ensure server has enough RAM (8GB+ recommended for llama3.1)

## Cost Comparison

| Option | Cost | Speed | Quality |
|--------|------|-------|---------|
| **Ollama (llama3.1)** | **FREE** | Medium | Good |
| **Ollama (llama3.2)** | **FREE** | Fast | Fair |
| OpenAI GPT-4 | ~$0.03/1K tokens | Fast | Excellent |
| Anthropic Claude | ~$0.015/1K tokens | Fast | Excellent |

**For your use case** (keeping projects running while away), Ollama should work great and save you money!

## Next Steps

1. ✅ Configure OpenClaw to use Ollama (see options above)
2. ✅ Test with a simple command via WhatsApp/Telegram
3. ✅ If needed, upgrade to paid APIs later for better quality

---

**Questions?** The OpenClaw community can help with Ollama integration specifics! 🦞
