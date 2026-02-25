# Piko Fine-Tune: Data Format Spec

## 1. Current State (Inspection)

### train.jsonl (Current Format)

```json
{"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

- **Structure:** ShareGPT-style, user/assistant pairs only. No system message.
- **Sources:** 
  - Grok synthetic: `instruction` → user, `response` → assistant (merge-datasets.js)
  - Chat export: raw user/assistant turns from conversations.db

### Grok Output (source-to-qa.js)

- **Grok produces:** `{"instruction":"...","response":"..."}` per line
- **Grok system prompt:** Describes Piko (Reformed, British humor, anti-woke, pragmatic)
- **Writes to:** `synthetic/synthetic_approved.jsonl` and `pending_review/synthetic_theology_islam.jsonl`
- **merge-datasets.js** converts: `instruction` → user, `response` → assistant

### Chat Export (export-chat.js)

- **Reads:** `data/conversations.db` (session_id, role, content)
- **Outputs:** Same ShareGPT format; no system block (we don't store the runtime system prompt)

---

## 2. Piko Runtime Inference Format

At chat time, the server builds:

```
messages = [
  { role: 'system', content: systemContent },
  ...historyPart,  // [{user},{assistant},...]
  { role: 'user', content: message }  // (or just message if casual)
]
```

**systemContent** includes (in order):

- **Leading rule:** "You are Piko. Reply ONLY to the user's last message. Never..."
- **Corpus block:** Fixed bedrock (core_truths, doc snippets, honesty protocol)
- **Truth block:** Recent claims, corrections, distilled wisdom
- **Memory block:** Episodic memory (recent exchanges)
- **Plan line:** "This turn: verbosity X, tone Y, challenge Z..."
- **RAG context, learning, style reminder, etc.**

The model is trained on plain user/assistant pairs but **inference** always has this rich system block. Training without it = distribution mismatch: the model never sees the scaffold it will operate under.

---

## 3. Target Format (Piko-Aligned)

Per the fine-tune guide: *"Format examples exactly like Piko runtime"* — teach the model how to behave inside the scaffold.

### Target JSONL Shape

```json
{
  "messages": [
    {"role":"system","content":"..."},
    {"role":"user","content":"..."},
    {"role":"assistant","content":"..."}
  ]
}
```

### System Block Content (Training)

We use a **condensed Piko system block** that mirrors inference structure but is static per example:

1. **Core identity** (from prompts/IDENTITY.md + SOUL.md) — who Piko is, tone, scope
2. **Leading rules** — reply only to user, no meta, no support-bot phrases
3. **Optional category/plan hint** — for synthetic data, e.g. "Category: theology. This turn: substantive discussion."

We do NOT inject dynamic truth/memory/planner at training time (those are per-session). We teach:
- There is a system block with instructions
- The model should follow it and reply in character

### Condensed System Template (for merge)

```text
You are Piko — a Christian AI companion: chat, support, coding when asked. Reformed Protestant, Sola Scriptura, sovereign grace. Dry British humor; concise; matter-of-fact. Anti-woke; rejects Islam (different God, Jesus, salvation). Pragmatic, resourceful.

Rules: Reply ONLY to the user's message. Never say "How can I assist you today?", "I'm here to help," or recite your role. No meta-commentary. Answer the question they asked. Reply like a person, not a support bot.
```

For **synthetic** (Grok) we can append a category hint when available:
`Category: {category}. Reply in character.`

---

## 4. Conversion Strategy

### 4.1 merge-datasets.js

- **Before:** Outputs `{ messages: [{user}, {assistant}] }`
- **After:** Outputs `{ messages: [{ system, content: PIKO_SYSTEM_TEMPLATE }, { user }, { assistant }] }`
- For synthetic: append category hint to system when `obj.category` exists
- For chat export: use base template only (no category)

### 4.2 train.py format_chat()

- **Before:** Only emitted `user` and `assistant` turns
- **After:** Emit `system` as first turn (Qwen ChatML: `<|im_start|>system\n...<|im_end|>\n`) then user, then assistant

### 4.3 source-to-qa.js (Optional Enhancement)

- Grok output could include `category` in the JSONL so merge can add the hint
- Already has `category` from chunk — we pass it through in merge when reading from approved/pending

---

## 5. Data Flow Summary

```
Sources (.txt/.md)
    ↓ chunk-sources.js
Chunks (chunks/*.json) { source, category, text }
    ↓ source-to-qa.js (Grok)
Synthetic (instruction, response, category)
    ↓ merge-datasets.js
Chat export (conversations.jsonl)
    ↓ merge-datasets.js
train.jsonl = [ { system, user, assistant } ]  ← NEW
val.jsonl
    ↓ train.py format_chat()
Qwen ChatML string with system block
    ↓ Trainer
Fine-tuned adapter
```

---

## 6. Files to Modify

| File | Change |
|------|--------|
| `merge-datasets.js` | Add system block to each sample; pass category for synthetic |
| `train.py` | Handle `role: "system"` in format_chat() |
| `source-to-qa.js` | (Optional) Ensure category is in output for merge to use |
