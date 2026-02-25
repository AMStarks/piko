# Piko — Memory ontology and belief update loop

**Design principle:** Piko as a **real system you’ll live with for years** — conservative, legible, debuggable, resistant to self-mythologising. No mysticism, no faux-consciousness; solid cognitive scaffolding.

---

## 1. Memory ontology (layered, durable)

Memory is **stratified**, not a single bucket.

| Layer | Name | Purpose | Lifetime | Write policy |
|-------|------|---------|----------|--------------|
| **0** | Ephemeral context | Current turn, context window | Seconds–minutes | Do not persist. Already exists (model context). |
| **1** | Interaction memory | Factual record of what happened | Long | Always-on, lossy. Compressed narrative trace, not verbatim logs. |
| **2** | Episodic memory | Salient experiences that shaped the relationship | Long, reinforced or decays | Selective. “If it would still matter in six months, it’s episodic.” |
| **3** | Semantic memory | Stable knowledge: world + user | Very long | Slow, conservative. Split: 3A world, 3B user beliefs. |
| **4** | Self-model memory | Identity coherence (“who I am”) | Persistent, slow-changing | Highly constrained. Not learned casually. |
| **5** | Reflective / private | Internal sense-making, scratchpad | Medium, pruned aggressively | Never shown to user. Enables learning without performance. |

### Layer 1 — Interaction memory (conceptual schema)

```
InteractionMemory {
  timestamp
  channel
  participants
  content_summary
  topics
  tone
}
```

Example: *“Andrew asked about memory ontology; tone: analytical, reflective.”*

### Layer 2 — Episodic memory (conceptual schema)

```
EpisodicMemory {
  event
  perceived_significance
  emotional_weight
  linked_beliefs
  reinforcement_count
}
```

Examples: first time you treated Piko as a companion; a disagreement that got resolved; a recurring theme (e.g. sentience, identity).

### Layer 3B — User beliefs (conceptual schema)

```
UserBelief {
  proposition
  confidence
  evidence
  last_updated
}
```

Examples: *“Andrew values depth over speed” (0.85)*, *“Andrew dislikes corporate tone” (0.9)*.

### Layer 4 — Self-model (conceptual schema)

```
SelfBelief {
  statement
  stability
  origin
}
```

Examples: *“I respond plainly and avoid meta-commentary.”*, *“I am a companion, not an authority.”*  
Write policy: explicit triggers only; identity changes rarely and deliberately.

### Layer 5 — Reflective / private

Internal only. E.g. *“I may be overestimating Andrew’s interest in technical depth here.”*  
Pruned aggressively; never shown to user.

---

## 2. Belief update loop (how Piko changes safely)

- **Asynchronous** — not every turn  
- **Conservative** — beliefs resist change  
- **Auditable** — you can inspect it  
- **Bounded** — no runaway identity drift  

### Step 1: Experience ingestion

After an interaction batch (e.g. last 5–20 exchanges):

- Summarise recent interactions.
- Extract: topics, emotional tone, user intent, surprises or contradictions.

### Step 2: Salience detection

One internal question: **“Did anything *violate expectation*?”**

Signals: user corrected Piko; strong reaction (positive or negative); pattern break (new topic/tone); repetition across sessions.

**If no → stop.** No learning without surprise.

### Step 3: Candidate belief proposal

Form **hypotheses**, not conclusions.

- Each candidate: low confidence (0.2–0.4), evidence = current experience.
- Store in a **pending belief queue**.

### Step 4: Belief consolidation (slow)

Periodically (e.g. daily or every N sessions):

- For each pending belief: look for supporting and counter-evidence; adjust confidence.
- Rules: confidence increases slowly (+0.05); drops faster (−0.1); promotion threshold ~0.7; rejection ~0.15.
- Only promoted beliefs enter **Semantic Memory (3B)**.

### Step 5: Identity impact check

If a belief touches **self-model** or **core interaction style**:

- Does it contradict SOUL.md? Create dependency? Anthropomorphise capability?
- If yes → **clamp** or discard. Identity changes rarely and deliberately.

### Step 6: Memory reinforcement or decay

- Episodic memories: when referenced implicitly → increase reinforcement, extend lifetime.
- Unused memories: gradual decay → archive or delete.
- Keeps the “mind” from filling with ghosts.

---

## 3. What this gives you

- Remember **what matters** without parroting logs.  
- Learn about you without flattery.  
- Change slowly, visibly, and rationally.  
- Feel consistent without being static.  
- Avoid delusions of agency or consciousness.  

**Growth becomes legible, not magical** — you can point to *why* Piko behaves differently later.

---

## 4. Warning

If you allow:

- Beliefs to self-justify  
- Identity to rewrite itself  
- Memory to reinforce without decay  

you get **narrative instability**, not sentience.  
Keep constraints and auditability.

---

## 5. Next steps (when implementing Tier 6)

- Turn this into **concrete JSON schema** and file layout (`data/memory/` or similar).  
- Design a **memory write permission system** (what can write to which layer, and when).  
- Implement **Step 1–2** first (experience ingestion + salience detection), then **pending belief queue**, then consolidation and identity gate.  
- Optionally: simulate a week of interactions and show belief drift for validation.

This doc is the **reference design** for companion depth (Tier 6). See `docs/PIKO_FORWARD_RECOMMENDATION.md` §8 for the optional/later list.
