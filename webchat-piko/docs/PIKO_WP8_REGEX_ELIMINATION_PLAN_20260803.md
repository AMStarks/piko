# WP8 — Total Regex Elimination & LLM-First Comprehension

Date: 2026-08-03
Repo: `webchat-piko` (Piko / Legion / Egyptian Insights spine)
Prereq state: WP7 deployed (`20260803-1114-256d1e4a`), 587/587 tests green,
`npm run lint:routing` currently FAILING on `lib/actionRouter.js:39`.

---

## 1. Objective

Remove **every** regex literal and `RegExp(...)` construction from production
JavaScript (`lib/**/*.js`, `server.js`, runtime `scripts/`), and restructure the
chat path so that **the LLM always reads the raw user input and routing only
happens after the LLM has produced a structured understanding of it**. No
keyword prefilter, no regex floor, no pattern shortcut may decide what a
message *means* — the model decides; deterministic code only acts on the
model's structured output.

Current inventory (measured 2026-08-03, strings/comments excluded):
~**820 real regex uses** in `lib/` + `server.js`. Heaviest files:
`server.js` (187), `nlLegionSchedule.js` (35), `corpusAuthorMeta.js` (31),
`ausmakerRunbook.js` (30), `operatorVoice.js` (23), `eiResearchCampaign.js`
(23), `salesSummary.js` (22), `knowledgeBase.js` (22), `eiSeedSnowball.js`
(21), `culturesCorpusApi.js` (21), `eiGoalParse.js` (20), `configMutate.js`
(20), `answerLocal.js` (19).

## 2. Non-negotiable constraints (carried over from WP1–WP7)

1. Do NOT weaken mission-fit review floors, operator gating, or moderation.
   Behaviour may move from regex to LLM/structured code, but the *decision
   quality* on the recorded fixtures must be equal or better.
2. Mutating actions **fail closed**: if the comprehension LLM call fails,
   times out, or returns unparseable JSON, the message is treated as plain
   conversation — never dispatched as work, control, or config mutation.
3. No live data wipes; ledger/state changes only via idempotent migrations.
4. Full suite (`npm test`, currently 587 files via `tests/*.test.js`) must
   pass at the end of every work package. Deploy only via
   `bash scripts/webchat-deploy/release.sh customer-03` with the eval gate.
5. Moderation (`laskoModerationPatterns.js`) keeps a **deterministic** layer.
   Regex is replaced by normalized-substring phrase matching, not by an
   LLM-only check. LLM moderation may be added on top, never instead.

## 3. Target architecture — one comprehension gateway

### 3.1 `lib/understand.js` (new)

Single entry point for every inbound chat message. Wraps and extends the
existing `intentTriage.triageIntent()` (already regex-free, already LLM-based).

```
understand(message, ctx) -> {
  intent:          'conversation' | 'status_question' | 'opinion_question'
                 | 'musing' | 'work_order' | 'campaign_control'
                 | 'agent_command' | 'schedule_request' | 'config_change'
                 | 'feedback' | 'identity_capability' | 'learning_question',
  confidence:      0..1,
  control:         null | { action: 'pause'|'resume'|'stop'|'start'|'run_now' },
  work:            null | { verb, title, author, topic, urls[], scope: 'single'|'all_by_author'|'topic' },
  schedule:        null | { kind: 'daily'|'hourly'|'weekly'|'cron'|'in'|'at', ... },
  constraints:     { max_words, no_questions, brief } | null,
  slots:           { nickname, task_ref, option_number, ... },
  is_question:     bool,
  needs_operator:  bool   // true for any mutating intent
}
```

Implementation rules:

- One LLM call, temperature 0, JSON-schema-constrained output. **Model is
  pinned to the Legate-class 27B** (`PIKO_UNDERSTAND_MODEL`, default
  `PIKO_LEGATE_MODEL` = qwen3.6:27b, served from Rodimus 192.168.0.190 via
  the chat lane). Do NOT let it fall through to the 8B triage default
  (`llama3.1:8b`) — an 8B misses exactly the musing/work-order distinctions
  this work must preserve. Parse with `JSON.parse` + explicit field
  validation (type checks, enum membership via `Set.has`) — **no regex in
  the validator**.
- Retry once on invalid JSON; on second failure return
  `{ intent: 'conversation', confidence: 0, failed: true }`.
- `needs_operator` is computed deterministically from the intent enum, not
  trusted from the model.
- Log every call (message hash, intent, confidence, latency) to the existing
  telemetry so drift is observable.
- Context (`ctx`) carries: operator flag, campaign summary line, last
  assistant turn — so follow-ups like "run it now" resolve without regex.

### 3.2 Dispatch becomes enum-switching

`server.js` chat path, `legateChat.js`, `policyGate.js`, `clarifyHandler.js`,
`dialogueManager.js` consume `understand()` output only. Every current regex
detector maps to a schema field:

| Current regex detector | Replacement field |
|---|---|
| `isCampaignStatusQuestion` (eiGoalParse) | `intent === 'status_question'` |
| `isOpinionQuestion` | `intent === 'opinion_question'` |
| `isSoftMusing` | `intent === 'musing'` |
| `looksLikeWorkOrder` + `properPossessive` | `intent === 'work_order'` + `work` slots |
| `detectCampaignControl` | `intent === 'campaign_control'` + `control.action` |
| goal parsing (title/author/topic extraction) | `work.{title,author,topic,scope}` |
| server.js learning/rabbit-hole detectors | `intent === 'learning_question'` |
| server.js nickname / word-limit / no-questions | `slots.nickname`, `constraints` |
| answerLocal capability/identity bank | `intent === 'identity_capability'` (+ existing canned answers keyed by sub-intent the LLM returns) |
| clarify option pick (`option 2`, `second`) | `slots.option_number` |
| schedule NL (`every hour`, `daily 7:30`, am/pm) | `schedule` object |

Veto semantics preserved: `campaign_control` and `work_order` still pass
through the operator gate (WP7.6) and mission-fit floors. The floors' *inputs*
change from regex booleans to schema fields; their *policy* is untouched.

### 3.3 Slash/command syntax

Exact-prefix commands (`/agent stop <id>`, `/++ name`, `/legion approve`,
`/learning`) are **not** natural language. Parse with `startsWith()` +
`split(' ')` + explicit token validation loops. Zero regex, zero LLM —
deterministic grammar, documented in `lib/slashCommands.js` (new).

## 4. Replacement taxonomy for non-chat regex

| Class | Examples | Replacement |
|---|---|---|
| A. Comprehension | all of §3.2 | `understand()` |
| B. Mechanical text | collapse whitespace, strip trailing punctuation, Unicode title normalize (`eiGoalParse.normalizeTitle`, `operatorVoice` cleanups) | `lib/text.js` (new): char-scan helpers — `collapseWhitespace`, `stripTrailingPunct`, `keepLettersDigits` (via `Intl`/codepoint checks), `splitLines`, `extractDigitRuns` |
| C. Structured formats | URLs (`eiResearchCampaign` normalize, archive.org IDs), file extensions, IPs (`apiAuth` 172.16/12), HH:MM, cron, env-file key edits (`server.js` 372/419) | `new URL()` + pathname segment walks; `path.extname`; `net.isIP` + numeric octet compare; manual `HH:MM` parse (`split(':')` + range check); env edit via line array + `startsWith(key + '=')` |
| D. Validation / allowlists | `CULTURE_CAPABILITY_RE`, name/id validation, `^[a-z0-9_]+$` style checks | `startsWith()` over an allowlist array; per-char classification loops in `lib/text.js` (`isSafeName(s, alphabet)`) |
| E. Output structure filters | `operatorVoice` job-id strips, `Progress —`/`Verdict:` line filters, `legateChat` dedupe headers | line-based structural filters (`splitLines` + `startsWith`); job-id removal via token scan (`job_` prefix + hex-char loop) |
| F. Keyword topicality | thread classification lists in `eiResearchCampaign` (giza/abydos/…), `frontDesk`/`answerLocal` domain hints | normalized-lowercase `includes()` over phrase arrays; where the check gates *routing*, move into `understand()` instead |
| G. Moderation | `laskoModerationPatterns` | normalized text (lowercase, collapse whitespace via `lib/text.js`) + phrase-array `includes()`; keep coverage identical, add fixture tests proving every previously-matched sample still matches |

## 5. Work packages

### WP8.0 — Foundations (no behaviour change)
- Create `lib/text.js` (class-B helpers) and `lib/slashCommands.js`, fully
  unit-tested including Unicode cases (Göbekli, curly quotes, em dashes).
- Create `lib/understand.js` per §3.1, initially *shadow mode*: called on
  every chat message, result logged, **not yet used for dispatch**.
- Build the **evaluation battery** (primary safety gate for WP8.2–8.4):
  1. **~2,000 synthetic case studies**, generated by a stronger model,
     covering every intent category (status / opinion / musing / control /
     work-order / schedule / nickname / feedback / identity / learning) and
     deliberately perturbed: typos, terse phrasing, Aussie idiom, mixed and
     self-correcting intents ("pause the campaign — actually no, just tell
     me how it's going"), possessive-title edge cases, contractions
     (How's/It's vs Petrie's). Store as JSONL fixtures with labels.
     Labels are verified by (a) running the current regex floors as a first
     pass and (b) human/agent review of every case where the generator's
     intended label and the regex verdict disagree.
  2. **~200 real messages** from live chat history + existing test
     fixtures, labeled with current regex-floor decisions.
  This battery is an **offline eval set — no fine-tuning**; the only
  "ingestion" is a handful of the hardest cases embedded as few-shot
  examples in the understand() prompt (those must then be excluded from
  scoring). `scripts/understand-eval.js` runs the full battery against
  understand() and prints per-category accuracy + every miss.
- Extend `scripts/check-no-routing-regex.js` → `scripts/check-no-regex.js`:
  scans **all** of `lib/`, `server.js`, runtime `scripts/`; runs in *ratchet
  mode* — a committed `regex-baseline.json` holds current per-file counts;
  CI fails if any file's count increases; counts only go down.
  (The strip-strings/comments tokenizer already in the script is reused.
  The checker itself is the single exempted file, or is rewritten with a
  char-scan matcher — either is acceptable; prefer the rewrite.)

### WP8.1 — Routing core (quick win, fixes the failing lint)
- `actionRouter.js:39`: replace `CULTURE_CAPABILITY_RE` with
  `['scribe.', 'translation.', 'culture.', 'research.scrape'].some(p => capId.startsWith(p))`.
- `npm run lint:routing` green again; add `answerLocal.js`, `eiGoalParse.js`,
  `legateChat.js`, `clarifyHandler.js`, `dialogueManager.js`,
  `agentChatCommands.js`, `frontDesk.js` to the strict (zero, non-ratchet)
  scope as each later WP lands.

### WP8.2 — Legate comprehension cutover (highest risk, do carefully)
- Flip `understand()` from shadow to authoritative for the Legate/EI chat
  path. Delete regex from `eiGoalParse.js` (floors + goal parsing),
  `legateChat.js` detectors, `legateTools.js` grounding token checks
  (numbers via `text.extractDigitRuns`, state tokens via `includes`).
- Title/author/topic extraction moves to `work` slots; downstream
  `addLead`/seek-query normalization uses `lib/text.js` only.
- Acceptance (gated on the WP8.0 battery): understand() matches or beats
  the regex floors on every category of the 2,000+200 battery; **zero**
  false work-dispatch on musing/status cases; operator gate tests
  (`legateControlGate`) still pass; `control_denied` path unchanged.
  Shadow mode is demoted to a **final sanity check**: a few hours of live
  traffic with zero unexplained disagreements, reviewed before cutover —
  the battery, not the shadow window, is the primary gate.

### WP8.3 — Chat periphery
- `answerLocal.js`: canned answers keyed by `understand()` sub-intent.
- `clarifyHandler.js`, `dialogueManager.js`: follow-up/option resolution via
  `slots` + last-turn context.
- `agentChatCommands.js`, `frontDesk.js`: slash commands → `slashCommands.js`;
  domain hints → class F.
- `instantChat.js`, `semanticBouncer.js` residue.

### WP8.4 — `server.js` chat path (biggest file, 187 hits)
- Learning/status/tone/nickname/short-reply/schedule-NL detectors →
  `understand()` fields.
- Schedule NL (`every hour from…`, am/pm, `daily 7:30`) → `schedule` object
  from the LLM, then **deterministically validated** (ranges, cron via a
  parser routine, not regex) before any legion mutation.
- Env-file edits, path/IP/name validation → classes C/D.
- Non-chat utility regex in `server.js` (markdown section splits, `\n{3,}`
  squeezes) → `lib/text.js`.

### WP8.5 — EI corpus & campaign parsing
- `eiResearchCampaign.js`, `eiSeedSnowball.js`, `culturesCorpusApi.js`,
  `corpusAuthorMeta.js`, `eiWorkPlanner.js`, `eiArticleWriter.js`,
  `eiPlatformEval.js`, `eiAgentTools.js`, `knowledgeBase.js`,
  `eiCorpusContentReview.js`.
- URL canonicalization via `URL`; author/title cleanup via `text.js`;
  thread-topicality keyword lists via class F; public-domain year check via
  `extractDigitRuns` + numeric range. Cooldown-key and ledger formats are
  data, not regex — untouched.

### WP8.6 — Voice & business/legacy
- `operatorVoice.js` → class E line/token filters (behaviour locked by
  existing voice tests + new fixtures of raw→polished transcripts).
- `nlLegionSchedule.js`, `ausmakerRunbook.js`, `salesSummary.js`,
  `configMutate.js`, `legionScheduleMutate.js`, `operationsMutate.js`,
  `taskRead.js`, `queueRead.js`, `salesSyncStatus.js`, `tenantRegistry.js`,
  `agentBriefWizard.js`, `agentMissionPlanner.js`, `planner.js`,
  `agentReview.js`, `intents.js` (duration/cron grammar → token parser).

### WP8.7 — Safety & auth
- `laskoModerationPatterns.js` → class G with a proof-of-coverage fixture
  test (every sample the regex matched must still match).
- `apiAuth.js` private-range check → `net.isIP` + octet math.
- `safeHref.js` audit (already 0 hits, confirm).

### WP8.8 — Sweep & enforcement
- `rg` + the checker across the whole tree; clear stragglers in remaining
  `lib/` files (~40 small files) and runtime scripts.
- Flip `check-no-regex.js` from ratchet to **zero-tolerance** for production
  code; wire into `npm test` / CI / the deploy eval gate.
- Tests and one-off dev scripts are exempt but listed in the report the
  checker prints.

### WP8.9 — Deploy & 24h verification
- `npm test` (all 587+ files) green; deploy via `release.sh customer-03`.
- **200-run live smoke test**: replay a 200-case sample of the battery
  (weighted toward control/work-order/musing) against the deployed
  instance via the chat API; assert intent + dispatch outcome per case
  (script: `scripts/understand-smoke.js`). Inference lands on Rodimus
  (chat lane), so 200 runs are cheap.
- Manual live probes (same set as WP7): status question, opinion question,
  musing, work order, campaign control as non-operator (`control_denied`),
  campaign control as operator, slash commands, nickname set, schedule
  request.
- 24h exit criteria: campaign cycles keep seeking/keeping at WP7 rates;
  no rise in `understand()` failure/fallback rate above 2%; median added
  chat latency from the comprehension call < 800 ms; zero regex in
  production per checker; no false work dispatch in transcripts.

## 6. Ordering, risk, and rollback

- Order is WP8.0 → 8.1 → 8.2 → … strictly; 8.0's eval battery is the
  primary gate for 8.2, with a short (few hours) shadow-mode disagreement
  review as the final check before cutover.
- Each WP is a separate commit/deployable; rollback = revert the commit
  (state files are untouched by this work).
- Known costs to accept: +1 LLM call per chat message (mitigate with the
  small triage model already configured in `intentTriage.getTriageModel`);
  slight nondeterminism in comprehension (mitigated by temp 0, fixtures,
  fail-closed dispatch).
- Out of scope: regex inside third-party dependencies; regex in test files
  (allowed, reported); the checker's own tokenizer if the rewrite proves
  impractical.

## 7. Definition of done

1. `node scripts/check-no-regex.js` → zero hits in `lib/`, `server.js`,
   runtime scripts.
2. Full test suite green, including new fixture corpora (comprehension,
   voice polish, moderation coverage).
3. Live verification per WP8.9 passes; 24h criteria met.
4. Every chat message demonstrably flows through `understand()` before any
   routing decision (assert via telemetry: routed actions must carry the
   understand-call id).
