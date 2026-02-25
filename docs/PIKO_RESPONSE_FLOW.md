# Piko response flow: code path from message to reply

This document traces how a user message (e.g. "G'day Piko.") becomes a reply, so you can see where alignment might break.

---

## 1. Entry point

| Step | Location | What happens |
|------|----------|--------------|
| Request | `server.js` ~2172 | `POST /api/chat` → `handleApiChat(req, res)` |
| Body | `server.js` ~1088–1105 | Parse JSON: `message`, `sessionId`, `stream`. Session key `key` = `PIKO_UNIFIED_SESSION_ID` or `sessionId` or `"main"`. |
| Allowlist | `server.js` ~1114–1125 | If `data/allowlist.json` exists, request must be allowed for `(source, externalId)` or 403. |

---

## 2. Command vs chat

Many commands are handled **before** the planner and LLM (e.g. `/gmail`, `/intents`, `/model`, `/cursor`, `/task`). If the message is not a command, execution continues into the **chat path** below. All of the following is in `handleApiChat` in `server.js`.

---

## 3. Load context (before planner)

| Step | Location | What happens |
|------|----------|--------------|
| Mind | `server.js` ~2013 | `loadMind()` from `data/mind/` (goals, tensions). |
| Corpus | `server.js` ~2015 | `getCorpusBlockForPrompt(primaryHuman)` from `lib/corpus.js` → corpus summary/truths (skipped for **casual**). |
| Truth | `server.js` ~2016 | `getTruthBlockForPrompt()` (skipped for **casual**). |
| Beliefs | `server.js` ~2016 | `memory.getUserBeliefs()` for planner. |
| Plan | `server.js` ~2018–2023 | `createResponsePlan({ userBeliefs, mind, userMessage: message, recentEpisodic: memory.getEpisodic().slice(-3) })` → **plan** (includes `plan.casual`). |

---

## 4. Planner: is this turn "casual"?

| Step | Location | What happens |
|------|----------|--------------|
| Greeting match | `lib/planner.js` ~9–10, 37–39 | `GREETING_PATTERN` = `^(hi|hey|...|g'?day|...)([\s!?.]*|\s+piko[\s!?.]*)$/i`. `trimmed.length <= 60` and match → `isGreeting = true`. |
| Casual | `lib/planner.js` ~49, 89 | If `(isGreeting \|\| isCasualSmallTalk) && !looksLikeInstruction` → `casual = true`. |

**"G'day Piko."** → trimmed `"G'day Piko."` → matches `g'day` + `\s+piko[\s!?.]*` → `isGreeting = true` → **`plan.casual === true`** (assuming no instruction-like pattern).

So for "G'day Piko." the code path **should** be the casual path. If it isn’t, the only way is if the message string differs (e.g. extra character, different apostrophe) or `looksLikeInstruction` is true.

---

## 5. System prompt construction (where alignment can break)

All in `server.js` ~2032–2098.

**When `plan.casual === true`:** the server sends **only** a minimal **CASUAL_SYSTEM_PROMPT** (no leadingRule, no corpus, no memory, no SYSTEM_PROMPT, no plan line, no styleReminder). That prompt tells Piko to reply with one short natural sentence (ideally under 15 words), match the user's tone, and not bring up themes, reflection, or follow-ups. No identity/soul/memory blocks are sent for casual.

**When `plan.casual === false`:** the server builds **baseContent** from: leadingRule, corpusBlock, truthBlock, memoryBlock, planLine, noAssumeDebugLine, impactBlock, SYSTEM_PROMPT (IDENTITY + SOUL + MEMORY.md + INTERESTS), recentLearningBlock, stickyIdeasBlock, getAndConsumePendingQuestionBlock(), getDailyMemoryBlock(key), gmailContext, ragContext, learning-inject and divergence text, and styleReminder. `systemContent = baseContent`.

---

## 6. Message array sent to LLM

| Step | Location | What happens |
|------|----------|--------------|
| History | `server.js` ~2081–2084 | `historyWindow = plan.casual ? 0 : SLICE_HISTORY`. For casual, **no prior turns** in the message array. |
| messages | `server.js` ~2085–2090 | `[{ role: 'system', content: systemContent }, ...historyPart]`. If casual, then **`messages.push({ role: 'user', content: message })`** so the only user message is the current one. |

So for casual we send: **one system message** (CASUAL_SYSTEM_PROMPT only) + **one user message** (e.g. "G'day Piko."). No prior turns.

---

## 7. LLM call

| Step | Location | What happens |
|------|----------|--------------|
| Stream vs non-stream | `server.js` ~2092 vs ~2124 | If `json.stream === true` (e.g. Telegram) → `ollamaChatStream(messages, ..., sessionModel, streamOptions)` else `ollamaChat(messages, sessionModel, chatOptions)`. For **casual** turns both use **max_tokens: 80**; otherwise no cap. |
| Ollama | `server.js` ~672–676, 665–669 | `ollamaChatStream` / `ollamaChat` → `lib/llm.js` `aiStream` / `ai` → LiteLLM `completion()` with `OLLAMA_URL` (e.g. `http://localhost:11434`) and model (e.g. `piko:finetune`). |

So the **same** system + user messages are sent to Ollama; the model (e.g. fine-tuned) generates the reply. If its prior is "always reflect themes and suggest follow-ups", it can still do that despite CASUAL_FINAL_BLOCK.

---

## 8. Post-processing

| Step | Location | What happens |
|------|----------|--------------|
| stripMetaSlip | `server.js` ~2065–2072, 2106/2126 | Replaces known meta phrases ("I'm back online...", "I'll review the changes", etc.) with "Hey — what's up?". |
| fixPersonalLifeDeflection | `server.js` ~2074–2080, 2107/2127 | Only if user asked about personal life and reply contains coding language → replace with "Sure — what's on your mind?". |
| **Casual guardrail** | `server.js` (stream and non-stream) | For **casual** turns only: (1) if reply echoes the user's greeting, replace with fallback; (2) take the first line, then the first sentence; append period if missing. No theme stripping — minimal prompt + no identity is the primary control. |
| Persist | `server.js` ~2109–2118 | Reply appended to history, sessionStore, optional daily memory; beliefLoop.ingestRecentExperience. |

---

## 9. Where things can misalign

- **Planner:** "G'day Piko." should set `plan.casual === true`. If the message is different (e.g. "G'day Piko" without period, or a different apostrophe), the regex might not match. Log `plan.casual` when `PIKO_PLANNER_DEBUG=1` or `PIKO_DEBUG_CASUAL=1`.
- **Model prior:** Even with the minimal casual prompt, the fine-tune may occasionally prefer "reflect themes + suggest follow-ups". The **casual guardrail** (first line → first sentence + period) keeps the visible reply to one short sentence.

**Implemented fix (casual path):** For `plan.casual === true` we send **only** CASUAL_SYSTEM_PROMPT (no memory, no SYSTEM_PROMPT, no identity/soul), use **max_tokens: 80**, and apply the guardrail so the user sees at most one short natural sentence.

---

## File reference

| File | Role |
|------|------|
| `server.js` | handleApiChat, prompt construction, LLM call, post-process |
| `lib/planner.js` | createResponsePlan, GREETING_PATTERN, plan.casual |
| `lib/memory.js` | getMemoryBlockForPrompt (beliefs + episodic) |
| `lib/llm.js` | ai(), aiStream(), completion() |
| `prompts/IDENTITY.md`, `SOUL.md`, `INTERESTS.md`, `MEMORY.md` | Loaded into SYSTEM_PROMPT at startup |
