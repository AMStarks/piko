# Understand evaluation battery (WP8)

- `battery-synthetic.jsonl` — ~2000 labeled synthetic cases
- `battery-real.jsonl` — ~200 real/fixture-harvested cases
- `battery-floor-disagreements.jsonl` — intended label vs current regex floors
- `eval-offline.json` / `eval-llm.json` — eval reports
- `smoke-report.json` — live 200-run smoke

Regenerate:

```bash
npm run understand:battery
npm run understand:eval:offline
OLLAMA_URL=http://192.168.0.190:11434 PIKO_UNDERSTAND_MODEL=qwen3.6:27b npm run understand:eval
```

Few-shot rows (`fewshot-*` ids / `exclude_from_scoring`) must not be scored when embedded in the prompt.
