# GPU Driver Fix Instructions

## Current Issue

**Driver/Library Version Mismatch:**
- Kernel module: `580.95.05`
- Libraries: `580.126.09`
- Error: `Failed to initialize NVML: Driver/library version mismatch`

**Impact:** GPU cannot be used in Docker containers (NVIDIA Container Runtime fails)

## Root Cause

The NVIDIA kernel module version doesn't match the user-space library version. This typically happens when:
1. Kernel was updated but driver wasn't reloaded
2. Libraries were updated but kernel module wasn't
3. System needs a reboot to sync versions

## Solution Options

### Option 1: Reboot (RECOMMENDED - Simplest)

The driver/library mismatch will be resolved after a reboot:

```bash
# On Optimus server
reboot
```

After reboot:
1. Verify GPU works: `nvidia-smi`
2. Restart Ollama with GPU: See "After Reboot" section below

### Option 2: Update Driver (If Reboot Not Possible)

```bash
# Check for driver updates
apt update
apt list --upgradable | grep nvidia

# Update NVIDIA packages
apt upgrade nvidia-driver-580 nvidia-utils-580

# Reboot (still required)
reboot
```

### Option 3: Reinstall Driver (If Above Don't Work)

```bash
# Remove old driver
apt remove --purge nvidia-driver-580

# Reinstall
apt install nvidia-driver-580

# Reboot
reboot
```

## After Reboot - Enable GPU in Ollama

Once GPU is working (`nvidia-smi` shows no errors):

### 1. Update docker-compose.yml

The GPU runtime is already enabled in `/opt/legion/docker-compose.yml`:
```yaml
runtime: nvidia
environment:
  - NVIDIA_VISIBLE_DEVICES=all
  - NVIDIA_DRIVER_CAPABILITIES=compute,utility
```

### 2. Restart Ollama Container

```bash
cd /opt/legion
docker-compose stop ollama
docker-compose rm -f ollama
docker-compose up -d ollama
```

### 3. Verify GPU Access

```bash
# Check container can see GPU
docker exec legion-ollama ls -la /dev/nvidia*

# Test inference speed (should be MUCH faster)
time curl -s http://localhost:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "llama3.2:latest", "messages": [{"role": "user", "content": "Say hi"}], "max_tokens": 10}'
```

**Expected:** Response in 1-3 seconds (vs 14 seconds on CPU)

## Current Status

- ✅ GPU hardware detected: NVIDIA RTX 3080
- ✅ NVIDIA container runtime installed
- ✅ Docker configured for GPU
- ❌ Driver/library version mismatch (needs reboot)
- ✅ Ollama running on CPU (llama3.2:latest, ~14 seconds per response)

## Performance Comparison

- **CPU-only (current)**: ~14 seconds per response (llama3.2)
- **GPU (after fix)**: ~1-3 seconds per response (estimated 5-10x faster)

## Notes

- The container is currently running without GPU (CPU-only)
- Performance is acceptable with llama3.2:latest (~14 seconds)
- GPU will provide significant speedup after reboot
- No data loss - models and data are in Docker volumes

---

**Next Step:** Reboot the server when convenient, then follow "After Reboot" steps above.
