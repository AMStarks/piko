# Wisdom Core — Implementation plan

## Option A vs Option B (corpus vs prompts)

**Option A — Two layers (corpus + prompts both feed the prompt)**  
- **Corpus** = canonical bedrock for *worldview, loyalty, epistemology, life navigation* (01–04). It holds “inalienable truths” and how Piko reasons about truth.  
- **Prompts** (IDENTITY, SOUL, MEMORY, INTERESTS) = unchanged. They still define *who Piko is* (name, tone, scope), *how it speaks* (soul), *durable facts/preferences* (memory), *interests*.  
- **System prompt** = `[corpus block]` + `[existing identity + soul + memory + interests]` + learning + mind + etc.  
- **Difference:** Two parallel sources. Corpus = “what is true and how we discern truth”; prompts = “who Piko is and how it talks.” No migration; both stay.

**Option B — One canonical truth layer; prompts shrink**  
- **Corpus** = same 01–04, but we *migrate* content from prompts into corpus over time. So IDENTITY (who Piko is) and MEMORY (durable facts) move into corpus (e.g. 01_worldview, 04_life_nav).  
- **Prompts** = thinned to **SOUL** (behavior/voice only) and **INTERESTS** (topics). Identity/memory-style content lives in corpus only.  
- **Difference:** One place for “truth” and identity/memory; prompts become mostly *style* and *interests*. Requires a one-time (or gradual) content move.

**Recommendation for this implementation:** **Option A.** We add corpus as the new bedrock and prepend it to the prompt; we leave prompts/ as-is. You can later move content into corpus (Option B) if you want a single canonical file set.

---

## Corpus summary: Option C (static foundation)

- **Summary is generated only when corpus is edited**, not on every load or on a schedule.  
- When you save a corpus doc (e.g. from `/control-wisdom`), we run **one** AI summarization and store the result in `corpus_index.json` (e.g. `summary` + `last_summarized`).  
- At chat time we **only read** the cached summary (and/or `core_truths`). No AI call.  
- **Corpus = static** between edits → Piko has a stable, objective foundation; the summary is just a compact view of that static corpus.

---

## Phases

| Phase | What | Outcome | Status |
|-------|------|--------|--------|
| **1** | data/corpus/ + 4 docs + corpus_index.json; lib/corpus.js (load, optional cached summary); no AI on load | Corpus on disk; loader returns summary or core_truths + snippets | Done |
| **2** | Regenerate summary: only when corpus is saved (API or control); store in corpus_index | Option C in place; corpus static between edits | Done |
| **3** | Wire system prompt: prepend corpus block (summary + honesty protocol) to existing prompt | Chat uses corpus as bedrock | Done |
| **4** | data/truth/ + claims.json, corrections.json, wisdom_cache.json; lib/truth.js | Truth engine structure; append/get recent | Done |
| **5** | Inject recent claims/corrections + wisdom (top 3) into prompt; optional correction detection in chat | Daily truth + wisdom in chat | Done |
| **6** | scripts/nightly_wisdom.js; cron 2AM | Nightly distillation → wisdom_cache | Done |
| **7** | /control-wisdom page: corpus docs, truth stats, “Regenerate summary”, “Run nightly now” | Control and visibility | Done |
| **8** | Summary doc of all wisdom core work | Single reference for what was built | Done |

---

## Phase 8: Summary of what was built

**Wisdom Core** is the fixed corpus + truth engine + nightly wisdom distillation that gives Piko a stable foundation and growing wisdom.

### Implemented

1. **Fixed corpus (Phases 1–3)**  
   - **data/corpus/** — Four docs: `01_worldview.md`, `02_loyalty.md`, `03_reality.md`, `04_life_nav.md`; `corpus_index.json` (core_truths, hierarchy, optional cached `summary`, `last_summarized`).  
   - **lib/corpus.js** — `loadCorpus()`, `getCorpusBlockForPrompt(primaryHuman)` (uses cached summary or core_truths + snippets; no AI at chat time), `regenerateSummary()` (Option C: one AI call when corpus is saved).  
   - **Chat** — System prompt starts with corpus block (bedrock + honesty protocol), then existing SYSTEM_PROMPT (prompts/) + learning + mind + RAG. Primary human injected from mind or env.

2. **Truth engine (Phases 4–5)**  
   - **data/truth/** — `claims.json`, `corrections.json`, `wisdom_cache.json`.  
   - **lib/truth.js** — `appendClaim()`, `appendCorrection()`, `getRecentClaims()`, `getRecentCorrections()`, `getWisdomCache()`, `getTruthBlockForPrompt()` (recent claims + corrections + top 3 wisdom), `getTruthStats()`, `setWisdomCache()`.  
   - **Chat** — Truth block (recent claims, corrections, distilled wisdom) injected after corpus block. **Correction detection:** user messages starting with "Actually X", "That's wrong", "No it's", "Correction: X" trigger `appendCorrection(lastAssistantMessage, X)` in the background.

3. **Nightly wisdom (Phase 6)**  
   - **scripts/nightly_wisdom.js** — Loads corpus + recent claims/corrections; one AI prompt to extract 1–3 wisdom statements (WISDOM: …); appends to `wisdom_cache.json`; optional Telegram morning message. Exports `runNightlyWisdom()`.  
   - **Server** — `cron.schedule('0 2 * * *', …)` runs `runNightlyWisdom()` at 2 AM. **POST /api/wisdom/run-nightly** runs it on demand.

4. **Control and API (Phase 7)**  
   - **GET /api/corpus** — Index + document contents.  
   - **POST /api/corpus/regenerate-summary** — Option C: regenerate and store summary.  
   - **PUT /api/corpus/documents/:name** — Save one corpus doc (body `{ content }` or raw), then regenerate summary.  
   - **GET /api/wisdom/truth-stats** — claims_count, corrections_count, wisdom_count, last_distilled.  
   - **POST /api/wisdom/run-nightly** — Run nightly distillation now.  
   - **/control-wisdom** — Fixed corpus (docs list, core truths, cached summary, "Regenerate summary"); Daily truth engine (stats, "Run nightly now").

### Design choices

- **Option A:** Corpus is the bedrock; prompts/ (IDENTITY, SOUL, MEMORY, INTERESTS) unchanged and still feed the prompt after the corpus block.  
- **Option C:** Corpus summary is generated only when corpus is saved or "Regenerate summary" is clicked; at chat time we only read the cache. Corpus stays static between edits.  
- **Primary human:** Injected from `loadMind().self_model.identity.primary_human` or `PIKO_PRIMARY_HUMAN` into the corpus block so 02_loyalty stays generic in the repo.

### File layout (as built)

```
data/
  corpus/   # 01_worldview.md, 02_loyalty.md, 03_reality.md, 04_life_nav.md, corpus_index.json
  truth/    # claims.json, corrections.json, wisdom_cache.json
lib/
  corpus.js
  truth.js
scripts/
  nightly_wisdom.js
public/
  control-wisdom.html
```

---

## File layout (target)

```
data/
  corpus/
    01_worldview.md
    02_loyalty.md
    03_reality.md
    04_life_nav.md
    corpus_index.json   # core_truths, hierarchy, summary (cached), last_summarized
  truth/
    claims.json
    corrections.json
    wisdom_cache.json
lib/
  corpus.js   # loadCorpus, getCorpusBlockForPrompt, regenerateSummary (Option C)
  truth.js    # appendClaim, appendCorrection, getRecent*, getWisdomForPrompt
scripts/
  nightly_wisdom.js
public/
  control-wisdom.html
```

---

## Primary human

- `02_loyalty.md` can say “Primary human: [injected]”. Loader or prompt builder reads `loadMind().self_model.identity.primary_human` (or env) and injects into the corpus block so the repo stays generic.
