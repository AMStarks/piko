# Control — next 5 improvements (highest impact, 1–2 days total)

**Status:** All five implemented. See below for data sources and current behaviour.

Planned order and data sources. Start with **#1 Learning Velocity Dashboard** (45min).

---

## 1. Learning Velocity Dashboard (45min) — TOP PRIORITY

**Add to `/control` main dashboard** (above Learning repo card):

```
Learning velocity (Week 8)
├── Causality: 42% (8/19 cycles followed intention)
├── Consolidation: 3 refinements active  
├── Sticky ideas: 7 total (2 new this week)
├── Tensions: 2 open (Tension #1: 14 days)
└── Phase B: 5 signals (2 tooLong, 3 clarity)
```

**Data sources** (all exist):

| Metric | Source |
|--------|--------|
| Causality | `piko-memory.json` → cycleHistory → `followedPlan` count |
| Consolidation | `MOLTBOOK_REFINEMENTS.md` → line count |
| Sticky ideas (total + new this week) | `data/learning/sticky-ideas.md` → parse items; “new this week” needs file mtime or stored timestamps |
| Tensions (count + age) | `data/learning/tensions.md` → count open; “Tension #1: 14 days” needs created/updated date (or infer from file) |
| Phase B signals | `data/moltbook-feedback.json` → signal totals (e.g. tooLong, clarity) |

**Why #1:** Instant feedback on whether interventions work.

---

## 2. Bulk Actions (1h)

**Learning page** (select multiple rows):

- ☐ ☐ ☐ **[Select all]** **[Delete selected]** **[Archive selected]** **[Export JSON]**

*Note: Archive = move to “archived” state (needs data model: archived list or flag). Delete and Export already partially done.*

**Moltbook** (upgrade existing):

- ☐ ☐ ☐ **Prune selected** → Confirm: *"Delete 3 posts from Moltbook?"*

*Already implemented; ensure copy matches.*

---

## 3. Global Search (45min)

**Top bar across all control pages:**

- 🔍 **Search learning, prompts, posts...** `[agent coordination]`

**Results:**

- **Learning (2):** "Agent coordination" sticky idea, Tension #1  
- **Moltbook (1):** "Coordination post" (Mar 2)  
- **Journal (3):** Mentions in last 7 days  

*Backend: endpoint that searches learning files, prompts (or titles), Moltbook posts, journal snippet; return grouped results. Frontend: persistent search bar, results dropdown or panel.*

---

## 4. Real-time Preview (30min)

**Learning inline edit** → live preview:

1. Content cell clicked → edit mode  
2. Below: *Piko says: "I've been thinking about agent coordination lately..."*  
3. Preview from actual chat model, ~3s latency (e.g. short prompt + sticky/tension context → one completion).

*API: e.g. `POST /api/control/learning/preview` with `{ databaseId, content }` → server injects into minimal context, calls Ollama, returns one line.*

---

## 5. Weekly Summary (20min)

**`/control` → new card:**

```
📊 This week in learning
• 3 new rabbit-hole notes
• 1 tension resolved  
• Causality: ↑5% (37→42%)
• You used Phase B: 5 signals
[View details → /control-learning/analytics]
```

*Data: compare this week vs last (rabbit-hole blocks, tension count, causality %, feedback signals). “View details” links to `/control-learning/analytics` (can be same page with analytics tab or future analytics view).*

---

## Implementation order

| When | Items | Time |
|------|--------|------|
| **Today** | 1. Learning Velocity Dashboard, 2. Weekly Summary | ~2h |
| **Tomorrow** | 3. Bulk Actions, 4. Global Search, 5. Real-time Preview | ~2h |

---

## Expected delight (post-implementation)

- Open `/control` → *"Causality 42%, 3 refinements, 2 tensions open"*
- Learning → Inline edit sticky idea → *"Piko preview: I've been thinking..."*
- Bulk delete 3 old tensions → *"Deleted 3 items"*
- Search *"coordination"* → 6 results across learning / Moltbook / journal

---

## Why this sequence

1. **Velocity dashboard** = immediate feedback loop  
2. **Weekly summary** = context for decisions  
3. **Bulk actions** = power user flow  
4. **Search** = discoverability  
5. **Preview** = confidence in edits  

**Start with #1** (45min). Quantitative learning metrics first; the rest compounds.

---

## Current state (for reference)

- **Learning velocity card** on `/control` already exists with: Causality %, Consolidation count, Sticky count, Tensions count (from earlier implementation). **Enhancement:** add “2 new this week” for stickies, “Tension #1: 14 days”, Phase B signals, and “Week N” in the header.
- **Bulk actions on Learning:** Select all/none, Delete selected already done. **Remaining:** Archive selected (needs model), Export JSON.
- **Moltbook prune:** Label already “Delete N post(s) from Moltbook” when N selected; confirm dialog exists.
- **Search:** Learning page has per-tab search/filter. **New:** global bar + backend search across learning/prompts/Moltbook/journal.
- **Weekly summary card** and **real-time preview** are new.
