`# Piko: App vs Telegram chat discrepancy — diagnosis and fix

## What you saw

- **App:** You sent "Hey hey" and got a long **meta/explanatory** reply: "It looks like you're trying to engage with Piko, but it seems like some of your messages got truncated... You asked if Piko could integrate with Tripview... Here's how Piko would respond... (Note: This response is a revised version based on the suggestions provided earlier.)"
- **Telegram:** Same "Hey hey" at the same time → you got a **normal** greeting: "Hello. Nice to meet you. I'm your buddy Piko. It's great to connect with you today..."

So the **same backend** produced two different kinds of replies for the same short message, depending on which client you used.

---

## Root cause

1. **Single shared session**  
   Both the app and Telegram were using the **same conversation session** on the server (`"main"`). So one history was used for both channels.

2. **Same history for both**  
   The server uses that session to load the last 20 messages and send them to the model. So the model was seeing a **mixed** history: everything you said on the app, on Telegram, and on WebChat in that one thread (including older topics like Tripview and persona "suggestions").

3. **Order of requests**  
   When you sent "Hey hey" from both clients around the same time:
   - One request (e.g. Telegram) was handled **first**: history had the old Tripview/suggestions context + one "Hey hey". The model replied with a normal greeting.
   - The other request (e.g. app) was handled **second**: history now had the same context + "Hey hey" + the greeting + **another** "Hey hey". The model then saw duplicate "Hey hey" and the long, mixed context and produced a **meta-explanation** (truncation, Tripview, "revised version") instead of a second greeting.

So the app wasn't "broken" — it was showing the **second** reply, generated with different context (duplicate "Hey hey" + full shared history). The model was reacting to that context, not to a single "Hey hey" in isolation.

---

## Fix (implemented)

**Per-channel session keys** so each channel has its own conversation history:

1. **Server (`webchat-piko`)**  
   - Conversation key is now: `PIKO_UNIFIED_SESSION_ID` if set, otherwise the **request's `sessionId`**, otherwise `"main"`.  
   - So when the app sends `sessionId: "main"` it gets the "main" history; when Telegram sends `sessionId: "telegram-123"` it gets a separate "telegram-123" history.

2. **Telegram bot**  
   - Sends `sessionId: "telegram-" + chatId` (unless `PIKO_UNIFIED_SESSION_ID` is set).  
   - So Telegram chats no longer share history with the app or WebChat.

3. **App**  
   - Keeps sending `sessionId: "main"`.  
   - App and WebChat (when it uses `"main"`) still share one thread; Telegram is separate.

If you **want** one shared conversation across app and Telegram, set `PIKO_UNIFIED_SESSION_ID` (e.g. to `main`) on the server and in the Telegram bot. Then both will use that single session again (and you may occasionally see meta-style replies when the same message is sent from both sides).

---

## Session key contract (supported prefixes)

The server treats `sessionId` as an opaque key but derives **allowlist source** from it when it contains a hyphen:

| Pattern | Source | Example | Use |
|--------|--------|---------|-----|
| `main` or no prefix | `webchat` | App, WebChat default | Shared app/WebChat history |
| `telegram-<chatId>` | `telegram` | `telegram-123456789` | One history per Telegram chat |
| `discord-<channelId>` | `discord` | (future) | Per Discord channel |
| `imessage-<chatGuid>` | (adapter-specific) | BlueBubbles | Per iMessage chat |

- **Allowlist:** If `data/allowlist.json` exists and a source is not `["*"]`, the request's `(source, externalId)` must be allowed. The server returns **403** with `{ error: "channel not allowed", channel: "<source>", id: "<externalId>", hint: "..." }` and logs `[auth] denied <source>-<id> — not in allowlist` so you can add the channel (e.g. `/allow telegram 123456789` from WebChat or edit allowlist.json).
- **Unified override:** Set `PIKO_UNIFIED_SESSION_ID=main` (server + Telegram bot) to force one shared session again.

---

## Clean slate and session reset

- **POST /api/control/session-reset** (control panel only): body `{ "sessionId": "main" }` (or any key) clears that session's conversation history. Use from the control UI or with a tool that can call the control API. Prevents manual DB edits when you want a fresh "main" or a specific channel thread cleared.
- **In-chat:** Sending `/new` clears the **current** session's history (existing behaviour).
- **Optional future:** A nightly cron or env `PIKO_SESSION_PRUNE_AGE` could truncate very old sessions to the last N messages; not implemented yet. For now, "main" can grow; use session-reset or DB trim if needed.

---

## Race conditions and meta-replies (remaining risks)

- **Cross-channel** race is fixed by per-channel sessions.
- **Intra-session** race can still happen: if the same channel sends two requests almost at once (e.g. double "Hey hey" in the same chat), the second request can see the first reply + duplicate user message and the model may still produce a meta/truncation-style reply. Mitigations already in place: last-20-messages limit; **anti-meta guardrail** in SOUL ("Never explain or comment on message delivery, truncation, duplication, or technical issues unless the user directly asks"). Future hardening: per-session request queue or mutex (not implemented).
- **Long-term:** Session key = cognitive boundary: beliefs and memory are scoped per session. With split sessions you have parallel "minds" per channel; with unified you have one mind but cross-channel races. Choose consciously (see design note below).

---

## Design note: identity boundary

Session identity defines where the "self" begins and ends: memory continuity, belief reinforcement, and personality formation are scoped by session key. Per-channel sessions give stable, predictable replies per interface but fragment belief drift across channels; unified session gives one evolving Piko but requires accepting occasional duplicate-message artifacts or adding concurrency controls (e.g. idempotency or channel metadata in the prompt). The current default (per-channel) favours UX stability; the env override keeps the "one brain" option available.

---

## Summary

| Before | After |
|--------|--------|
| App and Telegram shared one session (`"main"`) | Telegram uses `telegram-<chatId>`; app uses `"main"` (unless unified is set) |
| Same long, mixed history for both | Each channel has its own history |
| Second "Hey hey" + mixed context → meta reply on one client | Each client gets a reply based only on **its own** history |
| 403 "Not allowed" | 403 with `channel`, `id`, `hint` + clear server log |
| No way to clear session except /new in-session | POST /api/control/session-reset to clear any session |

So the "something wrong with the chat aspect" was **shared context + duplicate message** leading to a meta reply on one channel. Splitting sessions fixes that. If you want true one-brain, one-thread across app and Telegram, set `PIKO_UNIFIED_SESSION_ID` and accept that repeating the same message from both clients can still occasionally produce odd replies.
`