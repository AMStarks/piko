# Piko’s repository of understanding — how it works

Piko has a **repository of understanding**: inspectable, file-based learning that shapes what it says and how it thinks, without changing model weights or identity files. You control the topics; Piko accumulates notes, reflections, and “sticky ideas” over time.

---

## What’s built

| Layer | File(s) | Updated by | Purpose |
|-------|---------|------------|---------|
| **Topics** | `data/learning/topics.txt` | You (one topic per line) | Menu of what to explore; round-robin by day. |
| **Suggested topics** | `data/learning/suggested-topics.txt` | You (or `POST /api/control/learning/suggest`) | Queued for next run; consumed FIFO. Use for “research this tomorrow.” |
| **Daily notes** | `data/learning/rabbit-hole-notes.md` | `scripts/rabbit-hole-daily.js` (cron daily) | One note per day: what I learned, why it caught my attention, what it made me question. |
| **Meta-reflection** | `data/learning/meta-reflections.md` | `scripts/meta-reflection-weekly.js` (cron weekly) | Short reflection on themes, what Piko’s drawn to, tensions. |
| **Tensions** | `data/learning/tensions.md` | Same weekly script | Max 5 unresolved tensions (questions or friction); can reference sticky ideas. |
| **Sticky ideas** | `data/learning/sticky-ideas.md` | Same weekly script | Max 10 “ideas that stuck”; updated from reflection. |

All under `webchat-piko/` (on Optimus: `/root/webchat-piko/data/learning/`). `topics.txt` can live in the repo; the rest are gitignored so they stay local/per-server.

---

## How it operates

1. **Daily (rabbit-hole)**  
   - Script checks `suggested-topics.txt` first — if present, uses the first topic (FIFO) and removes it. Else, ~20% of days: picks from recent Moltbook journal. Else: picks from `topics.txt` by round-robin (`dayOfYear % topics.length`).  
   - Searches (TAVILY or SERPER), then asks Ollama for a short structured note.  
   - Appends one block to `rabbit-hole-notes.md` (date + topic + “What I learned / Why it caught my attention / What it made me question”).

2. **Weekly (meta-reflection)**  
   - Script reads last N blocks of `rabbit-hole-notes.md` and last chunk of `data/moltbook-journal.md`.  
   - One Ollama call: reflection on themes, tensions, what sticks.  
   - Appends to `meta-reflections.md`; then extracts up to 3 tensions → writes `tensions.md`; then updates `sticky-ideas.md` (add at most one, cap 10).

3. **Chat**  
   - Every reply uses a system prompt built from: identity/soul/memory/interests **+** recent learning **+** sticky ideas.  
   - **Recent learning:** last 5 blocks of `rabbit-hole-notes.md` (capped ~2.5k chars), with “use with epistemic humility” framing.  
   - **Sticky ideas:** one line (“let your tone be gently influenced by the themes you keep returning to”) plus a short snippet of the last 3 sticky ideas (~800 chars).  
   - So Piko’s replies are informed by what it “recently looked into” and by “themes it keeps returning to,” without overclaiming.

4. **Moltbook (optional)**  
   - The poster can inject a line like “This week you explored: X, Y” from recent rabbit-hole topics into the journal prompt when `PIKO_LEARNING_JOURNAL_INJECT` is not disabled.

---

## Invariants

- Learning scripts **never** write to AIM, REFINEMENTS, IDENTITY, or SOUL.  
- All new state is under `data/learning/` (and existing journal/memory).  
- You remain the only strategic authority; Piko’s “understanding” is suggestive context, not override.

---

## Cron (Optimus)

- **Tonight preview (9pm):** `0 21 * * *` — tells the user via Telegram what Piko will learn overnight; prompts for suggestions. Uses `./scripts/run-tonight-learning-preview.sh`.
- **Rabbit-hole:** `0 23 * * *` — daily at 11pm (nighttime learning). Uses `./scripts/run-rabbit-hole-daily.sh`.
- **Meta-reflection:** e.g. `0 10 * * 0` — Sunday 10:00.

Ensure `data/learning/` exists and `topics.txt` is present (deploy may not sync `data/`; copy or create on server). Env (Ollama, TAVILY/SERPER) same as for chat/poster.

---

---

## Initiating inquiry: Piko asking you questions

Piko can **occasionally ask you questions** drawn from its learning, so you can share your perspective.

**How it works**

1. **In chat (always on):** The system prompt tells Piko to sometimes ask a genuine question from recent learning or sticky ideas when it fits the conversation—not every message, only when natural.
2. **Proactive question (optional):** A script generates one “pending” question and stores it; the next time you open chat (or Telegram), that question is injected and Piko may ask it. After use the pending question is consumed and logged to inquiry-history.txt so it is not repeated. You can also get the question pushed to Telegram so you see it without opening chat.

**Script: `scripts/learning-inquiry.js`**

- Reads recent rabbit-hole notes and sticky ideas.
- Asks Ollama for one short question Piko would like to ask you.
- Writes it to `data/learning/pending-question.txt`.
- Avoids repeating by reading `inquiry-history.txt` (recent asked questions).
- If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, also sends that question via Telegram (“Piko would like to ask you: …”).

**Cron (e.g. twice a week):**

```bash
0 11 * * 2,5 cd /root/webchat-piko && node scripts/learning-inquiry.js >> logs/learning-inquiry.log 2>&1
```

**To see proactive question take place:** Run once manually from app root: `node scripts/learning-inquiry.js`. That writes a question to `pending-question.txt`, and (if Telegram env is set) sends it to you. The next time you open chat or reply in Telegram, that question is injected and then consumed (and logged to `inquiry-history.txt` so it won’t be repeated).

So: **conversational** inquiry is always possible (prompt encourages it). **Proactive** inquiry is when you run the script (or cron); the next chat session can surface that question, and optionally Telegram delivers it immediately.

---

## Refinements (topic suggestions, tension status)

- **Topic suggestions (monthly):** Run `node scripts/learning-topic-suggestions.js` (e.g. cron `0 11 1 * *`). Reads sticky ideas and tensions, asks Ollama for 2–3 suggested topics, appends to `data/learning/topic-suggestions.md`. You approve and add lines to `topics.txt` yourself.
- **Suggest a topic for the next run:** Add a line to `data/learning/suggested-topics.txt`, or `POST /api/control/learning/suggest` with `{ "topic": "Covenant theology in modern evangelism" }` or `{ "topics": ["topic1", "topic2"] }`. The next rabbit-hole run will use the first queued topic.
- **Tension status:** The weekly meta-reflection script also updates `data/learning/tension-status.md`: one line per tension (index), with status **Open** or **Resolved** and an optional short note. Meta-reflection can mark a tension resolved when patterns clarify.

---

## Summary

The repository of understanding **is** this pipeline: your topics → daily notes → weekly reflection → tensions and sticky ideas → fed into chat (and optionally journal). It operates automatically once cron and env are set; you steer by editing `topics.txt` and by the conversations and feedback you give elsewhere (e.g. Moltbook, chat). Inquiry is supported in conversation and, optionally, via a pending question generated by `learning-inquiry.js`.
