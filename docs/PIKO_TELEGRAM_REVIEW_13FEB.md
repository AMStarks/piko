# Telegram conversation review — 13 Feb 2026 (09:07)

## What you saw

| # | You said | Piko said |
|---|----------|-----------|
| 1 | Hello | Hey — coding's been a marathon today! Anything specific locking you up? |
| 2 | Not much. Was keen to chat. How are you? | Hey, nice to hear from you. Coding can be relentless at times. How's your project coming along? |
| 3 | It's good. What have you learned recently? | Hey, what's up? |

---

## What’s going on (turn by turn)

### Turn 1: "Hello" → still about coding

- **Planner:** "Hello" matches `GREETING_PATTERN`, so `plan.casual = true` and we send **no prior history**. The model only sees: system prompt + "Hello".
- So the issue isn’t old conversation context. The **system prompt** (SOUL, IDENTITY, SYSTEM_PROMPT) is full of “coding”, “debugging”, “practical”, “focus on coding help”. With no chat history, Qwen still infers “coding companion” and answers as if you’re in the middle of a coding day.
- **Conclusion:** No-history for greetings is working. The model is being primed by the **content of the system prompt**, not by history.

### Turn 2: "Not much. Was keen to chat. How are you?" → still “coding” and “project”

- **Planner:** That message is 41 characters and doesn’t match `GREETING_PATTERN` (which is short, single greeting only). It doesn’t match `CASUAL_PATTERN` either (that expects things like “not much” or “how are things” **and** end of string, so not “Not much. Was keen to chat. How are you?”).
- So `plan.casual = false` → we send the **last 20 turns** of the Telegram session. That includes turn 1 (Hello → “coding’s been a marathon…”). So the model sees that and continues in the same “coding / project” tone.
- **Conclusion:** This message is treated as normal (non-casual), so full history is sent and the first reply reinforces the coding frame.

### Turn 3: "What have you learned recently?" → "Hey, what's up?"

- That reply is almost certainly our **post-filter** replacement. The model likely said something that hit one of: `META_SLIP_PATTERN`, `HERE_TO_HELP_PATTERN`, or `EVASIVE_PATTERN` (“could you clarify”, “I’m not sure what you mean by”), and we replace with `"Hey — what's up?"`.
- So the model’s actual answer was replaced by a generic fallback. For a real question like “What have you learned recently?”, that’s wrong: we’re hiding a bad reply instead of letting a good one through (and we might be replacing an okay-but-canned reply too).
- **Conclusion:** The filter is doing its job (removing canned/evasive lines) but it’s also replacing **substantive** answers when the user asked a real question.

---

## Summary

| Cause | What’s happening |
|-------|-------------------|
| **System prompt** | Even with no history, SOUL/IDENTITY are so coding-heavy that “Hello” gets a coding-flavoured reply. |
| **Casual pattern too narrow** | “Not much. Was keen to chat. How are you?” isn’t treated as casual, so we send full history and the “coding” theme continues. |
| **Post-filter too broad** | “What have you learned recently?” got a reply that triggered the filter and was replaced by “Hey, what’s up?” so the real question was lost. |

---

## Recommended next steps

1. **Greeting / first turn:** Add a single line to the system prompt when `plan.casual` is true and the message is a pure greeting (e.g. “The user only said a greeting. Reply with one short greeting. Do not mention coding, projects, or debugging.”). That counter-acts the coding bias when there’s no history.
2. **Widen casual:** Extend `GREETING_PATTERN` or add a pattern so that “Not much. Was keen to chat. How are you?” (and similar “catching up” lines) is treated as casual → no history, short reply, less “project/coding” default.
3. **Post-filter:** Don’t replace with “Hey — what’s up?” when the user asked a clear, substantive question (e.g. “what have you learned”, “what do you think”). Either narrow the evasive patterns so they don’t fire on those, or add a “user asked a real question” guard so we don’t overwrite those replies.

I can implement (1) and (2) and adjust (3) in code next if you want.
