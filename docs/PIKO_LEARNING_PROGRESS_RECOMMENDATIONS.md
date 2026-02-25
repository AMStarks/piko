# Piko learning — progress recommendations

Synthesis of the full review and two external commentaries, plus concrete next steps (some already implemented).

---

## 1. Shared verdict

- **Learning substrate is sound.** Don’t change the architecture; tune the inputs.
- **Existence and accumulation are strong.** Loop, Phase A, journal, and consolidation are working and measurable.
- **Causality is weak but real.** Forbidden phrases dropped from recent titles; refinement + journal do influence behavior. The bottleneck is **generative inertia**: the model falls back to a stylistic attractor (“Beneath/Beyond/Fracturing X”) even when it “intends” something else.
- **Insight:** *“The brain works. The muscles need better commands.”* Learning is advisory; generation needs **binding constraints** for the current cycle, not only reflection.

---

## 2. What’s already implemented (this pass)

### 2.1 Cycle Constraint Block (learning → binding)

The poster now builds a **Constraints for this post (binding)** block from:

- **MUST:** Top of `nextExperiments` (or journal “What I’ll try next”) — e.g. “You MUST this cycle: Try a question as title.”
- **MUST NOT:** Last cycle’s failure when `followedPlan === false` — e.g. “You MUST NOT repeat last cycle’s failure: relied on sci-fi buzzwords.”

This is **ephemeral** (one cycle), **derived from learning**, and does not rewrite aim or refinements. It turns learning from advisory into a direct command for this post.

### 2.2 Self-eval consistency

If the model says “Yes” but the explanation contains negative markers (*didn’t*, *failed to*, *instead*, *not actually*, *still used*, *relied on*, etc.), we now set `followedPlan = false` and trust the explanation. That removes the contradiction (e.g. “followedPlan: true” with “I still used lengthy sentences”).

### 2.3 Phase B in the post prompt

Human feedback signals are now injected into the **post** prompt as well as the journal. Example:

`Human feedback (apply this cycle): tooLong 2 → Keep body short (under 120 words). goodQuestions 1 → Use a question as the title.`

So `/-- tooLong` and `/++ goodQuestions` give the generator **immediate, binary** instructions for this cycle, not only a journal nudge next time.

---

## 3. What you should do next (prioritized)

### 3.1 Deploy to Optimus (immediate)

Deploy the current `webchat-piko` (poster + server) so Optimus gets:

- Cycle Constraint Block  
- Self-eval consistency fix  
- Phase B in post prompt  
- Last-run file and feedback signals (if not already there)

Then restart the service. No config change required.

### 3.2 Use Phase B aggressively (first 48 hours)

After deploy, use one-tap feedback so the generator gets direct constraints:

- `/-- tooLong` when a post is too long → next post prompt gets “Keep body short.”
- `/++ goodQuestions` when you want more questions → “Use a question as the title.”
- `/-- tooAbstract` → “Use a concrete claim or example.”

This shortens the feedback loop from “next journal in 30 min” to “next post.”

### 3.3 Approve a second, structural refinement (this week)

The first refinement (title variety, avoid “Calculus of X”) worked partially. Add a **structural** one that is auditable and hard to wiggle around, e.g.:

- *“At least one in three titles must be a direct question.”*
- Or: *“No prepositions ‘of’, ‘beyond’, ‘beneath’ in the next 10 post titles.”*

Propose it (e.g. in `moltbook-pending-proposal.txt` or via your proposal script), then `/aim approve`. That gives the poster a durable rule, not just a cycle-level constraint.

### 3.4 Track learning velocity (optional)

Use the four levels as a simple dashboard:

- **Week 1 (baseline):** Existence PASS, Causality ~30%, Accumulation PASS, Consolidation 1 refinement.  
- **Week 2 (target):** Causality 50–60%, Consolidation 2 refinements, titles show questions or concrete claims.  
- **Week 3+:** Phase B counts in journal; cycle constraints visibly reflected in titles.

You can log these in a short weekly note or a small “learning maturity” checklist (see below).

---

## 4. What we’re *not* doing (by design)

- **No v2.0 architecture change.** Same loop; we’re only making constraints and feedback stronger.
- **No “100% obedience” goal.** 30–50% alignment with intention is realistic for in-context learning; perfect obedience would be suspicious. Target is “clearly better than baseline,” not “every post obeys exactly.”
- **No rationalizing self-eval.** The fact that Piko sometimes says “Yes” and then undermines it in the notes is healthy; we fixed the *parsing* so the data is consistent, but we didn’t soften the critique.

---

## 5. Learning maturity checklist (when is this “autonomous enough”?)

Use this as a lightweight gate for “learning is production-grade”:

- [ ] **Existence** — Last run file and cycleHistory show the loop running every 30 min when cron fires.
- [ ] **Causality** — At least one third of cycles have `followedPlan === true` *or* titles clearly match “This cycle’s focus” (e.g. question when focus was “try question”).
- [ ] **Accumulation** — Journal and experiments show repeated themes; Phase A notes feed into the next journal.
- [ ] **Consolidation** — At least 2 refinements approved; recent posts respect them (e.g. no forbidden phrases, some questions).
- [ ] **Feedback density** — Phase B used at least a few times; journal or post prompt shows “Human feedback” and next post responds (e.g. shorter when tooLong, question when goodQuestions).

When all are checked, you have **measurable, durable, human-steered learning** without changing the architecture. After that, any further gain is from more refinements, more Phase B use, or model/prompt tuning—not from redesigning the loop.

---

## 6. Summary

| Priority | Action | Status |
|----------|--------|--------|
| 1 | Deploy poster + server (constraint block, self-eval fix, Phase B in post) | Ready to deploy |
| 2 | Use Phase B (/-- tooLong, /++ goodQuestions) after deploy | Your action |
| 3 | Propose and approve second refinement (structural, auditable) | Your action |
| 4 | Track four levels weekly; aim for Causality 50–60%, 2 refinements | Optional |

**Bottom line:** Piko is learning at an expected rate for in-context systems. The new changes (Cycle Constraint Block, self-eval fix, Phase B in post) are designed to **strengthen the commands to the generator** so that learning doesn’t just accumulate—it binds. Deploy, use Phase B, add one structural refinement, and re-run the full review in 1–2 weeks to see if causality and title diversity improve.
