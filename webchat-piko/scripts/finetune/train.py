#!/usr/bin/env python3
"""
Full fine-tune Piko on 2× RTX 3080.
Uses Hugging Face transformers + PEFT (LoRA).
- Default: Qwen2.5-7B-Instruct (4-bit QLoRA) — may OOM during load
- PIKO_FINETUNE_DDP=1: BnB 4-bit QLoRA + DDP on 2 GPUs — use accelerate launch
- PIKO_FINETUNE_GPTQ=1: Qwen2.5-7B-Instruct-GPTQ-Int4 (pre-quantized, no BnB spike)
- PIKO_FINETUNE_AWQ=1: Qwen2.5-7B-Instruct-AWQ (requires ExLlama AWQ kernels)
- PIKO_FINETUNE_14B=1: Qwen2.5-14B-Instruct (8-bit + CPU offload)
Run: PIKO_FINETUNE_DDP=1 accelerate launch --config_file scripts/finetune/accelerate_config.yaml scripts/finetune/train.py
"""
import os
import json
import torch
from pathlib import Path

# Paths (relative to script or env)
SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = Path(os.environ.get("PIKO_DATA_DIR", SCRIPT_DIR.parent.parent / "data"))
FINETUNE_DIR = DATA_DIR / "finetune"
TRAIN_FILE = FINETUNE_DIR / "train.jsonl"
VAL_FILE = FINETUNE_DIR / "val.jsonl"
OUTPUT_DIR = FINETUNE_DIR / "outputs"

USE_DDP = os.environ.get("PIKO_FINETUNE_DDP", "").strip() in ("1", "true", "yes")
USE_14B = os.environ.get("PIKO_FINETUNE_14B", "").strip() in ("1", "true", "yes")
USE_AWQ = os.environ.get("PIKO_FINETUNE_AWQ", "").strip() in ("1", "true", "yes")
USE_GPTQ = os.environ.get("PIKO_FINETUNE_GPTQ", "").strip() in ("1", "true", "yes")
MODEL_ID = (
    "Qwen/Qwen2.5-14B-Instruct" if USE_14B
    else "Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4" if USE_GPTQ
    else "Qwen/Qwen2.5-7B-Instruct-AWQ" if USE_AWQ
    else "Qwen/Qwen2.5-7B-Instruct"
)
# GPTQ/AWQ: 512; DDP BnB: 1024; 14B: 1024; BnB single: 512 (fits 2x10GB); default: 2048
MAX_SEQ_LENGTH = 512 if (USE_GPTQ or USE_AWQ) else (1024 if (USE_14B or USE_DDP) else 512)
BATCH_SIZE = 1
GRAD_ACCUM = 4  # 4 for BnB on 2x10GB to reduce peak memory
LR = 2e-5
NUM_EPOCHS = 2
MAX_STEPS = int(os.environ.get("FINETUNE_MAX_STEPS", "0"))  # 0 = no limit; ~500 ≈ 1hr on 2x3080
LORA_R = 16 if (USE_GPTQ or USE_AWQ) else 32
LORA_ALPHA = 32 if (USE_GPTQ or USE_AWQ) else 64  # DDP uses 32/64 like default BnB

def load_jsonl(path):
    samples = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            samples.append(json.loads(line))
    return samples

def format_chat(entry):
    messages = entry.get("messages", [])
    if not messages:
        return None
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            parts.append(f"<|im_start|>system\n{content}<|im_end|>\n")
        elif role == "user":
            parts.append(f"<|im_start|>user\n{content}<|im_end|>\n")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}<|im_end|>\n")
    return "".join(parts).strip()

def main():
    from datasets import Dataset
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        TrainingArguments,
        BitsAndBytesConfig,
    )
    from peft import LoraConfig, get_peft_model, TaskType

    train_data = load_jsonl(TRAIN_FILE)
    val_data = load_jsonl(VAL_FILE) if VAL_FILE.exists() else []

    texts = []
    for s in train_data:
        t = format_chat(s)
        if t and len(t) < MAX_SEQ_LENGTH * 4:
            texts.append({"text": t})

    if not texts:
        print("[train] No training data")
        return

    dataset = Dataset.from_list(texts)
    val_dataset = None
    if val_data:
        val_texts = []
        for s in val_data:
            t = format_chat(s)
            if t:
                val_texts.append({"text": t})
        if val_texts:
            val_dataset = Dataset.from_list(val_texts)

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        padding_side="right",
    )
    tokenizer.pad_token = tokenizer.eos_token

    if USE_DDP and USE_GPTQ:
        # DDP + GPTQ: each rank loads full 7B GPTQ on its GPU (validated on 2×10GB)
        local_rank = int(os.environ.get("LOCAL_RANK", 0))
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype="auto",
            device_map={"": local_rank},
            trust_remote_code=True,
        )
        # GPTQ loader may set hf_device_map="auto"; accelerate rejects that in DDP
        if getattr(model, "hf_device_map", None) == "auto":
            model.hf_device_map = {"": local_rank}
    elif USE_AWQ or USE_GPTQ:
        # Pre-quantized AWQ/GPTQ: auto split across both GPUs (single process)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype="auto",
            device_map="auto",
            trust_remote_code=True,
        )
    elif USE_DDP:
        # BnB 4-bit QLoRA + DDP: each process loads on its own GPU via LOCAL_RANK
        local_rank = int(os.environ.get("LOCAL_RANK", 0))
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            quantization_config=bnb_config,
            device_map={"": local_rank},
            trust_remote_code=True,
        )
    elif USE_14B:
        # Option C: 8-bit + CPU offload — avoids 4-bit load-time OOM on 2×10GB
        bnb_config = BitsAndBytesConfig(
            load_in_8bit=True,
            llm_int8_enable_fp32_cpu_offload=True,
            llm_int8_threshold=6.0,
        )
        # Aggressive CPU offload: only 8 layers per GPU to stay under 10GB during load
        dm = {"model.embed_tokens": 0, "model.norm": "cpu"}
        for i in range(40):
            dm[f"model.layers.{i}"] = 0 if i < 8 else (1 if i < 16 else "cpu")
        dm["lm_head"] = "cpu"
        # Limit per-GPU to force spill; 8-bit supports CPU offload during load
        max_mem = {0: "7GiB", 1: "7GiB", "cpu": "32GiB"}
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            quantization_config=bnb_config,
            device_map=dm,
            max_memory=max_mem,
            trust_remote_code=True,
            torch_dtype=torch.float16,
        )
    else:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=False,  # avoids load spike on 10GB
        )
        # balanced + max_memory to avoid OOM during materialization on 2x10GB
        max_mem = {0: "9GiB", 1: "9GiB", "cpu": "32GiB"}
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            quantization_config=bnb_config,
            device_map="balanced",
            max_memory=max_mem,
            torch_dtype=torch.float16,
            trust_remote_code=True,
            low_cpu_mem_usage=True,
        )
    model.gradient_checkpointing_enable()

    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)

    def tokenize(examples):
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            padding="max_length",
            return_tensors=None,
        )

    tokenized = dataset.map(tokenize, batched=True, remove_columns=["text"])
    if val_dataset:
        val_tokenized = val_dataset.map(tokenize, batched=True, remove_columns=["text"])
    else:
        val_tokenized = None

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    train_kw = {"num_train_epochs": NUM_EPOCHS}
    if MAX_STEPS > 0:
        train_kw["max_steps"] = MAX_STEPS
    args = TrainingArguments(
        output_dir=str(OUTPUT_DIR),
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LR,
        fp16=False,
        bf16=True,
        logging_steps=10,
        save_steps=100,
        save_total_limit=2,
        warmup_ratio=0.03,
        report_to="none",
        **train_kw,
    )

    from transformers import DataCollatorForLanguageModeling
    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    from transformers import Trainer
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=tokenized,
        eval_dataset=val_tokenized,
        data_collator=collator,
    )

    trainer.train()
    trainer.save_model(str(OUTPUT_DIR / "final"))
    tokenizer.save_pretrained(str(OUTPUT_DIR / "final"))
    print(f"[train] Done. Model saved to {OUTPUT_DIR / 'final'}")

if __name__ == "__main__":
    main()
