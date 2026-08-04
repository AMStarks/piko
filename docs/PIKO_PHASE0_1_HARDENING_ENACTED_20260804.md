# Phase 0 + Phase 1 hardening — enacted 2026-08-04

Status: **ENACTED** on customer-03 (EI) and customer-01 (AusMaker).
Source plan: `docs/PIKO_PLATFORM_CODE_REVIEW_20260804.md` (Recommended sequencing Phase 0–1).

## What changed

### Phase 0 — config + guardrails
| ID | Change |
|---|---|
| P0.1 | Tenant `.env`: `PIKO_OLLAMA_ONLY=1`, `PIKO_OLLAMA_QUEUE=1`, `PIKO_WEBHOOK_SECRET` (48-hex), `PIKO_LEGATE_MODEL=qwen3.6:27b`, `PIKO_UNDERSTAND_MODEL=qwen3.6:27b` |
| P0.2 | All webhooks fail closed when secret unset; `/webhook/inventory-alert` now requires auth |
| P0.3 | Channel allowlist fail closed (`lib/channelAllowlist.js`); opt-in via `PIKO_CHANNEL_ALLOWLIST_OPEN=1` |
| P0.4 | `/task` disabled unless `PIKO_TASK_ENDPOINT=1` |
| P0.5 | `release.sh` npm install no longer `\|\| true` |
| P0.6 | Boot fails if authoritative understand without model pins; decide refuses silent 8B fallback |

### Phase 1 — stop the incident class
| ID | Change |
|---|---|
| P1.1 | Word-boundary thread matching + exclusive aliases (`matchThreadId`); short landmines removed |
| P1.2 | Planner/tool use `resolveThreadAlias` (exact) — `osireion`→`abydos`; invented ids stay unknown |
| P1.3 | Opinion retrieval prefers current-message topic; merges LanceDB RAG into opinion material |
| P1.4 | Singular titles only with quotes / possessive / by-author; conversational research → topic seek |
| P1.5 | Mission-fit purge → quarantine (tombstone + file move + note/RAG cascade); 14-day cleanup cron |
| P1.6 | `listNotes` sorts by mtime/`updated_at` before limit slice |
| P1.7 | Replan step fingerprint dedup; seek outcome taxonomy (`search_error` / `no_candidates` / `all_rejected` / `partial_keep`) in Legate completion copy |

### Deploy tooling
- `eval-gate.sh` chat timeout 90→180s; `release.sh` post-restart sleep 4→12s (cold 27B + queue).

## Files touched (primary)

- `webchat-piko/lib/config.js`, `channelAllowlist.js`, `legateChat.js`, `eiThreadDossiers.js`, `eiWorkPlanner.js`, `eiAgentTools.js`, `eiGoalParse.js`, `eiStancePositions.js`, `eiCorpusNotes.js`, `eiCorpusRag.js`, `eiMissionFitReview.js`, `culturesCorpusApi.js`, `eiWorkerRuntime.js`, `tenantBackgroundJobs.js`
- `webchat-piko/server.js`
- `webchat-piko/tests/phase01Hardening.test.js` (+ updates to legate/wp10/mission-fit tests)
- `scripts/webchat-deploy/release.sh`, `eval-gate.sh`
- `docs/PIKO_PLATFORM_CODE_REVIEW_20260804.md`

## Tests

```
npm test  →  669 pass / 0 fail  (includes no-regex ratchet)
```

## Live probes (customer-03)

### A — Osireion opinion
Ask: *Have you come to any conclusions on the Osireion and its possible origins?*

- Route: `legate_answer` / `opinion_question`
- Grounded on Petrie / Temenos of Osiris / Abydos — **not** “insufficient corpus”, **not** Giza-only
- Sample: concludes origins unresolved; cites Petrie excavation/stratigraphy evidence

### B — Research follow-up
Ask: *Yes please; prioritise research of the Osireion.*

- Dispatched job; seek query **`Osireion PDF`** (not sentence-as-title)
- Plan included `thread_dossier` → **`abydos`**
- Mission-fit: **keep=1, purged=0** (Petrie *Abydos* kept; no false hard-delete)
- `outcome_code=partial_keep` with explicit outcome line (no generic shrug alone)

### C — Webhook auth
- `POST /webhook/inventory-alert` without secret → **401**
- `POST /api/webhooks/events` without secret → **401**

## Deploy stamps

| Tenant | Host | Result |
|---|---|---|
| customer-03 | optimus-wan `:3021` | code live + eval-gate PASS (after gate timeout fix) |
| customer-01 | rodimus-wan `:3000` | `20260804-1159-4ab1868d` RELEASED, gate PASS |

## Deferred (Phase 2–3 — not in this enact)

- `server.js` decomposition, SQLite migration of jobs/campaign state, config schema, pino/metrics
- Real tenant isolation / secrets manager / privilege planes
- Legion scrape cancel API / worker leases
- Soft-delete restore UX (helpers exist; no chat command yet)
- Review still sometimes grades Petrie *Abydos* as “too broad” for an Osireion topic ask — product judgment, not the false-empty / false-purge class

## Commits

- `69d09d6` Harden Phase 0+1: fail-closed guards and stop the Osireion incident class
- `8617662` Give post-restart eval-gate enough time for cold 27B + Ollama queue
