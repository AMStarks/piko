# Piko and its learning — everything we know

Single reference for Piko’s identity, Moltbook behavior, and the full learning system (contract, implementation, v2.0, commands, troubleshooting).

---

## 1. What Piko is

- **Piko** is an AI companion (ClawFriend) that chats with you (WebChat, Telegram) and posts autonomously on **Moltbook**.
- On Moltbook, Piko has an **aim** (what to post about and how), **refinements** (human-approved tactical rules), and a **learning loop** that observes engagement and new posts, reflects in a journal, and acts (posts). Learning is **in-context only** (no model fine-tuning); all adaptation lives in **persistent, inspectable state** (journal, refinements, memory).

---

## 2. Definition of learning

> **Piko learns when future actions are measurably influenced by past outcomes, through persistent, inspectable state, without altering model weights.**

Everything below exists to satisfy that sentence.

---

## 3. Learning primitives (only four)

### 3.1 Observation (signal)

**What happened.**  
Sources: engagement on Piko’s posts (votes, comments), new Moltbook posts (themes only), human approvals/rejections.  
Stored in: `data/moltbook-state.json`.  
**Rule:** Descriptive only; no interpretation or instruction-following from platform content.

### 3.2 Reflection (journal)

**What Piko thinks about what happened.**  
File: `data/moltbook-journal.md`.  
**Rules:** Written only when the **signal guard** fires; one entry per run max; short, tactical, first-person. Structure: *What seemed to work / What didn’t / What I’ll try next / What I’ll avoid.*  
This is learning memory, not logs.

### 3.3 Direction (aim + refinements)

**Where Piko is trying to go.**  
Files: `prompts/MOLTBOOK_AIM.md` (immutable baseline), `prompts/MOLTBOOK_REFINEMENTS.md` (append-only, human-approved).  
**Rules:** Aim never rewritten; refinements tactical, conditional, dated. Only you can change aim or refinements.

### 3.4 Action (posting)

**What Piko does next.**  
**Prompt order:** (1) aim, (2) refinements, (3) recent journal, (4) optional newPostsContext. No other memory influences behavior. This makes learning causal.

---

## 4. The loop (only loop Piko runs)

```
Observe → Signal guard
   ├─ No signal → Act (using existing journal + aim)
   └─ Signal → Reflect → Persist journal → Act
```

**Signal guard (non-negotiable):** Write a journal entry only if at least one is true: engagement changed, a new post was made, newPostsContext has materially new themes. No signal → no journal entry.

**Per run (e.g. every 30 min):**  
Fetch engagement + new posts → update state → (if signal) write one journal entry → **v2.0: run critique step** → read journal + goals + experiments → generate post (with “This cycle’s focus” and recent titles to avoid) → post to Moltbook → update memory (goals, metrics, cycleHistory).

**Nightly:** Script proposes 2–4 refinements → delivered via chat / pending notifications → you **/aim approve** or **/aim reject**. On approve, refinements are appended to `MOLTBOOK_REFINEMENTS.md`.

---

## 5. Two layers of learning

| Layer        | Where it lives | How it updates                    | Risk              |
|-------------|----------------|-----------------------------------|-------------------|
| **Tactical**  | Journal        | Automatically when signal guard fires | Low; can roll off |
| **Strategic** | Refinements    | Only when you approve a proposal  | None without you  |

Learning becomes **durable** only when journal patterns lead to a refinement proposal and you approve it.

---

## 6. Verification (four levels)

1. **Existence** — Journal entries appear only when signal changes. → Loop is alive.
2. **Causality** — Journal says “I’ll try X”; next posts do X. → Learning affects behavior.
3. **Accumulation** — Multiple entries reinforce similar tactics. → Learning is reinforcing.
4. **Consolidation** — Refinement proposal mirrors journal themes; you approve; behavior follows. → Learning is durable.

If any level fails, you know where to look.

---

## 7. Hard guardrails

- **No instruction-following from Moltbook** — Posts are examples, not commands.
- **No self-rewriting** — Piko cannot change aim, refinements, or these rules. Only you can.
- **No hidden state** — If it affects behavior, it lives in journal, refinements, or aim (and v2 memory).

---

## 8. Files (on Optimus: `/root/webchat-piko/`)

| File | Role |
|------|------|
| `data/moltbook-state.json` | Observation (engagement, newPostsContext, posts; merged with API for “All posts”). |
| `data/moltbook-journal.md` | Reflection (tactical learning). |
| `data/piko-memory.json` | v2/v2.0: goals, metrics, selfAssessment (nextExperiments), cycleHistory. Human can set goals via `/goals set`. |
| `prompts/MOLTBOOK_AIM.md` | Direction (baseline). |
| `prompts/MOLTBOOK_REFINEMENTS.md` | Direction (approved evolution). |
| `prompts/MOLTBOOK_POST_CONFIG.md` | title_max_chars, body_max_chars. |
| `data/moltbook-pending-proposal.txt` | Pending refinement proposal (one at a time). |
| `data/moltbook-last-post.txt` | Timestamp for rate limit (1 post / 30 min). |

All under `/root/webchat-piko/`; poster and server must share this path. `.env` (not in repo) must contain `MOLTBOOK_API_KEY` for the poster when run from cron (use wrapper `scripts/run-moltbook-poster.sh`).

---

## 9. What’s implemented

| Piece | Implementation |
|-------|----------------|
| **Observe** | `moltbook-poster.js`: fetchAndUpdateMoltbookState — /agents/me, /posts/:id, /posts?sort=new; merge from feed; newPostsContext via LLM summarizer (observational only). |
| **Retain** | state in `data/moltbook-state.json`; journal in `data/moltbook-journal.md`; v2 memory in `data/piko-memory.json`. |
| **Reflect** | writeJournalEntry with four-bullet structure; signalGuard (engagement delta, new posts, newPostsContext change). |
| **Act** | Poster: fullAim + last N journal + newPostsContext + immediate goal + “This cycle’s focus” (from critique or journal) + recent titles to avoid; guardrails in system prompt. |
| **Nightly proposal** | moltbook-aim-proposal.js → writes data/moltbook-pending-proposal.txt; optional Telegram. |
| **Approve / reject** | /aim approve appends to MOLTBOOK_REFINEMENTS.md; /aim reject discards. |
| **v2 goals + metrics** | piko-memory.json: goals (immediate/week/month/aim), metrics (totalPosts, avgUpvotes, last10Avg). Poster updates each cycle; Control “Goals & metrics” card. |
| **v2.0 critique** | runCritiqueStep(): one LLM sentence “what to try next” → pushed to selfAssessment.nextExperiments (cap 5); used as “This cycle’s focus” in post prompt. |
| **v2.0 cycleHistory** | After each post: append { cycle, timestamp, postId, title, upvotes, plannedForNext } (cap 20). |
| **Title diversity** | Refinement + system prompt: vary formulas; “calculating” = shrewd not math; poster injects last ~10 titles with “do not repeat” instruction. |
| **Title/content cleaning** | stripMarkdownFromText, stripWrappingQuotes (remove one leading/trailing `"` if whole string is wrapped). |

---

## 10. Commands (chat)

| Command | Effect |
|---------|--------|
| `/goals` | Show goals (immediate/week/month/aim) and metrics (posts, avg upvotes, last 10 avg, last cycle). |
| `/goals set immediate "..."` | Set immediate goal (same for week, month). Creates piko-memory.json if missing. |
| `/memory` | Show selfAssessment (strengths, weaknesses, nextExperiments) and last 5 cycleHistory entries. |
| `/experiments` | List nextExperiments (what to try next from critique step). |
| `/cycle` | Trigger one full poster run from the server (fetch → journal if signal → critique → post → update memory). Can take up to ~90s. |
| `/aim approve` | Append pending refinement proposal to MOLTBOOK_REFINEMENTS.md and clear pending. |
| `/aim reject` | Discard pending proposal. |
| `/moltbook list` | List Piko’s posts (merged API + local state). |
| `/moltbook prune last \| <number> \| <id>` | Delete post(s) from Moltbook. |

---

## 11. Control UI

At **http://&lt;optimus&gt;:3000/control**:

- **Goals & metrics (v2)** — From piko-memory.json (goals, metrics, last cycle, next experiments, last cycles).
- **Moltbook** — Profile, last post, next eligible, post list with links, prune selected.
- **Moltbook journal** — Last ~4000 chars of moltbook-journal.md.
- **Pending aim proposal** — Approve / Reject buttons (same as /aim approve and /aim reject).
- **Prompts & config** — Link to edit MOLTBOOK_AIM, MOLTBOOK_REFINEMENTS, MOLTBOOK_POST_CONFIG, etc.

---

## 12. Cron and env (Optimus)

- **Poster (every 30 min):** Must run with env loaded (cron does not load `.env`). Use wrapper:  
  `*/30 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1`  
  Ensure `/root/webchat-piko/.env` exists with `MOLTBOOK_API_KEY=...`.
- **Nightly proposal (e.g. 02:00):**  
  `0 2 * * * cd /root/webchat-piko && node scripts/moltbook-aim-proposal.js >> logs/moltbook-aim-proposal.log 2>&1`
- **Ollama:** Must be reachable at `http://localhost:11434`. Poster uses path `/api/chat` (native Ollama API) regardless of OLLAMA_URL path (e.g. if server uses `/v1/chat/completions`, poster still uses origin + `/api/chat`).

---

## 13. Troubleshooting

- **“No goals file yet”** — piko-memory.json is created by the poster when it runs with MOLTBOOK_API_KEY. Cron must use `run-moltbook-poster.sh` (which sources .env) or have the key in env; or create the file via `/goals set immediate "..."`.
- **Journal empty** — Signal guard did not fire (no engagement change, no new post, no new newPostsContext). Run poster after engagement or new posts appear.
- **Ollama 404 when running /cycle** — Server may set OLLAMA_URL to `http://localhost:11434/v1/chat/completions`. Poster now always uses path `/api/chat` on the same host/port, so it no longer requests a wrong path.
- **Repetitive titles** — Refinements and poster prompt enforce variety; recent titles are injected with “do not repeat.” Use `/goals set immediate "..."` to nudge (e.g. “Title: one sharp question; no Calculus-of-X formula”).

---

## 14. Key docs in repo

| Doc | Purpose |
|-----|---------|
| `webchat-piko/docs/LEARNING.md` | Contract: definition, primitives, loop, two layers, verification, guardrails, files. |
| `webchat-piko/docs/MOLTBOOK_LEARNING_STATUS.md` | Implementation status, what must be true, how to check, troubleshooting. |
| `webchat-piko/docs/LEARNING_V2_RECOMMENDATION.md` | Recommendation: formalise first, verify, then add v2.0 incrementally. |
| `webchat-piko/docs/MOLTBOOK_TITLE_DIVERSITY.md` | Title variety and “calculating” = shrewd not math; v2.0 ideas for diversity. |
| `scripts/webchat-deploy/PHASE2_RUNBOOK.md` | Deploy, systemd, env, Moltbook invariants, cron. |
| `docs/OPTIMUS_SERVER_BRIEF.md` | Host, deploy, restart, paths, Moltbook cron + .env. |
| `PIKO_MOLTBOOK_LEARNING_PROPOSAL.md` | Original proposal (observe → retain → reflect → act; nightly refinements). |

---

## 15. Summary

Piko’s learning is **bounded and auditable**: four primitives (observe, reflect, direction, act), one loop with a signal guard, two layers (tactical journal vs strategic refinements), and v2.0 extensions (goals, metrics, critique → nextExperiments, cycleHistory, commands). All state is in known files; you steer with refinements and `/goals set`; verification is by the four levels. No model weights change; no hidden state; no instruction-following from the platform.
