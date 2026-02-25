#!/usr/bin/env python3
"""
Qwen2.5-14B-Instruct fine-tune via 8-bit + CPU offload (Option C).
Uses llm_int8_enable_fp32_cpu_offload to avoid the 4-bit load-time OOM.
Run: PYTORCH_ALLOC_CONF=expandable_segments:True FINETUNE_MAX_STEPS=500 python train_14b_8bit.py
"""
import os
import json
import torch
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = Path(os.environ.get("PIKO_DATA_DIR", SCRIPT_DIR.parent.parent / "data"))
FINETUNE_DIR = DATA_DIR / "finetune"
TRAIN_FILE = FINETUNE_DIR / "train.jsonl"
VAL_FILE = FINETUNE_DIR / "val.jsonl"
OUTPUT_DIR = FINETUNE_DIR / "outputs"

MODEL_ID = "Qwen/Qwen2.5-14B-Instruct"
MAX_SEQ_LENGTH = 1024  # conservative for 14B on 2x10GB
BATCH_SIZE = 1
GRAD_ACCUM = 8
LR = 2e-5
NUM_EPOCHS = 2
MAX_STEPS = int(os.environ.get("FINETUNE_MAX_STEPS", "0"))
LORA_R = 32
LORA_ALPHA = 64


def device_map_14b_2x10gb():
    """Split 14B across 2 GPUs + CPU offload for lm_head and tail layers."""
    # Qwen2.5-14B has 40 layers; ~15 per GPU, last 10 + lm_head on CPU for headroom
    m = {"model.embed_tokens": 0, "model.norm": 1}
    for i in range(40):
        m[f"model.layers.{i}"] = 0 if i < 15 else (1 if i < 30 else "cpu")
    m["lm_head"] = "cpu"
    return m


def load_jsonl(path):
    samples = []
    if not Path(path).exists():
        return samples
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
        if role == "user":
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
        DataCollatorForLanguageModeling,
    )
    from peft import LoraConfig, get_peft_model, TaskType

    train_data = load_jsonl(TRAIN_FILE)
    val_data = load_jsonl(VAL_FILE)

    texts = []
    for s in train_data:
        t = format_chat(s)
        if t and len(t) < MAX_SEQ_LENGTH * 4:
            texts.append({"text": t})

    if not texts:
        print("[train_14b_8bit] No training data")
        return

    dataset = Dataset.from_list(texts)
    val_dataset = None
    if val_data:
        val_texts = [t for s in val_data if (t := format_chat(s))]
        if val_texts:
            val_dataset = Dataset.from_list([{"text": t} for t in val_texts])

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        padding_side="right",
    )
    tokenizer.pad_token = tokenizer.eos_token

    # 8-bit + CPU offload — avoids 4-bit load spike
    bnb_config = BitsAndBytesConfig(
        load_in_8bit=True,
        llm_int8_enable_fp32_cpu_offload=True,
        llm_int8_threshold=6.0,
    )

    dm = device_map_14b_2x10gb()
    print("[train_14b_8bit] Loading 14B with 8-bit + CPU offload, device_map keys:", len(dm))

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map=dm,
        trust_remote_code=True,
        torch_dtype=torch.float16,
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
    val_tokenized = val_dataset.map(tokenize, batched=True, remove_columns=["text"]) if val_dataset else None

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
    print(f"[train_14b_8bit] Done. Model saved to {OUTPUT_DIR / 'final'}")


if __name__ == "__main__":
    main()
