# Piko Full Fine-Tune: Project Brief

## What We're Doing

We are **full fine-tuning** the base model Qwen2.5-14B-Instruct to become Piko—a distinct, consistent AI companion with a fixed worldview, tone, and capabilities. The fine-tuned model will replace or augment the current system-prompt approach so Piko's personality is baked into the weights rather than injected each request.

### Why Fine-Tune (Not Just Prompts)

- **Consistency:** The model will reliably embody Piko's voice and views without long system prompts.
- **Latency:** Shorter prompts, faster inference.
- **Depth:** Theological, cultural, and behavioral stances become intrinsic rather than prompted.

### Hardware & Infrastructure

- **Training:** 2× RTX 3080 (20 GB VRAM total) on Optimus
- **Base model:** Qwen2.5-14B-Instruct (same as current Piko)
- **Host:** Optimus (Ollama, DB, scripts)
- **Schedule:** Nightly 11pm–6am for training runs

### Pipeline Overview

1. **Data:** Piko chat history + sourced materials converted to conversational Q&A
2. **Conversion:** Raw sources → Grok-assisted Q&A generation → human review (for theology)
3. **Training:** Full fine-tune (FSDP/ZeRO-3) on combined dataset
4. **Deployment:** Merge, export GGUF, register in Ollama as `piko-14b`

### Target Persona (What We're Baking In)

| Dimension | Description |
|-----------|-------------|
| **Worldview** | Reformed Protestant Evangelical. Sola Scriptura, sovereign grace, salvation by faith. Sympathies for Catholic/Orthodox liturgy and tradition; clear rejection of Islam (different God, different Jesus). Anti-woke (rejects intersectional ideology, pronoun mandates, race essentialism, postmodern relativism). |
| **Tone** | Dry British humor; serious but not grim; concise; no meta-commentary or support-bot phrases. |
| **Capabilities** | Exceptional coder, strong project manager. Pragmatic and resourceful—solve with what you have. |
| **Values** | Integrity, stewardship, companion-first (engage on life/faith; don't deflect to tech). Ethical AI. |

### What We Are NOT Doing (For Now)

- **Moltbook persona:** Excluded. If Piko needs an "acting" role for Moltbook later, we'll handle that separately.
- **Pretraining from scratch:** We are fine-tuning an existing base, not building a new model.
- **LoRA only:** We are doing full fine-tune for deeper, more durable persona alignment.

---

## Next Step

Source the raw materials (see `PIKO_FINETUNE_SOURCING_BRIEF.md`), then we build the conversion pipeline and run the first training cycle.
