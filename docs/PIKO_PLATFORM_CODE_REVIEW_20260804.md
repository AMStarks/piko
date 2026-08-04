# Piko / Legion platform code review — 2026-08-04

Status: FINDINGS (no code changed by this review)
Scope: `webchat-piko/` + `adapters/`, with the production-SaaS lens requested by the operator.
Method: five parallel deep audits (chat/routing, knowledge/retrieval, orchestration/jobs,
security/multi-tenancy, reliability/ops) + live verification against customer-03.

---

## Verdict

Piko today is a capable **single-tenant, single-box trial spine**. It is not yet a
production SaaS virtual worker, and the gap is not one bug — it is five structural
deficits that keep producing the incidents you keep hitting:

1. **Silent-failure culture** — 618 empty `catch (_)` blocks (92 in lib, 113 in server.js
   alone, rest in scripts/adapters). Failures degrade into "Piko forgot" instead of alerts.
2. **Convention instead of enforcement** — tenancy, auth, config, and data contracts are
   env-var conventions with fail-open defaults, not enforced boundaries.
3. **Heuristic text plumbing between LLM stages** — substring alias matching, token-overlap
   retrieval, sentence-as-title parsing. Every recent incident (Osireion×3) is this class.
4. **No observability** — pino is a dependency but ~unused (~3 requires vs ~301 console.*);
   no metrics endpoint worth the name; p95 latency and job failure rate are unanswerable.
5. **A 12,731-line god file** — `server.js` holds ~166 routes, 25 crons, chat pipeline,
   env mutation, and adapter glue. Blast radius of any change is the whole product.

Cross-cutting numbers: 173 lib modules · 129 test files · **404 distinct `PIKO_*` env keys**
with boot validation covering only PORT + 3 URLs · ~110 non-atomic `writeFileSync` state
writers · 25 in-process crons.

## Why we keep stumbling (root-cause pattern)

Every recent incident followed the same arc:

> A **heuristic** (alias substring, token overlap, title parse, phrase floor) silently
> produced a wrong intermediate value → downstream stages **trusted it** (no cross-check,
> no confidence, no log) → a **fail-open or destructive default** (purge, fallthrough,
> hard delete) converted the wrong value into user-visible damage → **no telemetry**
> existed to catch it before a human did.

Concrete instances:
- `osireion` aliased on the Giza thread → wrong stance pack → confident "corpus has nothing".
- "Yes please; prioritise research of the Osireion." parsed as a *book title* → mission-fit
  purged a genuinely relevant Petrie keep (hard delete, no undo) → shrug reply.
- `thread_dossier` got `osireion`, planner dropped it as `unknown_thread` (and **still
  does** — the hotfix only fixed the tool runner, not `eiWorkPlanner.normalizePlan`).

The fix philosophy that follows from this: **fail closed, cross-check heuristics, make
destruction reversible, and log every routing decision.**

---

## Live-verified state (customer-03, 2026-08-04)

| Check | State | Meaning |
|---|---|---|
| `PIKO_WEBHOOK_SECRET` | **unset** | Webhooks fail OPEN right now |
| `PIKO_OLLAMA_ONLY` | **unset** | Cloud LLM fallback code path enabled (latent — no cloud keys present) |
| `PIKO_OLLAMA_QUEUE` | **unset** | LLM serialization off; load collapse risk |
| `PIKO_API_AUTH` | `lan` | Any private-IP caller gets full API |
| Listener | `0.0.0.0:3021` | Wide open if firewall fails |
| `PIKO_ADMIN_PASSWORD` | set | Admin gate active (good) |
| `PIKO_UNDERSTAND_AUTHORITATIVE` | `1` | 27B routing live (good) |
| `ANTHROPIC/OPENAI_API_KEY` | unset | No active exfil today |

---

## CRITICAL findings

### Security (act this week)

| # | Finding | Where |
|---|---|---|
| S1 | `/webhook/inventory-alert` has **no auth at all**; other webhooks fail open when secret unset (**live**) | `server.js:8822`, `:8712` |
| S2 | Channel allowlist fails **open**: no list ⇒ allow all; webchat always allowed. Adapters forward *any* inbound Discord/Slack/WhatsApp message to `/api/chat` → strangers become operators | `server.js:1125`, `adapters/*/bot.js` |
| S3 | Chat-driven config mutation (incl. proactive → `full_auto`) with no operator identity binding; confirmable with "yes" | `lib/configMutate*.js`, `server.js:4482` |
| S4 | `/task` interpolates user text into shell/docker with API key on argv — chat-to-RCE surface | `server.js:2788–2835` |
| S5 | `/api/ios-hub` reaches `execSync(..., {shell:true})` and the full YOLO Python tool registry without a YOLO-key check inside the handler | `server.js:2203–2456, 2684` |
| S6 | YOLO tool registry = SQL, email, Stripe refunds, shell, ERP writes behind one shared key (`===` compare, shares `PIKO_HEALTH_API_KEY` fallback) | `lib/yoloBridge.js`, `yolo_protocol.py` |
| S7 | Python sandbox defaults to **host** mode with process env; docker mode mounts entire DATA_DIR read-write | `lib/pythonSandbox.js:21,66` |
| S8 | OAuth/bot tokens written into `.env` on disk; sessions/tokens/PII plaintext across `data/` | `server.js:449, 10444, 11665` |

### Data integrity

| # | Finding | Where |
|---|---|---|
| D1 | Mission-fit **purge is a hard delete** (SQLite row + files) with no soft-delete/undo; fires on fail-closed paths and false named-work contracts; leaves **orphaned corpus notes + RAG chunks** that keep winning retrieval after the source is gone. Item #966 (Petrie Abydos) unrecoverable in-app | `eiMissionFitReview.js:442,688`, `culturesCorpusApi.js:89` |
| D2 | Job status transitions unlink-then-write — crash mid-transition **loses the job record** | `agentJobs.js:43–60` |
| D3 | ~110 whole-file JSON `writeFileSync` sites with no temp+rename — kill -9 corrupts intents/mind/jobs/campaign state | repo-wide |
| D4 | `listNotes` slices readdir order **before** sorting by `updated_at` — newest digests invisible to retrieval/dossiers/stances once corpus > 2×limit files | `eiCorpusNotes.js:345–357` |

### Routing / retrieval correctness (the incident class)

| # | Finding | Where |
|---|---|---|
| R1 | Planner still drops `thread_dossier: "osireion"` as unknown_thread — the hotfix fixed the tool, **not** `normalizePlan` | `eiWorkPlanner.js:160–166` |
| R2 | `matchThreadId` substring scoring misroutes: bare `"atlantis"` → **flood-myths**; `"Plato on justice"` → atlantis; `"flood insurance"` → flood-myths; short aliases (`flood`, `seti`, `anden`, `plato`) are landmines | `eiThreadDossiers.js:81–98` |
| R3 | `opinionRetrievalQuery` concatenates history before thread-matching — Giza history outvotes a current-message Osireion ask (recreates the incident) | `legateChat.js:909`, `eiStancePositions.js:295` |
| R4 | `parseNamedWork` conversational gate incomplete: "Keep researching the Osireion", "Focus research on Abydos", "Find me something on X" still become singular book titles → purge weapon armed | `eiGoalParse.js:568–591` |
| R5 | Decide model falls back to **`llama3.1:8b`** when `PIKO_LEGATE_MODEL` unset — silently downgrades all routing to the model understand() explicitly refuses | `legateChat.js:498–501` |
| R6 | `schedule_request` / `config_change` / `agent_command` intents classify correctly then hit decide, which has **no handlers** for them — accidental dispatch or fallthrough | `understand.js` vs `legateChat.js:72–80` |
| R7 | Authoritative `campaign_control`/`work_order` understanding only feeds **veto** floors — decide can drop "pause the campaign" | `legateChat.js:350–423` |

### Reliability / ops

| # | Finding | Where |
|---|---|---|
| O1 | Cloud LLM fallback (Anthropic/OpenAI via litellm) is default-ON in `ai()` unless `PIKO_OLLAMA_ONLY=1` — tenant data exfil is one env-var away | `llm.js:144–182` |
| O2 | Release script runs `npm install ... \|\| true` — broken deps still deploy | `release.sh:42` |
| O3 | Job timeout abandons in-flight Legion scrape runs (no cancel API) — corpus mutates after "job failed"; stale reaper doesn't set `cancel_requested` so zombies keep working | `agentWorker.js:401`, `agentJobs.js:309` |
| O4 | Config: 404 env keys, no schema; typo = silent feature-off/insecure default | `lib/config.js` |
| O5 | 12,731-line server.js; 25 crons on the chat event loop; sync full-file reads on hot paths | `server.js` |

---

## HIGH findings (condensed)

**Chat flow**
- `identity_capability` / `feedback` fall through to the ungrounded 8B persona — wrong for a virtual worker; should be grounded local answers (`legateChat.js:1101`).
- Recover path omits `lastAssistant`/`history` that the main opinion path passes — follow-up opinions after a decide failure retrieve poorly (`legateChat.js:1254`).
- Expert-opinion success path logs nothing (model/latency/thread/material) — quality invisible in prod.
- Worst-case opinion turn budget ≈165s with the session lock held; hedge retries stack GPU work; client abort doesn't cancel Ollama.
- Non-authoritative mode (env off) = phrase floors only, veto-only — unsafe as a fallback posture.
- `sessionStore` fails open to empty history when SQLite is missing — silent amnesia.
- Status/learning lookup synthesis uses the session 8B model instead of the Legate lane.

**Knowledge layer**
- Opinion lane never uses the LanceDB semantic search (`searchCorpus`) that already exists and works in article-writing — token overlap misses paraphrases.
- Stance/dossier staleness checked by note **count** equality only — same-count content changes never refresh.
- `findPositionForQuery` weak token fallback can attach an unrelated stance.
- Tokens ≤3 chars ignored: "Set", "Ra", "Geb" queries retrieve nothing.
- `THREAD_DEFS` ontology duplicated in 4+ places (dossiers, campaign, planner prompt, article writer) — drift already happened once.
- No file locking or temp+rename on notes/positions/dossiers — concurrent digest + stance jobs can tear files.

**Orchestration**
- Replan has no duplicate-step fingerprint — confirmed cause of the doubled `research_campaign start`.
- Inner tool timeouts (seek 10 min ×2) exceed the 20-min job budget — guaranteed overrun on replan.
- Outcome messaging can't distinguish `search_error` / `no_candidates` / `all_rejected` — hence the "not quite where I want it yet" shrug after a purge.
- Two workers (in-process + standalone script) share the file queue with no lease/owner.
- `tenant_id` stamped on jobs but never enforced at execution.
- 3 crons (belief/memory/weekly-retro) bypass tenant gating; campaign setInterval ungated at the schedule site.

**Security (high tier)**
- `PIKO_API_AUTH=lan` default trusts any private-IP socket — live on customer-03 with a 0.0.0.0 listener.
- Admin gate fully optional: no `PIKO_ADMIN_PASSWORD` ⇒ all protected-path checks skipped.
- `/api/agents/*` (enqueue/cancel jobs) not on the admin-protected list.
- Chat history IDOR: any authed caller can read/clear/inject **any** `sessionId`.
- Harvested web/PDF text flows into planner/chat prompts with no content-vs-instruction boundary (prompt injection into a system that can dispatch work and mutate config).
- `conversations.db` has no tenant column; `culturesDataRoot()` defaults to the **repo** data dir, not under `PIKO_DATA_DIR`.

**Reliability (high tier)**
- Unbounded JSONL: `piko-activity.jsonl` (append, full-file read on hot path), `campaign_cycles.jsonl`, scorecards, HQ audit logs.
- `notification-feed.jsonl` read-modify-write races drop entries.
- No `unhandledRejection`/`uncaughtException` handlers.
- Eval-gate = one chat smoke + health; would not have caught any of the three retrieval bugs. Zero integration/retrieval tests (129 unit files vs 219 lib files).
- No staging tenant; deploys restart the process mid-jobs (`orphaned_by_restart` exists as a category because of this).
- Repo hygiene: 73M/66M export .txt files, 137M Texts/, __pycache__, four unrelated projects in one repo.

---

## Recommended sequencing

### Phase 0 — this week (config + guardrails, mostly env/one-liners)
1. Set on all tenants: `PIKO_OLLAMA_ONLY=1`, `PIKO_OLLAMA_QUEUE=1`, `PIKO_WEBHOOK_SECRET`,
   `PIKO_API_AUTH=strict` (or firewall-verified LAN), `PIKO_LEGATE_MODEL` explicit.
2. Auth the inventory webhook; make webhook auth fail closed (S1).
3. Channel allowlist fail closed (S2). Disable `/task` on customer tenants (S4).
4. Remove `|| true` from release.sh npm install (O2).
5. Fail boot if `PIKO_LEGATE_MODEL`/`PIKO_UNDERSTAND_MODEL` unset on Legate tenants (R5).

### Phase 1 — stop the incident class (1–2 weeks)
6. Word-boundary thread matching; dedupe aliases across threads; fix atlantis/flood-myths (R2).
7. Planner alias resolution in `normalizePlan` (R1) — completes the hotfix.
8. Opinion thread-match on current message only; merge `searchCorpus` RAG into opinion material (R3 + HIGH).
9. `parseNamedWork`: singular title only when quoted / possessive / by-author; topic-phrase asks never become titles (R4).
10. Purge → soft-delete with quarantine window + tombstone (source URL for re-ingest); cascade-delete notes + RAG chunks (D1).
11. Fix `listNotes` ordering; index notes (D4).
12. Replan step fingerprinting; outcome taxonomy (`search_error`/`no_candidates`/`all_rejected`/`partial_keep`) wired into Legate copy (orchestration HIGHs).

### Phase 2 — platform hardening (2–6 weeks)
13. `atomicWriteJson` everywhere; migrate jobs + campaign state to SQLite (D2, D3).
14. Config schema (zod) over the 404 envs; strict mode fails boot on unknown/missing (O4).
15. Handlers for `schedule_request`/`config_change`/`agent_command`; drive control/work from authoritative understanding with floors as veto only (R6, R7).
16. Structured logging (pino) + `/metrics` (chat p95, queue depth, job failure rate, Ollama errors); lint-ban empty catches; unhandledRejection handler.
17. Legion run cancel API + job-budget-derived tool timeouts + worker leases (O3).
18. Grounded identity/feedback handlers; log expert-opinion successes.

### Phase 3 — SaaS foundations (before any second real customer)
19. Extract server.js into routes/pipeline/scheduler/integration modules; move background work out of the chat process.
20. Real tenant isolation: tenant_id on every row, tenant-scoped data roots (fix `culturesDataRoot`), per-tenant keys, no shared YOLO/health keys, session IDOR fixes.
21. Tenant-configurable ontology (thread defs, prompts, agents) — EI becomes a config pack, not hardcoding.
22. Privilege planes: chat ≠ config ≠ YOLO ≠ ERP; dual control for money actions; content-vs-instruction boundary for harvested text.
23. Staging tenant + zero-downtime deploys + retrieval golden tests in the eval gate.
24. Secrets: KMS/manager, no OAuth in .env, encrypt data at rest, retention/export/delete per tenant.

---

## Source audits

Full findings with file:line detail live in the five audit transcripts (chat/routing,
knowledge/retrieval, orchestration/jobs, security/multi-tenancy, reliability/ops),
2026-08-04. This document is the synthesis; the transcripts are the appendix.
