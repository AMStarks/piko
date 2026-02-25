# Piko conversational tone: problem statement

**Purpose:** Clear articulation of the issue so we can fix it or seek help (e.g. prompt engineering, fine-tune adjustment, or model change).

---

## What we want

- **Simple greetings** (e.g. “Hey Piko”, “How are you going?”) → one short, natural line in reply (e.g. “Doing good — you?”, “Not bad. You?”).
- **Background** (memory, interests, sticky ideas, recent learning) used only when it’s clearly relevant to what the user said. It must not drive the reply.
- No reprise of past topics or themes unless the user brings them up (e.g. no “how’s your project with Piko?” or “how’s standing out authentically going?” when the user only said “How are you?” or “That’s short”).

---

## What actually happens

- For “Ok, how are you going?” Piko replies with a paragraph that **leads with a theme** (“how’s your project with Piko shaping up?”, “differentiation”, “care to dive deeper?”) instead of a short, direct answer.
- For “That’s short” Piko again **leads with a theme** (“Hey Piko, doing well—how’s your journey on standing out authentically coming along? We chatted last week; care to share more?”) instead of acknowledging the comment briefly and naturally.

So the model is **prioritising “reflect back themes / suggest follow-ups” over “answer the question they asked and match their energy”.**

---

## What we’ve already tried (in the system prompt and planner)

- **SOUL.md:** “For greetings … Do **not** bring up past conversation topics, learning themes, or ‘how’s X going?’ unless the user just asked. Match their energy.”
- **SOUL.md:** “Background (memory, interests, sticky ideas, recent learning): use when it’s clearly relevant … For a simple ‘hi’ or ‘hey,’ do not reprise themes like ‘standing out’ or ‘the unique you’.”
- **Planner:** “Hey Piko”, “G’day Piko” (and similar) classified as **casual** so the server injects: “**This turn:** Casual greeting/small talk. One short warm line only. Match their energy … Do NOT bring up past topics, learning themes, or ‘how’s X going?’—they only said hi.”
- **Server:** For casual turns we skip Gmail, RAG, recent-learning block, and sticky-ideas block in the system prompt, and cap reply length (e.g. 200 tokens).

So the **instructions in the prompt are correct**, but the **model still leads with themes** instead of following them.

---

## Likely causes (to investigate or get help with)

1. **Fine-tune vs in-context instructions**  
   The model (`piko:finetune`) may have been tuned on data where “reflect back themes / suggest follow-ups” is common, so it overrides the in-context “one short line, don’t reprise” rule.

2. **Instruction position / length**  
   The “this turn: casual, one short line, don’t reprise” line may be getting diluted by a long system prompt (corpus, memory, identity, soul, etc.), so the model attends more to the general “companion that suggests follow-ups” than to the “this turn only” instruction.

3. **Model capability**  
   The base model may be weak at “do X this turn only” when the rest of the prompt encourages “engage with themes and suggest follow-ups”.

4. **History**  
   If we send recent conversation history, the model may be copying the style of earlier turns (e.g. “care to dive deeper?”) even when we ask for a short reply this turn. (We already send 0 history for casual turns; worth confirming that’s in effect for Telegram.)

---

## What would fix it (options)

- **Prompt:** Stronger or repeated “this turn only” instruction (e.g. at the very end of the system prompt, or as a separate system message), or shorter system prompt for casual so the instruction has more relative weight.
- **Fine-tune:** Add (or upweight) examples of “user: simple greeting → assistant: one short line, no theme reprise” and retrain or LoRA-merge so the model follows that pattern.
- **Model:** Try a different base or chat-tuned model that follows “this turn” instructions more reliably.
- **Post-process:** For casual turns, detect and trim sentences that reprise themes (e.g. “how’s X going?”, “care to dive deeper?”) and keep only the first short line. (Workaround, not a fix for the root cause.)

---

## Summary in one sentence

**The model keeps leading with “reflect back themes / suggest follow-ups” even when the system prompt explicitly says “this turn: one short line, don’t reprise past topics,” so simple greetings get long, theme-heavy replies instead of short, natural ones.**

---

## Structural fix (implemented)

For **casual** turns we send a **minimal prompt with a small persona** (Piko as friendly, dry-humoured mate — no full identity/soul/memory). Rules: one short sentence, never echo the user's greeting, vary wording. A light guardrail: echo fix (if reply = user greeting → fallback), first line → first sentence. No theme stripping — the minimal prompt is the primary control. See `docs/PIKO_RESPONSE_FLOW.md` and `docs/PIKO_ADOPTION_PLAN_VERIFY.md`.
