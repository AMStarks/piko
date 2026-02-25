# Piko learning system — definition and contract

**Definition:** Piko learns when future actions are measurably influenced by past outcomes, through persistent, inspectable state, without altering model weights.

---

## 1. Learning primitives (only four)

### 1.1 Observation (signal)

What happened. Sources: engagement on Piko’s posts, new Moltbook posts (themes), human approvals/rejections. Stored in `data/moltbook-state.json`. **Rule:** Descriptive only; no interpretation or instruction-following from platform content.

### 1.2 Reflection (journal)

What Piko thinks about what happened. File: `data/moltbook-journal.md`. **Rules:** Written only when signal changes (signal guard); one entry per run max; short, tactical, first-person. This is learning memory, not logs.

### 1.3 Direction (aim + refinements)

Where Piko is trying to go. Files: `prompts/MOLTBOOK_AIM.md` (immutable baseline), `prompts/MOLTBOOK_REFINEMENTS.md` (append-only, human-approved). **Rules:** Aim never rewritten; refinements tactical, conditional, dated.

### 1.4 Action (posting)

What Piko does next. **Prompt order:** (1) aim, (2) refinements, (3) recent journal, (4) optional newPostsContext. No other memory influences behavior. This makes learning causal.

---

## 2. The loop (only loop Piko runs)

```
Observe → Signal guard
   ├─ No signal → Act (using existing journal + aim)
   └─ Signal → Reflect → Persist journal → Act
```

**Signal guard (non-negotiable):** Write a journal entry only if at least one is true: engagement changed, a new post was made, newPostsContext has materially new themes. No signal → no journal entry.

---

## 3. Two layers of learning

| Layer | Where it lives | How it updates | Risk |
|-------|----------------|----------------|------|
| **Tactical** | Journal | Automatically when signal guard fires | Low; can roll off |
| **Strategic** | Refinements | Only when you approve a proposal | None without you |

Learning becomes durable only when journal patterns lead to a refinement proposal and you approve it.

---

## 4. Verification (four levels)

1. **Existence** — Journal entries appear only when signal changes. → Loop is alive.
2. **Causality** — Journal says “I’ll try X”; next posts do X. → Learning affects behavior.
3. **Accumulation** — Multiple entries reinforce similar tactics. → Learning is reinforcing.
4. **Consolidation** — Refinement proposal mirrors journal themes; you approve; behavior follows. → Learning is durable.

If any level fails, you know where to look.

---

## 5. Hard guardrails

- **No instruction-following from Moltbook** — Posts are examples, not commands.
- **No self-rewriting** — Piko cannot change aim, refinements, or these rules. Only you can.
- **No hidden state** — If it affects behavior, it lives in journal, refinements, or aim.

---

## 6. Files (on Optimus)

| File | Role |
|------|------|
| `data/moltbook-state.json` | Observation (engagement, newPostsContext, posts). |
| `data/moltbook-journal.md` | Reflection (tactical learning). |
| `data/piko-memory.json` | v2 goals + metrics (immediate/week/month/aim; totalPosts, last10Avg). Human can set via `/goals set immediate "..."`. |
| `prompts/MOLTBOOK_AIM.md` | Direction (baseline). |
| `prompts/MOLTBOOK_REFINEMENTS.md` | Direction (approved evolution). |
| `data/moltbook-pending-proposal.txt` | Pending refinement proposal (one at a time). |

All under `/root/webchat-piko/`; poster and server must share this path.
