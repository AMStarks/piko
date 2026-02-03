# Piko — WebChat + Cursor ✅

**Date:** February 2, 2026  
**Status:** Piko’s **main interface** is **WebChat** on Optimus (Llama 3.1 8B via Ollama). Optional: Telegram bot for mobile; Cursor CLI via SSH from bot.

---

## Primary: WebChat

- **URL (LAN):** http://192.168.0.121:3000  
- **App:** `webchat-piko/` — chat UI + Node API → Ollama (Llama 3.1 8B). No OpenClaw, no Telegram envelope.  
- **Deploy:** `./scripts/webchat-deploy/deploy-to-optimus.sh` then follow `scripts/webchat-deploy/PHASE2_RUNBOOK.md`.  
- **Service on Optimus:** `piko-webchat.service`

---

## What’s Done

- **WebChat:** Lightweight chat UI + API on Optimus; SOUL/IDENTITY prompts; in-memory sessions.
- **Telegram (optional):** Lightweight Telegram + Ollama bot on Optimus; `/cursor` handled first (before the LLM).
- **SSH:** Optimus → MacBook with key auth; Remote Login enabled on MacBook.
- **Cursor:** Telegram bot runs `/usr/local/bin/cursor` in `/Users/starkers/Projects` over SSH when you use `/cursor` in Telegram.

---

## Telegram Quirk (for future reference)

**Use a single hyphen for flags in Telegram:**  
e.g. `/cursor -version`, `/cursor -help` — not `--version` / `--help` (double hyphen can be stripped).  
See `TELEGRAM_CURSOR_TIP.md`.

---

## How to Use

| In Telegram | Effect |
|-------------|--------|
| `/cursor -version` | Cursor version from MacBook |
| `/cursor -help` | Cursor CLI help |
| `/cursor chat "explain main.py"` | Run Cursor chat (if supported) |
| `/cursor apply "refactor auth"` | Run Cursor apply (if supported) |
| `/status` | Bot status + Cursor tip |
| `/new` | New chat session |

---

## Remaining Steps (optional)

Nothing is required for Piko to run Cursor; the pipeline is working. Optional next steps:

1. **Try other Cursor commands** from Telegram (e.g. `/cursor chat "..."`, `/cursor apply "..."`) and fix any quoting or timeout issues if they appear.
2. **Monitoring:** Optional cron or health check that restarts `clawfriend-bot.service` if it stops (e.g. `systemctl is-active`).
3. **Security:** Commands are run as your user on the MacBook over SSH; no extra allowlist is in place. Add one later if you want to restrict which Cursor subcommands are allowed.

---

## Quick reference

- **WebChat (primary):** http://192.168.0.121:3000 — `piko-webchat.service`, app at `/root/webchat-piko/`. Deploy: `scripts/webchat-deploy/PHASE2_RUNBOOK.md`.  
- **Telegram (optional):** `/root/telegram-ollama-bot/bot.js` — `clawfriend-bot.service`. Deploy: `scp -i ~/.ssh/id_optimus telegram-bot/bot.js root@192.168.0.121:/root/telegram-ollama-bot/bot.js` then restart the service.  
- **OpenClaw removed:** Old framework archived in `archive/openclaw/`. To stop/disable on Optimus: `scripts/webchat-deploy/PHASE3_RUNBOOK.md`.

**Piko is ready via WebChat (and optionally Telegram).**
