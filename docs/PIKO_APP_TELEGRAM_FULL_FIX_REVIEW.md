# Piko app vs Telegram chat — full fix for review

Synthesis of diagnosis, implemented fix, and reviewer feedback. All accepted improvements are implemented below; optional/future items are listed at the end.

---

## 1. Root cause (unchanged)

- **Shared session** `"main"` for app and Telegram → one history.
- **Duplicate "Hey hey"** from both clients → second request saw first reply + duplicate message + long mixed context (Tripview, persona suggestions) → model produced **meta-explanation** on one client.
- **Fix:** Per-channel session keys so each channel has its own history; optional `PIKO_UNIFIED_SESSION_ID` to force one session.

---

## 2. Code and config changes (implemented)

### 2.1 Session key (already done)

- **Server:** `key = process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main'`.
- **Telegram bot:** `sessionId = process.env.PIKO_UNIFIED_SESSION_ID || ('telegram-' + String(chatId))`.
- **App:** Keeps `sessionId: "main"`.

### 2.2 Allowlist 403 — clearer and debuggable

- **Before:** `403 { error: "Not allowed" }`.
- **After:** `403 { error: "channel not allowed", channel: "<source>", id: "<externalId>", hint: "Add this channel via /allow <source> <id> from WebChat or update data/allowlist.json" }`.
- **Server log:** `[auth] denied <source>-<id> — not in allowlist` (with requestId) so logs are grep-friendly.

**Files:** `webchat-piko/server.js` (allowlist denial branch).

### 2.3 Anti-meta guardrail

- **SOUL.md** (Natural conversation): one new bullet: *"Never explain, apologize for, or comment on message delivery, truncation, duplication, or technical issues unless the user directly asks. Respond naturally as Piko."*
- Reduces intra-session meta-replies when the same message is sent twice quickly in one channel.

**Files:** `webchat-piko/prompts/SOUL.md`.

### 2.4 Session reset endpoint

- **POST /api/control/session-reset**  
  - Body: `{ "sessionId": "main" }` (or any session key).  
  - Clears that session’s conversation history (SQLite-backed).  
  - Protected by control access (`canAccessControl(req)`).  
  - Response: `200 { ok: true, message: "Session history cleared." }` or `400`/`500` with error.
- Use from control UI, curl, or app (e.g. “New conversation” that calls this for `"main"`). No manual DB edits needed for a clean slate.

**Files:** `webchat-piko/server.js` (new branch before aim-reject).

### 2.5 Documentation

- **Session key contract:** Supported prefixes (`main`, `telegram-<chatId>`, implied `discord-`, etc.), allowlist derivation, unified override. Documented in **`docs/PIKO_APP_VS_TELEGRAM_CHAT_DIAGNOSIS.md`** and **`webchat-piko/README.md`** (new “Session keys and channels” paragraph).
- **Diagnosis doc** updated with: session key contract, clean slate + session-reset, remaining intra-session race + anti-meta mitigation, optional future prune, and short “identity boundary” design note.
- **README:** Session keys, allowlist, 403 shape, link to diagnosis; APIs line mentions `POST /api/control/session-reset`.

**Files:** `docs/PIKO_APP_VS_TELEGRAM_CHAT_DIAGNOSIS.md`, `webchat-piko/README.md`.

---

## 3. Deployment checklist (for you)

1. **Redeploy webchat-piko** to Optimus (includes server + SOUL.md).
2. **Redeploy Telegram bot** so it sends `sessionId: "telegram-" + chatId` (unless `PIKO_UNIFIED_SESSION_ID` is set).
3. **Allowlist:** If you use `data/allowlist.json`, add Telegram: e.g. `"telegram": ["YOUR_CHAT_ID"]` or allow from WebChat with `/allow telegram YOUR_CHAT_ID`. Otherwise new Telegram chats get 403 with the new JSON body and log line.
4. **Test:** Send “Hey hey” from app and from Telegram → both get normal greetings; no meta-reply.
5. **Optional:** Clear “main” if you want a fresh app thread: call `POST /api/control/session-reset` with `{ "sessionId": "main" }` (from a client that can hit the control API).

---

## 4. Not implemented (optional / later)

- **Per-session mutex or queue** to eliminate intra-session races (noted in diagnosis as future hardening).
- **Session prune cron** or `PIKO_SESSION_PRUNE_AGE`: truncate very old sessions to last N messages (documented as optional in diagnosis).
- **Idempotency guard** for unified mode (ignore duplicate message within X seconds across channels); only relevant if you rely on `PIKO_UNIFIED_SESSION_ID`.
- **Channel metadata in prompt** (e.g. `[Channel: Telegram]`) for a future unified-brain design; design note only.
- **Session versioning** for schema/planner changes; design note only.

---

## 5. Summary table

| Item | Status |
|------|--------|
| Per-channel session key (server) | Done |
| Telegram bot sends `telegram-<chatId>` | Done |
| 403 body + log for allowlist deny | Done |
| Anti-meta guardrail in SOUL | Done |
| POST /api/control/session-reset | Done |
| Session key contract in docs | Done |
| README session keys + allowlist | Done |
| Intra-session race note + mitigation | Documented |
| Optional prune / mutex / idempotency | Deferred |

You can review the diffs in `webchat-piko/server.js`, `webchat-piko/prompts/SOUL.md`, `webchat-piko/README.md`, `telegram-bot/bot.js`, and `docs/PIKO_APP_VS_TELEGRAM_CHAT_DIAGNOSIS.md`, then deploy and run the checklist above.
