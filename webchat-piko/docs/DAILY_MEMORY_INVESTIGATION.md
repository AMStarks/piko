# Daily interaction log + end-of-day summary memory — investigation

## Idea

Record every line of interaction (user + assistant) to a database that Piko can refer back to. At the end of each day, summarize that day’s interactions into a **day summary**. Keep day summaries as a long-term memory; optionally discard or archive the raw lines after summarization. Users accept a bit more latency if Piko is “reviewing historic info.”

## Benefits

- **Long-term memory across sessions and days:** Piko can refer to “last week you were excited about the Dragons” or “you mentioned groin stretches before” without that detail living only in the current SLICE_HISTORY window.
- **Clear mental model:** “Piko remembers our days and can look back” is easy to explain and matches the idea of a companion that accumulates context over time.
- **Controlled growth:** Raw lines are summarized and then discarded (or moved to cold storage), so the “memory” stays a set of daily summaries rather than unbounded chat logs.
- **Latency tradeoff is acceptable:** If we inject recent day-summaries (and maybe “today so far”) into the prompt, the extra cost is mainly prompt build + a slightly larger context. We can frame this as “Piko is reviewing your history” so a 1–3s delay feels intentional rather than sluggish.

## Current state (relevant pieces)

- **conversations.db (sessionStore):** Keeps the last N messages per session_id (e.g. `main`, `telegram-123`). Used only for the immediate chat window (SLICE_HISTORY). No cross-day persistence of raw lines beyond what’s in the rolling window.
- **Memory/beliefs:** User beliefs, episodic memory, mind (goals, tensions). Updated asynchronously from recent exchanges; not a line-by-line log.
- **Learning:** Sticky ideas, tensions, rabbit-hole notes — thematic, not a chronological interaction log.

So we do **not** currently have a durable, queryable log of “every line” that we then summarize by day.

## Design options

### 1. Schema for raw interactions

- **Table:** e.g. `interaction` with `(id, session_id, channel?, role, content, created_at)`.
- **Session vs user:** If we want memory to be “per human” across channels, we need a stable user id (e.g. primary_human or a derived id). If we’re fine with “per session,” we can key by existing session_id (then Telegram and app would have different logs unless we use a unified id).
- **What to store:** Exactly what we send to the model: role (user/assistant), content, timestamp. Optionally source/channel for analytics.

### 2. When to write

- **On every turn:** After we append to sessionStore, also insert into the interaction log (same session_id or a canonical user_id). One row per message (user and assistant).

### 3. Day summary

- **Definition:** One summary per (day, session_id) or per (day, user_id) — a short paragraph (or bullet list) of what was discussed, any decisions, follow-ups, or notable topics.
- **When to run:** Nightly job (cron after midnight server TZ, or a fixed time). For “today,” we can either run at end-of-day only, or keep a rolling “today so far” summary updated every N messages (heavier) or only at EOD (simpler).
- **How to generate:** LLM over that day’s raw messages (or over chunks if the day is very long). Prompt: “Summarize this conversation from [date]: themes, decisions, things the user cares about, follow-ups. One short paragraph (or 3–5 bullets). No meta.”
- **Where to store:** e.g. `day_summary (date, session_id_or_user_id, summary_text, created_at)`.

### 4. When to discard raw lines

- **Implemented:** After the day summary is written (nightly cron), **raw interactions for that day are deleted**. **Day summaries are kept indefinitely** (as long as possible); no automatic deletion. Data is stored in `data/daily_memory.db` on the server (Optimus). The **date (YYYY-MM-DD) accompanies each summary** in the table and in the prompt block (“Recent history (summaries): 2026-02-13: …”).

### 5. How Piko “refers back”

- **Inject into system prompt:** When building the prompt, load “last K days of day summaries” (e.g. K=7 or 14) for this session/user and append a block: “**Recent history (summaries):** [date]: … [date]: …”. Optionally add “**Today so far:**” from a short summary of today’s messages (or last N messages of today) if we don’t run “today” summary until EOD.
- **No extra LLM call for “reviewing”:** “Reviewing historic info” can mean “we include the summary block in the prompt” — the model reads it as part of the same call. That adds tokens and a small amount of prompt-build time, but not a second round-trip. So latency is “slightly larger prompt,” not “Piko does a separate search step” unless we add RAG later.
- **Optional RAG later:** If we have many months of summaries, we could embed and retrieve “most relevant past days” instead of always last K. For an MVP, last K is enough.

### 6. Latency and UX

- **Extra work per request:** (1) Insert 2 rows (user + assistant) into interaction table — cheap. (2) Load last K day summaries + maybe “today so far” — one small query. (3) Append block to system prompt — a few hundred to a couple thousand tokens. So we’re adding a bit of I/O and prompt size; no extra Ollama call.
- **User message:** We can show a short “Reviewing your history…” or “Thinking…” for 1–2s if we want to set the expectation that Piko is considering past context. The actual delay is mostly the same Ollama call with a longer prompt.

### 7. Privacy and retention

- **Raw lines:** Discarded after the day is summarized (nightly). **Summaries:** Kept indefinitely; no automatic deletion. User can request deletion if needed.
- **Where it runs:** On Optimus; `data/daily_memory.db` lives in Piko’s data dir. All data stays on your server.

### 8. Implementation sketch (MVP)

1. **New table(s):** `interaction (id, session_id, role, content, created_at)` and `day_summary (id, date, session_id, summary_text, created_at)`. Use same session_id as sessionStore (and PIKO_UNIFIED_SESSION_ID if you use it) so “main” = one logical user across app/Telegram.
2. **On each chat turn (after we have user + assistant):** Insert two rows into `interaction`.
3. **Cron (e.g. 00:05 server time):** For yesterday’s date, for each session_id that has interactions, fetch all rows for that day, call LLM to summarize, insert into `day_summary`, then delete (or archive) those raw rows.
4. **Prompt builder (in server.js):** Before building systemContent, query `day_summary` for this session_id for the last 7 days (or 14). Format as “**Recent history (summaries):** …”. Append to system prompt. Optionally add “**Today (so far):**” from a rolling summary of today’s messages (e.g. last 5 exchanges) or skip “today” until EOD.
5. **Config:** `PIKO_DAILY_MEMORY_ENABLED=1`, `PIKO_DAILY_MEMORY_DAYS=7`, retention (raw delete after 1 day vs 7 days).

### 9. Open questions

- **Unified vs per-channel:** Should day summaries be per session_id (so Telegram and app have separate “memories” unless session is unified) or per canonical user? Per session_id is simpler and matches current keying; we can introduce user_id later if we want cross-channel memory.
- **“Today so far”:** Without it, the model only sees past days’ summaries until the nightly job runs. Adding a short “today so far” (e.g. updated every 10 messages or on each request from last 5 exchanges) keeps same-day context; adds a bit of complexity.
- **Token budget:** 7 days × ~150 words per summary ≈ 1000 words ≈ 1.3k tokens. Acceptable. If we go to 30 days, we might need to summarize the summaries (weekly rollups) or use retrieval.

## Conclusion

- **Worth doing:** Gives Piko a clear, bounded “memory” (day summaries) that persists beyond the rolling chat window and can be referred to naturally. Fits the “Piko takes a bit more time to think and reviews historic info” story.
- **Latency:** Mainly “slightly larger prompt” (summaries block). No extra Ollama call. Optional “Reviewing your history…” message can set expectations.
- **Implemented:** See lib/dailyMemory.js, server.js (getDailyMemoryBlock, append on turn), scripts/daily-memory-summarize.js. Cron on Optimus: `5 0 * * * cd /root/webchat-piko && node scripts/daily-memory-summarize.js`.
