# Egyptian Insights (customer-03)

Isolated Ancient Cultures research spine for Piko/Legion.

## Layout

- `db.py` — `cultures_cache.sqlite` + schema
- `harvest.py` — connector router (Met, Commons, ARTIC, Digital Giza) into cultures_cache
- `sources/` — Phase-1 open-source connectors (+ optional seed stubs)
- `scribe.py` — Ollama vision transcription (default `llama3.2-vision:11b`)
- `scholar.py` — text critique (default `llama3.1:8b`; override with `EGYPTIAN_SCHOLAR_MODEL`)
- `pipeline.py` — scrape → scribe → scholar handshake
- `prompts/` — non-conversational scribe + scholar prompts
- `research_goal.json` — early-period three-site mandate + query packs

Data dir (override with `EGYPTIAN_INSIGHTS_DATA_DIR`):

`data/egyptian-insights/cultures_cache.sqlite`  
`data/egyptian-insights/assets/images/`

## Smoke

```bash
python3 scripts/smoke-egyptian-insights.py
# Rodimus: pull vision model + sync + smoke
./scripts/deploy-egyptian-insights-rodimus.sh
```

## Research goal

Canonical goal: **earliest-period primary sources** for Abydos/Oserion (Umm el-Qa'ab), Heliopolis (Iunu), and Giza — see `research_goal.json` and `knowledge/customer-03/RESEARCH_GOAL.md`.

Default harvest/query/agent briefs target that goal. Scholar defaults to `llama3.1:8b` unless `EGYPTIAN_SCHOLAR_MODEL` is set (pull a 70B when ready).

## Isolation

No AusMaker inventory/sales capabilities. Legion adapter id: `egyptian-insights`.
Tenant id: `customer-03`.
