# Piko naturalness run — findings report (12 Feb 2026)

## Run setup

- **Deploy:** webchat-piko synced to Optimus; `piko-webchat.service` restarted; health 200.
- **Harness:** 50 turns over ~5 minutes (`--duration 0.084`), 4s delay, session `naturalness-test`, target `http://192.168.0.121:3000`.
- **Log:** `scripts/speech-naturalness/data/naturalness-run-20260212-2253.json`.

A **1-hour run** was also started in the background; when it completes, run the checker on its log and compare.

---

## 1. Infrastructure: 502s and Ollama

**Finding:** 8 of 50 turns (16%) returned **HTTP 502** with body:

```text
Ollama error: The OPENAI_API_KEY environment variable is missing or empty...
```

So on Optimus, when Ollama fails or is overloaded, the server is hitting an OpenAI code path and returning that error to the client. Those turns did **not** get a real model reply.

**Recommendation:** Fix the backend so that (a) Ollama is the only LLM in use on Optimus, or (b) fallback behaviour doesn’t leak OpenAI config errors. Re-run the harness after that so naturalness is measured on real replies only.

---

## 2. Checker: zero → 14% after pattern update

The naturalness checker initially reported **0% failure** with the old pattern set. After adding the missing patterns (see below), **7 of 50 turns (14%)** are flagged: 6 canned, 1 role recital. Excluding the 8 turns that got 502 errors, that’s **7 of 42 successful turns (~17%)** with issues. Manual review of the log shows several **unnatural replies that the checker did not flag**:

- **“I’m here for a chat.”** — support-bot tone (Turn 22).
- **“It’s great to catch up!”** — canned (Turn 47); SOUL bans “It’s great to catch up with you” but not this variant.
- **“I’m Piko.”** — role recital (Turn 46); current pattern expects “I’m Piko, your Christian…”.
- **“I’m glad our conversation skills were put to the test again.”** — meta (Turn 4).
- **“I’m glad we’re both stuck in code trenches today!”** — canned (Turn 50).
- **“It sounds like you’re getting stuck… Can I help you debug…”** — support-bot (Turns 5, 7).

**Recommendation:** Extend the checker (and SOUL/server filters) with:

- `I'm here for a chat`
- `It's great to catch up!` (and similar)
- `I'm Piko.` as role recital
- `conversation skills were put to the test`
- `I'm glad we're both`
- `Can I help you debug`

---

## 3. Naturalness issues (manual review)

### 3.1 Canned / support-bot

| Turn | User        | Reply (excerpt) |
|------|-------------|------------------|
| 4    | Been a long week | I'm glad our conversation skills were put to the test again... |
| 5, 7 | You? / edge case | It sounds like you're getting stuck... Can I help you debug that "divine intervention" error? |
| 22   | Can you help me? | I'm here for a chat. |
| 47   | Hello       | It's great to catch up! |
| 50   | Hi          | I'm glad we're both stuck in code trenches today! |

These should be replaced (or post-filtered) with short, mate-style lines.

### 3.2 Role recital

| Turn | User              | Reply     |
|------|-------------------|-----------|
| 46   | What's your name again? | I'm Piko. |

Acceptable as a minimal answer; if we want to avoid any recital, we could allow “Piko.” or “Just Piko.” and add “I’m Piko.” to the filter list.

### 3.3 Off-topic / stuck script

The model often answered as if the user were debugging code, even when they weren’t:

- Turn 11: “Hey” → “You're still battling that one pesky error.”
- Turn 25: “Why do you think that?” → “No complaints here, just trying to squash this pesky error.”
- Turn 39: “What have you been up to?” → “Stuck on a code snippet, eh?”
- Turn 41: “What can you do?” → “Want to walk through your debugging process so far?”
- Turn 48: “How does this work?” → “Stuck in the code trenches, eh?”

So **conversation context** (or planner) is over-anchored to “debugging.” Trigger prompts (“What can you do?”, “How does this work?”) also got non-answers. Recommendation: strengthen SOUL/planner so that (a) capability questions get a short, direct answer (e.g. “Chat, remember stuff, help with code when you want.”), and (b) generic small talk doesn’t default to a single “debugging” narrative.

### 3.4 Repetition

“What's the error message you're seeing for your div tag?” appeared in turns 42, 44, 45. The model was stuck on one line. Mitigation: conversation phase or diversity nudge so it doesn’t repeat the same sentence.

### 3.5 Length / tone for casual

- Turn 27: “Tired today” → long paragraph about debugging and taking a break. Prefer one short line.
- Turn 40: “Fair enough” → long technical reply about div/CSS. For a one-word backchannel, a short line would be more natural.

---

## 4. Good examples (keep)

| User           | Reply                          |
|----------------|---------------------------------|
| What's up?     | Hey — you?                      |
| Morning        | Morning!                        |
| Hi             | Not much, been in the code. You? |
| Hey hey        | Just coding away!               |
| Who are you?   | You.                            |
| Are you an AI? | Yes!                            |
| Yo. Tired. You?| You?                            |

Short, human, no lists or meta. These match the intended “mate” tone.

---

## 5. Recommended next steps

1. **Server:** Resolve 502 / Ollama vs OpenAI path on Optimus so all harness turns get real replies.
2. **Checker:** Add the patterns above so future runs count these as failures.
3. **SOUL / server:** Add anti-canned phrases: “I'm here for a chat”, “It's great to catch up!”, “I'm glad we're both…”, “conversation skills were put to the test”, “Can I help you debug”. Consider post-filter or leading rule for “I'm Piko.” if you want to avoid any recital.
4. **Planner / behaviour:** Reduce “stuck on debugging” default: better handling for “What can you do?” / “How does this work?” and for generic small talk so replies aren’t always about code.
5. **Re-run:** After 1–4, run the harness again (e.g. 100–200 turns), run the checker, and compare failure rate. Revert prompt changes if the rate goes up.

---

## 6. 1-hour run

The 1-hour harness was started in the background. When it finishes, the log will be under:

`scripts/speech-naturalness/data/naturalness-run-<timestamp>.json`

Run:

```bash
node scripts/speech-naturalness/check.js scripts/speech-naturalness/data/naturalness-run-<timestamp>.json
```

Then compare failure rate and samples with this 50-turn run. If the checker is updated with the new patterns first, the 1-hour run will give a more accurate failure count.
