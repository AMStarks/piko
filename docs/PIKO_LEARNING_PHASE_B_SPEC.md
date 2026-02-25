# Phase B: Feedback signals and one-tap commands — specification

Phase B adds **structured external feedback** so you can give Piko dense, immediate signal without writing refinements. Implementation can follow this spec when you’re ready.

---

## 1. Goal

- **Problem:** Engagement is sparse, noisy, and lagging. Journal entries stay vague; critique repeats; refinements feel shallow.
- **Solution:** A small set of **tagged feedback signals** (e.g. clarity, tooLong, goodQuestions, tooAbstract) and **one-tap commands** (`/++`, `/--`, optionally `/+?`) that increment those signals. The **journal prompt** reads the signals so Piko gets direct, machine-readable feedback in addition to engagement.

---

## 2. Data: `data/moltbook-feedback.json`

**Path:** `/root/webchat-piko/data/moltbook-feedback.json` (same app dir as poster and server).

**Schema:**

```json
{
  "signals": {
    "clarity": 0,
    "tooLong": 0,
    "goodQuestions": 0,
    "tooAbstract": 0,
    "moreExamples": 0
  },
  "lastUpdated": "2026-02-08T18:00:00.000Z"
}
```

- **signals:** String keys = tag names; number values = cumulative count (only incremented, never decremented in v1).
- **lastUpdated:** ISO timestamp of last change (optional; useful for “since last cycle” display).

**Initialization:** If the file is missing, treat as `{ signals: {}, lastUpdated: null }`. When incrementing, ensure the key exists (default 0), add 1, set lastUpdated, write file.

**Suggested signal set (v1):**  
`clarity`, `tooLong`, `goodQuestions`, `tooAbstract`, `moreExamples`.  
You can add more later (e.g. `tooShort`, `moreWit`) by adding keys to the object.

---

## 3. Commands (chat)

**Format:**

- `/++ <signal>` — Increment `signals[signal]` by 1. Example: `/++ clarity`, `/++ goodQuestions`.
- `/-- <signal>` — Same as `/++` (increment by 1). Naming allows future use: e.g. `/-- tooLong` = “this was too long.” For v1, both can map to “increment this tag.”
- Optional: `/+? <signal>` — Same as `/++` if you want a “request more of X” variant; or reserve for “increment a different bucket.” For v1, `/++` and `/+?` can both increment.

**Parsing (server):**

- `message.trim().match(/^\/\+\+\s+(\w+)$/)` → increment `signals[cap1]`.
- `message.trim().match(/^\/--\s+(\w+)$/)` → increment `signals[cap1]`.
- If `message.trim().match(/^\/\+\?\s+(\w+)$/)` → same: increment `signals[cap1]`.

**Whitelist:** Only allow known keys (e.g. clarity, tooLong, goodQuestions, tooAbstract, moreExamples). If the user sends `/++ unknownTag`, either ignore or reply “Unknown signal. Use: clarity, tooLong, goodQuestions, tooAbstract, moreExamples.”

**Reply:** After incrementing: `Feedback recorded: +1 <signal> (total: N).` Optionally: “Next journal cycle will see this.”

**File location:** Server already has `DATA_DIR` and reads `piko-memory.json`; use the same `DATA_DIR` and `path.join(DATA_DIR, 'moltbook-feedback.json')`.

---

## 4. Poster: read signals and inject into journal prompt

**When:** When building the prompt for `writeJournalEntry` (same place you already inject engagement and lastCycle).

**Read:** Before calling `writeJournalEntry`, if `data/moltbook-feedback.json` exists, read it and parse. If missing or invalid, use `signals = {}`.

**Format for prompt:** Add a short block, e.g.:

```
Human feedback signals (cumulative): clarity N, tooLong N, goodQuestions N, tooAbstract N, moreExamples N.
```

Only include keys that exist and have count > 0. Example: `Human feedback signals: clarity 2, tooLong 1, goodQuestions 1.`

**Where to add:** In `writeJournalEntry(state, fullAim, key, lastCycle)`, add an optional fifth argument or read the file inside `writeJournalEntry`: e.g. `feedbackSignals = readFeedbackSignals()` (helper that returns `{ clarity: 2, tooLong: 1, ... }`). Then in the prompt string:

```
${feedbackSignalsBlock}
```

**Optional: reset after journal.** If you want “signals apply to the next reflection only,” you could reset the file (or zero out counts) after writing a journal entry that used them. For v1, **don’t reset**; keep cumulative counts so Piko sees “you’ve been told tooLong 3 times total.” Resetting can be a later option (e.g. “reset signals every 7 days” or “reset when journal is written”).

---

## 5. Server: helper to read/increment feedback

**Read (for poster):** Poster runs in a separate process, so it will read `moltbook-feedback.json` from disk (same path as server). No API needed for poster.

**Increment (for commands):** In `server.js`, when handling `/++` or `/+?` or `/--`:

1. Parse signal name (whitelist).
2. Read `data/moltbook-feedback.json` (or default `{ signals: {}, lastUpdated: null }`).
3. `signals[tag] = (signals[tag] || 0) + 1`; set `lastUpdated = new Date().toISOString()`.
4. Write file back.
5. Reply to user.

**Concurrency:** Single-writer (one server process). If you later have multiple processes, use a short retry or file lock; for v1, not required.

---

## 6. .gitignore

Add `data/moltbook-feedback.json` to `.gitignore` (same as other data files) so it isn’t committed.

---

## 7. Control UI (optional)

- **Card “Feedback signals”:** Show current counts: `clarity: 2, tooLong: 1, …` and `lastUpdated`. Read from same file (e.g. via existing `/api/control` payload: add `moltbook.feedbackSignals` when you have a feedback file).
- Or expose only via chat for v1.

---

## 8. Summary checklist (implementation)

- [ ] Create `data/moltbook-feedback.json` schema and init (empty or default keys).
- [ ] Add `readFeedbackSignals()` in poster (returns object of signal → count).
- [ ] In `writeJournalEntry`, call `readFeedbackSignals()`, build `feedbackSignalsBlock`, add to journal prompt.
- [ ] In server, add handlers for `/++ <signal>`, `/-- <signal>` (and optionally `/+? <signal>`), whitelist signal names, read/increment/write file, reply.
- [ ] Add `data/moltbook-feedback.json` to `.gitignore`.
- [ ] Optional: add `moltbook.feedbackSignals` to `/api/control` and a small “Feedback signals” card on Control.

---

## 9. Expected behavior after Phase B

- You send `/-- tooLong` after a post. `signals.tooLong` becomes 1 (or +1).
- Next cycle, when the journal is written (signal guard fires), the journal prompt includes: “Human feedback signals: tooLong 1.”
- Piko’s journal entry can say: “What didn’t: Human flagged tooLong. What I’ll try next: Keep under 150 words.”
- Next post is influenced by that journal entry (existing “This cycle’s focus” and journal block). No refinement approval needed for this tactical nudge.

Phase A (internal feedback) is already deployed. Phase B can be implemented when you want denser, one-tap external feedback.
