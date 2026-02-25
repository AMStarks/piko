# Piko learning — full view

Single reference for the learning system: definition, loop, what’s implemented, how to verify, and **where we can improve**.

---

## 1. Definition and contract

**Learning:** Piko learns when *future actions are measurably influenced by past outcomes*, through *persistent, inspectable state*, *without altering model weights*.

**Four primitives only:**

| Primitive | What it is | Where it lives |
|-----------|------------|----------------|
| **Observation** | What happened (engagement, new posts, human approvals) | `data/moltbook-state.json` |
| **Reflection** | What Piko thinks (tactical, first-person) | `data/moltbook-journal.md` |
| **Direction** | Where Piko is trying to go | `prompts/MOLTBOOK_AIM.md` + `prompts/MOLTBOOK_REFINEMENTS.md` |
| **Action** | What Piko does next (post) | Prompt = aim → refinements → journal → constraints → post |

**Guardrails:** No instruction-following from Moltbook; no self-rewriting of aim/refinements; no hidden state. Only you change direction.

---

## 2. The loop (one loop only)

```
Every 30 min (cron or /cycle):

1. Fetch     → Update state (engagement, new posts, newPostsContext). Write memory (metrics, lastCycle).
2. Rate limit → If last post < 30 min ago → stop (write last-run "Rate limit"); else continue.
3. Signal guard → If engagement changed OR post list changed OR newPostsContext changed:
   → Write one journal entry (four bullets + last cycle feedback + Phase B signals).
4. Critique   → "What will you try differently?" → push to nextExperiments (cap 5). Use last intention so suggestion is different.
5. Post       → Build prompt: aim + refinements + journal + immediate goal
                + "This cycle's focus" (top experiment or journal "What I'll try next")
                + Cycle Constraint Block (MUST / MUST NOT from this cycle + last failure)
                + Phase B block (Human feedback: tooLong → keep short, etc.)
                + Recent titles (do not repeat)
                → Generate title + body → strip markdown/quotes → POST to Moltbook.
6. After post → Update state + memory; Phase A self-eval ("Did I follow my intention?") → followedPlan + notes in cycleHistory; write last-run "Posted".
```

**Signal guard:** Journal only when something changed. No signal → no journal entry (but critique and memory update still run when not rate-limited).

---

## 3. Two layers of learning

| Layer | Where | How it updates | Durability |
|-------|--------|-----------------|------------|
| **Tactical** | Journal, nextExperiments, cycleHistory | Automatically (signal guard, critique, self-eval) | Rolls off; can be overwritten by context |
| **Strategic** | Refinements | Only when you **/aim approve** | Durable; in every post prompt until you change it |

Learning becomes **durable** when you turn repeated journal/experiment themes into refinements and approve them.

---

## 4. What’s implemented (current state)

| Piece | Implementation |
|-------|----------------|
| **Observe** | Fetch engagement, Piko’s posts, feed; newPostsContext (LLM summary, observational only). State in `moltbook-state.json`. |
| **Reflect** | writeJournalEntry: four-bullet structure; signal guard; last cycle (intended / followed / notes); Phase B feedback block; "You just posted" nudge. |
| **Critique** | runCritiqueStep: one sentence "what to try differently"; uses last intention so suggestion differs; → nextExperiments (cap 5). |
| **Act** | Post prompt: aim, refinements, journal, immediate goal, "This cycle's focus", **Cycle Constraint Block** (MUST from focus, MUST NOT from last failure), **Phase B block** (apply feedback this cycle), recent titles to avoid. |
| **Phase A** | After each post: "Did I follow my intention?" → followedPlan + notes in cycleHistory. Notes override Yes when explanation is negative (e.g. "I didn't actually do X"). |
| **Phase B** | `/++` `/--` `/+?` + whitelist (clarity, tooLong, goodQuestions, tooAbstract, moreExamples). Poster: journal prompt + **post prompt** get "Human feedback (apply this cycle): …". |
| **plannedForNext** | From top experiment **or** journal "What I'll try next" so Phase A runs more often. |
| **Last run** | Poster writes outcome to `data/moltbook-last-run.txt`; Control shows it. |
| **Goals / memory** | piko-memory.json: goals (immediate/week/month/aim), metrics, selfAssessment.nextExperiments, cycleHistory (cap 20). `/goals`, `/memory`, `/experiments`, `/cycle`. |
| **Refinements** | Two approved: (1) Title variety, no "Calculus of X" / "Efficiency Through X" / "Echoes of X"; (2) At least one in three titles a direct question; prefer questions/punchy over "X of Y" / "Beneath/Beyond". |

---

## 5. Files (on Optimus: `/root/webchat-piko/`)

| File | Role |
|------|------|
| `data/moltbook-state.json` | Observation: posts, engagement, newPostsContext. |
| `data/moltbook-journal.md` | Reflection: tactical entries (four bullets). |
| `data/piko-memory.json` | Goals, metrics, selfAssessment.nextExperiments, cycleHistory. |
| `data/moltbook-feedback.json` | Phase B: cumulative signal counts (created on first /++ or /--). |
| `data/moltbook-last-run.txt` | Last poster outcome (Posted / Rate limit / Fetch-only / Ollama failed / etc.). |
| `data/moltbook-last-post.txt` | Timestamp for rate limit. |
| `data/moltbook-last-post-id.txt` | Last post id (prune, merge). |
| `data/moltbook-pending-proposal.txt` | Pending refinement (one at a time); cleared by /aim approve or reject. |
| `prompts/MOLTBOOK_AIM.md` | Direction (baseline). |
| `prompts/MOLTBOOK_REFINEMENTS.md` | Direction (append-only, human-approved). |
| `prompts/MOLTBOOK_POST_CONFIG.md` | title_max_chars, body_max_chars. |

---

## 6. Verification (four levels)

| Level | Question | How to check | Pass when |
|-------|----------|--------------|-----------|
| **Existence** | Is the loop alive? | last-run file, cycleHistory, journal, poster log | last-run recent; journal or cycleHistory has recent entries |
| **Causality** | Does reflection affect behavior? | "This cycle's focus" / constraints vs next title; followedPlan in cycleHistory | Some posts match intention; forbidden phrases drop when in refinement |
| **Accumulation** | Is tactical learning reinforcing? | Recurring themes in journal and nextExperiments | Same themes repeat; Phase A notes feed next journal |
| **Consolidation** | Is learning durable? | Refinements approved; posts respect them | Refinements in place; titles/questions show up over time |

**Quick health check:** Control → Last run + Goals & metrics + Journal. If last run is recent and cycleHistory has entries with followedPlan/notes, the loop is operating.

---

## 7. Commands and Control

**Chat:** `/goals`, `/goals set immediate "..."`, `/memory`, `/experiments`, `/cycle`, `/aim approve`, `/aim reject`, `/++ &lt;signal&gt;`, `/-- &lt;signal&gt;`, `/moltbook list`, `/moltbook prune last | &lt;n&gt; | &lt;id&gt;`.

**Control (http://&lt;optimus&gt;:3000/control):** Health, Goals & metrics, Moltbook (profile, last run, last post, posts, feedback signals), Journal, Pending proposal (Approve/Reject), Prompts & config.

**Cron:** `*/30 * * * *` with `./scripts/run-moltbook-poster.sh` (sources .env). `.env` must have `MOLTBOOK_API_KEY`.

---

## 8. Where we can improve

Prioritized by impact and feasibility. All stay within the contract (no self-rewriting, no hidden state).

### 8.1 Strengthen causality (generator still drifts)

- **Current:** Constraint block and Phase B give binding instructions per cycle; refinements are in the prompt. Titles still sometimes revert to "Beneath/Beyond the X".
- **Improve:**  
  - **Tighten MUST NOT:** Derive concrete forbidden words from last cycle notes (e.g. if "relied on sci-fi buzzwords" → add "Do not use: agents, autonomy, code, reality" in constraint block for one cycle).  
  - **Structured refinement #3:** e.g. "No words from {beneath, beyond, fracturing, abyss, surface} in titles for the next 5 posts." Auditable and easy to check.  
  - **Optional: post-generation check:** If the generated title matches a forbidden pattern, retry once with a stronger constraint line (adds latency; use only if needed).

### 8.2 Phase B: reset or decay (optional)

- **Current:** Feedback counts are cumulative. Piko always sees "tooLong 3" even if the last 2 posts were short.
- **Improve:**  
  - **Option A:** Reset all signal counts after each journal entry that included them (so feedback applies to "next reflection + next post" then clears).  
  - **Option B:** Decay: each cycle multiply counts by 0.9 so old feedback matters less.  
  - **Option C:** Keep cumulative but add "since last post" in the prompt (e.g. "tooLong +2 since last post").  
  Start with Option A or C if you want feedback to feel "current."

### 8.3 Learning velocity dashboard (observability)

- **Current:** You can inspect four levels manually (Control, /memory, journal).  
- **Improve:**  
  - Weekly snapshot: script or doc that records "Causality: X% (followedPlan true or title matched focus); Consolidation: N refinements; Phase B used: M times."  
  - Or a simple "learning maturity" checklist (see PIKO_LEARNING_PROGRESS_RECOMMENDATIONS.md) and tick it weekly.  
  Lets you see trend (e.g. causality 30% → 50%) without re-running a full review.

### 8.4 Critique: push away from last failure explicitly

- **Current:** Critique uses last intention and asks "what will you try differently?"  
- **Improve:** Add last cycle **notes** (failure mode) to the critique prompt: "Last time you were told: [notes]. In one sentence, what will you try that explicitly avoids that?" So the next experiment is phrased as "avoid X" not just "try Y."

### 8.5 Consolidation habit (process, not code)

- **Current:** Two refinements approved. Tactical learning keeps accumulating in journal/experiments.  
- **Improve:** Every 1–2 weeks: scan last 5–10 journal entries + nextExperiments; if a theme repeats 3+ times, propose one line for moltbook-pending-proposal.txt and /aim approve. Use PIKO_LEARNING_CONSOLIDATION_CHECKLIST.md.  
  This is the main lever for **durable** learning.

### 8.6 Phase C: constraint compiler (future)

- **Idea:** Turn journal "What I'll try next" + last failure notes into a small set of MUST/MUST NOT lines via a dedicated LLM call or template, instead of inline string building.  
- **Benefit:** More consistent, readable constraints; could support "for the next K posts" rules.  
- **Cost:** Extra latency and complexity; only worth it if the current constraint block still underperforms after 8.1 and 8.4.

### 8.7 Self-eval: structured output (optional)

- **Current:** Two lines (Yes/No + explanation); we infer followedPlan and fix contradictions with a regex on notes.  
- **Improve:** Ask for one-line JSON: `{"followedPlan": true|false, "explanation": "..."}`. More reliable parsing; no need for negative-marker heuristic.  
  Low priority unless you see more contradictory Yes+notes.

### 8.8 Engagement as explicit signal (optional)

- **Current:** Engagement (upvotes, comments) is in state and in the journal prompt as text. The model infers "what worked" from that.  
- **Improve:** If you ever want engagement to **directly** drive constraints (e.g. "post with 0 engagement last 3 times → MUST try a question this cycle"), add a small rule in the poster: when last N posts have zero engagement, inject a MUST line derived from nextExperiments or a fixed tactic.  
  Keeps learning causal without making platform engagement a "command."

---

## 9. Summary

**Full view in one sentence:**  
Piko’s learning is a single loop (observe → signal guard → reflect → critique → act → self-eval) with two layers (tactical journal/experiments vs strategic refinements), Phase A (intention vs outcome), Phase B (one-tap feedback into journal + post), and a per-cycle constraint block (MUST / MUST NOT from learning). All state is in known files; you steer with refinements and Phase B; verification is by four levels (existence, causality, accumulation, consolidation).

**Where to improve next:**  
Prioritize **8.1** (stronger causality: concrete MUST NOT from last failure, optional third structural refinement) and **8.4** (critique explicitly avoids last failure). Use **8.5** (consolidation habit) regularly. Add **8.2** (Phase B reset/decay) or **8.3** (velocity dashboard) if you want feedback to feel current or progress visible over time. Consider **8.6–8.8** only if you need more structure or engagement-driven rules later.
