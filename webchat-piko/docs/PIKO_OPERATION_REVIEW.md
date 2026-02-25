# Piko operation review: how it works and how to improve

## 1. How chat works (all channels)

- **Single entrypoint:** Every channel (WebChat, Telegram, iMessage, etc.) POSTs to `/api/chat` with `message` and `sessionId`. SessionId shape: `webchat`/default → `main` or key; `telegram-<chatId>` → source `telegram`; `imessage-<chatGuid>` → source `imessage`.
- **Allowlist:** Non-webchat sources must be in `data/allowlist.json` (or allowed via `/allow <source> <id>` from WebChat). WebChat is always allowed.
- **Same brain:** All channels use the same flow: allowlist check → command handling (e.g. `/allow`, `/new`) or → build system prompt + history → call Ollama (or fallback) → reply. No channel-specific model or prompt; the only difference is session key (so each Telegram chat / iMessage chat has its own history).

## 2. System prompt and reply path

- **Prompt assembly (server.js):** Leading rule (reply only to message, no meta) + corpus block (identity/soul/memory/interests) + truth block + memory block + **response plan line** + no-assume-debug + impact + `SYSTEM_PROMPT` (IDENTITY + SOUL + INTERESTS) + recent learning + sticky ideas + pending question + RAG context + style reminder.
- **Response planner (lib/planner.js):** Classifies turn as greeting/casual/capability/goal-relevant etc. For **greetings** (e.g. "Hello.", "Hi.") it sets `casual: true`, `verbosity: low`, `tone: warm`.
- **Casual turns:** When `plan.casual` is true, **history is cleared for this turn** (`historyWindow = 0`): the model sees only system prompt + the single user message (e.g. "Hello."). The plan line says: one short warm line, not "Hey — you?", e.g. "Hey — good to hear from you" or "Hi — how's it going?"
- **LLM call:** `ollamaChat(messages, sessionModel)` → `ai(messages, { model, max_tokens: 4000 })` (lib/llm.js). Temperature 0.9, top_p 0.92. On Optimus, `PIKO_OLLAMA_ONLY=1` so **no fallback** to Claude/OpenAI; if Ollama fails, the request fails.
- **Post-processing:** `stripMetaSlip(reply)` replaces known meta phrases (e.g. "I'm here to help", "could you clarify") with **"Hey — what's up?"** so the user never sees those. `fixPersonalLifeDeflection` can replace a coding-heavy reply with "Sure — what's on your mind?" when the user asked about personal life.

## 3. Why Telegram (or any channel) might get short / “7b-like” replies

- **Not a different model:** Telegram and iMessage use the same Ollama model and same prompt. There is no separate “7b” path; if you see "Hey — you?" it is either:
  1. **Raw model output** for a casual greeting with no history: the model is told “one short line” and sometimes produces an overly minimal reply.
  2. **stripMetaSlip:** If the model had said something like "I'm here to help" or "could you clarify", it would be replaced by "Hey — what's up?" (not "Hey — you?"). So "Hey — you?" is almost certainly the model’s own output.
- **Casual = no history:** For "Hello." we send only system + "Hello." So the model has no prior turns to mirror or extend; some models default to a very short bounce-back.
- **SOUL already says:** "Do not repeat the same phrase (e.g. 'Hey — you?')" and "Vary greetings". The instruction is there; the model (e.g. Gemma 27B) may still under-follow on first turn.

## 4. What we changed to improve greetings

- **Plan line for casual turns:** Explicitly instruct: one short **warm** line, with examples ("Hey — good to hear from you", "Hi — how's it going?"), and **do not** reply with only "Hey — you?" or a bare bounce-back.
- **SOUL.md** (already): Greetings one short line, warm and human; vary; do not repeat "Hey — you?".

## 5. Recommendations to make the model work better

| Area | Suggestion |
|------|------------|
| **Model** | Use the largest Ollama model that fits your hardware (e.g. 27B over 7B). Confirm `data/current_model.txt` or env is set to that model; restart after changing. |
| **Greetings** | If replies stay too terse, add 1–2 example greetings in IDENTITY.md or in the casual plan line. You can also try **including last 1 exchange** for greetings (e.g. `historyWindow = plan.casual ? 1 : SLICE_HISTORY`) so the model sees "Hello." and one prior pair; test for side effects. |
| **Temperature** | Default 0.9 is quite high. For more consistent tone, try 0.7–0.8 in lib/llm.js or via a per-session override if you add one. |
| **Fallback** | On Optimus, fallback is off (`PIKO_OLLAMA_ONLY=1`). If Ollama is slow or errors, you get 502. Enabling fallback (remove or set to 0) would send to Claude/GPT when Ollama fails—different tone/cost. |
| **Observability** | Set `PIKO_PLANNER_DEBUG=1` to log planner output (verbosity, tone, casual, reason) per request; helps confirm greeting turns are classified as casual. Set `PIKO_LOG_CONSOLE=1` and grep for `[latency]` or `"msg":"latency"` to see `historyMessages` and `totalMs` (and `timeToFirstTokenMs` for stream) so you can compare latency when changing SLICE_HISTORY. |
| **stripMetaSlip** | The replacement "Hey — what's up?" is a last resort. If you prefer a different default when meta is detected, change it in server.js (`stripMetaSlip`). |
| **Channels in UI** | Control → Dashboard now has an **Access (channels)** card (allowlist). Control → Channels lists iMessage (BlueBubbles), Telegram, WhatsApp, and others with allowlist instructions. |

## 6. Unified session and cross-channel context (“carried over but missed bits”)

When **PIKO_UNIFIED_SESSION_ID** is set (e.g. to `main`), Telegram and the app (and WebChat) all use the **same session key**, so they share one conversation store. That’s why switching from Telegram to the app can feel like “context carried over.”

**Why some bits are missed:**

- **History window:** The model only ever sees the **last SLICE_HISTORY items** (currently 20 = about 10 exchanges). The DB keeps more (up to 30), but we slice before sending. So if the Telegram thread was long, specifics like “Engadine Dragons,” “St George Illawarra,” “groin stretching” may have been in earlier exchanges that are **outside the window** when you send from the app. The model then only has high-level topic (team, season) from recent turns, plus whatever made it into **memory/beliefs** (which are often summarised, so fine-grained details like team names or a one-off question may not be there).
- **Casual turns:** If the first message from the app is a short greeting (“Just checking in,” “Hey hey”), it can be classified as **casual** → we send **0 history** for that turn. Then the model has no conversation at all; any “team / season” flavour comes only from beliefs/episodic in the system prompt, which tend to be generic (“user into footy”) rather than “user plays for Engadine Dragons.”

**What we changed:** SLICE_HISTORY increased from 20 to 30 so that when you continue in the app (or any channel) after a long thread, the model sees the last **15 exchanges** instead of 10, reducing how often specifics drop out of the window.

**Optional improvements:** (1) For “continuation” messages (e.g. after a long session), avoid treating short follow-ups as full casual (history = 0) so we always send at least the last few exchanges. (2) Add a “recent context summary” (e.g. last N messages) into the system prompt when history is long, so key facts survive even when the raw history is sliced.

## 7. Quick checklist

- [ ] Ollama running; model set to desired size (e.g. Gemma 27B or Qwen 14B).
- [ ] `PIKO_OLLAMA_ONLY=1` on Optimus (no OpenAI key needed).
- [ ] Allowlist includes `telegram` and `imessage` as needed (`/allow telegram *`, `/allow imessage *` or specific IDs).
- [ ] SOUL.md and IDENTITY.md stress: one short **warm** greeting; vary; avoid "Hey — you?".
- [ ] Restart server after changing prompts or model.
- [ ] Optional: `PIKO_PLANNER_DEBUG=1` to verify planner behaviour.
