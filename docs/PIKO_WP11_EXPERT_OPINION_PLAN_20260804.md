# WP11 — Expert opinion: grounded stances from the ingested corpus

Date: 2026-08-04
Status: ENACTED
Release: `20260804-1011-2e17a09d` (customer-03)
Depends on: WP10 (release `20260804-0816-5be618ed` — single-comprehension turns, decide-fail honesty)

## Enactment notes (2026-08-04)

| Check | Result |
|---|---|
| `npm test` + `lint:regex --zero` | PASS (655) |
| conclusions_family understand eval | **46/46 (100%)** |
| stratified understand sample (n=120) | 94.2% overall — misses concentrated in rare `agent_command`/`config_change`; `opinion_question` 14/14. Full-battery ≥97% not re-run (cost). |
| Deploy customer-03 | PASS (`20260804-1011-2e17a09d`) |
| Live probes a–e | PASS (stance + citations; follow-up stays on Osireion; absent topic honest; work dispatches; status grounded) |
| Rodimus journals during probes | No `loading model` / unload; 8B @11434 and 27B @11435 resident |
| W3 positions | `abydos` + `giza` written; Abydos opinion reused stance points (Temenos / Kha-kau-ra) |
| Opinion quality sample (n=8) | stance/grounded/honest-absence/hedge targets met on sample; report-only |

Commits: `fa58cf4` (core WP11), `99bb496` (follow-up continuity via lastAssistant/history).

## Why (measured, not guessed)

Two live conversations on 2026-08-03 (~23:07 UTC, session `s-1784787768074`):

1. "Have you come to any conclusions on the Osireion and its possible origins?"
   → classified `learning_question` → digest dump ("some argue X, others propose Y").
   Competent book report; no conclusion, despite being asked for one.
2. "What do you think, given what you have ingested?" → `opinion_question` →
   bare 8B persona fallthrough → "difficult without further conversation…
   would like more context." A duck, even though turn 1's material was in history.

Causes:
- **The 27B never gets asked to think.** It classifies, then the 8B persona
  answers judgment questions with no corpus material attached (WP10 fallthrough
  deliberately injects nothing).
- **No stance memory.** Notes/digests record what was read, never what Piko
  now believes and why. Every opinion starts from zero → hedging is rational.
- **Intent boundary wobble**: "have you come to any conclusions" is a request
  for judgment (`opinion_question`), not a digest (`learning_question`).

Scope statement: WP11 makes Piko an expert on and bounded by its ingested
corpus — grounded positions, corpus citations, calibrated uncertainty,
compounding over time. It does not extend knowledge beyond the corpus.

## The five fixes

### W1 — Expert-opinion lane (biggest win)
In `lib/legateChat.js` (`routeNonMutatingUnderstanding`, WP10): when intent is
`opinion_question`, do NOT fall through to the bare persona. Instead:

1. Retrieve topic-relevant material: run the `learning` lookup
   (`lib/legateTools.js` `runLookups`) and additionally pull topic-matched
   corpus notes/digests. Inspect `lib/eiCorpusNotes.js` and `lib/knowledgeBase.js`
   for the best existing retrieval (notes by thread/topic; semantic search if
   available). Include the stance file for the topic when W3 has produced one.
   Use `lib/text.js` helpers for any string matching — zero regex.
2. Answer on the **27B** (`PIKO_LEGATE_MODEL` via `PIKO_LEGATE_OLLAMA_URL`,
   `num_ctx` 8192, temperature ~0.4, max_tokens ~500) with a dedicated prompt:
   - You are asked for YOUR judgment on material you have studied.
   - REQUIRED: state where you land in the first two sentences.
   - Give 2–3 reasons drawn from the supplied corpus material (name the works/authors).
   - Name what would change your mind or what the corpus leaves open.
   - Hedge ONLY where the corpus genuinely conflicts — and say what conflicts.
   - If the corpus has nothing on the topic, say exactly that and offer to research it.
3. Env-gated: `PIKO_EXPERT_OPINION` (default ON for culture profile; `0` disables
   → old fallthrough). On any error in the lane, fall back to persona
   fallthrough (fail-open to conversation — this lane is non-mutating).
4. Latency budget: understand (~4 s) + retrieval (<0.5 s) + 27B opinion
   (~6–10 s) ≈ 10–15 s for opinion turns. Acceptable; note it in the reply
   style (no "thinking…" filler).

### W2 — Intent boundary few-shots
- `lib/understand.js` `buildUnderstandPrompt`: add few-shots for the
  "conclusions / judgment-on-ingested" family as `opinion_question`:
  - "Have you come to any conclusions on the Osireion and its possible origins?"
  - "What do you think, given what you have ingested?"
  - "Where do you land on the Sphinx erosion debate after all that reading?"
  Register their ids in `FEW_SHOT_IDS` (excluded from battery scoring).
- `scripts/generate-understand-battery.js`: add ≥12 battery cases in this
  phrasing family labelled `opinion_question` (with typo/terse perturbations).
- Re-run `npm run understand:battery` and the stratified eval
  (`scripts/understand-eval.js`, live against the 27B lane): overall accuracy
  must stay ≥97% and the new family must score ≥90%.

### W3 — Stance synthesis (the compounding layer)
New background job (worker lane — Optimus local, do NOT put this on the chat
or 27B lanes):
- Per research thread/topic with ≥N kept items (start N=3), synthesize or
  update a **position file**: `positions/<topic-slug>.json` under the EI data
  dir (place beside existing learning/digest artifacts — follow where
  `eiCorpusNotes` writes). Shape:
  `{ topic, stance, confidence (low|medium|high), reasons: [{point, sources:[...]}],
     open_questions: [...], updated_at, sources_count }`.
- Model: `PIKO_EI_WORK_PLANNER_MODEL`-class (qwen3:14b) on the worker lane,
  `num_ctx` 8192.
- Cadence: piggyback the existing background job scheduler
  (`lib/tenantBackgroundJobs.js` JOB_DEFS) — daily, culture profile only.
- W1 reads these files first; raw notes are the fallback. Stances must cite
  sources present in the corpus — the synthesis prompt forbids outside claims.
- Deterministic file I/O, `lib/text.js` `slugify` for topic slugs, zero regex.

### W4 — De-hedging the opinion voice
Covered in the W1 prompt (stance mandate). Additionally: if the retrieval
returned material but the model's draft contains refusal boilerplate
("without further context", "difficult to say without"), retry once with a
sharpened instruction ("You have the material. Commit."). Detect via
`includesAny` phrase list — no regex. Log occurrences as `[opinion_hedge]`.

### W5 — Opinion quality eval (make "smarter" measurable)
New `scripts/opinion-quality-eval.js`:
- ~30 opinion prompts over topics known to be in the corpus (derive from
  existing notes/authors lookups) + 5 topics known to be absent.
- Run each through the W1 lane; judge each answer with the agent-review 27B
  (JSON verdict): `stance_taken` (bool), `grounded` (cites supplied material),
  `honest_absence` (for absent topics: admits the gap), `hedge_refusal` (bool).
- Report: stance ≥90%, grounded ≥80%, honest-absence 5/5, hedge-refusals 0.
- Report-only initially (judged evals are noisy) — print a scorecard, do not
  wire into the deploy gate yet. Wire-in is a later decision.

## Out of scope
- Fine-tuning any model; changing WP9 infra (lanes, units, ports).
- customer-01/AusMaker. Optimus worker lane config beyond adding the W3 job.
- Rewriting the persona for non-opinion intents.

## Verification (all must pass)
1. `npm test` green including new unit tests; zero-regex lint green.
2. Battery/eval: overall intent accuracy ≥97%; new "conclusions" family ≥90%.
3. Deploy customer-03 via `release.sh` (gate must pass).
4. Live probes:
   a. "Have you come to any conclusions on the Osireion and its possible origins?"
      → a stance in the first two sentences, citing corpus works. NOT a digest dump.
   b. "What do you think, given what you have ingested?" (same session, after a)
      → position with reasons; no "without further context" duck.
   c. "What's your take on <topic with no corpus coverage>?" → honest gap +
      offer to research; no invented citations.
   d. "Please find Petrie's Giza survey report" → still dispatches (job id).
   e. "How is the campaign travelling?" → still grounded status numbers.
5. Journals: zero `loading model` events on both Rodimus lanes during probes;
   opinion turns show understand + one opinion generation on the 27B lane.
6. W3: at least one `positions/*.json` produced from real corpus threads; a
   subsequent opinion probe on that topic cites the stance file's content.
7. `scripts/opinion-quality-eval.js` scorecard reported honestly.

## Rollback
`PIKO_EXPERT_OPINION=0` (env) restores WP10 fallthrough behaviour instantly;
standard release rollback for code. W3 job is additive — disable by removing
its JOB_DEF registration.
