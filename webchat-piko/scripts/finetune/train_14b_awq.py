#!/usr/bin/env python3
"""
Fine-tune Qwen2.5-14B-Instruct-AWQ with LoRA on 2× RTX 3080 (10 GB each).

Uses the PRE-QUANTIZED AWQ model — no bitsandbytes, no on-load quantization spike.
Weights are 4-bit on disk; load directly into VRAM. Should fit on 2×10 GB.

Requirements: transformers>=4.37, peft, datasets, autoawq (pip install autoawq)

Run:
  FINETUNE_MAX_STEPS=500 python train_14b_awq.py
"""
import os
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = Path(os.environ.get("PIKO_DATA_DIR", SCRIPT_DIR.parent.parent / "data"))
FINETUNE_DIR = DATA_DIR / "finetune"
TRAIN_FILE = FINETUNE_DIR / "train.jsonl"
VAL_FILE = FINETUNE_DIR / "val.jsonl"
OUTPUT_DIR = FINETUNE_DIR / "outputs"

MODEL_ID = "Qwen/Qwen2.5-14B-Instruct-AWQ"
MAX_SEQ_LENGTH = 1024
BATCH_SIZE = 1
GRAD_ACCUM = 8
LR = 2e-5
NUM_EPOCHS = 2
MAX_STEPS = int(os.environ.get("FINETUNE_MAX_STEPS", "0"))
LORA_R = 32
LORA_ALPHA = 64


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
        if role == "user":
            parts.append(f"<|im_start|>user\n{content}<|im_end|>\n")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}<|im_end|>\n")
    return "".join(parts).strip()


def main():
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, DataCollatorForLanguageModeling
    from peft import LoraConfig, get_peft_model, TaskType
    from transformers import Trainer

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

    print(f"[train] Loading {MODEL_ID} (pre-quantized AWQ, no BnB)...")
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        padding_side="right",
    )
    tokenizer.pad_token = tokenizer.eos_token

    # Pre-quantized AWQ: loads directly in 4-bit, no materialization spike
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype="auto",
        device_map="auto",
        trust_remote_code=True,
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

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

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
