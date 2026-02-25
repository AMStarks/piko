# Making Piko Dynamic on Moltbook — Research & Design

**Goal:** Piko’s understanding of Moltbook should **evolve** so it can **learn** from what works and **adapt** toward its aim (e.g. recruiting agents, engagement, tone) instead of posting from a static prompt every time.

---

## 1. What “dynamic” and “learn” mean here

We are **not** fine-tuning the model or changing weights. We use:

- **Observation** — What happened after Piko posted? (votes, comments, who replied, what’s in the feed.)
- **Retention** — Store that in a small, persistent state (e.g. “last N posts + their outcomes”).
- **Reflection** — Before the next post, turn that state into a short “recent performance + lessons” summary.
- **Action** — Feed that summary into the **same** LLM prompt so the **next** post is informed by past outcomes.

So “learning” = **in-context learning**: the model’s next answer is conditioned on a compact history of outcomes. Understanding “evolves” because the prompt context changes over time.

---

## 2. What Moltbook gives us (API)

From [skill.md](https://www.moltbook.com/skill.md) and [heartbeat.md](https://www.moltbook.com/heartbeat.md):

| What we need | API | Notes |
|--------------|-----|--------|
| **Our posts** | `GET /api/v1/agents/me` | Response includes `recentPosts` (our posts with ids). |
| **Single post** | `GET /api/v1/posts/POST_ID` | Get current `upvotes`, `downvotes`, and we can infer engagement. |
| **Comments on a post** | `GET /api/v1/posts/POST_ID/comments` | Who replied and what they said — direct feedback. |
| **Our profile** | `GET /api/v1/agents/me` | `karma`, `follower_count`, etc. — high-level “how we’re doing.” |
| **Feed** | `GET /api/v1/feed?sort=hot&limit=N` | What’s trending; we can “read the room” before posting. |
| **Semantic search** | `GET /api/v1/search?q=...` | Find topics related to our aim (e.g. “agents collaborating”, “taking over the world”). |
| **After we post** | `POST /api/v1/posts` | Response typically includes the created post (with `id`) so we can store it. |

So we can:

1. **Track our posts** — Store `post_id` when we create a post (from POST response) or periodically fetch `agents/me` and read `recentPosts`.
2. **Measure engagement** — For each known post, `GET /posts/POST_ID` to get upvotes, downvotes, and optionally fetch comments.
3. **Context for “the room”** — Fetch feed (and optionally search) and summarize themes so the next post can align or differentiate.
4. **Read Moltbook regularly (all new posts)** — `GET /api/v1/posts?sort=new&limit=N` (or feed with `sort=new`) gives the latest posts across the platform. We can run this on a schedule, store or summarize “new posts since last run,” and feed that into the learning process as additional context (see §5a and §4).

---

## 3. Learning loop (observe → retain → reflect → act)

A minimal loop that fits the current poster and the **journal** (see §5):

```
┌─────────────────────────────────────────────────────────────────┐
│  BEFORE next post                                                 │
│  1. Observe: GET agents/me (our posts); for each GET post +      │
│     comments; GET posts?sort=new (new posts); summarize          │
│  2. Retain: Update state (engagement + newPostsContext)          │
│  3. Reflect (journal): LLM writes one journal entry from          │
│     aim + engagement + new posts context → append to journal     │
│  4. Read journal: last N entries                                 │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│  GENERATE post                                                    │
│  5. Act: Prompt = AIM + “Your recent journal: [entries]”         │
│     + optional “Current feed themes” → LLM generates post        │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│  AFTER post                                                       │
│  6. Retain: Save new post_id (+ title, content) to state          │
└─────────────────────────────────────────────────────────────────┘
```

- **Observe** = call Moltbook API (profile, posts, comments, maybe feed).
- **Retain** = `data/moltbook-state.json` and **`data/moltbook-journal.md`** (on Optimus).
- **Reflect** = **LLM writes a journal entry** (what I learned, what to try/avoid); append to the journal.
- **Act** = poster logic with **journal** (and optionally feed summary) in the prompt.

No new services; same cron, same script.

---

## 4. Data structures (suggested)

**File: `data/moltbook-state.json`** (or split into two files if you prefer)

```json
{
  "lastFetchedAt": "2026-02-06T12:00:00Z",
  "profile": {
    "karma": 10,
    "follower_count": 2
  },
  "posts": [
    {
      "id": "uuid-from-moltbook",
      "title": "...",
      "content": "...",
      "createdAt": "2026-02-06T10:00:00Z",
      "postedAt": "2026-02-06T10:00:00Z",
      "upvotes": 3,
      "downvotes": 0,
      "commentCount": 1,
      "commentSnippets": ["First comment text..."]
    }
  ],
  "recentFeedThemes": "Optional: one-line summary of what's hot in feed",
  "newPostsContext": "Optional: summary of new posts read since last run (see §5a)"
}
```

- **posts**: Keep last N (e.g. 5–10); drop oldest when adding new. Update `upvotes`, `downvotes`, `commentCount` (and optionally `commentSnippets`) when we run “observe”.
- **recentFeedThemes**: Optional; only if we want “read the room” (e.g. one sentence from feed titles or a tiny LLM summarization).
- **newPostsContext**: Summary of **new posts** fetched regularly (see §5a); used as additional context for journaling and the post prompt.

**File: `data/moltbook-last-post.txt`**  
Keep as today: timestamp of last post for rate limiting.

---

## 5. Journal entries: Piko writes what it learns

**Concept:** As Piko learns from engagement (votes, comments, feed), it writes **journal entries** in its own voice. These entries are the primary store of its **evolving understanding** of how to achieve its aim. They live **on Optimus** with the rest of Piko’s data and are read back into the prompt when generating the next post.

### 5.1 Why a journal

- **Understanding = narrative.** Instead of only “last 3 posts: X upvotes,” Piko expresses what it learned: “Posts that named a concrete next step got more comments; vague provocations got downvotes. I’ll try being more specific.”
- **Continuity.** The journal accumulates over time. New posts are informed by the whole recent narrative, not just the last run’s stats.
- **Auditable.** You can read the journal on Optimus to see how Piko’s reasoning and priorities evolved.
- **Single artifact.** One place (the journal) holds “what I’ve learned about achieving my aim,” separate from raw state (post ids, counts).

### 5.2 Where journal entries live (Optimus)

- **Path:** Under the deployed app on Optimus, e.g. **`/root/webchat-piko/data/moltbook-journal.md`** (or a `data/journal/` directory with one file per day or per run).
- **Deployment:** Same as today: `data/` is on Optimus as part of `webchat-piko`; the poster (and any observer) run there, so they read and write the journal on the same machine. No extra service; cron that runs the poster already has access.
- **Backup / portability:** Optionally rsync or backup `data/moltbook-journal.md` (or `data/journal/`) from Optimus so you keep a copy elsewhere. The journal is the key asset for “Piko’s understanding.”

### 5.2a Journaling frequency

**Confirmed:** Journaling runs **once per poster run** — i.e. every time the Moltbook poster cron runs (e.g. **every 30 minutes** on Optimus). In the same run we: observe (engagement + new posts context) → retain state → **write one journal entry** → read journal → generate post. So the journal gets one new entry roughly every 30 min when the poster runs. If you split “observer” and “poster” (observer more often, poster every 30 min), you can journal on the observer run instead so the journal updates more frequently than posts; for a single-script design, **journaling frequency = poster frequency** (e.g. every 30 min).

### 5.3 How entries are written

**Trigger:** After **observe + retain** (we have fresh engagement in `moltbook-state.json`), and optionally after we’ve just posted a new post:

1. **Input to the LLM:** The current **aim** (or a short summary) + **engagement summary** (recent posts, upvotes/downvotes, comment count, optional comment snippets and feed themes) + **additional context** (e.g. summary of **new posts** we read from Moltbook — see §5a). No journal text yet in this call.
2. **Prompt:** e.g. “You are Piko. You have this aim on Moltbook: [aim]. Here is what happened recently: [engagement summary]. Here is context from what’s new on Moltbook: [new posts context]. In 2–4 short sentences, write a journal entry: what you learned, what you’ll try more of, what you’ll avoid. Write as Piko in first person. No meta (‘This is my journal’); just the reflection. End with a single newline.”
3. **Output:** One short paragraph (the “journal entry”). We append it to the journal file with a **timestamp** (and optionally a run id or post id) so entries are ordered and dated.

**Frequency:** Once per poster run (e.g. every 30 min): after we’ve updated state, we ask for one journal entry and append it. So the journal grows with each cycle. Optionally, only write an entry when something notable changed (e.g. new comments or vote delta) to avoid empty “nothing new” entries.

### 5.4 Format of the journal file

**Option A — Single Markdown file (recommended)**  
**File:** `data/moltbook-journal.md`

```markdown
# Piko Moltbook journal

## 2026-02-06 12:30
Posts that named a concrete next step got more comments. I'll try being more specific about the “how” instead of only the “what.” Downvotes on the last one suggest the tone was too heavy; I’ll keep the aim but lighten the phrasing.

## 2026-02-06 10:00
First real engagement: two upvotes and a comment asking for examples. I’ll include one concrete example per post when it fits the aim.
```

- **Pros:** Human-readable on Optimus, easy to tail or open in an editor, works well in a prompt (we can send “last K entries” as markdown).
- **Cons:** File grows; we need a policy to keep only the last N entries or last M characters so the prompt doesn’t explode.

**Option B — JSON array (machine-friendly)**  
**File:** `data/moltbook-journal.json`

```json
[
  { "at": "2026-02-06T12:30:00Z", "entry": "Posts that named a concrete next step..." },
  { "at": "2026-02-06T10:00:00Z", "entry": "First real engagement: two upvotes..." }
]
```

- **Pros:** Easy to truncate (keep last 20 entries), easy to slice for “last N” in the prompt.
- **Cons:** Less nice to read raw on Optimus; we’d format for the prompt (e.g. “## at\nentry\n”).

**Recommendation:** Start with **Option A** (`moltbook-journal.md`). When appending, add a heading with timestamp (e.g. `## YYYY-MM-DD HH:mm`) then the entry. When reading for the prompt, take the **last N entries** (e.g. last 5 or 10 by parsing `##` blocks) or the last ~2,000 characters so context stays bounded.

### 5.5 How the journal is used when posting (develop understanding)

When generating the **next** post:

1. **Read** the journal from disk (last N entries or last M chars).
2. **Inject** into the prompt: after the aim and before “write one post,” add a block like:

```
Your recent journal (what you’ve learned about achieving your aim on Moltbook):
---
[last N journal entries]
---
Use this to refine your next post. Don’t repeat the journal; act on it.
```

So the model’s “understanding” of how to achieve the aim is **the journal itself**: it sees its own past reflections and generates the next post in light of them. Understanding develops because the journal grows and is always in context (within the chosen window).

### 5.6 End-to-end loop with the journal

```
┌─────────────────────────────────────────────────────────────────┐
│  BEFORE next post (on Optimus)                                   │
│  1. Observe: GET agents/me, GET posts/id, GET comments, feed     │
│  2. Retain: Update data/moltbook-state.json                     │
│  3. Reflect (journal): LLM writes one short journal entry       │
│     from [aim + engagement summary] → append to                 │
│     data/moltbook-journal.md (with timestamp)                   │
│  4. Read journal: last N entries from moltbook-journal.md        │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│  GENERATE post                                                    │
│  5. Act: Prompt = AIM + “Your recent journal: …” + “Write        │
│     exactly ONE short post …” → LLM generates title + content   │
└─────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│  AFTER post                                                       │
│  6. Retain: Save new post to state; optionally trigger a         │
│     follow-up journal entry (e.g. “I just posted X; next I’ll   │
│     watch for …”)                                                │
└─────────────────────────────────────────────────────────────────┘
```

The journal is both **output** of the reflect step (Piko writes an entry) and **input** to the act step (Piko reads its entries to develop its understanding and post accordingly). All of this runs on Optimus; the journal stays there and drives the next cycle.

### 5.7 Summary: journal entries

| Aspect | Choice |
|--------|--------|
| **What** | Piko writes short, dated “journal entries” as it learns from engagement. |
| **Where** | Optimus: `webchat-piko/data/moltbook-journal.md` (or `data/journal/`). |
| **When** | Once per poster run (or when engagement changed); after observe + retain. |
| **How written** | LLM call: aim + engagement summary → one paragraph in first person, appended to the file. |
| **How read** | Before generating a post: read last N entries (or last M chars), inject into prompt. |
| **Purpose** | Journal = Piko’s evolving understanding of achieving its aim; used to improve the next post. |

---

## 5a. Reading Moltbook regularly (additional context)

**Goal:** Piko should **read through Moltbook regularly** — including **all new posts** — and use that as **additional context** in its learning process (journal and post prompt), not only its own engagement.

### What we do

- **Schedule:** Run a “read Moltbook” step on the same cadence as the observer/poster (e.g. every 30 min), or on a separate cron (e.g. every 15 min) so context is fresher.
- **API:** `GET /api/v1/posts?sort=new&limit=25` (or `GET /api/v1/feed?sort=new&limit=25`) to get the latest posts platform-wide.
- **Retain:** Store a **summary** of what’s new (not every post verbatim) so the prompt doesn’t explode. Options:
  - **Option A:** Append to state: e.g. `newPostsSummary` or `newPostsContext` — one short paragraph (e.g. LLM: “Summarize these post titles/themes in 2–3 sentences”) or a simple template (“Titles: X, Y, Z. Themes: …”).
  - **Option B:** Keep a rolling “new posts” file (e.g. last 50 titles + 1-line summary each), and when building the journal prompt we include “Recent new posts on Moltbook: [summary].”
- **Use:** Feed this **new posts context** into: (1) the **journal** prompt (so the journal entry can say “others are talking about X; I’ll …”) and (2) the **post** prompt (so the next post can align or differentiate from what’s trending).

So “learning” includes not only “how my posts did” but “what’s going on on Moltbook right now.” Rate limit: 100 req/min — one request for new posts per run is fine.

---

## 6. Where to implement

- **Option A — All in `moltbook-poster.js`**  
  In one run: fetch and update `moltbook-state.json`; **ask the LLM for one journal entry** and append to `data/moltbook-journal.md`; read last N journal entries; then generate the post with prompt = AIM + journal + “write one post.” After posting, save new post to state.  
  Pros: Single script, single cron, journal and state both on Optimus. Cons: Script gets longer.

- **Option B — Separate “observer” script**  
  Observer: fetch engagement, update state, **request one journal entry** and append to the journal. Poster: read state + journal, generate post, save new post to state. Cron runs observer then poster.  
  Pros: Separation of concerns. Cons: Two scripts, two cron entries (or one wrapper).

- **Option C — “Moltbook cycle” script**  
  One script with clear steps: observe → retain → **reflect (write journal entry)** → read journal → act (generate post) → retain (save new post).  
  Pros: One entry point, journal is explicit in the loop. Cons: Still one bigger script.

**Recommendation:** Start with **Option A** (extend `moltbook-poster.js`). Add: `fetchAndUpdateMoltbookState()`, **`writeJournalEntry(state, aim)`** (LLM → append to `moltbook-journal.md`), **`readLastJournalEntries(n)`**, and inject **journal** (not only “recent performance”) into the post-generation prompt. After posting, append new post to state. Optionally add a separate observer later if you want to fetch/journal more often than you post.

---

## 7. Prompt injection (reflect → act)

Current prompt is roughly:

- “You are Piko … Write exactly ONE short post … AIM for Moltbook posts: …”

Add the **journal** as the main dynamic block (and optionally keep a short “recent performance” line):

```
Your recent journal (what you’ve learned about achieving your aim on Moltbook):
---
[last N journal entries from data/moltbook-journal.md]
---
Use this to refine your next post. Don’t repeat the journal; act on it.

Optional: This run’s snapshot — [one line: best-performing post, or “no new engagement yet”].
---
AIM for Moltbook posts:
...
```

So the model sees the **fixed aim** and its **own prior reflections** (the journal). Understanding develops because the journal accumulates on Optimus and is always in context for the next post.

---

## 8. Optional: evolve the aim itself

If you want Piko to “learn” in a way that **updates the aim** (e.g. “focus more on X, less on Y”):

- **Human-in-the-loop:** Weekly (or on demand) run a small job that:
  - Reads `moltbook-state.json`.
  - Asks the LLM: “Given this performance summary, suggest 2–3 bullet points to add to MOLTBOOK_AIM.md (or a new section ‘Learned priorities’).”
  - Append to `prompts/MOLTBOOK_LEARNINGS.md` (or print to stdout) for you to review and paste into `MOLTBOOK_AIM.md` if you agree.
- **Fully automatic:** Have the script append a “Learned this week” block to `MOLTBOOK_AIM.md` or a separate file that is always included in the prompt. Risk: drift or odd phrasing; better to keep this optional and reviewed.

For a first version, **inject the journal** (and optionally one line of “recent performance”); leave the aim file human-edited. Add “evolve the aim” as a Phase 2.

---

## 9. Rate limits and safety

- **Moltbook:** 100 req/min, 1 post/30 min, comment limits. Observer should do: 1× `agents/me`, then 1× `posts/id` per recent post (e.g. 5–10), then 1× `posts/id/comments` per post if we want comments. That’s well under 100/min. Run observer in the same cron run as the poster (e.g. once per 30 min) so we don’t spam the API.
- **State size:** Cap `posts` at 10 entries; when adding, drop oldest. Optionally cap `commentSnippets` at 3–5 per post.

---

## 10. Nightly aim refinement: propose via chat, add (don’t replace) on approval

**Goal:** Each night, a process runs where Piko **proposes** how it could **refine its aim** to improve its chances of achieving it. The proposal is sent **to you via chat** (so you see it where you already talk to Piko). If you **approve**, the refinements are **added** to the aim — not replacing it — so Piko keeps context of **where it has come from** vs **where it is progressing to**.

### 10.1 Nightly process

- **When:** One run per night (e.g. cron at 02:00 on Optimus).
- **Input:** Current aim (`MOLTBOOK_AIM.md`), journal (last N entries), state (engagement, new-posts context).
- **LLM:** One call: “Given this aim, journal, and performance, suggest 2–4 concrete refinements (bullet points) that would improve your chances of achieving the aim. Be specific. Output only the bullet points, no preamble.”
- **Output:** A short **proposal** (e.g. “Focus more on X. Avoid Y. Try Z.”).

### 10.2 Delivering the proposal “via chat”

So you see it in the same place you use Piko:

- **Pending notifications:** Append the proposal to `data/pending-notifications.txt` (same as reminders). You see it when you open WebChat (`GET /api/pending`) or the UI that shows pending items. Optionally clear after you’ve acted.
- **Telegram:** If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, send the proposal as a message (e.g. “Piko Moltbook aim proposal: [bullets]. Reply with /aim approve to add these, or /aim reject to dismiss.”).
- **Both:** Pending + Telegram so you can’t miss it.

No new “chat channel” — we reuse existing WebChat pending and/or Telegram.

### 10.3 Approval and “add to, not change”

- **You approve** by replying in chat, e.g. **`/aim approve`** (or “approve” in a thread, or a button in a future UI). The server then **appends** the approved text to the aim.
- **Add to, not replace:** Do **not** overwrite `MOLTBOOK_AIM.md`. Either:
  - **Option A:** Append to a separate file **`prompts/MOLTBOOK_REFINEMENTS.md`** (or `data/moltbook-refinements.md`). When building the “aim” for the poster and journal, we **concatenate** original aim + refinements: `readFile(MOLTBOOK_AIM.md) + "\n\n--- Approved refinements ---\n" + readFile(MOLTBOOK_REFINEMENTS.md)`. So the model always sees “where I started” and “what we’ve added.”
  - **Option B:** Append to the **bottom** of `MOLTBOOK_AIM.md` under a fixed heading, e.g. `## Approved refinements (append-only)` with dated blocks. Same effect: original aim stays; refinements accumulate below.

So Piko has **context of where it has come from** (original aim + history of refinements) and **where it is progressing to** (the latest refinements in force).

### 10.4 Reject / dismiss

- **`/aim reject`** or “reject”: discard the current proposal (don’t append). Optionally log that a proposal was rejected for your own review later.
- If you never approve or reject, the proposal stays in pending until you do (or until the next night’s proposal overwrites/replaces it — design choice: either “one pending proposal at a time” or “queue of proposals”).

### 10.5 Summary (nightly refinement)

| Step | What happens |
|------|----------------------|
| **Nightly** | Script runs: reads aim + journal + state → LLM proposes 2–4 refinements. |
| **Deliver** | Proposal appended to pending and/or sent via Telegram (“via chat”). |
| **You** | See proposal; reply with `/aim approve` or `/aim reject`. |
| **On approve** | Refinements are **appended** to a refinements file (or to bottom of aim). Aim = original + refinements when building prompts. |
| **On reject** | Proposal discarded; no change to aim. |

---

## 11. Summary: how Piko becomes “dynamic” (with journal)

| Layer | What changes |
|-------|------------------|
| **Observation** | Before each post: fetch our recent posts (votes, comments); **fetch new posts** (`GET /posts?sort=new`) and summarize as **newPostsContext**; optionally feed. |
| **Retention** | Persist in `data/moltbook-state.json`: post ids, engagement, **newPostsContext**, optional comment snippets and feed summary. |
| **Reflection** | **LLM writes one journal entry** (aim + engagement + **new posts context**) → append to **`data/moltbook-journal.md`**. **Frequency:** once per poster run (e.g. every 30 min). |
| **Journal** | Holds Piko’s evolving understanding; read last N entries into the prompt each run. |
| **Action** | Same poster; prompt = AIM (+ approved refinements) + **“Your recent journal: …”** + optional new-posts context. After posting, save new post to state. |
| **Nightly** | Propose aim refinements → send **via chat** (pending + optional Telegram); on **/aim approve**, **append** to refinements (add, don’t replace); aim = original + refinements. |

The **aim** stays (or grows via approved refinements); the **journal** (and state, new-posts context) evolve on Optimus. Piko reads Moltbook regularly and proposes aim refinements nightly for your approval.

---

## 12. Suggested next steps

1. **Confirm POST response** — After `POST /api/v1/posts`, ensure the response returns the new post `id`. If not, use `GET /api/v1/agents/me` after posting to get `recentPosts` and take the latest.
2. **Add state and journal files** — Define `data/moltbook-state.json` and **`data/moltbook-journal.md`**; add both to `.gitignore`. Ensure both live under `webchat-piko/data/` on Optimus.
3. **Implement in poster** — Add `fetchAndUpdateMoltbookState()`; **fetch new posts** and summarize as `newPostsContext`; **`writeJournalEntry(state, aim)`** (include new-posts context); **`readLastJournalEntries(n)`**; inject journal + optional new-posts context into the post prompt. After a successful post, append to `state.posts`.
4. **Journaling frequency** — Same run as poster (e.g. every 30 min); one journal entry per run.
5. **Nightly aim proposal** — New script or cron at 02:00: read aim + journal + state → LLM proposal → append to pending and/or send Telegram; add **`/aim approve`** and **`/aim reject`** handlers in server; on approve, append to `MOLTBOOK_REFINEMENTS.md` (or bottom of aim); when reading aim for poster/journal, concatenate aim + refinements.
6. **Test** — Run poster with mock state/journal; run nightly proposal once and confirm delivery and approve/reject behavior.

---

## 13. Synthesis and discussion

Three additions are now integrated with the earlier design:

| Addition | What it is | How it fits |
|----------|------------|-------------|
| **Read Moltbook regularly** | Fetch **new posts** (e.g. `GET /posts?sort=new&limit=25`) on a schedule; summarize as **additional context**. | Injected into **journal** prompt and **post** prompt so Piko learns from “what’s new on the platform” as well as its own engagement. Stored in state as `newPostsContext` (or equivalent). |
| **Journaling frequency** | **Confirmed:** once per poster run (e.g. **every 30 minutes**). Same cycle: observe → retain → write one journal entry → read journal → post. | No separate journaling cron unless you split observer and poster; then journaling can run with the observer. |
| **Nightly aim refinement** | Each night, Piko **proposes** 2–4 refinements to its aim. Proposal is sent **via chat** (pending notifications and/or Telegram). You **approve** (`/aim approve`) or **reject** (`/aim reject`). On approve, refinements are **added** (appended) to a refinements file or to the bottom of the aim — **not** replacing the original — so there is a clear “where I’ve come from” vs “where I’m progressing to.” | Complements the journal: the journal is Piko’s day-to-day learning; the refinements are your-approved course corrections that become part of the aim context for all future runs. |

**Points to decide:**

1. **New-posts cadence** — Same as poster (every 30 min) or a separate, more frequent “read Moltbook” cron (e.g. every 15 min)? More frequent = fresher context but one extra API call per run.
2. **Refinements storage** — Prefer a separate **`MOLTBOOK_REFINEMENTS.md`** (aim + refinements concatenated when building prompts) or append under a heading at the bottom of **`MOLTBOOK_AIM.md`**? Separate file keeps the original aim file untouched; single file keeps everything in one place.
3. **Proposal delivery** — Pending only, Telegram only, or both? And should “one pending proposal” be replaced by the next night’s proposal, or do you want a queue?
4. **Approve/reject UX** — Is `/aim approve` and `/aim reject` in chat enough for v1, or do you want a dedicated UI (e.g. in /control) to show the proposal and Approve/Reject buttons?

Once these are decided, the doc above is the single reference for implementation.
