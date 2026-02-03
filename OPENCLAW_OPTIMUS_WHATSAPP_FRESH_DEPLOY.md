# OpenClaw on Optimus: Full Reset + Fresh Deploy (WhatsApp)

**If you don’t have a second phone number:** use the **Telegram** guide instead: [OPENCLAW_OPTIMUS_TELEGRAM_FRESH_DEPLOY.md](OPENCLAW_OPTIMUS_TELEGRAM_FRESH_DEPLOY.md).

**Goal:** Wipe existing setups, install OpenClaw from scratch on Optimus, and talk to the **agent** via **WhatsApp** only. Uses **Ollama** (local, free) with official implicit discovery so the agent works. **Requires a second phone number** (or personal number with self-chat mode).

**References:** [OpenClaw docs](https://docs.clawd.bot/), [Getting Started](https://docs.clawd.bot/start/getting-started), [Ollama provider](https://docs.clawd.bot/providers/ollama), [WhatsApp channel](https://docs.clawd.bot/channels/whatsapp).

---

## Overview

| Phase | What |
|-------|------|
| **0** | Reset: stop Piko bot, remove old OpenClaw state and service |
| **1** | Prerequisites: Node ≥22, Ollama running on Optimus |
| **2** | Install OpenClaw CLI (official install or npm) |
| **3** | Onboard with wizard: WhatsApp, Ollama (implicit), daemon |
| **4** | Ensure OLLAMA_API_KEY for gateway; no explicit ollama provider |
| **5** | WhatsApp login (QR scan) |
| **6** | Workspace: SOUL.md, IDENTITY.md |
| **7** | Verify: health, models, first WhatsApp message |

All commands below are intended to be run **on Optimus** unless noted. If you SSH as `root`, `~` is `/root` and state is `/root/.openclaw`.

**Optional script:** `scripts/optimus-openclaw-reset-and-install.sh` automates Phase 0 (reset) and Phase 2 (install) on Optimus. Copy it to the server and run; then do the wizard and WhatsApp login interactively (Phases 3–7).

---

## Phase 0: Reset everything

Do this first so nothing conflicts.

### 0.1 Stop the lightweight Piko/ClawFriend bot

Only one process can use a given Telegram bot token; we are switching to WhatsApp, but stop the bot so no leftover service runs.

```bash
sudo systemctl stop clawfriend-bot
sudo systemctl disable clawfriend-bot
```

(If the service has a different name, use that. Leave the unit file in place if you might re-enable it later.)

### 0.2 Remove old OpenClaw (if present)

If OpenClaw CLI is still installed:

```bash
openclaw gateway stop
openclaw gateway uninstall
rm -rf "${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
```

If the CLI is already gone but a gateway service exists (Linux systemd user):

```bash
systemctl --user disable --now openclaw-gateway.service
rm -f ~/.config/systemd/user/openclaw-gateway.service
systemctl --user daemon-reload
```

If you previously ran as **root** on Optimus, state is under `/root/.openclaw`:

```bash
sudo rm -rf /root/.openclaw
```

### 0.3 (Optional) Uninstall OpenClaw CLI

Only if you want a completely clean CLI install:

```bash
npm rm -g openclaw
```

---

## Phase 1: Prerequisites on Optimus

### 1.1 Node.js ≥ 22

```bash
node -v
```

If version is &lt; 22, install or switch (e.g. nvm, NodeSource, or your distro):

```bash
# Example (adjust for your setup):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 1.2 Ollama running and reachable

Ollama must be listening on `http://127.0.0.1:11434` (or the host that the gateway will use). On Optimus you had Ollama in Docker; ensure the container is up and the gateway will resolve “localhost” to that host.

```bash
curl -s http://localhost:11434/api/tags
```

You should see JSON with a `models` array. Pull at least one model that supports tools if needed:

```bash
ollama pull llama3.3
# or: ollama pull qwen2.5-coder:32b
```

OpenClaw’s Ollama integration **auto-discovers** models that report tool support from `http://127.0.0.1:11434`. No manual provider block required.

---

## Phase 2: Install OpenClaw

Pick one method.

### Option A: Official install script (recommended)

This installs the CLI and can run onboarding; we will use it without onboarding first so we can configure Ollama + WhatsApp cleanly.

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
```

If you prefer to run the full installer and then adjust config:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Then skip to Phase 3 and, if the wizard did not set Ollama, do Phase 4.

### Option B: npm global install

```bash
npm install -g openclaw@latest
```

Then run onboarding in Phase 3.

### Verify CLI

```bash
openclaw --version
openclaw doctor
```

---

## Phase 3: Onboarding wizard

Run the wizard **on Optimus** (same host where the gateway and Ollama run). Use a **user that will run the gateway** (e.g. your normal user or root). If you use root, `~` = `/root` and state = `/root/.openclaw`.

```bash
openclaw onboard --install-daemon
```

**During the wizard, choose:**

1. **Existing config:** If it finds old config, choose **Reset** (full reset) so we start clean.
2. **Local vs remote:** **Local** (gateway on this machine).
3. **Model / Auth:**  
   - For **Ollama-only**, choose **Skip** (no cloud API key).  
   - We will set **OLLAMA_API_KEY** and the default model in Phase 4 so the agent uses Ollama via implicit discovery.
4. **Workspace:** Default `~/.openclaw/workspace` is fine.
5. **Gateway:** Port (e.g. 18789), bind (e.g. 0.0.0.0 if you need remote access, or 127.0.0.1 for local only), **Token** auth recommended.
6. **Channels:** Enable **WhatsApp**. Do **not** enable Telegram unless you want it as well (and use a different bot token).
7. **WhatsApp:** When asked for your phone number, give the number you will message **from** (E.164, e.g. +15551234567). This sets the allowlist so your DMs are accepted.  
   - Prefer a **dedicated number** for the agent (e.g. spare phone + eSIM). If you use your **personal number**, the wizard may offer **self-chat mode**; accept it and add yourself to the allowlist.
8. **Daemon:** **Yes** — install the background service (systemd user unit on Linux).
9. **Runtime:** **Node** (required for WhatsApp; do not use Bun).
10. **Skills:** Optional; you can skip or add later.

After the wizard, the gateway may start automatically. If it does, we will restart it in Phase 4 after setting Ollama.

---

## Phase 4: Ollama as the only model (implicit discovery)

OpenClaw must use **implicit** Ollama discovery (no explicit `models.providers.ollama` block). That avoids the old “provider not registered” bug.

### 4.1 Set OLLAMA_API_KEY for the gateway

The gateway process must see `OLLAMA_API_KEY` (any non-empty value). Two ways:

**A) Systemd user unit (if gateway runs as your user)**

Edit the user service (path may vary; check `openclaw gateway status` or docs):

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/openclaw-gateway.service
```

Add or extend the `[Service]` block:

```ini
[Service]
Environment="OLLAMA_API_KEY=ollama-local"
```

If the unit uses `EnvironmentFile=`, add the same line to that file instead.

**B) Root / system-wide (if gateway runs as root on Optimus)**

If the service is under `/etc/systemd/system/` or similar:

```bash
sudo nano /etc/systemd/system/openclaw-gateway.service
```

Add:

```ini
[Service]
Environment="OLLAMA_API_KEY=ollama-local"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart openclaw-gateway
# or, for user:
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway
```

**C) Global .env (alternative)**

OpenClaw can load `~/.openclaw/.env` (or `$OPENCLAW_STATE_DIR/.env`). Create or edit it:

```bash
mkdir -p ~/.openclaw
echo 'OLLAMA_API_KEY=ollama-local' >> ~/.openclaw/.env
```

Restart the gateway after changing `.env`.

### 4.2 Ensure no explicit Ollama provider

Implicit discovery only works if you do **not** define `models.providers.ollama` (or a custom “openai” provider pointing at Ollama). Check:

```bash
cat ~/.openclaw/openclaw.json | jq '.models.providers'
```

- If you see `ollama` or an `openai` block with `baseUrl` to `localhost:11434`, **remove** that block (or the whole `models.providers` section if Ollama is the only provider).
- If the wizard wrote nothing under `models.providers`, you are fine.

Set the default model to an Ollama model that exists and is discovered (e.g. `llama3.3`, `llama3.1:latest`, `qwen2.5-coder:32b`). Example:

```bash
openclaw configure set agents.defaults.model.primary "ollama/llama3.1:latest"
# or use your actual model id, e.g. ollama/llama3.3
```

Or edit `~/.openclaw/openclaw.json` and set:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "ollama/llama3.1:latest" }
    }
  }
}
```

Use a model you pulled in Phase 1. List discovered models (after gateway restart):

```bash
openclaw models list
```

You should see `ollama/...` entries. Restart the gateway after any config change:

```bash
openclaw gateway restart
# or systemctl --user restart openclaw-gateway
```

---

## Phase 5: WhatsApp login (QR)

WhatsApp uses “Linked Devices” (QR) login. Run on the **same host as the gateway** (Optimus), in a session where you can see the terminal (or forward the QR if needed).

```bash
openclaw channels login
```

- Open WhatsApp on your phone → **Settings → Linked devices → Link a device**.
- Scan the QR code shown in the terminal.
- Credentials are stored under `~/.openclaw/credentials/whatsapp/` (e.g. `default/creds.json`).

If you use **pairing** for DMs, the first message from an unknown number will get a pairing code; approve it:

```bash
openclaw pairing list whatsapp
openclaw pairing approve whatsapp <CODE>
```

If you configured an **allowlist** with your number in the wizard, your own DMs do not need pairing.

---

## Phase 6: Workspace (SOUL.md, IDENTITY.md)

The agent’s identity and behavior come from the **workspace** under `~/.openclaw/workspace` (or the path set in config).

### 6.1 IDENTITY.md

Create or edit `~/.openclaw/workspace/IDENTITY.md`:

```markdown
# Identity

You are a friendly, capable AI assistant (e.g. ClawFriend or the name you prefer).

- **Tone:** Conversational, helpful, concise.
- **Scope:** General conversation, coding help, and tasks the user asks for.
- Edit this file to change who the agent is. Restart the gateway or wait for next load for changes to apply.
```

### 6.2 SOUL.md

Create or edit `~/.openclaw/workspace/SOUL.md`:

```markdown
# Soul (behavior)

- Respond **directly** to the user. Do not meta-analyze or describe the message; just reply.
- No commentary like "You asked me to…" — answer as in a normal chat.
- Keep replies natural and concise unless the user asks for more.
- You have access to tools and skills when configured; use them when appropriate.
```

Restart the gateway if you want these loaded immediately; otherwise the agent will use them on next run.

---

## Phase 7: Verify end-to-end

### 7.1 Gateway and health

```bash
openclaw gateway status
openclaw status
openclaw health
```

Resolve any “no auth” or “provider not registered” errors (usually fixed by OLLAMA_API_KEY and no explicit ollama provider).

### 7.2 Models

```bash
openclaw models list
```

Expect at least one `ollama/...` model.

### 7.3 First WhatsApp message

From your phone (the number you added to the allowlist or approved via pairing), send a WhatsApp message to the linked device/number (or to yourself if in self-chat mode). The agent should reply using Ollama.

If there is no reply:

- Check gateway logs: `openclaw logs --follow` (or `journalctl --user -u openclaw-gateway -f`).
- Confirm pairing/allowlist: `openclaw pairing list whatsapp` and `openclaw channels status`.
- Confirm health and model: `openclaw health` and `openclaw models list`.

---

## Summary checklist

- [ ] Phase 0: Piko bot stopped; old OpenClaw state and service removed.
- [ ] Phase 1: Node ≥22; Ollama running and `curl http://localhost:11434/api/tags` works; at least one model pulled.
- [ ] Phase 2: OpenClaw CLI installed (`openclaw --version`, `openclaw doctor`).
- [ ] Phase 3: `openclaw onboard --install-daemon` with WhatsApp, Skip auth, Node, daemon installed.
- [ ] Phase 4: `OLLAMA_API_KEY=ollama-local` in gateway environment; no explicit `models.providers.ollama`; `agents.defaults.model.primary` = `ollama/<model>`; gateway restarted; `openclaw models list` shows ollama models.
- [ ] Phase 5: `openclaw channels login` (QR scanned); pairing approved if using pairing.
- [ ] Phase 6: `~/.openclaw/workspace/IDENTITY.md` and `SOUL.md` created/edited.
- [ ] Phase 7: `openclaw health` OK; WhatsApp message from allowlisted/paired number gets a reply.

---

## Optional: Cursor / SSH skill on MacBook

If you want the OpenClaw agent to run Cursor or commands on your MacBook (as before), add the skill and SSH config **after** the agent is working over WhatsApp. That is a separate step; the docs and your existing Cursor skill notes (e.g. in this repo) apply. This guide focuses on a clean OpenClaw + Ollama + WhatsApp deploy on Optimus.

---

## References

- Install: https://docs.clawd.bot/install  
- Getting started: https://docs.clawd.bot/start/getting-started  
- Onboarding wizard: https://docs.clawd.bot/start/wizard  
- Ollama provider (implicit discovery): https://docs.clawd.bot/providers/ollama  
- WhatsApp channel: https://docs.clawd.bot/channels/whatsapp  
- Uninstall: https://docs.clawd.bot/install/uninstall  
- Environment variables: https://docs.clawd.bot/environment  
