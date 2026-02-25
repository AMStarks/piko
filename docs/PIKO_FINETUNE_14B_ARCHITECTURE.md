# Piko Fine-Tune: 14B on 2×10GB — Architectural Fix

Qwen2.5-14B OOMs on 2× RTX 3080 (10GB each) when using the standard HF + BnB flow. The failure is **architectural**, not config.

## The Problem

```
HF from_pretrained() → materialize weights (FP16) → quantize → shard → move to devices
```

During load, weights are materialized at full precision **before** quantization. That transient spike exceeds 9.6 GB per GPU. With `device_map`, sharding applies to **final** placement, but allocation happens on a default device during load. Result: single-GPU peak > 10 GB.

**4-bit BnB does not support CPU offload** in the way 8-bit does, so there’s no spill path.

## Four Architectural Paths

### Option A — Zero-Init + Partitioned Dispatch

**Goal:** Avoid full-precision materialization on a single device.

**Flow:**
1. `init_empty_weights()` → create model skeleton (meta tensors, no VRAM)
2. Load each parameter directly into its assigned shard via `load_checkpoint_and_dispatch` or equivalent
3. Quantize layer-by-layer as we go; never hold a full layer in FP16 on one GPU

**Implementation:** Use `accelerate`’s `init_empty_weights` and `load_checkpoint_and_dispatch`. For 4-bit, Accelerate’s `load_and_quantize_model` supports custom (non-Transformers) models; for Transformers + 4-bit the path is less direct and may need custom loading hooks.

**Status:** Documented; not yet wired for Transformers + QLoRA.

---

### Option B — GGUF / llama.cpp Runtime

**Goal:** Load already-quantized weights; no FP16 staging.

**Flow:**
- Use GGUF (Q4_K_M etc.) → load directly into VRAM in quantized form
- No materialization spike

**Trade-off:** Different stack. Fine-tuning uses llama.cpp’s finetune or a separate pipeline; you lose the HF fine-tuning convenience.

**Status:** Valid for inference; for training, requires stack change.

---

### Option C — Pre-Quantized AWQ (Recommended)

**Goal:** Load a model already 4-bit on disk. No on-the-fly quantization = no spike.

**Flow:**
- Use `Qwen/Qwen2.5-14B-Instruct-AWQ` — pre-quantized, ~10 GB for inference
- `AutoModelForCausalLM.from_pretrained(model_id, device_map="auto")` — no BitsAndBytesConfig
- Weights load directly in compressed form; `device_map="auto"` splits across 2 GPUs

**Trade-off:** Requires `autoawq`. Best path for 2×10 GB.

**Status:** Implemented in `train_14b_awq.py`.

---

### Option D — 8-bit + CPU Offload (OOMs during load)

**Goal:** Use a quantization mode that supports CPU offload.

**Flow:**
- `load_in_8bit=True` instead of 4-bit
- `llm_int8_enable_fp32_cpu_offload=True`
- Custom `device_map` that puts some modules on `"cpu"`

**Trade-off:** CPU offload in bitsandbytes applies mainly to **inference**, not loading. Still OOMs during `from_pretrained`.

**Status:** Implemented in `train.py` with `PIKO_FINETUNE_14B=1`; OOMs at ~80% load.

---

### Option E — Scale Inference, Not Width

**Goal:** Keep 7B and improve perceived quality via search/sampling.

**Flow:**
- Use 7B with repeated sampling, reranker, self-consistency
- Belief architecture, structured memory, planner

**Trade-off:** No 14B; often comparable or better for constrained-VRAM setups.

**Status:** Always available; 7B remains the default.

---

## Implemented Solutions

### 1. 14B via AWQ (`train_14b_awq.py`) — Recommended

```bash
pip install autoawq  # if not already in requirements
FINETUNE_MAX_STEPS=500 python scripts/finetune/train_14b_awq.py
```

Pre-quantized AWQ model; no BnB, no load-time spike. Should fit on 2×10 GB.

### 2. DeepSpeed ZeRO-3 config (`ds_config_zero3.json`)

For full-precision 14B (no quantization): use with `accelerate config` → DeepSpeed ZeRO-3, CPU offload. Fallback if AWQ path fails.

### 3. Env-based Model Selection (`train.py`)

```bash
# 7B (default)
python scripts/finetune/train.py

# 14B via 8-bit + CPU offload
PIKO_FINETUNE_14B=1 python scripts/finetune/train.py
```

---

## Hardware Constraint

Each 3080 exposes ~9.6 GB usable VRAM. Multi-GPU does not pool memory for allocation spikes. You effectively have two 9.6 GB ceilings, not one 19.2 GB pool.

---

## References

- [Accelerate: Model quantization](https://huggingface.co/docs/accelerate/usage_guides/quantization)
- [Transformers: Bitsandbytes](https://huggingface.co/docs/transformers/en/quantization/bitsandbytes)
- [8-bit offloading](https://huggingface.co/docs/transformers/en/quantization/bitsandbytes#offloading)
