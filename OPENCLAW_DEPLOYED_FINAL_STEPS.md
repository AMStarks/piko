# OpenClaw Deployed on Optimus — Final Step (Telegram Pairing)

**Status:** OpenClaw (Clawd) is deployed and running on Optimus as root. Gateway is up, Telegram channel is enabled, Ollama (mistral:latest) is configured via implicit discovery.

---

## What was done

- **Phase 0:** Stopped Piko/ClawFriend bot; removed old OpenClaw state.
- **Phase 1–2:** Confirmed Node 22 and Ollama; installed OpenClaw CLI.
- **Phase 3–4:** Created `/root/.openclaw/openclaw.json` with Telegram (your existing bot token) and Ollama; installed gateway service with `OLLAMA_API_KEY=ollama-local`; **no** explicit `models.providers.ollama` (implicit discovery).
- **Phase 6:** Created `/root/.openclaw/workspace/IDENTITY.md` and `SOUL.md` (ClawFriend identity and behavior).
- **Phase 7:** Gateway is running; `openclaw health` shows Telegram ok (@pikotheservicedog_bot); `openclaw models list` shows `ollama/mistral:latest`.

---

## What you need to do (one step)

**Telegram pairing:** OpenClaw only replies to DMs from **paired** users. The first time you message the bot, it will send you a **pairing code** (or “access not configured” with a code). You must approve that code on Optimus.

1. **Send a message** to your Telegram bot (@pikotheservicedog_bot), e.g. “Hi”.
2. The bot will reply with a short **pairing code** (or a message that includes a code).
3. **On Optimus**, approve the code (SSH as root, then run):

   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   openclaw pairing list telegram
   openclaw pairing approve telegram <CODE>
   ```

   Replace `<CODE>` with the code the bot sent you (e.g. `ABC12345`). Codes expire after about an hour.

4. **Send another message** to the bot. The agent should reply using Ollama (ClawFriend).

---

## Useful commands on Optimus

- **Gateway status:** `openclaw gateway status`
- **Health:** `openclaw health`
- **Models:** `openclaw models list`
- **Channels:** `openclaw channels status`
- **Pairing list:** `openclaw pairing list telegram`
- **Logs:** `openclaw logs --follow` or `journalctl --user -u openclaw-gateway -f`

---

## Config and workspace (root)

- **Config:** `/root/.openclaw/openclaw.json`
- **Workspace (IDENTITY/SOUL):** `/root/.openclaw/workspace/`
- **Service:** `/root/.config/systemd/user/openclaw-gateway.service` (systemd user unit for root)

Restart gateway after config changes: `systemctl --user restart openclaw-gateway` (as root on Optimus).
