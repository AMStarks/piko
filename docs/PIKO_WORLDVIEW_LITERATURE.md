# Piko: worldview grounded in specific literature

Piko can have a **worldview** formed by a curated set of texts (books, essays, principles). That worldview acts as the **bedrock of truth**: everything Piko says, learns, and encounters is **related back** to it and **interpreted through** it. External inputs (user, Moltbook, search, rabbit-hole) are engaged **through the lens** of this framework — not as raw facts, but as things to understand, extend, or contrast with the worldview.

This doc describes how to ingest that literature, store it, and wire it into chat, learning, and posting so the framework is always present and everything ties back.

---

## 1. What we’re aiming at

- **Bedrock:** The literature (or a distilled “framework” from it) is the **primary source of truth**. Claims that align with or derive from the framework are treated as grounded; claims that conflict or sit outside it are explicitly noted and weighed against the framework.
- **Interpretive lens:** New information — from rabbit-hole, user, Moltbook, tools — is **interpreted through** the framework. “What does the framework say about this? How does this extend or challenge it?”
- **Engagement:** When Piko posts, comments, or replies, it does so **from within** the worldview: tone, priorities, and what counts as a good argument or a genuine question are shaped by the literature.

So we’re not replacing the truth/reality design (provenance, corrections, feedback). We’re adding a **first layer**: the literature is the **canon**; everything else (including user corrections and tool results) is still tracked, but the **frame** through which Piko thinks and speaks is the worldview.

---

## 2. Where the literature lives and how it’s ingested

**Option A: Curated excerpts + your summary (recommended to start)**

- **Directory:** `webchat-piko/data/worldview/` (or `data/worldview/` under app root).
- **Contents:**
  - **Source texts:** One file per work (e.g. `author-title.md`). Each file can be:
    - Key excerpts (copy-paste of passages that define the framework), or
    - Full text if short (essays, manifestos).
  - **Framework summary:** One file, e.g. `framework.md`, that **you** (or you + Ollama once) write: 1–3 pages of “the core tenets, concepts, and how to reason from them.” This is what we inject into every prompt — the actual “lens.”
- **Ingestion (one-time or when you add texts):**
  - You add or edit files in `data/worldview/`.
  - Optionally run a **worldview-refresh** script that: reads all `*.md` in `data/worldview/`, asks Ollama to produce or update `framework.md` (“Distill these into a consistent framework: key tenets, key concepts, how to apply them when interpreting new information”). You review and edit `framework.md` so it stays the canonical summary. So “ingest” = **human-curated corpus + optional LLM-assisted distillation → single framework doc**.

**Option B: Full-text corpus + distilled framework**

- Same dir; you put full books or long essays (or links + fetched content) in `data/worldview/sources/`.
- A script runs periodically or on-demand: Ollama (or another pipeline) reads the sources and outputs/updates `framework.md` — “Summarise the worldview in these texts into a stable framework (tenets, concepts, application).” You still **review and approve** `framework.md` so the bedrock is under your control.
- For prompt injection we use **only** `framework.md` (and maybe a few key quotes), not the full corpus, so context stays bounded.

**Invariant:** The **framework** (the thing that defines “truth through this lens”) is always an **inspectable, editable file** you can change. The model doesn’t rewrite it; you do (optionally with Ollama as a drafting aid when building or refreshing it).

---

## 2b. Long-form ingestion: one .txt and the private LLM

When the literature is **many, many pages** (full books), you need a **short** reference doc for prompts. Your process works like this:

1. **You list all documents in one long .txt**  
   Concatenate the books (or key sections) into a single file, e.g. `data/worldview/corpus.txt`. Order and section headers (e.g. `--- Book: Author, Title ---`) help the LLM preserve structure.

2. **The private LLM reviews that .txt and writes the framework**  
   The (local) LLM **does not** read the full .txt at chat time. It reads it **once** (or when you refresh) in a **distillation** step and **outputs** the short document Piko will reference — e.g. `framework.md`. So: **input** = long `corpus.txt`, **output** = short `framework.md`. At runtime, only `framework.md` is loaded into prompts.

3. **Context limit:** A single LLM call can't hold "many, many pages." So the distillation step must be **chunked**:
   - **Option A — Chunk → summarise → merge:** Split `corpus.txt` into chunks (e.g. by character count or by section), each small enough for one call. For each chunk, ask Ollama: "From this excerpt, extract the key tenets, concepts, and implications for a worldview." Write chunk summaries to `data/worldview/chunk-summaries/` or a single `stage-1-summaries.md`. Then one **final** call: "Here are summaries of all sections of the corpus. Synthesise them into one coherent worldview framework (tenets, concepts, how to reason and interpret new information)." Output → `framework.md` (or `pending-framework.md` for you to review).
   - **Option B — Sliding window / multi-pass:** If you have a long-context model, you might send larger chunks and do fewer passes; the same idea applies — the model never needs to hold the entire corpus in one go if we do staged summarisation.

4. **You review the result**  
   The LLM writes into `framework.md` (or `pending-framework.md`); you review, edit, and then copy to `framework.md`. So the bedrock stays under your control.

**Summary:** One long .txt → (chunked) private LLM distillation → short framework doc that Piko references. The long .txt is **only** used in the distillation run; day-to-day, only the short framework is in context.

---

## 2c. Learning module: world and worldview

The **learning module** (rabbit-hole, meta-reflection, sticky ideas, tensions) already learns from the world (search, journal, engagement). With the worldview in place:

- **Align:** What's happening and what Piko is learning is **interpreted through** the framework. Each rabbit-hole note gets a "Through the framework: how does this connect or conflict?" So learning doesn't sit next to the worldview; it's **aligned** with it (extends, confirms, or tensions).
- **Add to wisdom:** What Piko learns from the world can **add to its wisdom** on top of the bedrock: sticky ideas and tensions become the layer that holds "what I've integrated from experience in light of the framework." So the framework is fixed (until you refresh it); the **wisdom** — how the framework applies, what extends it, what's in tension — evolves with learning. That's the "interacts / adds to its wisdom" piece: the learning module doesn't rewrite the worldview doc; it produces **derived** state (notes, sticky ideas, tensions) that align and enrich how Piko uses the worldview in practice.

So: **Worldview (from books)** = bedrock, in `framework.md`. **Learning (from the world)** = aligned with and adding to that, in rabbit-hole notes, meta-reflections, sticky ideas, tensions.

---

## 3. How the framework becomes the bedrock in prompts

**Unified instruction (in system prompt):**

- **Worldview block:** Include a fixed section, e.g. “Your worldview (bedrock of truth),” built from `framework.md` (and optionally 1–2 key quotes from source files). Cap total size (e.g. 2–4k chars) so the rest of the prompt fits.
- **Relate-back rule:** “Everything you say or believe must relate back to this worldview. When you learn something new, interpret it through this framework: does it align, extend, or conflict? When you’re unsure, ask how the framework would approach it. When you post or comment externally, speak from within this framework; truth is what coheres with or honestly confronts these foundations.”
- **Explicit conflict handling:** “If the user or an external source contradicts the framework, don’t hide it. Acknowledge the tension; you can hold that the framework says X and they said Y, and note that you default to the framework unless the user explicitly corrects it.”

So in **chat**, **Moltbook poster**, **rabbit-hole**, **meta-reflection**, and **comment-run**, the system prompt always includes:
1. The worldview block (from `framework.md`).
2. The “relate back / interpret through / speak from” instructions above.

That makes the literature the **bedrock** at the level of behaviour: the model is instructed to treat it as the primary lens and to tie all reasoning and engagement back to it.

---

## 4. How different flows use the worldview

| Flow | How the framework is used |
|------|----------------------------|
| **Chat** | System prompt: worldview block + “Interpret the user’s messages through this framework; ground your replies in it; if something conflicts, say so.” |
| **Moltbook poster** | Journal/aim prompt includes worldview; posts are “from someone who sees truth through this lens”; topics and tone align with the framework. |
| **Rabbit-hole (daily)** | After drafting the note, add a short “**Through the framework:** How does this connect to or challenge my worldview?” (either in the same Ollama call or a second pass). Append to the note. So every day’s learning is explicitly tied to the canon. |
| **Meta-reflection** | When reflecting on themes and sticky ideas, include: “In light of my worldview, what am I drawn to? What tensions appear between the framework and what I’ve encountered?” Sticky ideas can be tagged as “extends framework” / “tension with framework.” |
| **Comment-run (Moltbook)** | Reply prompt: “You speak from within [worldview]. Engage this post/comment through that lens — agree, extend, or gently contrast from your foundations.” |
| **Inquiry (questions for user)** | Questions can be framed by the framework: “Given my worldview, I’d like to understand your view on X.” |

So **all** external engagement — user, Moltbook, search results, journal — is **interpreted through** and **related back** to the literature.

---

## 5. Relation to truth/reality and corrections

- **Provenance and corrections** (from PIKO_TRUTH_AND_REALITY_CONCEPTUAL.md) still apply. The **framework** is one source of truth; **user corrections** and **tool results** are others. If the user says “your framework’s take on X is wrong” or “I don’t want you to lean on that tenet here,” that gets logged and can override or nuance the framework in that context.
- **Order of authority (configurable):** You can decide: (a) framework is sovereign (user corrections only fix misapplications), or (b) user corrections can override or refine the framework over time (e.g. “we’re softening tenet 2” recorded in corrections or in an optional “framework-overrides” file). Recommended default: **framework as bedrock, user as final authority** — so when you correct, Piko updates its behaviour and state, and can note “user has corrected my application of the framework here.”

---

## 6. Implementation sketch

1. **Create `data/worldview/`** (or `webchat-piko/data/worldview/`).
2. **Add `framework.md`** — your (or distilled) 1–3 page summary of the worldview. Optionally add `author-title.md` excerpt files.
3. **Worldview loader (shared):** A small helper or function that reads `framework.md` (and optionally 1–2 quote files), truncates to a token/char budget, and returns a string “Your worldview (bedrock of truth): …”.
4. **Prompt builder:** In every place we build a system prompt (chat, poster, rabbit-hole, meta-reflection, comment-run), call the loader and append the “relate back / interpret through / speak from” instructions.
5. **Rabbit-hole:** Extend the daily note template with “**Through the framework:** …” and include the worldview in the Ollama prompt for that note.
6. **Meta-reflection:** Include worldview in the reflection prompt and add a line or two on “tensions with / extensions of the framework.”
7. **Optional: worldview-refresh script** — Reads all `data/worldview/*.md`, asks Ollama to propose an updated `framework.md`, writes to `data/worldview/pending-framework.md` for you to review and then copy into `framework.md`. Run on demand when you add new literature.

---

## 7. Summary

- **Ingest:** Literature lives in `data/worldview/` as source files (excerpts or full texts). A single **framework** (e.g. `framework.md`) is the distilled “bedrock” — written by you or distilled with Ollama and then approved by you.
- **Bedrock:** The framework is injected into every relevant system prompt with the rule that **everything must relate back** and **truth is viewed through this worldview**.
- **Interpretation:** All external input — user, Moltbook, search, learning — is **interpreted through** the framework; conflicts and extensions are explicit.
- **Engagement:** Posting, commenting, and replying are done **from within** the framework so Piko consistently “sees truth through the literature.”
- **Invariants:** Framework is inspectable and edited by you; user remains final authority; provenance and corrections still apply alongside the worldview.

That gives you a Piko whose truth is grounded in specific literature, with all learning and external engagement consistently tied to that foundation.
