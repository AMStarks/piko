# Better Free Models for OpenClaw

Your server has **31GB RAM (25GB available)** and a **Ryzen 5 5600** - you can run much stronger models than llama3.1:8b!

## Current Setup
- **llama3.1:latest** (8B, 4.9GB) - Good but limited
- **llama3.2:latest** (3.2B, 2.0GB) - Fast but less capable

## Recommended Upgrades (All FREE!)

### 🏆 Best Overall: **llama3.1:70b** (Recommended)
- **Size**: ~40GB (quantized versions available)
- **Quality**: Excellent reasoning, coding, and tool use
- **RAM needed**: ~45-50GB (might be tight, but try Q4_K_M quantization)
- **Speed**: Slower but much better quality
- **Best for**: Complex tasks, coding, reasoning

```bash
# Try the quantized version first (smaller, faster)
docker exec legion-ollama ollama pull llama3.1:70b-q4_K_M
```

### 🥈 Best for Coding: **codellama:34b** (Meta - US Company)
- **Size**: ~20GB
- **Quality**: Excellent for coding tasks (what OpenClaw needs!)
- **RAM needed**: ~25GB
- **Speed**: Good balance
- **Best for**: Cursor integration, code generation, debugging
- **Origin**: Meta (US company, open source, trusted)

```bash
docker exec legion-ollama ollama pull codellama:34b
```

**Note**: DeepSeek-coder was removed from recommendations due to origin concerns. Codellama is a great alternative from Meta.

### 🥉 Best Balance: **mixtral:8x7b**
- **Size**: ~26GB
- **Quality**: Very good, great reasoning
- **RAM needed**: ~30GB
- **Speed**: Good
- **Best for**: General tasks, good tool calling

```bash
docker exec legion-ollama ollama pull mixtral:8x7b
```

### 🚀 Best Speed/Quality: **qwen2.5:72b**
- **Size**: ~42GB
- **Quality**: Excellent, competitive with GPT-4
- **RAM needed**: ~48GB (might be tight)
- **Speed**: Moderate
- **Best for**: Best quality if it fits

```bash
docker exec legion-ollama ollama pull qwen2.5:72b
```

### 💡 Good Alternative: **mistral-large:latest**
- **Size**: ~13GB
- **Quality**: Very good
- **RAM needed**: ~18GB
- **Speed**: Fast
- **Best for**: Good balance, fits easily

```bash
docker exec legion-ollama ollama pull mistral-large:latest
```

## Quick Comparison

| Model | Size | RAM Needed | Quality | Speed | Best For |
|-------|------|-------------|---------|-------|----------|
| **llama3.1:8b** (current) | 4.9GB | 8GB | Good | Fast | General use |
| **codellama:34b** | 20GB | 25GB | Excellent | Good | **Coding tasks** ⭐ |
| **mistral-large** | 13GB | 18GB | Very Good | Fast | Balanced |
| **mixtral:8x7b** | 26GB | 30GB | Very Good | Good | General + tools |
| **llama3.1:70b** | 40GB | 45GB | Excellent | Slow | **Best quality** ⭐ |
| **qwen2.5:72b** | 42GB | 48GB | Excellent | Moderate | Best overall |

## My Recommendation for OpenClaw

**Start with `codellama:34b`** (or `llama3.1:70b` if you want best quality) because:
1. ✅ **Perfect for coding** - OpenClaw's main use case
2. ✅ **Fits in your RAM** - 25GB available, model needs ~25GB
3. ✅ **Excellent tool calling** - Critical for OpenClaw features
4. ✅ **Good speed** - Not too slow for interactive use
5. ✅ **FREE** - No cost

If you want even better quality and don't mind slower responses, try **llama3.1:70b** (quantized).

## Installation Steps

### 1. Check Available Space
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
df -h /  # Check disk space
free -h  # Check RAM
```

### 2. Pull Your Chosen Model
```bash
# Recommended: codellama for coding tasks (Meta, US company)
docker exec legion-ollama ollama pull codellama:34b

# OR for best overall quality
docker exec legion-ollama ollama pull llama3.1:70b-q4_K_M

# OR for balanced performance
docker exec legion-ollama ollama pull mistral-large:latest
```

### 3. Test the Model
```bash
docker exec legion-ollama ollama run codellama:34b "Write a Python function to reverse a string"
```

### 4. Update OpenClaw Config
After pulling a new model, update OpenClaw to use it:

```bash
# Edit OpenClaw config
nano ~/.openclaw/config.yaml

# Change model name to your new model
# Example:
# model: "deepseek-coder:33b"
```

### 5. Restart OpenClaw
```bash
systemctl restart openClaw
```

## Performance Tips

### CPU-Only Inference
Since you don't have a GPU, models will run slower but still work. Tips:
- Use quantized models (Q4_K_M, Q5_K_M) - smaller and faster
- Consider smaller models if speed is critical
- For best quality, accept slower responses with larger models

### Memory Management
- Monitor RAM usage: `watch -n 1 free -h`
- Close other services if needed
- Use swap if RAM is tight (slower but works)

## Model Size Reference

Quantization levels (smaller = faster, less quality):
- **Q4_K_M**: Good balance (recommended)
- **Q5_K_M**: Better quality, larger
- **Q8_0**: Best quality, largest
- **F16**: Full precision (largest, slowest)

## Testing Models

Test different models to see what works best:

```bash
# List available models
docker exec legion-ollama ollama list

# Test a model
docker exec legion-ollama ollama run deepseek-coder:33b "Explain how to use OpenClaw with Cursor"

# Compare response quality
docker exec legion-ollama ollama run llama3.1:8b "Same question"
docker exec legion-ollama ollama run codellama:34b "Same question"
```

## Next Steps

1. ✅ Pull `codellama:34b` (recommended for coding, Meta/US company)
2. ✅ Test it with a coding task
3. ✅ Update OpenClaw config to use the new model
4. ✅ Test OpenClaw with the new model
5. ✅ If needed, try `llama3.1:70b` for even better quality

## Security Note

See `DEEPSEEK_SECURITY_NOTE.md` for information about model origins and privacy considerations.

---

**Remember**: All these models are 100% FREE! No API costs. 🎉
