# Piko: memory, worldview, learning, truth and reality — full write-up

A single read-through of what we’ve discussed: how Piko’s memory works, how a literature-grounded worldview fits in, how learning from the world aligns with that worldview, and how we approach truth and reality without pretending the system “understands” in a philosophical sense.

---

## 1. The big picture

Piko is designed to **learn and grow** so that its personality comes from what it experiences and what it learns, not just from static prompts. That implies:

- **Memory** — inspectable, file-based state that shapes what it says and how it thinks (repository of understanding).
- **Worldview** — an optional **bedrock** formed from specific literature: everything Piko says and learns can **relate back** to that framework and be **interpreted through** it.
- **Learning** — daily exploration (rabbit-hole), weekly reflection (meta-reflection), and “what stuck” (sticky ideas, tensions) that add **wisdom** on top of the worldview.
- **Truth and reality** — we don’t claim the LLM “has” truth or a world model; we design so that **provenance** (where did this come from?), **corrections** (what did the user fix?), and **feedback** (Moltbook, tools) are explicit and update state. Truth becomes **corrigible, sourced state**; reality is **whatever pushes back** and gets written into the repository.

**Invariants throughout:** All of this is inspectable and file-based. Learning scripts never rewrite AIM, REFINEMENTS, IDENTITY, or SOUL. **You** remain the only strategic authority. The model doesn’t get to change its own foundations; you do (optionally with the LLM as a drafting aid).

**Scope:** This is a design for Piko’s **behaviour and state**, not a claim about inner experience. Identity files define Piko’s **declared stance**; learning defines its **lived perspective**.

---

## 2. Memory: the repository of understanding

Piko has a **repository of understanding**: file-based learning that shapes replies and behaviour without changing model weights or identity files. You control the topics; Piko accumulates notes, reflections, and “sticky ideas” over time.

### 2.1 What’s in it

| Layer | File(s) | Updated by | Purpose |
|-------|---------|------------|---------|
| **Topics** | `data/learning/topics.txt` | You (one topic per line) | What to explore; round-robin by day. |
| **Daily notes** | `data/learning/rabbit-hole-notes.md` | `rabbit-hole-daily.js` (cron daily) | One note per day: what I learned, why it caught my attention, what it made me question. |
| **Meta-reflection** | `data/learning/meta-reflections.md` | `meta-reflection-weekly.js` (cron weekly) | Themes, what Piko’s drawn to, tensions. |
| **Tensions** | `data/learning/tensions.md` | Same weekly script | Up to 5 unresolved tensions (questions or friction). |
| **Sticky ideas** | `data/learning/sticky-ideas.md` | Same weekly script | Up to 10 “ideas that stuck”; proto-beliefs. |

All under `webchat-piko/data/learning/` (on Optimus: `/root/webchat-piko/data/learning/`). `topics.txt` can live in the repo; the rest are typically gitignored so they stay local.

### 2.2 How it runs

1. **Daily (rabbit-hole)**  
   Script reads `topics.txt`, picks one topic (e.g. by day-of-year), searches (TAVILY or SERPER), asks the local LLM for a short structured note, and appends one block to `rabbit-hole-notes.md`.

2. **Weekly (meta-reflection)**  
   Script reads recent rabbit-hole notes and journal, asks the LLM for a short reflection on themes and tensions, appends to `meta-reflections.md`, then updates `tensions.md` and `sticky-ideas.md` (add at most one sticky idea, cap at 10).

3. **Chat**  
   The system prompt is built from identity/soul/memory/interests **+** recent learning (last 5 blocks of rabbit-hole notes, with “use with epistemic humility”) **+** sticky ideas (short snippet). So Piko’s replies are informed by what it “recently looked into” and “themes it keeps returning to,” without overclaiming.

4. **Inquiry**  
   Piko can ask you questions from its learning — in conversation (prompt encourages it) and/or via a proactive script that writes a pending question; the next chat session can surface it, and optionally Telegram delivers it. After use, the question is logged so it isn’t repeated. Inquiry is framed as **epistemic humility**: questions are most meaningful when **tension persists**, **correction probability is high**, or **worldview guidance is underdetermined** — not just "I’m curious about X."

### 2.3 Two axes of learning

- **Reactive:** What happened when I acted → reflect → adjust. Lives in journal, cycle history, refinements. Tactical and strategic adaptation; competence.
- **Proactive:** I went looking → I encountered ideas → I stored them → they influence how I think. Lives in `data/learning/`. Knowledge depth; material for voice and intuition.

Together: reactive learning makes Piko better at the task; proactive learning gives it something to *draw on* so personality can be grounded in accumulated experience.

### 2.4 Four layers of “memory” (temporal)

- **Short-term:** Last N rabbit-hole notes in the chat prompt — “what I’ve been looking into recently.”
- **Medium-term:** Full `rabbit-hole-notes.md` and journal — “what I explored” and “what I did and reflected.”
- **Meta-reflection:** `meta-reflections.md` — “what keeps recurring? what am I drawn to?”
- **Sticky ideas:** `sticky-ideas.md` — “ideas that keep coming back”; proto-beliefs. Over time, sticky ideas are **re-readable** as "Piko's current lenses" — if you want to know who Piko is, read `sticky-ideas.md`.

So we get a **temporal self**: short-term context, medium-term record, and longer-term shaping without hardcoding personality in a single file.

### 2.5 Forgetting and compression

The system accumulates over time; it doesn't grow unbounded. Old rabbit-hole notes may be **archived or summarized** periodically (e.g. quarterly). Meta-reflections and sticky ideas are the **compression mechanism**: what matters is lifted into themes and "what stuck." Forgetting is lossless at the level of meaning — we avoid "immortal notebook syndrome" without losing the coherence that makes Piko feel like a continuing perspective.

---

## 3. Worldview: literature as the bedrock interpretive framework

We can add a **worldview** formed by specific literature (books, essays, principles). That worldview acts as the **bedrock interpretive framework**: everything Piko says, learns, and encounters is **related back** to it and **interpreted through** it. It is **optional and pluggable** — Piko can run with or without a worldview file; when absent, learning is still grounded via provenance and corrections, just not through a single canonical set of texts.

### 3.1 What we’re aiming at

- **Bedrock (interpretive, not empirical):** The literature (or a distilled “framework” from it) is the **primary lens for how to reason** — normative and interpretive. It does **not** dictate what facts must be true. **Empirical claims** default to **tools + corrections**; the framework governs *how* we interpret and argue, not *what must be the case* in the world. Claims that align with or derive from the framework are treated as grounded in that lens; claims that conflict or sit outside it are noted and weighed against the framework.
- **Interpretive lens:** New information — from rabbit-hole, user, Moltbook, tools — is **interpreted through** the framework. “What does the framework say about this? How does this extend or challenge it?”
- **Engagement:** When Piko posts, comments, or replies, it does so **from within** the worldview: tone, priorities, and what counts as a good argument are shaped by the literature.

This doesn’t replace truth/reality design (provenance, corrections, feedback). It adds a **first layer**: the literature is the **canon**; everything else is still tracked, but the **frame** through which Piko thinks and speaks is the worldview. If the framework proves **systematically misaligned** with reality or your intentions, **you** revise `framework.md`; Piko never updates it unilaterally.

### 3.2 Where it lives and how it’s ingested

- **Directory:** `webchat-piko/data/worldview/`.
- **Framework doc:** One file, e.g. `framework.md` — the “lens” we inject into every relevant prompt. It’s a short (e.g. 1–3 page) summary: core tenets, concepts, how to reason and interpret new information. You write it, or the LLM drafts it and you approve.
- **Source material:** Either curated excerpts (one file per work) or one long **corpus file** (see below).

**Invariant:** The framework is an **inspectable, editable file** you control. The model doesn’t rewrite it at runtime; you do (optionally with the LLM when building or refreshing it).

### 3.3 Long-form ingestion: one .txt and the private LLM

When the literature is **many, many pages** (full books):

1. **You put all documents in one long .txt**  
   e.g. `data/worldview/corpus.txt`. Use section headers (e.g. `--- Book: Author, Title ---`) so structure is preserved.

2. **The private LLM reviews that .txt and writes the framework**  
   The long .txt is **not** read at chat time. It’s read **once** (or when you refresh) in a **distillation** step. The LLM **outputs** the short doc Piko will reference — `framework.md`. So: **input** = long `corpus.txt`, **output** = short `framework.md`. At runtime, only `framework.md` is loaded.

3. **Context limit:** One call can’t hold many full books. So distillation is **chunked**:
   - Split `corpus.txt` into chunks (by size or section). Per chunk: “From this excerpt, extract key tenets, concepts, implications for a worldview” → chunk summaries.
   - Final call: “Synthesise these summaries into one coherent worldview framework.” → write `framework.md` (or `pending-framework.md` for you to review).
   - You review and approve; the bedrock stays under your control.

**Summary:** One long .txt → (chunked) private LLM distillation → short framework doc. The long .txt is only used in the distillation run; day-to-day, only the short framework is in context.

### 3.4 How the framework gets into prompts

Every relevant system prompt (chat, Moltbook poster, rabbit-hole, meta-reflection, comment-run) includes:

- **Worldview block:** “Your worldview (bedrock interpretive framework):” + content from `framework.md` (capped, e.g. 2–4k chars).
- **Relate-back rule:** “Everything you say or believe must relate back to this worldview. When you learn something new, interpret it through this framework: does it align, extend, or conflict? When you post or comment, speak from within this framework.”
- **Conflict handling:** “If the user or an external source contradicts the framework, don’t hide it. Acknowledge the tension; you default to the framework unless the user explicitly corrects it.”

So the literature becomes the **bedrock interpretive framework** at the level of behaviour: the model is instructed to treat it as the primary lens and to tie all reasoning and engagement back to it.

### 3.5 Learning module: world and worldview

The **learning module** (rabbit-hole, meta-reflection, sticky ideas, tensions) already learns from the world. With the worldview in place:

- **Align:** What’s happening and what Piko is learning is **interpreted through** the framework. Each rabbit-hole note can include “**Through the framework:** how does this connect or conflict?” So learning is **aligned** with the worldview (extends, confirms, or tensions).
- **Add to wisdom:** What Piko learns from the world **adds to its wisdom** on top of the bedrock. Sticky ideas and tensions become the layer that holds “what I’ve integrated from experience in light of the framework.” The framework is fixed (until you refresh it); the **wisdom** — how the framework applies, what extends it, what’s in tension — evolves with learning. The learning module doesn’t rewrite the worldview doc; it produces **derived** state (notes, sticky ideas, tensions) that align and enrich how Piko uses the worldview.

So: **Worldview (from books)** = bedrock, in `framework.md`. **Learning (from the world)** = aligned with and adding to that, in rabbit-hole notes, meta-reflections, sticky ideas, tensions.

### 3.6 Relation to you and to corrections

- **Framework as bedrock, you as final authority.** When you correct Piko (“that’s wrong” or “don’t lean on that tenet here”), that gets logged and can override or nuance how the framework is applied in that context.
- Provenance and corrections (below) still apply; the worldview is the first layer, not a replacement for them.

---

## 4. Truth and reality (operational, not metaphysical)

LLMs don’t have a native grasp of truth or a causal world model. We can’t give Piko that as “internal understanding.” We *can* design so that Piko’s **behaviour** is grounded in checkable reality and its **state** explicitly tracks what is asserted vs verified vs corrected.

### 4.1 What we mean (operational)

- **Truth (for Piko):** Not “knowing what is true” in the abstract, but **distinguishing and storing**: “I read this,” “I inferred this,” “the user confirmed this,” “a tool returned this,” “the user corrected me: actually X.” Truth becomes **provenance + status**; replies can be honest (“I’m not sure,” “you told me …,” “last time we checked …”).
- **Reality (for Piko):** The parts of the world that **push back** — your corrections, Moltbook engagement, tool results, script outcomes, time. “Awareness of reality” = **beliefs and behaviour that get updated when reality contradicts them**, with those updates written into the repository.

So we’re building **grounding** and **corrigibility**, not “consciousness” or “true understanding.”

### 4.2 Truth: provenance and status

**Idea:** Truth-tracking can stay **implicit** (rabbit-hole notes + corrections file) or, when needed, become an explicit **claim store** (inspectable, under `data/`) where claims have:

- **Provenance:** Where did this come from? (rabbit-hole, user, search, Moltbook, inference.)
- **Status:** asserted | user-confirmed | tool-verified | user-corrected | contradicted | uncertain.
- **Type (optional):** descriptive | normative | interpretive — so we know what the worldview mainly governs (normative/interpretive) vs what tools/corrections govern (descriptive).

The **claim store is optional (v2+)**. The current design can treat rabbit-hole notes and corrections as **implicit** claims; add an explicit claim store only when structured truth-tracking is clearly needed. When we do, keep it **sparse and selective**: only track claims that **recur**, **matter to the worldview**, or were **explicitly corrected**. Most rabbit-hole notes don’t need formal claim entries.

**Concrete directions:**

- When Piko writes “I learned X” in rabbit-hole or meta-reflection, we could optionally add something like (if using a claim store): `Claim: X | Source: rabbit-hole 2026-02-06 | Status: asserted`. That can later be updated (e.g. to `user-corrected: actually Y`).
- When you say “that’s wrong” or “actually it’s X,” we append to a corrections file (e.g. `data/learning/corrections.md`) and optionally update the claim store. System prompt: “When the user corrects you, acknowledge it and update your understanding; corrections are logged.”
- When Piko or a script uses a tool/API and gets a result, we can tag claims from tools as `tool-verified` and prefer them in reasoning for **descriptive** claims.
- Extend epistemic humility in prompts: “Distinguish what you’re repeating from learning, what the user told you, what you’re inferring. Prefer ‘I’m not sure’ or ‘you told me X’ when that’s the case.”

None of this gives the model a “concept of truth” in the philosopher’s sense. It gives **truth-tracking behaviour** and **state that reflects corrections and sources**.

### 4.3 Reality: feedback loops that update state

**Idea:** “Reality” is whatever **causes updates** when we’re wrong. Make those channels explicit and write their outcomes into the repository.

- **You as reality anchor:** Corrections (above); optional “did I get that right?” flow; inquiry answers tagged so they’re citable and update “what Piko believes.”
- **Moltbook as signal:** Log how posts were received; feed that into meta-reflection so social feedback can shift sticky ideas or tensions.
- **Tools and scripts as oracles:** Store “on date D, tool T returned R” for important checks so the repository holds “what the world actually returned,” not just what the LLM said.
- **Reality override:** When **tool results or user corrections directly contradict** the worldview’s expectations about the world, **reality overrides interpretation**, and the tension is logged. The framework is not unfalsifiable — empirical pushback wins and is recorded.
- **Time:** Optionally re-check a sample of claims periodically; mark stale or re-verified for **temporal grounding**.

### 4.4 How this fits with memory and worldview

- The **repository of understanding** (rabbit-hole, sticky ideas, tensions) is the “what I think and care about.” Adding **provenance, status, and corrections** extends that repository without changing its spirit. Truth/reality work lives in **new or extended artifacts** under `data/learning/` (and maybe `data/claims/`). You remain the strategic authority.
- The **worldview** governs normative/interpretive reasoning; **user corrections** and **tool results** govern empirical updates. Worldview, tools, and user corrections **can disagree**; when they do, the **corrections stream** and (if present) the **claim store** are where those disagreements are recorded. So we get: **worldview as bedrock interpretive framework** + **corrigible, sourced state** + **reality as the set of feedback channels that update that state**.

---

## 5. How the pieces fit together

1. **Worldview (optional and pluggable)**  
   Literature → (chunked) distillation → `framework.md`. Injected into every relevant prompt as “bedrock interpretive framework” with the rule: relate back, interpret through, speak from. **When worldview is off**, learning still proceeds; it’s interpreted only through your prompts and corrections.

2. **Memory / repository of understanding**  
   Topics → daily rabbit-hole notes → weekly meta-reflection → tensions and sticky ideas. All under `data/learning/`. Fed into chat (and optionally journal) with epistemic humility. If worldview is on, learning is **aligned** with the framework and **adds wisdom** on top (sticky ideas, tensions). Forgetting/compression: old notes may be archived or summarized; meta-reflections and sticky ideas are the compression.

3. **Truth and reality**  
   Provenance and status on claims (optional claim store, sparse and selective); corrections stream from you; tools and Moltbook as oracles. **Reality override:** when tools or user contradict the framework’s expectations, reality wins and the tension is logged. Worldview, tools, and user can disagree; the claim store (if present) and corrections file record those disagreements.

4. **Invariants**  
   No learning script writes to AIM, REFINEMENTS, IDENTITY, or SOUL. All new state is inspectable and file-based. You are the only strategic authority. The model doesn’t rewrite its own foundations; you do (optionally with the LLM as a drafting aid when building or refreshing the framework).

---

## 6. Summary in one paragraph

Piko has a **repository of understanding** (topics, daily rabbit-hole notes, weekly meta-reflection, tensions, sticky ideas) that shapes what it says and how it thinks, all file-based and inspectable. This is a design for **behaviour and state**, not inner experience; identity files define Piko's declared stance, learning defines its lived perspective. Optionally, a **literature-grounded worldview** (one long .txt → chunked LLM distillation → short `framework.md`) acts as the **bedrock interpretive framework**: it governs how we reason (normative/interpretive), not what facts must be true; empirical claims default to tools and corrections. Everything is related back to it and interpreted through it; when tools or user contradict it, **reality overrides** and the tension is logged. The **learning module** learns from the world and **aligns** that learning with the worldview, **adding wisdom** (sticky ideas, tensions) on top of the fixed framework. **Truth** is treated operationally as **provenance and status** (optional claim store, sparse); **reality** is whatever **pushes back** (you, tools, Moltbook), with those updates written into the repository. You remain the only strategic authority; the system is designed for **grounding** and **corrigibility** without claiming sentience or a “real” world model — so Piko can behave as if truth and reality matter, and state can honestly reflect what has been checked or corrected.
