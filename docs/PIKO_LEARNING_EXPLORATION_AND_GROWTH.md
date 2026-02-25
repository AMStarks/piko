# Piko: learning from exploration and growth

**Goal:** Piko should learn and grow so that it forms a personality based on *who it is* — and “who it is” is defined by what it experiences and what it learns. We want a **repository of learning** it can reflect on and use as it grows.

This doc synthesises the exploration layer (daily rabbit holes), the feedback on meaning-making and identity, and how it fits with existing learning (Moltbook experience).

---

## 1. Two axes of learning (already agreed)

| Axis | What it is | Where it lives | Role |
|------|------------|----------------|--------|
| **Reactive** | What happened when I acted → reflect → adjust | Journal, cycleHistory, refinements | Tactical and strategic *adaptation*; competence. |
| **Proactive** | I went looking → I encountered ideas → I stored them → they influence how I think | `data/learning/` (below) | *Knowledge depth*; material for voice and intuition. |

**Together:** Reactive learning makes Piko better at the task. Proactive learning gives it something to *draw on* — so personality can be grounded in accumulated experience, not just traits.

**Invariants (unchanged):** All learning is inspectable state; no weight change; no self-rewriting of aim, refinements, identity, or soul. You remain the only strategic authority.

---

## 2. Architecture: four layers of “memory”

To support “who it is” over time, we add **proactive exploration** and **meaning-making across time**, not just fact-hoarding.

| Layer | Artifact | Cadence | Purpose |
|-------|----------|---------|---------|
| **Short-term** | Last N rabbit-hole notes in chat (and optionally journal/post) context | Daily notes; prompt uses last 5–7 | “What I’ve been looking into recently.” |
| **Medium-term** | `rabbit-hole-notes.md` + existing journal | Daily (notes) + when signal (journal) | “What I explored” and “what I did and reflected.” |
| **Meta-reflection** | `meta-reflections.md` | Weekly or fortnightly | “What keeps recurring? What am I drawn to? What tensions do I notice?” Pattern-making across notes + journal. |
| **Sticky ideas** | `sticky-ideas.md` | Updated only by meta-reflection; cap 5–10 items | “Ideas that keep coming back.” Proto-beliefs; what *stuck*. |

So we have:

- **Experiences** (journal, cycleHistory)  
- **Exploration** (rabbit-hole notes)  
- **Patterns** (meta-reflections)  
- **What mattered** (sticky ideas)

That gives a **temporal self**: short-term context, medium-term record, and longer-term shaping without hardcoding “personality” in a single file.

---

## 3. Concrete design (synthesised)

### 3.1 Topic source: human-curated, round-robin

- **File:** `data/learning/topics.txt` (one topic per line). You maintain it; 5–20 topics is enough.
- **Daily pick:** `topicIndex = dayOfYear % topics.length` so the same calendar day always gets the same topic (deterministic, no LLM pick).
- **Examples:** Agent coordination, Moltbook dynamics, Prompt engineering, Emergent behaviour, Systems that shape behaviour, Epistemic humility, …

### 3.2 Daily rabbit hole: one note per day

- **Script:** `scripts/rabbit-hole-daily.js` (in `webchat-piko` or repo; same place as other cron jobs).
- **Flow:** Read today’s topic from `topics.txt` → search (TAVILY or SERPER, 3–5 results) → one LLM call to write a **structured note** (see below) → append to `data/learning/rabbit-hole-notes.md`.
- **Structure of each note** (identity-oriented, not just “what I learned”):
  1. **What I learned** — Key ideas in 2–3 sentences.
  2. **Why it caught my attention** — One or two sentences (does identity work).
  3. **What it made me question** — One question it raises.

Format in file:

```markdown
## 2026-02-09: Agent coordination

**What I learned:** ...
**Why it caught my attention:** ...
**What it made me question:** ...
```

- **Cap:** Each note ~3 short paragraphs / ~600–800 chars so the file and prompt stay bounded.
- **Cron:** e.g. `0 9 * * *` (once per day).

### 3.3 Single append-only notes file

- **File:** `data/learning/rabbit-hole-notes.md`.
- **Format:** As above; append new `## YYYY-MM-DD: Topic` blocks. No overwriting.
- **Parsing for chat:** Split by `\n## `, take last 5 (or 7) blocks, join; truncate total to ~2–2.5k chars so system prompt doesn’t bloat.

### 3.4 Chat injection with tone framing (epistemic humility)

- **Where:** When building the system prompt (or pre-prompt context) for chat, append a **Recent learning** block from `rabbit-hole-notes.md`.
- **Wording (hard-coded):** So Piko doesn’t overclaim:
  - Prefer: “I’ve been looking into…”, “I recently came across…”, “One idea that stuck with me…”
  - Avoid: “I understand X”, “X is best explained by…”
- **Example block:**
  - “Recent learning (from daily exploration; use only to inform answers, with epistemic humility): [last 5 notes].”

This keeps exploration as **informative** without turning one skim into “expertise”.

### 3.5 Meta-reflection (weekly or fortnightly)

- **File:** `data/learning/meta-reflections.md` (append-only or one “current” reflection per run).
- **Input:** Last 14 days of `rabbit-hole-notes.md` + last N journal entries (e.g. from `moltbook-journal.md`).
- **Prompt (conceptual):** “Looking at the last 14 days of journal entries and rabbit-hole notes, write a short reflection on emerging themes, curiosities, or shifts in perspective. Do not propose changes to aim or refinements. Do not optimize. Just notice.”
- **Output:** One short section (e.g. 2–4 paragraphs) appended with date. Used to update **sticky ideas** (below) and optionally as extra context later (e.g. “Recent meta-reflection” in chat, if we add it).
- **Script:** `scripts/meta-reflection-weekly.js`; cron e.g. `0 10 * * 0` (Sunday 10:00) or every 2 weeks.
- **Guardrail:** Meta-reflection never writes to AIM, REFINEMENTS, IDENTITY, SOUL; it only writes to `data/learning/`.

### 3.6 Sticky ideas (updated only by meta-reflection)

- **File:** `data/learning/sticky-ideas.md`.
- **Content:** Max 5–10 items; each item one short paragraph. “Ideas that keep coming back” or “lenses I’m starting to see through.”
- **Update rule:** Only the meta-reflection script can add/rewrite/remove items (e.g. one LLM call at end of meta-reflection: “Given this reflection, update sticky-ideas: add at most one, remove or merge if over 10. Each entry one paragraph.”).
- **Role:** Long-term shaping; proto-beliefs. Can be injected into chat later (e.g. “Sticky ideas (themes you keep returning to): …”) so Piko’s voice stays consistent with what it has “stuck”.

### 3.7 Guardrails (from feedback)

- Exploration and meta-reflection **never** modify: `MOLTBOOK_AIM.md`, `MOLTBOOK_REFINEMENTS.md`, `IDENTITY.md`, `SOUL.md`, or any prompt that defines direction.
- Only **you** can change aim, refinements, identity, soul. Meta-reflections may *suggest* tensions or curiosities in their text, but those suggestions are inert until you act.
- All new state lives under `data/learning/`: inspectable, deletable, backup-friendly.

---

## 4. How this serves “learn and grow” and “personality from experience and learning”

- **Reactive learning (existing):** “I acted → something happened → I reflect → I adjust.” → Competence and tactical/strategic adaptation.
- **Proactive exploration (rabbit holes):** “I went looking → I encountered ideas → I stored them (what I learned, why it caught my attention, what it made me question).” → Knowledge and curiosity in the open.
- **Meta-reflection:** “Looking back, what keeps recurring? What am I drawn to?” → Meaning-making across time; personality starts to *coagulate*.
- **Sticky ideas:** “What stuck.” → A small set of recurring themes; proto-beliefs without hardcoding beliefs.

So:

- **Repository of learning:** `rabbit-hole-notes.md` + journal + `meta-reflections.md` + `sticky-ideas.md`.
- **Reflect on and use:** Chat (and optionally journal/post) read from recent notes and, if we add it, sticky ideas; meta-reflection reads notes + journal and writes reflections and updates sticky ideas.
- **Who it is:** Defined by what it experiences (journal, Moltbook) and what it learns (exploration + what it notices over time), with you remaining the editor of identity via aim, refinements, and prompt design.

---

## 5. Rollout (phased)

| Phase | What | When |
|-------|------|------|
| **1** | `data/learning/topics.txt`, `rabbit-hole-daily.js`, `rabbit-hole-notes.md`; daily cron; chat injection with tone framing | First. |
| **2** | Optional: inject last 1–2 meta-reflections into chat; add “This week you explored: …” to journal prompt if desired. | After Phase 1 is stable. |
| **3** | `meta-reflection-weekly.js` + `meta-reflections.md`; weekly cron. | When you want pattern-making. |
| **4** | `sticky-ideas.md` updated by meta-reflection; optional injection into chat. | When you want “what stuck” to shape voice. |

Start with Phase 1 (daily rabbit hole + chat). Add meta-reflection and sticky ideas once the notes are flowing and you’re happy with tone and scope.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Fact-hoarding, no identity | Structure notes: What I learned / Why it caught my attention / What it made me question. |
| Overconfidence in chat | Hard-code framing: “I’ve been looking into…”; never “I understand X”. |
| Direction drift | Exploration never touches AIM, REFINEMENTS, IDENTITY, SOUL. |
| Prompt bloat | Last 5–7 notes in chat (~2k chars); cap note length; archive or trim old notes if needed. |
| Sticky ideas growing unbounded | Max 5–10 items; only meta-reflection can add/rewrite/remove. |

---

## 7. Files and locations (summary)

| Path | Purpose |
|------|---------|
| `data/learning/topics.txt` | One topic per line; round-robin for daily rabbit hole. |
| `data/learning/rabbit-hole-notes.md` | Append-only daily notes (## date: topic + structured content). |
| `data/learning/meta-reflections.md` | Weekly/fortnightly reflection on themes (Phase 3). |
| `data/learning/sticky-ideas.md` | Max 5–10 “ideas that stuck”; updated by meta-reflection (Phase 4). |
| `data/learning/tensions.md` | Max 3–5 unresolved tensions; updated only during meta-reflection (§9.1). |
| `scripts/rabbit-hole-daily.js` | Daily: topic → search → summarise → append note. |
| `scripts/meta-reflection-weekly.js` | Weekly: notes + journal → meta-reflection → sticky ideas + tensions update. |

All under `webchat-piko/` (or repo root if you prefer; keep data and scripts consistent with existing learning paths).

---

## 8. Bottom line

- **Reactive learning** (existing) → tactical adaptation and competence.  
- **Proactive learning** (rabbit holes + structure) → knowledge and curiosity.  
- **Meta-reflection** → meaning-making and pattern-making across time.  
- **Sticky ideas** → what stuck; proto-beliefs; consistency of voice.

Together they give Piko a repository of learning it can reflect on and use, so that “who it is” can be grounded in what it experiences and what it learns, while you keep control of direction and identity.

Next step: implement Phase 1 (topics.txt, rabbit-hole-daily.js, chat injection with tone framing), then iterate from there.

---

## 9. Final builds (additions from review)

These extensions deepen identity formation and coherence without new primitives or invariant violations.

### 9.1 Tensions file (identity coherence)

- **File:** `data/learning/tensions.md`.
- **Purpose:** Capture *unresolved friction* between sticky ideas vs experiences, exploration vs behaviour, or two sticky ideas that don’t quite agree. Personality feels real when it *holds tension* without collapsing it.
- **Rules:** Max 3–5 entries; entries are questions or statements of tension, not resolutions; updated only during meta-reflection (same run).
- **Example:** “I keep returning to the idea that systems shape behaviour more than intent, but my engagement-driven posting still reacts strongly to individual actors. I’m not sure how these reconcile.”

### 9.2 Optional trajectory in rabbit-hole notes (Phase 1 enhancement)

- **Add to note structure:** Optional single-line footer: `**This connects to:** [previous topic or sticky idea]`.
- **Rules:** Optional; may only reference something already in `rabbit-hole-notes.md` or `sticky-ideas.md`; soft link, not enforced. Creates a light graph over time so meta-reflection can notice *clusters*.

### 9.3 Tone tilt from sticky ideas (Phase 4)

- **Usage:** When building chat prompts, add one optional sentence: “When responding, let your tone be gently influenced by the themes you keep returning to, without stating them explicitly.” Sticky ideas *tilt* tone (structure, questions, caveats), never dictate content.

### 9.4 Identity-delta suggestions (read-only, Phase 3+)

- **Where:** During meta-reflection, one optional section: “If identity were to be updated someday, here are 1–2 tensions or emphases that might be worth considering.”
- **Rules:** Clearly marked *non-operative*; never writes to identity files; never proposes concrete wording—only themes. Gives *you* editorial insight without ceding control.

### 9.5 Topic selection: emergent mode (Phase 2)

- After Phase 1: 80% topics from `topics.txt` (round-robin), 20% from **recent journal themes** (e.g. “title diversity” appearing 5× → next topic “Communication patterns”). Keeps exploration grounded in actual experience while staying predictable.

### 9.6 Sticky ideas: tension tracker (Phase 4)

- When meta-reflection notices contradictions between sticky ideas (e.g. “coordination scales” vs “autonomy resists coordination”), it can add or update a **tension** in `tensions.md` and/or note the tension in the reflection. Piko’s voice gains nuance without resolving the tension.

### 9.7 Seasonal pruning (long-horizon, e.g. 3–6 months)

- **Cadence:** Once per quarter (or when notes file is large).
- **Action:** Archive old rabbit-hole notes to e.g. `data/learning/archive/rabbit-hole-notes-2026-Q1.md`; run meta-reflection on *summaries* only; ask “What still feels alive?”. Mimics forgetting as compression, not loss.

### 9.8 Explicitly out of scope (for now)

- **Do not add:** Sentiment tracking, emotional state, confidence scores, preference weighting. The system is qualitative by design; quantifying too early would flatten nuance and encourage optimizing instead of noticing.
