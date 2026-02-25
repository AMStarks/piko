# Piko naturalness — 1-hour run summary and advice

## Run summary

| Metric | Value |
|--------|--------|
| **Total turns** | 622 |
| **HTTP 502 (Ollama/OpenAI error)** | 128 (20.6%) |
| **Successful replies (200)** | 494 |
| **Checker: unnatural** | 9 (1.4% of all turns; **1.8% of successful turns**) |
| **Checker: ok** | 613 (many 502 replies were still classified; 485 successful turns passed) |

So in the 1-hour run, **about 1 in 55 successful replies** was flagged as canned or role recital. The raw failure count is low, but the **patterns** are important: the model keeps falling into the same bad habits.

---

## What the checker caught (9 failures)

1. **"I'm here to help"** (5 turns) — Replies like: *"Debugging's a tough nut to crack, but I'm here to help. What specifically is giving you trouble?"* to **"Who are you?"**, **"Can you help me?"**, **"Cool"**, **"Hello"**. SOUL already forbids "I'm here to help"; the model still uses it when stuck in the debugging script.
2. **"You've been struggling with those error messages, and I'm here to help"** (2 turns) — Same phrase to "Yeah" and "Give me a summary". Support-bot tone + off-topic.
3. **"I'm glad our conversation skills were put to the test again"** (1 turn) — Meta/canned; we already flag it but it still appears.
4. **"I'm Piko."** (1 turn) — Minimal role recital to "What's your name again?"
5. **Evasive reply** (1 turn) — "What would you do?" → *"I'm not sure what you mean by 'What are you?' - could you clarify..."* (wrong question + support-bot).

Underlying issue: the model often **ignores the user’s actual question** and answers as if they’re debugging. So "Who are you?" and "Hello" get "I'm here to help" + debugging follow-up.

---

## Advice: what to adjust

### 1. Post-filter "I'm here to help" on the server (high impact)

SOUL already says not to use it; the model still does. Add a **server-side post-filter** (like `stripMetaSlip`):

- If the reply contains **"I'm here to help"** (or "I'm here to help." / "but I'm here to help"), replace that sentence (or the whole reply) with a short fallback, e.g. *"Hey — what's up?"* or *"What's on your mind?"* (or a random short line from a small list).

This directly removes the most frequent failure (5 of 9) and reinforces that we never send that phrase to the user.

### 2. Add the phrase to SOUL and leading rule (reinforce)

In **SOUL.md** and the server **leading rule**, make it explicit:

- **Never** say "I'm here to help" or "I'm here to help. What's..." — reply to what they said in one short line instead.

In **IDENTITY.md** (greetings / one-line): remind that **capability questions** ("Who are you?", "Can you help me?", "What can you do?") get **one short direct answer**, not a debugging follow-up.

### 3. Break the "debugging default" (high impact)

Many bad replies come from the model assuming the user is always debugging. So:

- **Planner:** When the user message is a **direct question** (who are you, what can you do, can you help, how does this work) or a **greeting/casual** ("Hello", "Cool", "Yeah"), set a flag or plan line that says: **"Answer the question asked. Do not assume they are debugging code. One short line."**
- **System prompt:** Add one line: *"Do not assume the user is debugging or has a bug unless they said so. Answer the question they actually asked."*

That should reduce off-topic "What's the error message?" / "Debugging's a tough nut..." replies to "Who are you?" and "Hello".

### 4. Evasive "could you clarify" (medium)

For replies that say **"I'm not sure what you mean by ... could you clarify"** when the user asked something clear (e.g. "What would you do?"), we can:

- Add to SOUL: *"Do not reply with 'could you clarify' or 'what do you mean by X' when the user asked a clear question. Answer briefly or ask one short follow-up."*
- Optionally add a post-filter: if the reply contains "could you clarify" or "I'm not sure what you mean by" and the user message was short and clear, replace with a short fallback.

### 5. Role recital "I'm Piko." (low)

Only one instance. Options:

- Add **"I'm Piko."** to the server meta-slip filter and replace with *"Piko."* or *"Just Piko."*, or
- Leave as-is and rely on SOUL ("Do not recite your role") for now.

### 6. Fix 502s on Optimus (infrastructure)

128 of 622 (20.6%) were 502 with Ollama/OPENAI_API_KEY error. That’s an environment/config issue: either Ollama is failing and the server is falling back to an OpenAI path that isn’t configured, or something else is wrong. Fix that so the harness (and real users) get real replies instead of error text. Then re-run the harness to get a cleaner naturalness rate.

---

## Suggested order of changes

| Priority | Change | Why |
|----------|--------|-----|
| 1 | **Server post-filter for "I'm here to help"** | Removes 5/9 failures immediately; no model change. |
| 2 | **Planner + system prompt: "Answer the question asked; don’t assume debugging"** | Reduces off-topic debugging script for greetings and capability questions. |
| 3 | **SOUL + leading rule: never "I'm here to help"; capability Q = one short answer** | Reinforces behaviour so the model learns it. |
| 4 | **SOUL: no "could you clarify" for clear questions; optional post-filter** | Handles evasive replies. |
| 5 | **Fix 502 / Ollama on Optimus** | So 100% of turns are real replies. |
| 6 | **Optional: "I'm Piko." → "Piko." in post-filter** | Polish; only 1 failure. |

After 1–4: redeploy, run the harness again (e.g. 200 turns), run the checker. If the failure rate goes **up**, revert. If it goes **down**, keep and optionally run a longer run to confirm.

---

## One-line summary

**1-hour run:** 622 turns, 20% 502s, **1.8% of successful replies** flagged (9 total). Main issue: **"I'm here to help"** and **stuck-on-debugging** replies to simple questions. **Adjust:** post-filter "I'm here to help", add "answer the question asked; don’t assume debugging" to planner and system prompt, tighten SOUL/IDENTITY, then fix 502s and re-test.

---

## Implemented (all 6)

1. **Server post-filter** — `stripMetaSlip` now also replaces: "I'm here to help", "could you clarify" / "I'm not sure what you mean by", and reply exactly "I'm Piko." → "Piko."
2. **Planner + system prompt** — Capability-question pattern (who are you, what can you do, can you help me, how does this work, what's your name, introduce yourself); plan line "Answer in one short line. Do not assume they are debugging."; system line "Do not assume the user is debugging or has a bug unless they said so."
3. **SOUL + leading rule** — Leading rule: never "I'm here to help"; answer the question they asked; do not assume debugging. SOUL: capability questions = one short direct answer; "I'm here to help. What's..." in forbidden list.
4. **SOUL: no "could you clarify"** — SOUL line: do not reply with "could you clarify" or "what do you mean by X" when the user asked a clear question. Post-filter replaces those replies with "Hey — what's up?"
5. **Fix 502** — In `lib/llm.js`, when **PIKO_OLLAMA_ONLY=1** (or true), only the primary model is tried (no Claude/OpenAI fallback). **On Optimus, set `PIKO_OLLAMA_ONLY=1`** in the environment so 502s return the real Ollama error instead of leaking OPENAI_API_KEY messages.
6. **"I'm Piko." → "Piko."** — Included in server post-filter (item 1).
