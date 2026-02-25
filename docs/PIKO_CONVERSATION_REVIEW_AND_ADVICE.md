# Piko conversation: review and advice

**Purpose:** Sit back, examine the codebase and the responses we get, treat **conversation as the key and critical component of Piko**, then advise what’s going well (with code refs) and what’s going wrong. Written so you can digest it in one pass.

---

## 1. The failure you hit

**Exchange:**
- You: Hey Piko  
- Piko: Morning mate.  
- You: How are things?  
- Piko: Not bad — you.  
- You: Good, good. I'm just doing some work. **Want to chat for a while?**  
- Piko: **Hey — what's up?**

“Hey — what’s up?” is wrong here because you **just invited conversation**. The right kind of reply is “Sure — what’s on your mind?” or “Yeah, happy to — what do you want to talk about?”. The system is overwriting a contextually correct reply with a generic opener.

---

## 2. Root cause (with code)

The reply is being **replaced in post-processing**, not by the planner or the model path.

- **Planner:** “Want to chat for a while?” does **not** match any casual pattern in `lib/planner.js` (no “chat”, “want to”, “for a while” in the regex set). So `plan.casual === false` and the **full path** runs: full identity, **history included** (last 30 messages), so the model *does* see the prior turns.
- So the model often produces something like “Sure — I’m here to help. What would you like to talk about?” or “What’s on your mind?”.
- Then **every** reply (casual and full) goes through `stripMetaSlip(reply)` in `server.js`:

```2108:2112:webchat-piko/server.js
  function stripMetaSlip(text) {
    if (!text || typeof text !== 'string') return text;
    if (META_SLIP_PATTERN.test(text)) return "Hey — what's up?";
    if (HERE_TO_HELP_PATTERN.test(text)) return "Hey — what's up?";
    if (EVASIVE_PATTERN.test(text)) return "Hey — what's up?";
```

- `META_SLIP_PATTERN` includes `what'?s on your mind today`; `HERE_TO_HELP_PATTERN` is `I'm here to help`. So as soon as the model says “I’m here to help” or “what’s on your mind today”, the **entire** reply is thrown away and replaced with **“Hey — what’s up?”**.
- That replacement is **context‑blind**: it doesn’t check whether the user just asked to chat. So a good, conversational answer is replaced by a generic opener. **That’s why “Hey — what’s up?” is not contextually correct.**

---

## 3. What’s going well (with code)

### 3.1 Single entrypoint and shared brain

All channels (WebChat, Telegram, etc.) hit the same `POST /api/chat` and the same `handleApiChat` in `server.js`. One brain, one conversation stack. That’s the right design for a coherent conversational agent.

- Ref: `server.js` ~1093+, request body → `message`, `sessionId` → same planner and LLM path.

### 3.2 Planner is message-driven and predictable

`lib/planner.js` is a pure function: it only looks at the **current message** (and beliefs/goals/tensions). No LLM in the loop. That gives:

- Stable routing (same message → same plan).
- Clear rules: e.g. greetings/short ack/sign-offs → casual; everything else → full path.

Ref: `createResponsePlan(context)` with `context.userMessage`, patterns like `GREETING_PATTERN`, `SOCIAL_RECIPROCITY_PATTERN`, etc., and `plan.casual` / `plan.casualMode`.

### 3.3 Full path has real conversation context

When `plan.casual === false`, the model gets **recent conversation**:

```2149:2150:webchat-piko/server.js
  const historyWindow = plan.casual ? 0 : SLICE_HISTORY;
  const historyPart = history.slice(-historyWindow).map(({ role, content }) => ({ role, content }));
```

- `SLICE_HISTORY = 30` (~15 exchanges). So for “Want to chat for a while?” the model *does* see the previous “Hey Piko” / “How are things?” / “Not bad — you” / “Good, good…” and can answer in context. The bug is not missing context; it’s the post-step that overwrites the reply.

### 3.4 Casual isolation is scoped correctly

For true small talk (greetings, reciprocity, sign-offs), we intentionally send **no** history (`historyWindow = 0`) and only `CASUAL_SYSTEM_PROMPT`. That prevents theology/identity bleed on those turns. The design is right; the problem in your example is **not** casual routing (we’re on the full path) but the **shared** post-process.

Ref: `server.js` ~2149, ~2165–2169 (messages built with `historyPart` and, for casual, only current user message).

### 3.5 Soft drive for coherence

The planner exposes a “soft drive” when there’s recent episodic context, so the full prompt can stress coherence with the recent exchange. That’s the right kind of lever for conversation quality.

Ref: `lib/planner.js` ~127–129 (`soft_drive = hasRecentContext ? 'coherence' : null`) and `formatPlanForPrompt` including “when relevant maintain conversational coherence with the recent exchange”.

### 3.6 Personal-life deflection is context-aware

`fixPersonalLifeDeflection` only runs when the **user** asked about personal life **and** the reply is coding-heavy. So it uses both user message and reply. That’s the right pattern; we want the same for “invitation to chat”.

Ref: `server.js` ~2119–2124.

---

## 4. Where things go wrong

### 4.1 Meta-slip replacement is context-blind

- **What:** `stripMetaSlip(reply)` replaces several phrases (including “I’m here to help”, “what’s on your mind today”) with a **single** string: “Hey — what’s up?”. It never looks at the user’s last message.
- **Effect:** When the user has just said “Want to chat for a while?”, a reply like “Sure — what’s on your mind?” or “I’m here to help — what would you like to talk about?” is replaced by “Hey — what’s up?”, which ignores the invitation and resets the conversation.
- **Fix (see below):** Use the user message when choosing the fallback: if the user invited chat, use “Sure — what’s on your mind?” (or similar) instead of “Hey — what’s up?”.

### 4.2 “Hey — what’s up?” is overloaded

That string is used as:

- Fallback for meta slips (stripMetaSlip).
- Fallback for echo (fixEchoReply).
- Fallback for repetition (casual path).

So it appears in many unrelated situations. When the user has explicitly invited conversation, that generic opener is the worst choice; we need a **conversation-invitation**–aware fallback.

### 4.3 No explicit “invitation to chat” handling

The planner doesn’t have a pattern for “want to chat / like to talk / chat for a while”. That’s fine for routing (we already go full path). But post-processing doesn’t know “this user just invited chat, so don’t replace a helpful reply with a generic opener.” Adding that awareness is what fixes your example.

---

## 5. Recommendations (digest)

1. **Make stripMetaSlip context-aware (high impact)**  
   When we would replace the reply with “Hey — what’s up?”, check the **user message**. If it looks like an invitation to chat (e.g. “want to chat”, “like to talk”, “chat for a while”, “have a chat”), use a **conversational** fallback instead, e.g. “Sure — what’s on your mind?”. So: pass `message` into `stripMetaSlip(reply, userMessage)` and branch on `userMessage` when deciding the replacement. This directly fixes “Want to chat for a while?” → “Hey — what’s up?”.

2. **Optional: planner “invitation to chat”**  
   You could add a pattern (e.g. `want to chat|like to talk|chat for a while`) and set something like `plan.invitationToChat = true` so future logic (e.g. prompt or post-process) can explicitly treat the turn as “user invited conversation”. Not strictly required for the fix above, but useful if you want to drive prompt or behaviour from the planner.

3. **Keep conversation as the north star**  
   The codebase is already built around one brain and one history; the main leak is **post-processing** that doesn’t take the last user message into account. Fix that one place and you get a big win for “Want to chat?” and similar turns without changing the overall architecture.

---

## 6. Summary table

| Aspect | Status | Where |
|--------|--------|--------|
| Single entrypoint, shared brain | Good | `server.js` handleApiChat, one path for all channels |
| Planner (message-only, no LLM) | Good | `lib/planner.js` createResponsePlan, pattern set |
| Full path gets history | Good | `server.js` historyWindow = SLICE_HISTORY (30), historyPart in messages |
| Casual isolation (no history) | Good | `server.js` plan.casual → historyWindow 0, CASUAL_SYSTEM_PROMPT only |
| Soft drive / coherence | Good | `lib/planner.js` soft_drive, formatPlanForPrompt |
| Personal-life deflection | Good | `server.js` fixPersonalLifeDeflection (user + reply) |
| Meta-slip replacement | **Bad** | `server.js` stripMetaSlip: one fallback “Hey — what’s up?” for all, no user context |
| “Hey — what’s up?” overuse | **Bad** | Same string for meta, echo, repetition → wrong when user invited chat |

**Bottom line:** Conversation is central and the architecture supports it (one brain, history on full path). The bug is a **single, context-blind replacement** in `stripMetaSlip`. Making that replacement depend on the user message (invitation to chat → “Sure — what’s on your mind?”) fixes your example and keeps the rest of the design intact.

---

## 7. Fix applied (same session)

In `server.js`:

- **INVITATION_TO_CHAT** pattern added: `want to chat|like to talk|chat for a while|have a chat|up for a chat|feel like chatting`.
- **stripMetaSlip(reply, userMessage)** now takes the current user message. When the reply would be replaced by a generic fallback, we use **“Sure — what’s on your mind?”** instead of “Hey — what’s up?” when `INVITATION_TO_CHAT.test(userMessage)`.
- Both call sites (stream and non-stream) pass `message` into `stripMetaSlip(reply, message)`.

So for “Want to chat for a while?”: if the model says “I’m here to help” or “what’s on your mind today”, we now replace with **“Sure — what’s on your mind?”** instead of “Hey — what’s up?”. Redeploy and re-test that flow.
