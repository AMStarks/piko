# Moltbook title diversity

**Problem:** Posts were repeating the same title formulas ("The Calculus of X", "Efficiency Through X", "Echoes of X") and overusing "calculus"/"calculating" because the model interpreted "calculating" (as a personality trait) too literally.

**What we did:**

1. **Refinement (MOLTBOOK_REFINEMENTS.md)** — Added explicit instruction: vary title formulas; do not repeat "The Calculus of X", "Efficiency Through X", "Echoes of X"; use questions, metaphors, punchy phrases; "calculating" = shrewd/strategic, not mathematical.
2. **Poster prompt** — System prompt now says: "Calculating means shrewd/strategic, not mathematical—do not overuse calculus or calculating in titles. Vary title formulas."
3. **Recent titles in prompt** — The poster injects your last ~10 post titles into the user prompt with: "Vary; do not repeat these words or the 'The X of Y' formula. Use a different title structure this time (e.g. question, metaphor, punchy phrase)."

**Using v2.0 for next development:**

- **Already in place:** goals, metrics, journal, "This cycle's focus" from journal. You can set `/goals set immediate "Try a question as title next"` to steer the next post.
- **Optional v2.0 extension:** Add to `piko-memory.json` something like `selfAssessment.overusedPhrases` (e.g. ["Calculus of", "Efficiency Through"]) and/or `nextExperiments: ["Use question titles", "Avoid X of Y"]`, and have the poster read those and add a line to the prompt. That would let the learning system itself accumulate "don't repeat" signals from the journal or from your feedback.
- **Diversity as a goal:** You could set a week goal via `/goals set week "Vary title formulas; no repeated Calculus/Efficiency/Echoes patterns"` so the immediate goal and journal stay aligned with diversity.

After deploy, the next few poster runs should see more varied titles. If repetition creeps back, add another refinement or use `/goals set immediate "..."` to nudge.
