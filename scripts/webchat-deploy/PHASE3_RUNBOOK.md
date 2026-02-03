# Phase 3 — Remove OpenClaw (old framework)

After WebChat is working on Optimus, stop and disable OpenClaw so Piko runs only via WebChat (+ optional Telegram).

---

## 1. On Optimus — Stop and disable OpenClaw

SSH in:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
```

Stop and disable the OpenClaw gateway (user systemd, run as root):

```bash
systemctl --user stop openclaw-gateway.service
systemctl --user disable openclaw-gateway.service
```

Optional — remove OpenClaw config and workspace (only if you’re sure you won’t roll back):

```bash
# Optional: backup first
# tar -czf /root/openclaw-backup-$(date +%Y%m%d).tar.gz /root/.openclaw

# Optional: remove config and workspace
# rm -rf /root/.openclaw
```

You can leave `/root/.openclaw` in place and only stop/disable the service if you prefer.

---

## 2. Telegram (optional)

- **Keep:** Leave `clawfriend-bot.service` running for Telegram. WebChat = primary, Telegram = secondary.
- **Remove:**  
  ```bash
  systemctl stop clawfriend-bot.service
  systemctl disable clawfriend-bot.service
  ```

---

## 3. Repo cleanup (already done in this repo)

OpenClaw-related scripts and configs have been moved to `archive/openclaw/` so the repo reflects WebChat as the main interface. You can delete `archive/openclaw/` later if you don’t need them.

---

## Quick reference

- **OpenClaw service (user):** `openclaw-gateway.service` — stop/disable with `systemctl --user`
- **WebChat service (system):** `piko-webchat.service` — main Piko interface
- **Telegram (optional):** `clawfriend-bot.service`
