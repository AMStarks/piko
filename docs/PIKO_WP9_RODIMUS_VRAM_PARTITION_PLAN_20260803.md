# WP9 — Rodimus VRAM Partition (Tier 3, the complete fix)

Date: 2026-08-03
Status: ENACTED (2026-08-03; release `20260803-2151-ac4daa27`)
Depends on: WP8 (understand() authoritative, deployed `20260803-1935-761b076f`)

## Problem statement (measured, not guessed)

Rodimus (192.168.0.190) runs one Ollama 0.23.2 instance on 5 GPUs
(idx 0: 3070 Ti 8 GB, idx 1–3: 3080 10 GB, idx 4: 3070 Ti 8 GB — ~46 GB total).

Measured on 2026-08-03:

- `llama3.1:8b` (4.9 GB weights) is resident at **20.1 GB VRAM**. Cause:
  `OLLAMA_NUM_PARALLEL=4` × client `num_ctx=8192` = 32k tokens of f16 KV cache,
  spread across all 5 GPUs by `OLLAMA_SCHED_SPREAD=1`.
- `qwen3.6:27b` (17 GB weights, ~20 GB loaded with sane KV) cannot co-reside.
  Every `understand()`/Legate/agent-review call evicts the 8B or waits.
- Journal: **1,261 load/evict/unload events in 6 hours.**
- Usage has inverted: last 200 LLM calls = 80× qwen3.6:27b, 1× llama3.1:8b.
  The idle model owns the VRAM; the workhorse gets evicted.
- The `10-context.conf` drop-in sets `OLLAMA_NUM_CTX=2048` — that is not a real
  Ollama env var on 0.23.x (no effect). Context is driven per-request by the app.
- `gemma3:27b` (17 GB disk) has zero recent usage. `llama3.2-vision:11b` is
  served from the Optimus worker lane, not Rodimus.

## Why partitioning alone is NOT the complete fix

The 8B at its current 20.1 GB footprint does not fit in any two-GPU partition.
Partitioning only works after the footprint fixes. The complete fix is four
pieces, in order:

1. **Footprint discipline** — parallel=1–2, q8_0 KV cache. 8B: 20.1 GB → ~6.5 GB.
   27B: ~27 GB → ~19–20 GB.
2. **Physical partition** — two systemd Ollama instances pinned to disjoint
   GPU sets via `CUDA_VISIBLE_DEVICES`. Eviction becomes physically impossible.
3. **Routing** — each model's call sites point at its instance's port.
4. **Verification** — churn count, residency, latency, and 24 h watch with a
   5-minute rollback path.

## Target layout

| Instance | Port | GPUs (`CUDA_VISIBLE_DEVICES`) | VRAM budget | Model | Expected use |
|---|---|---|---|---|---|
| `ollama.service` (existing) | 11434 | `0,4` (2× 3070 Ti = 16 GB) | ~6.5 GB | llama3.1:8b | chat replies, triage, adapters, any legacy caller |
| `ollama-27b.service` (new) | 11435 | `1,2,3` (3× 3080 = 30 GB) | ~19–20 GB | qwen3.6:27b | understand(), Legate decide, agent review |

Port choice rationale: `:11434` keeps its current meaning (default chat lane),
so every caller we did NOT enumerate keeps working untouched. Only the three
known, recently-built 27B call sites move to `:11435`. A forgotten 27B call
hitting `:11434` will be slow/CPU-offloaded but cannot evict anything, and
shows up in the journal check (Phase 5).

`CUDA_DEVICE_ORDER=PCI_BUS_ID` stays set in both units so indices are stable.

## Phase 0 — Preflight (read-only, ~15 min)

- Snapshot baseline: `nvidia-smi`, `/api/ps`, `ollama list`,
  `journalctl -u ollama --since "24 hours ago" | grep -cE "loading|evict|unload"`.
- Enumerate every consumer of `rodimus:11434` beyond customer-03: adapters
  (BlueBubbles/Discord/Slack/WhatsApp), beacon, sentinel, cron. Record which
  model each requests. Anything requesting qwen3.6:27b gets re-pointed in Phase 3.
- 7-day model usage from `data/llm-usage.jsonl` to confirm gemma3:27b is dead.

## Phase 1 + 2 — Footprint fixes and the two instances (Rodimus, ~30 min)

One maintenance window; chat lane degraded for ~2 minutes during restarts.

**Rewrite `/etc/systemd/system/ollama.service.d/override.conf`** (8B/chat instance):

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="CUDA_DEVICE_ORDER=PCI_BUS_ID"
Environment="CUDA_VISIBLE_DEVICES=0,4"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
```

Delete the ineffective `10-context.conf` (`OLLAMA_NUM_CTX` is not a real env
var; keep per-request `num_ctx` from the app). Drop `OLLAMA_SCHED_SPREAD` here —
the 8B fits on a single card; no need to smear it.

**Create `/etc/systemd/system/ollama-27b.service`** (27B instance):

```ini
[Unit]
Description=Ollama 27B (understand/legate) — GPUs 1,2,3
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="OLLAMA_HOST=0.0.0.0:11435"
Environment="CUDA_DEVICE_ORDER=PCI_BUS_ID"
Environment="CUDA_VISIBLE_DEVICES=1,2,3"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_SCHED_SPREAD=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"

[Install]
WantedBy=default.target
```

(`SCHED_SPREAD=1` stays here — ~20 GB must span the three 10 GB cards.
Both instances share `/usr/share/ollama/.ollama` model storage; weights on
disk are read-only shared, no duplication.)

**Warm-load both models at boot** (keep-warm becomes server-side and per-instance;
no client-side keep-warm hacks remain):

```ini
# in each unit / drop-in
ExecStartPost=/bin/sh -c 'sleep 5; curl -s http://127.0.0.1:<port>/api/generate -d "{\"model\":\"<model>\",\"keep_alive\":-1}" >/dev/null || true'
```

**Firewall**: mirror the existing LAN rule for the new port —
`ufw allow from 192.168.0.0/16 to any port 11435 proto tcp` (match whatever
scope the existing 11434 rule uses).

**Apply**: `systemctl daemon-reload && systemctl restart ollama && systemctl enable --now ollama-27b`.

**Gate before proceeding**: `/api/ps` on 11434 shows 8B ≤7 GB on GPUs 0/4 only;
`/api/ps` on 11435 shows 27B ≤24 GB on GPUs 1–3 only; both `expires_at` = never.
If the 27B does not fit on 3×10 GB with q8_0 KV (contingency): move it to
`CUDA_VISIBLE_DEVICES=1,2,3,4` (38 GB) and the 8B to `0` alone (8 GB — fits at
~6.5 GB with parallel=1).

## Phase 3 — App routing (small code change + env, deploy via normal pipeline)

**Code** (webchat-piko; `llm.js` already honours `options.ollamaBaseUrl`, no change there):

- `lib/understand.js`: pass `ollamaBaseUrl: process.env.PIKO_UNDERSTAND_OLLAMA_URL`
  (when set) into the LLM call options. Fallback: current chat lane. ~5 lines.
- `lib/legateChat.js` decide call: same with `PIKO_LEGATE_OLLAMA_URL`. ~5 lines.
- Agent review already has `PIKO_AGENT_REVIEW_OLLAMA_URL` — env-only change.
- Unit tests for the env plumbing; regex lint stays at zero; ship through the
  standard deploy + eval gate.

**Env on customer-03** (`OLLAMA_URL` unchanged):

```bash
PIKO_UNDERSTAND_OLLAMA_URL=http://192.168.0.190:11435
PIKO_LEGATE_OLLAMA_URL=http://192.168.0.190:11435
PIKO_AGENT_REVIEW_OLLAMA_URL=http://192.168.0.190:11435   # was :11434
```

Worker lane (`PIKO_WORKER_OLLAMA_URL=127.0.0.1:11434` on Optimus — 14B, vision)
is untouched by all of this.

## Phase 4 — Retire strays

- `ollama rm gemma3:27b` after Phase 0 confirms zero 7-day usage (frees 17 GB disk).
- `llama3.2-vision:11b` on Rodimus: confirm no Rodimus caller (scribe runs on the
  Optimus worker lane); optionally `ollama rm` to free disk. It never loads into
  VRAM unless called, so this is hygiene, not correctness.

## Phase 5 — Verification and exit criteria

Immediately after cutover:

1. **Residency**: both instances report their model resident, `expires_at` ≈ never.
2. **Isolation**: `nvidia-smi` shows GPUs 0/4 ≈ 8B only, GPUs 1–3 ≈ 27B only.
3. **Churn**: `journalctl` on both units — load/evict events ≈ 0/hour warm
   (baseline: 1,261 per 6 h).
4. **Concurrency**: 20 parallel mixed calls (chat→11434, understand→11435
   simultaneously); assert zero evictions, zero fail-closed, understand warm
   median ≤ 4 s.
5. **Live smoke**: re-run `scripts/understand-smoke.js` (80 stratified cases);
   expect 0 transport failures, accuracy unchanged from WP8 (~97–99%).
6. **Stray watch**: journal on the 8B instance shows no qwen3.6:27b load
   attempts (would indicate a missed 27B call site).

Then a **24 h watch**: understand fail-closed rate (target 0% excluding genuine
outages), campaign cycle cadence unchanged, chat latency snappy (8B always warm).

## Rollback (< 5 minutes)

```bash
systemctl disable --now ollama-27b
# restore previous override.conf (all 5 GPUs, old settings), restart ollama
# revert the 3 env lines on customer-03, restart app
```

The Phase 3 code change is fallback-safe by design: unset env → current behaviour.

## What this buys

- **Eviction becomes physically impossible** — the models cannot see each
  other's GPUs. Not a scheduling policy that can regress; a hardware boundary.
- 8B always warm → chat replies snappy and consistent.
- 27B always warm → `understand()` at warm-inference latency (~2–4 s), the
  fail-closed path reserved for genuine outages instead of routine eviction.
- Headroom: ~10 GB spare in the 27B partition and ~9 GB in the 8B partition for
  context growth or a future small model.
