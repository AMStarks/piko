# Piko WebChat — Docker (Phase 5.3)

## Quick start

```bash
# From webchat-piko/
docker compose up -d
```

Requires **Ollama on the host**. The container uses `OLLAMA_URL` to reach it (default `http://host.docker.internal:11434` on Mac/Windows).

## Options

- **`.env`** — Create from `.env.example` if present; set `OLLAMA_URL`, `OLLAMA_MODEL`, and any other env (e.g. `PIKO_PRIMARY_HUMAN`, Telegram, Notion).
- **Data** — Persisted in volume `piko-data`. To reset: `docker compose down -v` (then `up` again).
- **Linux host** — If `host.docker.internal` is not available, set `OLLAMA_URL=http://<host-ip>:11434` or run Ollama in a separate container and link.

## Build only

```bash
docker build -t piko-webchat .
docker run -p 3000:3000 -v piko-data:/app/data -e OLLAMA_URL=http://host.docker.internal:11434 piko-webchat
```
