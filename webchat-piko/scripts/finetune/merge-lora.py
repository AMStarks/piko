#!/usr/bin/env python3
"""
Merge LoRA adapter into unquantized base and save full model.
Adapter was trained on GPTQ base; we merge with FP16 base (standard workaround).
Output: data/finetune/outputs/merged/ (HuggingFace format for GGUF conversion)
"""
import os
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = Path(os.environ.get("PIKO_DATA_DIR", SCRIPT_DIR.parent.parent / "data"))
ADAPTER_DIR = DATA_DIR / "finetune" / "outputs" / "final"
MERGED_DIR = DATA_DIR / "finetune" / "outputs" / "merged"
BASE_MODEL = "Qwen/Qwen2.5-7B-Instruct"


def main():
    if not ADAPTER_DIR.exists():
        print(f"[merge-lora] Adapter not found: {ADAPTER_DIR}")
        return 1

    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    import torch

    # Load base in fp16 on CPU to produce fp16 merged output (llama.cpp GGUF converter
    # does not support bitsandbytes). 7B fp16 ~14GB RAM; needs 32GB+ system RAM.
    print("[merge-lora] Loading base model (fp16 on CPU)...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map="cpu",
        low_cpu_mem_usage=True,
        trust_remote_code=True,
    )

    print("[merge-lora] Loading LoRA adapter...")
    model = PeftModel.from_pretrained(model, str(ADAPTER_DIR), is_trainable=False)

    print("[merge-lora] Merging adapter into base...")
    model = model.merge_and_unload()

    MERGED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[merge-lora] Saving merged model (fp16) to {MERGED_DIR}...")
    model.save_pretrained(str(MERGED_DIR), safe_serialization=True)
    tokenizer.save_pretrained(str(MERGED_DIR))

    print("[merge-lora] Done.")
    return 0


if __name__ == "__main__":
    exit(main())
