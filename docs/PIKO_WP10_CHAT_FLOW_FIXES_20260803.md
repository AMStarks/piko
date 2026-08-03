# WP10 — Chat flow fixes: decide-fail honesty, single-comprehension turns

Date: 2026-08-03
Status: ENACTED (release `20260804-0816-5be618ed`; live probes 2026-08-03T22:18Z)
Depends on: WP8 (understand() authoritative), WP9 (Rodimus VRAM partition, release `20260803-2254-44a9e22f`)

## Triggering incident (measured)

Operator asked: "It sounds interesting. Have you come to any conclusions on the
Osireion and its possible origins?"

- `understand()` classified it correctly: `opinion_question`, confidence 0.95,
  failed:false, 6.0 s (journal 13:02:26Z).
- The Legate decide call (18.2 s on the 27B) then hit a fail path, and the user
  saw the hard-coded `DECIDE_FAIL_REPLY`: "I didn't parse that cleanly — want me
  to treat it as a work order?"
- No `floor_override` line and no decide-failure log exists for the turn — the
  fail reason travels in the API response (`legate.reason`) but is never logged,
  so the exact fail path could not be identified from the journal. That gap is
  itself F2 below.

Root architecture issue: each turn runs TWO 27B calls (understand → decide).
Decide re-derives what understand already knew, and every decide-fail path
returns `DECIDE_FAIL_REPLY` without consulting the (valid, non-mutating)
understanding. Latency is also doubled (~4 s + 6–18 s of serialized 27B time).

## Fixes

### F2 — Instrument decide failures (do first)
In `lib/legateChat.js`, log every `decideFailResult(...)` like the
`[understand]` lines: reason, msg hash, and first ~200 chars of the raw model
output that failed to parse. Also log when `applyVetoFloors` runs with
`floorsOk:false`. No behaviour change.

### F1 — Decide-fail must consult understanding
In `decideLegateTurn` / `handleLegateChatTurn`: when `opts.understanding` is
present, `failed:false`, and intent is non-mutating (`conversation`, `musing`,
`opinion_question`, `status_question`, `learning_question`, `feedback`,
`identity_capability`), a decide failure must NOT surface `DECIDE_FAIL_REPLY`.
Instead:
- `status_question` → answer via deterministic lookups (`['campaign','activity']`)
  + `synthesizeLookupReply` (8B voice), same as the status floor path.
- everything else → fall through to the main chat persona (`reply: null,
  fallthrough: true`), same as the benign-answer path.
`DECIDE_FAIL_REPLY` remains only for: understanding failed/absent, or intent is
mutating and decide could not produce a valid payload. Unit tests for each
branch (mock decide throwing / returning invalid JSON, understanding fixed).

### F3 — Skip decide for non-mutating intents
In `handleLegateChatTurn`: when authoritative understanding returns a
non-mutating intent, do not call `decideLegateTurn` at all:
- `conversation` / `musing` / `opinion_question` → fallthrough to chat persona.
- `status_question` → lookups + 8B synthesis (as above).
- `learning_question` / `feedback` / slash-command intents → existing handlers.
Only `work_order`, `campaign_control`, `agent_command`, `schedule_request`,
`config_change` proceed to decide (+ floors + work_confirm as today).
Effect: one 27B call for most turns (~half the latency), decide-fail surface
gone for benign traffic. The veto floors remain in place on the mutating path.
Update `tests/legateRoutingAcceptance.test.js` expectations accordingly — the
acceptance battery must still pass with identical final routing outcomes.

### F4 — Decide output discipline
Decide currently writes essay-length `reply` text the floors discard (observed
~550 chars, 10+ s of 27B generation) and risks JSON truncation at
`max_tokens: 400`. In the decide prompt: `reply` must be ≤ 2 short sentences
(the persona voices the real answer). Raise `max_tokens` to 600 as a guard.

### F5 — Neutral fail wording
Change `DECIDE_FAIL_REPLY` to a neutral clarifier ("I didn't quite catch that —
can you say it another way?"). The current wording invites false work orders.

### F6 — Config-default hygiene
Align code defaults with the 8192 lane standard so tenants without env pins
don't regress into num_ctx reload churn (Ollama 0.23: any num_ctx change = full
model reload):
- `lib/legateChat.js` `PIKO_LEGATE_NUM_CTX || 4096` → `|| 8192`
- `lib/legateTools.js` same
- `lib/understand.js` `PIKO_UNDERSTAND_NUM_CTX || 4096` → `|| 8192`

## Separate ops decisions (not in the WP10 deploy)

- **F7 — customer-01 (AusMaker)**: shares the Rodimus 8B lane, still runs old
  code with 512-ctx casual calls; when it chats it can churn the shared 8B.
  Env-only mitigation: add `PIKO_CASUAL_NUM_CTX=8192`, `PIKO_TRIAGE_NUM_CTX=8192`
  to its .env + service restart, in daylight. A full release would pull the
  entire WP8/WP9 delta — do not do that casually.
- **F8 — Optimus worker lane audit**: mixed num_ctx on worker call sites
  (4096/1024 vs 8192) and qwen3:14b + llama3.2-vision sharing 2 GPUs unpartitioned.
  Background-only impact; same treatment as WP9 when prioritized.
- **F9 — 27B concurrency**: agent review shares :11435 with chat comprehension;
  optional `OLLAMA_NUM_PARALLEL=2` on ollama-27b (~+1 GB KV, headroom ~4.8 GB)
  if review-vs-chat queuing shows up in the 24 h watch. Evaluate after F3.

## Verification

1. `npm test` green including new F1/F3 unit tests; regex lint stays zero.
2. Deploy customer-03 via `release.sh` (eval gate must pass).
3. Live probes: opinion question ("Have you come to any conclusions on the
   Osireion...?"), status question, casual greeting, and a real work order
   ("Please find Petrie's Giza survey") — assert: no DECIDE_FAIL_REPLY on the
   first three, dispatch ack + queued job on the fourth, decide called ONLY on
   the fourth (journal: exactly one 27B POST for benign turns).
4. Latency: benign turns ≤ ~8 s end-to-end (one 27B call + 8B voice).
5. Journal shows `[decide_fail]` instrumentation lines exist (grep for the
   logger, force one failure in a test env if needed).
6. Zero `loading model` events on both Rodimus lanes during probes.

## Rollback

Standard release rollback (pre-snapshot tar + service restart). No env or
infra changes in this WP besides code deploy.
