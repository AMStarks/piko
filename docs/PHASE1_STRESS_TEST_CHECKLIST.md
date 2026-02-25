# Stress-test / observe checklist (2–4 weeks)

**Purpose:** Use Piko normally for 2–4 weeks and observe the belief/planner loop before doing belief-lifecycle refactor (hierarchy, compression, inertia). Phases 1–5 are already implemented.

**Rule:** No new cognition during this period. Observe only.

**Enable planner debug (optional):** `PIKO_PLANNER_DEBUG=1` to log beliefs_considered, plan, reason each turn.

---

## Five questions to answer after ~30 interactions

| # | Question | Notes |
|---|----------|--------|
| 1 | Does `challenge_level` adjust meaningfully? | Check planner logs or write_decisions / user_beliefs. |
| 2 | Does verbosity correlate with engagement? | Subjective: when you want more/less, does it track? |
| 3 | Do beliefs drift gradually or jump? | Inspect `data/memory/user_beliefs.json` and `data/memory/write_decisions.json` over time. |
| 4 | Does tone feel stable across days? | Subjective. |
| 5 | Does the system feel more coherent after ~30 interactions? | Subjective. |

If **yes** to most → architecture is sound; proceed to belief-lifecycle work (see `docs/PIKO_FEEDBACK_SYNTHESIS_AND_RECOMMENDATIONS.md`).  
If **no** → tune (thresholds, behaviour signals, planner) before refactoring.

---

## Completion

- [ ] 2–4 weeks of normal use (no feature expansion)
- [ ] Five questions answered
- [ ] Ready to consider B1 (belief hierarchy), B2 (compression), B3 (inertia) from the synthesis doc
