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

    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import PeftModel
    import torch

    # 4-bit to minimize VRAM (7B ~3.5GB); cap per-GPU to force balanced split + CPU offload
    max_memory = {0: "6GiB", 1: "6GiB", "cpu": "24GiB"}
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_quant_type="nf4",
    )
    print("[merge-lora] Loading base model (4-bit)...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb,
        device_map="balanced",
        max_memory=max_memory,
        trust_remote_code=True,
        torch_dtype=torch.float16,
        low_cpu_mem_usage=True,
    )

    print("[merge-lora] Loading LoRA adapter...")
    model = PeftModel.from_pretrained(model, str(ADAPTER_DIR), is_trainable=False)

    print("[merge-lora] Merging adapter into base...")
    model = model.merge_and_unload()

    MERGED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[merge-lora] Saving merged model to {MERGED_DIR}...")
    model.save_pretrained(str(MERGED_DIR), safe_serialization=True)
    tokenizer.save_pretrained(str(MERGED_DIR))

    print("[merge-lora] Done.")
    return 0


if __name__ == "__main__":
    exit(main())
