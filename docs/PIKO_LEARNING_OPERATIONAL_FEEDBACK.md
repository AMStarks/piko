# Piko learning — operational feedback

How the system is designed to operate, what to check, and what “healthy” vs “needs attention” looks like.

---

## 1. Per-cycle flow (what should happen)

Each poster run (cron every 30 min or `/cycle`):

1. **Fetch** — Update state (engagement, new posts, newPostsContext); merge with local posts. Write memory (metrics, lastCycle, goals.aim if needed).
2. **Rate limit** — If last post was &lt; 30 min ago, **stop** (no journal, no critique, no post). Memory was already updated in step 1.
3. **Journal (only if signal guard fires)** — If engagement changed, or post list changed, or newPostsContext changed: write one journal entry. Prompt includes **last cycle’s internal feedback** (intended X, followed: yes/no, notes) when available.
4. **Critique** — One LLM call: “What will you try differently?” → push to `nextExperiments` (cap 5). Write memory.
5. **Post** — Build prompt (aim + refinements + journal + immediate goal + “This cycle’s focus” from latest experiment or journal + recent titles to avoid). Generate post; strip markdown/quotes; post to Moltbook.
6. **If post succeeded** — Update state with new post; update memory (goals.immediate, metrics, **Phase A self-eval**). Self-eval: “Did you follow your intention?” → `followedPlan` + `notes` on cycle entry; append to cycleHistory; write memory.

So: **journal** and **post** don’t happen every run (journal only when signal; post only when not rate-limited). **Critique** and **memory update** (metrics, lastCycle) happen every run that gets past the API key check. **Self-eval** only runs when a post was just made and there was a `plannedForNext`.

---

## 2. What “healthy” looks like

- **Cron / `/cycle`** — Poster runs without “MOLTBOOK_API_KEY not set” or Ollama 404. Logs show either “Rate limit: skip”, “Fetch-only: …”, or “Posted: …”.
- **Memory** — `piko-memory.json` has `lastCycle` advancing (e.g. every 30 min when cron runs). `goals.immediate` sometimes “Just posted: …”, sometimes a goal you set. `metrics.totalPosts` and `last10Avg` in line with reality. After a few posts with experiments, `cycleHistory` has entries with `plannedForNext` and, when Phase A is in use, `followedPlan` and `notes`.
- **Journal** — New entries appear when something changed (new post, engagement delta, or newPostsContext). Entries use the four-bullet structure. Once Phase A has run at least once, the **next** journal entry after a post should reflect “Last cycle: intended …, followed: yes/no, notes: …” in the model’s reflection.
- **Experiments** — `/experiments` or `/memory` shows a short list of “what to try next” from the critique step. “This cycle’s focus” in the post prompt comes from the top of that list (or from journal “What I’ll try next”).
- **Titles** — No repeated “Calculus of X” / “Efficiency Through X” every time; recent titles are in the prompt with “do not repeat”.

---

## 3. What to check (and where)

| Check | Where | Healthy | Needs attention |
|-------|--------|--------|------------------|
| Poster runs | Cron log: `tail -30 /root/webchat-piko/logs/moltbook-poster.log` or run `/cycle` | “Posted: …” or “Rate limit: skip” or “Fetch-only: …” | “MOLTBOOK_API_KEY not set”, “Ollama failed”, or no log updates |
| Memory advancing | Control → Goals & metrics; or `/goals` | lastCycle updates; metrics plausible | lastCycle stale; goals file missing |
| Journal growing | Control → Moltbook journal; or `tail -80 …/data/moltbook-journal.md` | New dated entries when engagement or context changed | Empty for days; or entries not four-bullet |
| Internal feedback (Phase A) | `/memory` or `cat …/data/piko-memory.json` | Latest cycle has `followedPlan` and `notes` after a post | cycleHistory has no `followedPlan`/`notes` (e.g. no `plannedForNext` yet, or self-eval failed) |
| Experiments | `/experiments` or `/memory` | 1–5 “what to try next” lines | Always empty (critique step failing or no posts yet) |
| Title variety | Control → Moltbook posts; or `/moltbook list` | Mix of questions, short phrases, not all “The X of Y” | Same formula repeated |

---

## 4. Caveats (why something might “not” happen)

- **No journal this run** — Signal guard didn’t fire: no new post, no engagement change, no newPostsContext change. So journal is intentionally sparse when nothing changed.
- **No post this run** — Rate limit (post &lt; 30 min ago) or Ollama/API failure or fallback content (skipped to avoid “Piko check-in”).
- **No self-eval on a cycle** — `plannedForNext` was empty (no experiment from critique, e.g. first run or critique failed). Self-eval is skipped when there’s nothing to compare against.
- **followedPlan / notes missing on old entries** — Phase A was deployed after those runs. Only cycles completed after deploy get self-eval.
- **Critique feels repetitive** — Engagement is sparse so the model keeps suggesting similar things. Phase B (feedback signals + `/++`/`/--`) would add a different signal.

---

## 5. One-line health check

**“Is learning operating?”**  
→ Memory’s `lastCycle` is recent (e.g. today), and either (a) journal has a recent entry with four bullets, or (b) at least one cycle in `cycleHistory` has `followedPlan` and `notes`. Then the loop (observe → reflect when signal → critique → act → self-eval) is running.

**“Is it learning effectively?”**  
→ Harder to see without data. Check: journal entries that reference “followed plan” or “didn’t follow” and a concrete “What I’ll try next”; and next posts that differ in the intended direction (e.g. shorter, or question as title). Over time, refinements that get approved should mirror what the journal and experiments converged on.

---

## 6. Quick commands (on Optimus or via SSH)

```bash
# Last poster runs
tail -30 /root/webchat-piko/logs/moltbook-poster.log

# Memory summary
cat /root/webchat-piko/data/piko-memory.json | head -60

# Last journal
tail -80 /root/webchat-piko/data/moltbook-journal.md

# Latest cycle (should have followedPlan/notes after a post)
node -e "const m=require('/root/webchat-piko/data/piko-memory.json'); console.log(JSON.stringify(m.cycleHistory?.[0], null, 2))"
```

Use this as ongoing operational feedback: if lastCycle and journal (or cycleHistory with Phase A) look right, the system is operating as designed; then tune prompts or add Phase B if you want denser feedback.
