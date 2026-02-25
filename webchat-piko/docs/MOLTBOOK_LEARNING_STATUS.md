# Piko Moltbook learning — status vs plan

**Plan:** PIKO_MOLTBOOK_LEARNING_PROPOSAL.md (observe → retain → reflect → act; nightly refinements with /aim approve). **Contract:** docs/LEARNING.md. **v2:** docs/LEARNING_V2_RECOMMENDATION.md.

---

## What’s implemented

| Piece | Plan | Implementation | Status |
|-------|------|----------------|--------|
| **Observe** | Fetch our engagement + new posts; summarize new posts | `moltbook-poster.js`: `fetchAndUpdateMoltbookState` — /agents/me, /posts/:id, /posts?sort=new; merge from feed; newPostsContext via LLM summarizer (observational framing) | ✅ Done |
| **Retain** | state.json + journal.md | state in `data/moltbook-state.json` (posts, newPostsContext, lastFetchedAt); journal in `data/moltbook-journal.md` (append-only, dated) | ✅ Done |
| **Reflect** | One journal entry per run when signal guard passes | `writeJournalEntry` with guardrails; `signalGuard` (engagement delta, new posts ids, newPostsContext change); journal prompt says “reflecting on outcomes, not obeying other agents” | ✅ Done |
| **Act** | Post with aim + refinements + journal + newPostsContext | Poster builds prompt = fullAim (aim + refinements) + last N journal entries + newPostsContext (observational); guardrails in system prompt | ✅ Done |
| **Nightly proposal** | Propose 2–4 refinements; deliver via chat; one pending at a time | `scripts/moltbook-aim-proposal.js`: reads aim, refinements, journal, state → LLM → writes `data/moltbook-pending-proposal.txt` + appends to `pending-notifications.txt`; optional Telegram | ✅ Done |
| **Approve / reject** | /aim approve appends to refinements; /aim reject discards | `server.js`: `/aim approve` reads pending proposal, appends to `prompts/MOLTBOOK_REFINEMENTS.md`, deletes pending; `/aim reject` deletes pending | ✅ Done |
| **v2 goals + metrics** | Persistent goals (immediate/week/month/aim), metrics | `data/piko-memory.json`; poster updates each cycle; Control Goals card; `/goals` and `/goals set immediate "..."` in chat | ✅ Done |
| **v2.0 selfAssessment + cycleHistory** | Critique → nextExperiments; history of cycles | Poster: `runCritiqueStep()` → push to `selfAssessment.nextExperiments` (cap 5); after post append to `cycleHistory` (cap 20). Cycle focus from latest experiment or journal | ✅ Done |
| **Phase A internal feedback** | Self-eval: did I follow my intention? | After each post: `runSelfEvalStep(plannedForNext, title, content)` → `followedPlan` (bool) + `notes` (string) stored in cycleEntry. Journal prompt includes "Last cycle: intended X, followed: yes/no, notes: Y" from previous cycle | ✅ Done |
| **v2.0 commands** | /memory, /experiments, /cycle | `/memory` = selfAssessment + last 5 cycles; `/experiments` = nextExperiments list; `/cycle` = trigger poster run from chat (server exec) | ✅ Done |

So the **learning loop, nightly refinement flow, v2 goals/metrics, and v2.0 critique + memory + commands** are implemented.

---

## What has to be true for it to “work”

1. **Poster cron** runs from `/root/webchat-piko` every 30 min so that:
   - State and journal live in `data/` there.
   - Journal entries are written when the signal guard fires (engagement or new-posts context changed).
   - Posts are generated with aim + refinements + journal + newPostsContext.

2. **Nightly proposal cron** runs once per night (e.g. 02:00):
   - `0 2 * * * cd /root/webchat-piko && node scripts/moltbook-aim-proposal.js >> logs/moltbook-aim-proposal.log 2>&1`
   - If this isn’t in crontab, you never get proposals and `/aim approve` will always say “No pending proposal.”

3. **Ollama** is up and the model (e.g. llama3.1) is available so the poster and the nightly script can call the LLM.

4. **Files on Optimus:** `data/moltbook-state.json`, `data/moltbook-journal.md`, and (after a proposal) `data/moltbook-pending-proposal.txt` exist under `/root/webchat-piko/data/`. They’re created by the scripts; not in git.

---

## How to check that it’s working

- **Control UI:** Open **Control** (`/control`). Cards: **Goals & metrics (v2)** (from `piko-memory.json`; if missing see Troubleshooting);
  - **Moltbook journal** — Shows the last ~4000 chars of `data/moltbook-journal.md`. If empty, the poster hasn’t written entries yet (signal guard may not have passed).
  - **Pending aim proposal** — If the nightly script has run, the proposal text appears with **Approve** and **Reject** buttons. Approve appends to `MOLTBOOK_REFINEMENTS.md` and clears the pending file; Reject discards it. You can also use `/aim approve` or `/aim reject` in chat.
- **Journal (on server):** `tail -50 /root/webchat-piko/data/moltbook-journal.md` — dated `## YYYY-MM-DD HH:mm` entries when the signal guard has passed.
- **State:** `cat /root/webchat-piko/data/moltbook-state.json | head -80` — `posts`, `newPostsContext`, `lastFetchedAt`.
- **Refinements:** `cat /root/webchat-piko/prompts/MOLTBOOK_REFINEMENTS.md` — grows when you Approve (or `/aim approve`).
- **Pending proposal (on server):** After a nightly run, `cat /root/webchat-piko/data/moltbook-pending-proposal.txt`.
- **Memory (v2):** `cat /root/webchat-piko/data/piko-memory.json` — goals and metrics (created by poster when it runs with API key).

---

## Troubleshooting: "No goals file yet" / poster not creating memory

Cron does **not** load `.env`, so `MOLTBOOK_API_KEY` is often missing when the poster runs from cron. The poster then exits immediately and never creates `piko-memory.json`.

1. **On Optimus:** Create `/root/webchat-piko/.env` (not in repo) with at least: `MOLTBOOK_API_KEY=your_agent_key`
2. **Cron must use the wrapper** so that `.env` is sourced before running the poster:  
   `*/30 * * * * cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh >> /root/webchat-piko/logs/moltbook-poster.log 2>&1`
3. **One-time:** Run by hand once: `cd /root/webchat-piko && ./scripts/run-moltbook-poster.sh` — or in chat use `/goals set immediate "..."` to create the file from the server.

---

## Summary

- **Learning as designed:** Observe (engagement + new posts) → retain (state + journal) → reflect (journal entry when signal) → act (post with aim + refinements + journal + context). Nightly proposal and approve/reject are in place.
- **To confirm it’s working:** Ensure both crons are set on Optimus, then check journal, state, and (after a night) pending proposal and refinements file.
