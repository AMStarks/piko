# Fine-Tuning Qwen2.5-14B on 2× RTX 3080: OOM During Load — Seeking Advice

## Goal

Fine-tune **Qwen2.5-14B-Instruct** with LoRA/QLoRA on a machine with **2× NVIDIA RTX 3080 (10 GB each)**. Using Hugging Face `transformers`, `peft`, and `bitsandbytes`.

## Hardware

- **GPUs:** 2× NVIDIA GeForce RTX 3080, 10 GB VRAM each (~9.6 GB usable)
- **Total VRAM:** ~19.2 GB (not pooled; each GPU has its own ceiling)
- **OS:** Linux

## The Problem

**OOM happens during model loading**, before training starts. Failure occurs around 50–80% through the weight-loading phase (around layer 25 with 4-bit, layer 22 with 8-bit).

### Root Cause (Our Understanding)

The HF + bitsandbytes loading flow appears to:

1. Materialize weights at **full precision (FP16)** (or at least higher than final)
2. Quantize them
3. Place them according to `device_map`

So there is a **temporary peak** in VRAM during loading that can exceed the final quantized footprint. The spike exceeds ~9.6 GB on a single GPU before sharding/quantization finishes.

## What We've Tried

### 1. 4-bit QLoRA (default path)

- `load_in_4bit=True`, `device_map="auto"`
- **Result:** OOM at ~53% (layer 25), GPU 1 at ~9.5 GB / 9.6 GB
- **Error:** `torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 10.00 MiB. GPU 1 has a total capacity of 9.64 GiB of which 16.25 MiB is free.`

### 2. 4-bit + Tweaks

- `device_map="balanced"`
- `max_memory={0: "8GiB", 1: "8GiB", "cpu": "16GiB"}`
- `model.gradient_checkpointing_enable()`
- `MAX_SEQ_LENGTH` reduced to 1024
- `PYTORCH_ALLOC_CONF=expandable_segments:True`

- **Result:** Same OOM around 53%

### 3. 4-bit + CPU Offload

- `max_memory={0: "6GiB", 1: "6GiB", "cpu": "24GiB"}` to force CPU offload

- **Result:** `ValueError: Some modules are dispatched on the CPU or the disk. Make sure you have enough GPU RAM to fit the quantized model...`  
  **Interpretation:** 4-bit bitsandbytes does **not** support CPU offload in this way (unlike 8-bit).

### 4. 8-bit + CPU Offload

- `load_in_8bit=True`, `llm_int8_enable_fp32_cpu_offload=True`
- Custom `device_map`: layers 0–14 on GPU 0, 15–29 on GPU 1, 30–39 + `lm_head` on CPU

- **Result:** OOM at ~80% (layer 22), GPU 1 at ~9.5 GB / 9.6 GB  
- **Error:** `torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 130.00 MiB. GPU 1 has a total capacity of 9.64 GiB of which 58.25 MiB is free.`

### 5. 8-bit + Aggressive CPU Offload

- `device_map`: 8 layers per GPU, rest on CPU
- `max_memory={0: "7GiB", 1: "7GiB", "cpu": "32GiB"}`

- **Result:** OOM (same loading spike; CPU offload helps inference, not load)

---

## Advice Received: Viable Paths Forward

### 1. Pre-Quantized AWQ/GPTQ (Recommended — No Materialization Spike)

Load a model that is **already 4-bit on disk**. No on-the-fly quantization = no spike.

- **Qwen/Qwen2.5-14B-Instruct-AWQ** — Official AWQ, ~10 GB for inference
- **Qwen/Qwen2.5-14B-Instruct-GPTQ-Int4** — GPTQ variant

Load with `AutoModelForCausalLM.from_pretrained(model_id, device_map="auto")` — no `BitsAndBytesConfig`. Weights enter VRAM in compressed form.

**Status:** Next path to try. See `train_14b_awq.py`.

### 2. DeepSpeed ZeRO-3

- Partitions parameters, gradients, and optimizer states across GPUs
- Never materializes full layer on one GPU
- Supports `offload_param_device: "cpu"` and `offload_optimizer_device: "cpu"`
- Use `accelerate config` → select DeepSpeed ZeRO-3
- See `ds_config_zero3.json` for 2×10 GB tuning

### 3. Meta-Device Trick (`init_empty_weights` + `load_checkpoint_and_dispatch`)

- Avoids full materialization by loading piece-by-piece
- Complex to combine with bitsandbytes 4-bit; easier with ZeRO or pre-quantized

### 4. Why 8-bit CPU Offload Still OOMs

- CPU offload in bitsandbytes is primarily for **inference**, not loading
- During `from_pretrained`, the loader still processes layers and can hit GPU limits before deciding to spill
- The "Dispatcher" initialization calculates placement; a 500 MB buffer on top of 8.6 GB can OOM before offload kicks in

### 5. RTX 3080 Tip

Set `max_memory` to ~**8.5 GiB** per card to leave headroom for CUDA context (~500 MB) and OS (~500–1 GB).

---

## Key Constraint

**2×10 GB ≠ 20 GB for loading.** Multi-GPU `device_map` does not pool memory. Each GPU must handle its own peak during loading. The transient materialization peak on a single GPU exceeds 9.6 GB.

## What Works

- **Qwen2.5-7B-Instruct** in 4-bit QLoRA loads and trains fine on one 10 GB GPU.
- So the setup is viable for 7B; the issue is specific to 14B.

## Questions for Advice

1. **Loading path:** Is there a way to load 14B (4-bit or 8-bit) that avoids or reduces the FP16 materialization spike on a single GPU? For example:
   - Zero-init + partitioned load (e.g. `init_empty_weights` + `load_checkpoint_and_dispatch` with quantization)?
   - Any HF/bitsandbytes options to stream or load in smaller chunks?
   - Other loaders or workflows that avoid this spike?

2. **8-bit CPU offload:** Why does 8-bit + `llm_int8_enable_fp32_cpu_offload` still OOM during load? Does CPU offload only apply at inference, not during `from_pretrained`?

3. **Alternatives:** Besides switching to 7B or upgrading GPUs, what options exist?
   - Pre-quantized GGUF + a different fine-tuning stack?
   - DeepSpeed ZeRO-3 / FSDP or similar for partitioned loading?
   - Any known configs or examples for 14B on 2×10 GB?

4. **Model size vs hardware:** Is 14B on 2×10 GB generally considered infeasible with the current HF + bitsandbytes loading path, or are there known workarounds?

## Environment

- `transformers`, `accelerate`, `peft`, `bitsandbytes` (versions typical for late 2024 / early 2025)
- Python 3.12
- CUDA 13.0
- Driver 580.x
