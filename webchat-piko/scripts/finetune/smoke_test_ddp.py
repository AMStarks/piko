#!/usr/bin/env python3
"""
Smoke test for DDP QLoRA setup on 2× RTX 3080.
Loads model with device_map per LOCAL_RANK, runs one forward pass, exits.
- 3B by default (fits 10GB)
- SMOKE_TEST_7B=1: test 7B BnB (tight on 10GB)
- SMOKE_TEST_7B=1 SMOKE_TEST_GPTQ=1: 7B GPTQ (often 0.5–1 GB lighter)
Run: accelerate launch --config_file scripts/finetune/accelerate_config.yaml scripts/finetune/smoke_test_ddp.py
"""
import os
import torch

USE_7B = os.environ.get("SMOKE_TEST_7B", "").strip() in ("1", "true", "yes")
USE_GPTQ = os.environ.get("SMOKE_TEST_GPTQ", "").strip() in ("1", "true", "yes")
MODEL_ID = (
    "Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4"
    if USE_7B and USE_GPTQ
    else "Qwen/Qwen2.5-7B-Instruct"
    if USE_7B
    else "Qwen/Qwen2.5-3B-Instruct"
)


def main():
    local_rank = int(os.environ.get("LOCAL_RANK", 0))
    world_size = int(os.environ.get("WORLD_SIZE", 1))
    print(f"[rank {local_rank}/{world_size}] Loading {MODEL_ID} on GPU {local_rank}...")

    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token

    if USE_GPTQ and USE_7B:
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype="auto",
            device_map={"": local_rank},
            trust_remote_code=True,
        )
    else:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=False,
        )
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            quantization_config=bnb_config,
            device_map={"": local_rank},
            trust_remote_code=True,
        )

    model.gradient_checkpointing_enable()

    # One forward pass (short seq for smoke)
    text = "<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n"
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=64)
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    with torch.no_grad():
        out = model(**inputs)
    # No labels → no loss; we just verify forward ran
    scalar = out.logits.shape[-1] if out.logits is not None else 0
    print(f"[rank {local_rank}/{world_size}] Forward OK (logits last_dim={scalar})")
    print("[smoke_test_ddp] OK")


if __name__ == "__main__":
    main()
