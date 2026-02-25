# Phase 3: Casual Small-Talk Corrective LoRA

This runbook documents how to train a corrective LoRA that teaches Piko to reply briefly and reciprocally on greetings and small-talk, reducing theme injection and philosophy leakage.

---

## What It Does

- **Dataset:** ~120 synthetic (instruction, response) pairs in `synthetic_casual_smalltalk.jsonl` covering:
  - Greetings (G'day Piko, Hey, Hi, Morning, etc.)
  - Social reciprocity (How are you?, Good thanks — you?, Sorta. You doing ok?, etc.)
  - Short acks (Cool, That's short, Ok, Nice, etc.)

- **Merge:** `merge-datasets.js` includes these in `train.jsonl` alongside chat export and other synthetic Q&A.

- **Training:** Same LoRA pipeline as main Piko fine-tune. The casual examples upweight short, natural replies so the model prior shifts away from "reflect themes / suggest follow-ups" on casual turns.

---

## Prerequisites

- Optimus with 2× RTX 3080 (or single GPU)
- `.venv-finetune` with transformers, peft, datasets
- Base model (e.g. Qwen2.5-7B-Instruct) pulled

---

## Steps

### 1. Generate casual dataset

```bash
cd /root/webchat-piko  # or your webchat-piko root
node scripts/finetune/generate-casual-smalltalk.js
```

Output: `data/finetune/synthetic/synthetic_casual_smalltalk.jsonl`

### 2. Merge datasets (includes casual)

```bash
node scripts/finetune/export-chat.js
node scripts/finetune/merge-datasets.js
```

Check logs for `[merge-datasets] Casual small-talk: N`

### 3. Train LoRA

```bash
# Single GPU (7B GPTQ)
PIKO_FINETUNE_GPTQ=1 bash scripts/finetune/run-on-optimus.sh

# Or DDP on 2 GPUs
PIKO_FINETUNE_DDP=1 PIKO_FINETUNE_GPTQ=1 bash scripts/finetune/run-on-optimus.sh
```

Adapter saved to `data/finetune/outputs/final/`

### 4. Merge LoRA and create Ollama model

```bash
bash scripts/finetune/export-to-ollama.sh
```

Creates `piko:finetune` in Ollama. Update `OLLAMA_MODEL=piko:finetune` (or use `/model piko:finetune` in chat).

---

## Quick pipeline (casual-only merge + train)

If you only want to add casual examples and retrain (skip chunking/Q&A):

```bash
cd /root/webchat-piko
node scripts/finetune/generate-casual-smalltalk.js
node scripts/finetune/export-chat.js
node scripts/finetune/merge-datasets.js
PIKO_FINETUNE_GPTQ=1 python3 scripts/finetune/train.py
```

Then `bash scripts/finetune/export-to-ollama.sh` to create the model.

---

## Extending the dataset

Edit `scripts/finetune/generate-casual-smalltalk.js` and add pairs to the `PAIRS` array:

```js
['User says this', 'Piko replies like this'],
```

Run `node scripts/finetune/generate-casual-smalltalk.js` to regenerate the JSONL. Then re-merge and retrain.

---

## Expected outcome

After Phase 3, casual turns should:

- Reply with one short natural line
- Not inject themes ("forging your path", "grand visions", "how's the project")
- Reciprocate naturally ("Good thanks — you?" → "Same here.")
- Reduce echo ("G'day Piko" → "G'day mate — you?" not "G'day Piko.")

Phase 2 (planner + guardrails) catches most cases at runtime. Phase 3 shifts the model prior so the fine-tuned weights reinforce short, reciprocal behaviour instead of fighting it.
