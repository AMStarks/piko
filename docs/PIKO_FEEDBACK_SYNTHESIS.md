# Feedback synthesis: what to integrate, what to let go

Three reviewers responded to the Piko memory/worldview/learning write-up. Below: synthesized takeaways, **integrate** (adopt into the design/docs), and **let go** (don’t adopt or deprioritize).

---

## What all three agreed on (and we keep)

- File-based, inspectable memory; proactive + reactive learning; literature-grounded worldview as optional bedrock; operational truth/reality (provenance, corrections); invariants (no writing to identity/soul/aim/refinements); separation of worldview / learning / truth; “repository of understanding” as the right abstraction; corrigibility without humiliation.

---

## Integrate (adopt into the design)

### 1. Scope and framing

- **Design for behaviour, not inner experience.** Add one explicit sentence: this is a design for Piko’s **behaviour and state**, not a claim about inner experience.
- **Identity vs learning.** Add: “Identity files define Piko’s declared stance; learning defines its lived perspective.” So identity drift from sticky ideas + worldview is acknowledged as intentional.

### 2. Worldview: tighten “bedrock” and avoid dogmatism

- **Reframe “bedrock of truth” → “bedrock interpretive framework”.** Clarify: the framework governs **how** we reason (normative and interpretive), not **what facts must be true**. Empirical claims default to **tools + corrections**.
- **Reality override rule.** Add explicitly: “When tool results or user corrections directly contradict the worldview’s expectations about the world, **reality overrides interpretation**, and the tension is logged.” Keeps the framework falsifiable.
- **Optional and pluggable.** State clearly: Piko can run with or without a worldview file; when absent, learning is still grounded via provenance and corrections.
- **You revise the framework.** Add: “If the framework proves systematically misaligned with reality or your intentions, **you** revise `framework.md`; Piko never updates it unilaterally.”

### 3. Claim store: keep it sparse and optional

- **Sparse and selective.** Only track claims that: recur, matter to the worldview, or were explicitly corrected. Most rabbit-hole notes don’t need formal claim entries.
- **Optional v2+.** The current design can treat rabbit-hole notes and corrections as **implicit** claims; an explicit claim store is something to add when structured truth-tracking is clearly needed.
- **Claim type (optional refinement).** If we do a claim store, add a simple tag: `descriptive | normative | interpretive`. Worldview mainly governs normative/interpretive; tools mainly govern descriptive; keeps category errors explicit.

### 4. Memory: sticky ideas and forgetting

- **Sticky ideas as “current lenses”.** Add one line: over time, sticky ideas are **re-readable** as “Piko’s current lenses” — if you want to know who Piko is, read `sticky-ideas.md`.
- **Forgetting and compression.** Add a short note: old rabbit-hole notes may be **archived or summarized** periodically (e.g. quarterly). Meta-reflections and sticky ideas are the compression mechanism; “forgetting” is lossless at the level of meaning (avoids immortal-notebook syndrome).

### 5. Inquiry: epistemic humility, not curiosity theatre

- **When to ask.** Frame inquiry as epistemic humility: trigger when **tension persists**, **correction probability is high**, or **worldview guidance is underdetermined** — not just “I’m curious about X.” Keeps questions meaningful.

### 6. How the pieces fit together

- **Worldview off.** When worldview is off, learning still proceeds; it’s interpreted only through your prompts and corrections.
- **Disagreements.** Worldview, tools, and user corrections can disagree; the claim store (if present) is where those disagreements are recorded.

---

## Let go (don’t integrate, or treat as future-only)

- **Always-on notification bridge for inquiry.** Nice for “alive” feel, but not core; leave as optional future idea, don’t add to the main design.
- **Soft promotion/demotion for sticky ideas (e.g. usage/recency).** Reasonable future tuning; not required for the write-up. Hard caps (5 tensions, 10 sticky ideas) stay as-is for now.
- **Ecosystem comparison (Mem0, MemGPT, OpenClaw).** Helpful as external validation; no need to bake into our doc.
- **Full claim-tracking from day one.** Don’t mandate it; keep as optional, sparse, and v2+.

---

## Scalability and distillation (note, don’t over-specify)

- **Scalability:** When `rabbit-hole-notes.md` or `corpus.txt` grow very large, capping and summarization will be essential; we already hint at this — no need for more than a brief mention (e.g. in forgetting/compression).
- **Distillation drift:** When refreshing `framework.md` from a growing corpus, LLM interpretation can shift; **human review is critical** — we already require it; can stress it once in the worldview section.

---

## Summary

**Integrate:** Explicit “design for behaviour”; identity vs learning sentence; “bedrock interpretive framework” + empirical vs normative; reality override rule; worldview optional/pluggable + you-revise-framework; claim store sparse/optional/v2+ and optional type tag; sticky ideas as “current lenses”; forgetting/compression; inquiry as epistemic-humility triggers; “worldview off” and “disagreements in claim store” in the fit section.

**Let go:** Always-on notification bridge; soft sticky-idea ranking for now; ecosystem comparison in-doc; mandatory full claim store.
