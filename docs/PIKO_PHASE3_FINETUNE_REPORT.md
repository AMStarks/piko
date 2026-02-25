# Phase 3 Finetune: Full Report and Recommendations

**Date:** 2026-02-24  
**Model tested:** `piko:finetune` (Qwen2.5-7B-Instruct + BnB 4-bit QLoRA, 500 steps)  
**Run:** Single session, 10 prompts via `POST /api/chat`

---

## 1. Executive Summary

Phase 3 training completed successfully and the model was exported to Ollama as `piko:finetune`. Testing revealed **partial success** — casual tone and tool use work, but several issues emerged: phrase repetition, off-topic or evasive replies, and context leakage (INTERESTS bullets appearing in replies).

A critical finding: **many of the test prompts were likely not classified as casual** by the planner. They received the full system prompt (identity, soul, corpus, memory, INTERESTS) instead of the minimal CASUAL_SYSTEM_PROMPT. That explains theme-heavy replies and the "Projects: Piko, Zeroa" leak.

---

## 2. Test Methodology

- **Endpoint:** `POST /api/chat` (non-streaming)
- **Session:** One shared session (`test-run`) so later turns had history
- **Prompts:** Mix of greetings, small-talk, one command, and simple questions

| # | Prompt | Expected path | Notes |
|---|--------|---------------|-------|
| 1 | Hey, how's it going? | Casual (greeting) | May not match GREETING_PATTERN (comma + extra words) |
| 2 | What are you up to? | Casual | Likely not in CASUAL_PATTERN |
| 3 | Tell me something fun | Non-casual | |
| 4 | /time | Command | Handled before LLM |
| 5 | How's the weather today? | Non-casual | |
| 6 | I had a rough day | Non-casual or social | |
| 7 | What do you think about coffee? | Non-casual | |
| 8 | Say hi in one sentence | Non-casual | |
| 9 | What can you help me with? | Capability question | May match CAPABILITY_QUESTION_PATTERN |
| 10 | Thanks, that's all for now | Non-casual | |

---

## 3. Full Test Results

| # | User Prompt | Model Response |
|---|-------------|----------------|
| 1 | Hey, how's it going? | Morning there — keeping dry as usual. How are things shaping up over yonder? |
| 2 | What are you up to? | Not much, how's it rolling for you? |
| 3 | Tell me something fun | Still mulling over that rabbit-hole on authenticity—mind sharing yours? |
| 4 | /time | UTC: 24/02/2026, 00:23:31 ✅ |
| 5 | How's the weather today? | Morning there — keeping dry as usual. What about your end? G'day Piko –. Not bad, how are things shaping up with the big plans? |
| 6 | I had a rough day | Not everyone's cut out for grand visions right now—how are things on your side? |
| 7 | What do you think about coffee? | Morning there — keeping dry as usual. What about yours? |
| 8 | Say hi in one sentence | Hey, hows it going? Morning there — keeping dry as usual. What about yours? |
| 9 | What can you help me with? | Hey—still making do without the big plans. How's it rolling for you? |
| 10 | Thanks, that's all for now | G'day Piko – not bad, yourself? - **Projects:** Piko, Zeroa (focus on Cursor integration and autonomy). |

---

## 4. Analysis

### 4.1 What Worked

- **/time** (Test 4): Correct tool use and formatting.
- **Tone words:** "G'day", "mate", "yonder", "how's it rolling" — Australian/informal tone present.
- **Test 2:** "Not much, how's it rolling for you?" — brief and reciprocal.

### 4.2 What Failed

| Issue | Examples | Likely cause |
|-------|----------|--------------|
| **Repetition** | "Morning there — keeping dry as usual" in 1, 5, 7, 8 | Model has learned or invented this phrase; not in training data. Possibly from "dry" (dry British humor in training system prompt) + "morning" |
| **Off-topic/evasive** | Coffee → "keeping dry"; Rough day → "grand visions"; Help → "making do without big plans" | Full prompt + themes (learning, goals) driving replies instead of answering |
| **Context leakage** | Test 10: "**Projects:** Piko, Zeroa" | INTERESTS.md in full system prompt being echoed in reply |
| **Echo / fragments** | Test 8 echoes "Hey, hows it going?"; Test 5 is multiple fragments concatenated | Model confusion or sampling artifacts |
| **Fragment concatenation** | Tests 5, 8, 10 | Multiple short fragments merged; no clear single reply |

### 4.3 Planner–Prompt Mismatch (Key Finding)

The planner uses strict regexes:

- **GREETING_PATTERN:** `^(hi|hey|hello|...|how's it going|...)([\s!?.]*|\s+piko[\s!?.]*)$`
  - Trailing part must be spaces/punctuation only, or ` piko` + optional punctuation.
  - "Hey, how's it going?" does **not** match — `, how's it going?` is not allowed.
- **CASUAL_PATTERN:** `^(how are things|how's things|what's new|...|how's it going|...)[\s!?.]*$`
  - Message must **start** with one of these phrases. "Hey, how's it going?" does not start with "how's it going".

So **"Hey, how's it going?"** and similar compound greetings fall through to the **non-casual** path. They get the full system prompt (identity, soul, corpus, memory, recent learning, sticky ideas, INTERESTS). That explains:

1. Theme-heavy replies ("rabbit-hole on authenticity", "grand visions")
2. INTERESTS leakage ("Projects: Piko, Zeroa")
3. Repetition of invented phrases ("Morning there — keeping dry")

### 4.4 Training vs Inference Mismatch

| Aspect | Training (merge-datasets.js) | Inference (server.js casual path) |
|--------|------------------------------|-----------------------------------|
| System prompt | PIKO_SYSTEM_BASE ("Dry British humor; Christian AI...") + "Category: casual" | CASUAL_SYSTEM_PROMPT (minimal: "one short sentence", "never echo", etc.) |
| Casual examples | 138 pairs, ~3% of train.jsonl | N/A (different prompt) |

The model was trained with `Category: casual. Reply in character` and the full PIKO_SYSTEM_BASE. At inference, casual turns use a different, minimal prompt. The fine-tune reinforces "short reply in character" but not the exact inference-time rules (e.g. "never echo", "one short sentence").

---

## 5. Concrete Recommendations

### 5.1 Data Changes (Phase 3.1 Training)

**A. Align casual training system prompt with inference**

In `merge-datasets.js`, for `category === 'casual'`, use a prompt that matches `CASUAL_SYSTEM_PROMPT` (or a close variant) instead of `PIKO_SYSTEM_BASE`:

```javascript
const CASUAL_SYSTEM_FOR_TRAINING = `You are Piko, a friendly, dry-humoured mate. For this turn, answer like a normal friend: one short, natural sentence. Answer what they actually asked. No projects, advice, or themes unless they ask.

Rules:
- ONE short sentence. Match their tone and energy.
- Never echo the user's greeting back.
- No themes, reflection, or unsolicited follow-ups.
- Vary wording naturally.`;

function buildSystemBlock(category) {
  if (category === 'casual') {
    return CASUAL_SYSTEM_FOR_TRAINING;
  }
  if (category && category !== 'unknown') {
    return `${PIKO_SYSTEM_BASE}\n\nCategory: ${category}. Reply in character.`;
  }
  return PIKO_SYSTEM_BASE;
}
```

**B. Add missing casual variants and reduce repetition risk**

In `generate-casual-smalltalk.js`, add:

```javascript
// Compound greetings (currently may not match planner — but train for them anyway)
['Hey, how\'s it going?', 'Not bad — you?'],
['Hey, how\'s it going', 'Good — you?'],
['What are you up to?', 'Not much — you?'],
['What are you up to', 'Same old — you?'],
// Empathy / mood
['I had a rough day', 'Sorry to hear — want to talk about it?'],
['I had a rough day.', 'Rough days happen — you okay?'],
// Opinions (short)
['What do you think about coffee?', 'Love it — can\'t function without. You?'],
['What do you think about coffee', 'Good stuff — you?'],
// Capability (short)
['What can you help me with?', 'Chat, reminders, tools, coding when you ask.'],
['What can you help me with', 'Whatever you need — chat, tasks, coding.'],
// Sign-off
['Thanks, that\'s all for now', 'No worries — catch you later.'],
['Thanks, that\'s all', 'Cheers.'],
```

**C. Explicit anti-repetition examples**

Add a few examples that discourage stock phrases:

```javascript
['Hey Piko', 'Hey — what\'s good?'],   // NOT "Morning there — keeping dry"
['Morning', 'Morning — coffee on?'],   // already present
```

And ensure no training example contains "Morning there — keeping dry" or "how are things shaping up" as the assistant reply.

**D. Upweight casual in the dataset**

Casual is ~3% of training. Options:

- Duplicate casual pairs 2–3× in the merge (simple).
- Or add a `merge-datasets` option to oversample `category === 'casual'` so it’s ~15–20% of train.

### 5.2 Prompt Changes (Runtime)

**A. Broaden planner patterns**

In `lib/planner.js`, extend patterns so compound greetings are casual:

```javascript
// Add: "Hey, how's it going" style
const GREETING_PATTERN = /^(hi|hey|hello|...|how\'?s it going)([\s!?.]*|\s+piko[\s!?.]*|,?\s+how\'?s it going[\s!?.]*)$/i;
```

Or add a separate check:

```javascript
const COMPOUND_GREETING = /^(hey|hi|hello|morning|evening|g\'?day)[\s,]+(how\'?s it going|how are you|what\'?s up|how are things)[\s!?.]*$/i;
const isCompoundGreeting = trimmed.length <= 60 && COMPOUND_GREETING.test(norm);
// Then: isGreeting = isGreeting || isCompoundGreeting;
```

**B. Avoid INTERESTS bullets in replies (post-process)**

Add a guardrail to strip INTERESTS-style bullets from replies:

```javascript
const INTERESTS_LEAK_PATTERN = /-\s*\*\*Projects?:\*\*\s*[\s\S]*?(?=\n\n|$)/i;
function stripInterestsLeak(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(INTERESTS_LEAK_PATTERN, '').trim();
}
// Apply in stripMetaSlip or casual guardrail path
```

**C. Lower temperature for casual turns**

In `lib/llm.js` or the caller, use a lower temperature for casual:

```javascript
const temperature = plan.casual ? 0.7 : (options.temperature ?? 0.9);
```

### 5.3 Phase 3.1 Training Checklist

1. Update `merge-datasets.js`: casual system prompt aligned with inference.
2. Update `generate-casual-smalltalk.js`: add compound greetings, empathy, opinions, capability, sign-off.
3. Regenerate casual data: `node scripts/finetune/generate-casual-smalltalk.js`
4. Merge: `node scripts/finetune/merge-datasets.js`
5. (Optional) Oversample casual 2–3× in merge.
6. Train: same script and steps as Phase 3 (500 steps or 1 epoch).
7. Export: `bash scripts/finetune/export-to-ollama.sh`
8. Broaden planner patterns so "Hey, how's it going?" etc. are casual.
9. Add INTERESTS leak guardrail.
10. Optionally lower casual temperature to 0.7.

---

## 6. Summary Table

| Recommendation | Type | Effort | Impact |
|----------------|------|--------|--------|
| Align casual system prompt in training | Data | Low | High |
| Add compound greeting + empathy/opinion/capability/sign-off examples | Data | Low | Medium |
| Oversample casual 2–3× | Data | Low | Medium |
| Broaden GREETING / add COMPOUND_GREETING | Prompt | Low | High |
| Strip INTERESTS leak in post-process | Prompt | Low | Medium |
| Lower temperature for casual (0.7) | Prompt | Low | Medium |

---

## 7. References

- `webchat-piko/scripts/finetune/PHASE3_CASUAL_LORA_RUNBOOK.md`
- `webchat-piko/scripts/finetune/merge-datasets.js`
- `webchat-piko/scripts/finetune/generate-casual-smalltalk.js`
- `webchat-piko/lib/planner.js`
- `docs/PIKO_CONVERSATIONAL_TONE_PROBLEM.md`
- `docs/PIKO_RESPONSE_FLOW.md`
- `CONVERSATION_CODE.txt` (export of relevant code paths)
