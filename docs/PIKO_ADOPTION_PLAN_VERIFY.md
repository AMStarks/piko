# Piko adoption plan — changes to verify before implementation

This document lists **all changes** we will make on the basis of adopting the reviewed recommendations (philosophy/epistemology, response hierarchy, casual prompt, guardrails). Use it to verify scope and wording before we implement.

---

## Part A — Philosophy and system-design docs

These are documentation and conceptual clarifications. No runtime behaviour change.

### A.1 Already present (no change needed)

The following are **already** in `docs/PIKO_MEMORY_WORLDVIEW_AND_LEARNING_FULL_WRITEUP.md`:

- **Bedrock as interpretive framework:** §3.1, §3.4, §5, §6 use “bedrock interpretive framework” and state that empirical claims default to tools + corrections; framework governs *how* we reason, not *what must be true*.
- **Reality override:** §4.3 and §5 state that when tool results or user corrections contradict the worldview’s expectations, reality overrides and the tension is logged.
- **Forgetting and compression:** §2.5 describes archiving/summarizing old rabbit-hole notes; meta-reflections and sticky ideas as compression; “forgetting is lossless at the level of meaning.”
- **Identity vs learning:** §1 and §6: “Identity files define Piko’s declared stance; learning defines its lived perspective.”
- **Claim store sparse and selective:** §4.2 says to track only claims that recur, matter to worldview, or were explicitly corrected; most rabbit-hole notes don’t need formal claim entries.
- **Claim type (descriptive | normative | interpretive):** §4.2 mentions optional type for the claim store.
- **Inquiry as epistemic humility:** §2.1 (in REPOSITORY_OF_UNDERSTANDING.md) and the full writeup frame inquiry as meaningful when tension persists, correction probability is high, or worldview guidance is underdetermined — not just “I’m curious.”

**Action:** None for these; they are already adopted in the docs.

### A.2 Optional tightening (if we touch those sections)

- **Explicit one-line “reality override” in §4:** Add a single stand-alone sentence in the truth/reality section, e.g.  
  **“When tool results or user corrections directly contradict the worldview’s expectations about the world, reality overrides interpretation, and the tension is logged.”**  
  (This is already stated in §4.3 and §5; we can add it as a one-line rule in §4.1 or §4.2 if you want it more prominent.)
- **Avoid “bedrock of truth” wording everywhere:** Search the repo for “bedrock of truth” and replace with “bedrock interpretive framework” or “bedrock (interpretive framework)” wherever it still appears. (Full writeup already uses “bedrock interpretive framework.”)

**Action:** Grep for “bedrock of truth”; replace if any remain. Optionally add the one-line reality-override sentence in §4.

---

## Part B — Casual reply: prompt and message structure

These are **runtime** changes in `webchat-piko/server.js` (and optionally `lib/planner.js` if we only add a comment).

### B.1 Replace full system prompt for casual with a minimal prompt

**Current behaviour (for `plan.casual === true`):**

- We send one system message containing: `leadingRule` + `memoryBlock` (already `''`) + `noAssumeDebugLine` + **full `SYSTEM_PROMPT`** (IDENTITY + SOUL + MEMORY.md + INTERESTS) + `CASUAL_FINAL_BLOCK` at the end.
- So the model still sees all companion/reflection/suggest-follow-ups language, then “this turn only: one short line.”

**New behaviour:**

- For **casual only**, do **not** send `SYSTEM_PROMPT` (no IDENTITY, SOUL, MEMORY.md, INTERESTS).
- Send a **single** system message that is **only** the minimal casual prompt below (no leadingRule blob, no corpus, no memory, no impact, no learning, no styleReminder).
- History remains 0; `memoryBlock` remains `''` for casual.
- `max_tokens` for casual remains low (e.g. 80–120; we already use 200; can reduce to 80 if desired).

**Exact minimal casual system prompt (to use as the only system message for casual):**

- **Word cap:** “Under 15 words” (not 12) — gives breathing room for natural replies (e.g. “Doing well — just keeping busy today. You?”) without enabling drift. One short sentence is the primary constraint; the word cap is secondary.
- **Safety line:** Include “Reply ONLY to the user’s last message.” so we retain that constraint without the full leadingRule blob.
- **Examples:** Include one colloquial and one “That’s short” so tone and brevity are anchored.

```text
You are Piko.

Reply ONLY to the user's last message.

This is a casual greeting or small-talk turn.

Your job:
- Reply with ONE short, natural sentence (ideally under 15 words).
- Match the user's tone and energy.
- No themes.
- No reflection.
- No suggestions.
- No follow-up about projects, growth, or past topics.
- Do not bring up memory.
- Do not steer the conversation.

If they ask how you are, answer briefly and optionally mirror it back in 1–3 words.

Examples:
User: Hey Piko
You: Hey — good to see you.

User: Hey
You: Hey mate — all good here.

User: How are you going?
You: Good thanks — you?

User: G'day
You: G'day mate.

User: That's short.
You: Yeah, keeping it brief.
```

**Implementation detail:**

- In `server.js`, when `plan.casual === true`:
  - Build **no** `baseContent` from `leadingRule`, `corpusBlock`, `truthBlock`, `memoryBlock`, `planLine`, `noAssumeDebugLine`, `impactBlock`, `SYSTEM_PROMPT`, etc.
  - Set `systemContent = CASUAL_SYSTEM_PROMPT` only (the string above).
  - `messages = [{ role: 'system', content: systemContent }, { role: 'user', content: message }]` (no history; we already do history 0 for casual).
- When `plan.casual === false`, keep current behaviour: one system message with full `baseContent + styleReminder` (no change to non-casual path).

### B.2 Message structure (no second system message for now)

- **Casual:** One system message (minimal prompt only), one user message. No second system message.
- **Non-casual:** Unchanged — one system message containing the full prompt blob. (We can later add a separate “TURN MODE: Normal” system message if we want turn constraints to dominate identity in general; that is **not** in this adoption batch.)

### B.3 Token and generation settings for casual

- **Recommendation:** Reduce `max_tokens` for casual from 200 to **80** (stream and non-stream). A lower generation budget tends to compress output and reduces drift; cheap insurance. Optional but recommended.
- Leave `temperature` unchanged for this pass (default 0.9); only change if tests show over- or under-variation.

---

## Part C — Post-process guardrail for casual

**What:** After the model returns a reply for a **casual** turn:

1. Take the **first line** only (split on newlines first) so drift like “Good thanks — you?\nBy the way…” doesn’t leak.
2. From that line, take the **first sentence** (split on `[.!?]`); if empty, keep the original reply.
3. If the result doesn’t end with `.!?`, append a period.

Phrase-stripping and word-cap truncation are **deferred** unless tests show we need them.

**Where:** `server.js`, after `stripMetaSlip(reply)` and `fixPersonalLifeDeflection(...)`, in both the streaming and non-streaming branches.

**Exact guardrail code:**

```js
if (plan.casual && reply && typeof reply === 'string') {
  const cleaned = reply.trim().split(/\n+/)[0];
  const firstSentence = cleaned.split(/[.!?]/)[0].trim();
  if (firstSentence.length > 0) {
    reply = firstSentence;
    if (!/[.!?]$/.test(reply)) reply = reply + '.';
  }
}
```

---

## Part D — File-by-file change list

### D.1 `webchat-piko/server.js`

| Location (approx) | Change |
|-------------------|--------|
| ~2038–2061 | **Casual branch:** Define a constant `CASUAL_SYSTEM_PROMPT` with the exact minimal prompt text above. When `plan.casual === true`, set `systemContent = CASUAL_SYSTEM_PROMPT` and **do not** use `baseContent`, `SYSTEM_PROMPT`, `memoryBlock`, `corpusBlock`, `truthBlock`, `impactBlock`, `recentLearningBlock`, `stickyIdeasBlock`, `getDailyMemoryBlock`, `gmailContext`, `ragContext`, or `styleReminder` for the system message. When `plan.casual === false`, keep current logic (build `baseContent`, then `systemContent = baseContent + styleReminder`). |
| ~2085–2090 | No change to `messages` construction: still `[{ role: 'system', content: systemContent }, ...historyPart]` and, for casual, `messages.push({ role: 'user', content: message })`. The only change is that for casual, `systemContent` is now the minimal prompt only. |
| ~2106 (stream) and ~2126 (non-stream) | After `stripMetaSlip` and `fixPersonalLifeDeflection`, add the casual guardrail (Part C): first line only, then first sentence; append period if missing. |
| ~2095 and ~2124 | For casual, set `max_tokens: 80` in `streamOptions` and `chatOptions` (recommended). |
| After building `systemContent` (~2060) | **Optional debug:** If `process.env.PIKO_DEBUG_CASUAL === '1'`, log `[CASUAL DEBUG] message, plan.casual, systemContent.length` so you can confirm casual detection and prompt size during testing. |

### D.2 `docs/PIKO_RESPONSE_FLOW.md`

| Change |
|--------|
| Update the “System prompt construction” and “Message array” sections to state that for **casual** we send **only** the minimal `CASUAL_SYSTEM_PROMPT` (no SYSTEM_PROMPT, no memory, no corpus, no identity/soul/interests). |
| Add a short subsection describing the **casual guardrail**: for casual, post-process keeps first sentence only. |
| Optionally add a note that “TURN MODE” as a second system message for non-casual is deferred. |

### D.3 `docs/PIKO_CONVERSATIONAL_TONE_PROBLEM.md` (or PIKO_RESPONSE_FLOW.md)

| Change |
|--------|
| Add a line that the **structural fix** adopted is: for casual, full SYSTEM_PROMPT is removed and replaced by a minimal prompt-only system message; optional guardrail keeps first sentence. |

### D.4 Philosophy docs (optional)

| File | Change |
|------|--------|
| `docs/PIKO_MEMORY_WORLDVIEW_AND_LEARNING_FULL_WRITEUP.md` | None required; already aligned. Optionally add the one-line “reality override” sentence in §4.1 or §4.2 if you want it more prominent. |
| Repo-wide | Grep for “bedrock of truth”; replace with “bedrock interpretive framework” (or equivalent) if any occurrences remain. |

### D.5 No changes to

- `lib/planner.js` — no logic change; planner already sets `plan.casual` for “G'day Piko.” etc. Comment-only change optional.
- `prompts/IDENTITY.md`, `SOUL.md`, `INTERESTS.md`, `MEMORY.md` — no change in this adoption (identity hierarchy and energy-matching are already updated in a previous pass).
- Telegram bot — no change (it just forwards to `/api/chat`).
- Any other services or scripts.

---

## Part E — Summary checklist for you to verify

Before implementation, please confirm:

- [ ] **A** — Philosophy: We only do optional grep/replace for “bedrock of truth” and optional one-line reality-override sentence; no other doc changes required.
- [ ] **B.1** — Casual uses the **exact** minimal prompt text above as its **only** system message (no IDENTITY, SOUL, MEMORY.md, INTERESTS).
- [ ] **B.2** — Non-casual path is unchanged (single system message, full prompt).
- [ ] **B.3** — Casual `max_tokens` set to **80** (recommended).
- [ ] **C** — Guardrail: for casual we keep **first line, then first sentence**; append period if missing. Phrase-stripping deferred.
- [ ] **D** — Files to touch: `server.js` (casual branch + guardrail), `PIKO_RESPONSE_FLOW.md` (and optionally conversational-tone doc); optional philosophy doc tweak.

---

## Part F — After implementation

- Deploy `webchat-piko` to Optimus and restart `piko-webchat`.
- **Test set:** Run these (and variants) and confirm one short natural line, no theme reprise:
  - `G'day.` / `G'day Piko.` / `How are you?` / `Hey` / `Hey Piko` / `That's short.` / `Morning.` / `Cool.` / `How's it going?` / `What's up?` / `Sup?`
- **Negative checks:**
  - “Hey Piko” → must **not** contain “how’s the project…”, “care to…”, “what’s on your heart”, or reflective follow-up.
  - “That’s short” → must **not** contain follow-up coaching or “care to dive deeper?”
- **Success criterion:** ≥8/10 of the test prompts yield one short natural line with **zero** theme reprise. If not, use `PIKO_DEBUG_CASUAL=1` to confirm whether casual detection fired and what prompt length was sent; if detection is correct and drift persists, the next lever is LoRA/short-reply fine-tune data.
- If needed, add phrase-stripping or word-cap truncation in the guardrail and re-test.

---

## Final recommendation

**Approve and implement** with the integrated tweaks above:

1. **Casual prompt:** 15-word cap; “Reply ONLY to the user’s last message.”; examples including “That’s short” and “Hey mate — all good here.”
2. **Runtime:** For `plan.casual === true`, send **only** `CASUAL_SYSTEM_PROMPT` (no SYSTEM_PROMPT, no identity/soul/memory/interests). Non-casual path unchanged.
3. **Guardrail:** First line → first sentence; append period if missing. No phrase-stripping in this pass.
4. **Tokens:** `max_tokens: 80` for casual (stream and non-stream).
5. **Optional:** `PIKO_DEBUG_CASUAL=1` when testing to log message, `plan.casual`, and systemContent length.
6. **Philosophy:** Optional grep for “bedrock of truth” and optional one-line reality-override in §4; same voice as existing doc.

**Deploy** after ticking the checklist in Part E. **Success** = ≥8/10 test prompts give one short natural line with zero theme reprise. If the fix holds, the hierarchy change is validated; if not, the debug log tells you whether to fix planner edge cases or add short-reply LoRA data next.
