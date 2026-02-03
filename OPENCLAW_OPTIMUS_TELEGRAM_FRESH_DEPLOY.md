# OpenClaw on Optimus: Full Reset + Fresh Deploy (Telegram)

**Goal:** Wipe existing setups, install OpenClaw from scratch on Optimus, and talk to the **agent** via **Telegram**. Uses **Ollama** (local, free) with official implicit discovery so the agent works. No second phone number needed (unlike WhatsApp).

**References:** [OpenClaw docs](https://docs.clawd.bot/), [Getting Started](https://docs.clawd.bot/start/getting-started), [Ollama provider](https://docs.clawd.bot/providers/ollama), [Telegram channel](https://docs.clawd.bot/channels/telegram).

---

## Gateway user: root vs another user

**“Run the gateway as root or another user”** means: **which Linux user account on Optimus owns and runs the OpenClaw gateway**.

- **Root:** You SSH as `root` and run `openclaw onboard` (and all `openclaw` commands) as root. Then:
  - State lives in **`/root/.openclaw`** (so `~` = `/root`).
  - The systemd **user** unit is **root’s** user service: `/root/.config/systemd/user/openclaw-gateway.service`, and you use `systemctl --user` as root.
- **Another user:** You SSH as a normal user (e.g. `starkers` or `openclaw`) and run the wizard as that user. Then:
  - State lives in **`/home/<username>/.openclaw`** (e.g. `/home/starkers/.openclaw`).
  - The systemd user unit is that user’s: `~/.config/systemd/user/openclaw-gateway.service`.

So when the guide says “edit `~/.openclaw/openclaw.json`” or “add OLLAMA_API_KEY to the gateway service”, use the **same user** that runs the gateway: if the gateway runs as root, use root’s paths and root’s `systemctl --user`; if it runs as `starkers`, use that user’s home and that user’s `systemctl --user`. Pick one and stick to it for the whole deploy.

---

## Overview

| Phase | What |
|-------|------|
| **0** | Reset: stop Piko bot, remove old OpenClaw state and service |
| **1** | Prerequisites: Node ≥22, Ollama running on Optimus |
| **2** | Install OpenClaw CLI (official install or npm) |
| **3** | Onboard with wizard: **Telegram**, Ollama (implicit), daemon |
| **4** | Ensure OLLAMA_API_KEY for gateway; no explicit ollama provider |
| **5** | Telegram: bot token + pairing (first DM gets code, approve it) |
| **6** | Workspace: SOUL.md, IDENTITY.md |
| **7** | Verify: health, models, first Telegram message |

All commands below are intended to be run **on Optimus** unless noted. If you run as **root**, `~` is `/root` and state is `/root/.openclaw`. If you run as another user, `~` is that user’s home.

**Optional script:** `scripts/optimus-openclaw-reset-and-install.sh` automates Phase 0 (reset) and Phase 2 (install). Then do the wizard and Telegram setup interactively (Phases 3–7).

---

## Phase 0: Reset everything

Do this first so nothing conflicts.

### 0.1 Stop the lightweight Piko/ClawFriend bot

Only one process can use a given Telegram bot token. Stop the old bot so OpenClaw can use the token.

```bash
sudo systemctl stop clawfriend-bot
sudo systemctl disable clawfriend-bot
```

(If the service has a different name, use that.)

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

If you previously ran as **root** on Optimus, remove root’s state too:

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

If version is < 22, install or switch (e.g. nvm, NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 1.2 Ollama running and reachable

```bash
curl -s http://localhost:11434/api/tags
```

You should see JSON with a `models` array. Pull at least one model if needed:

```bash
ollama pull llama3.3
# or: ollama pull llama3.1:latest
```

---

## Phase 2: Install OpenClaw

**Option A (recommended):**

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
```

**Option B:**

```bash
npm install -g openclaw@latest
```

Then:

```bash
openclaw --version
openclaw doctor
```

---

## Phase 3: Onboarding wizard

Run the wizard **on Optimus** as the **user that will run the gateway** (root or your normal user). That user’s `~` is where `~/.openclaw` will live.

```bash
openclaw onboard --install-daemon
```

**During the wizard, choose:**

1. **Existing config:** If it finds old config, choose **Reset** (full reset).
2. **Local vs remote:** **Local** (gateway on this machine).
3. **Model / Auth:** For **Ollama-only**, choose **Skip** (no cloud API key). We set OLLAMA_API_KEY in Phase 4.
4. **Workspace:** Default `~/.openclaw/workspace` is fine.
5. **Gateway:** Port (e.g. 18789), bind (e.g. 0.0.0.0 or 127.0.0.1), **Token** auth recommended.
6. **Channels:** Enable **Telegram**. Do **not** enable WhatsApp unless you have a second number.
7. **Telegram:** When asked, paste your **Telegram bot token** (from [@BotFather](https://t.me/BotFather): /newbot or /mybots → your bot → API Token). The wizard stores it in config.
8. **Daemon:** **Yes** — install the background service (systemd user unit on Linux).
9. **Runtime:** **Node** (required for Telegram; do not use Bun).
10. **Skills:** Optional; skip or add later.

After the wizard, the gateway may start. We’ll set Ollama and restart in Phase 4.

---

## Phase 4: Ollama as the only model (implicit discovery)

OpenClaw must use **implicit** Ollama discovery: set **OLLAMA_API_KEY**, and **do not** add an explicit `models.providers.ollama` block.

### 4.1 Set OLLAMA_API_KEY for the gateway

The gateway process must see `OLLAMA_API_KEY` (any value, e.g. `ollama-local`).

**If the gateway runs as your user (systemd user unit):**

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/openclaw-gateway.service
```

Add under `[Service]`:

```ini
Environment="OLLAMA_API_KEY=ollama-local"
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway
```

**If the gateway runs as root:** same idea but for root’s user unit (e.g. `/root/.config/systemd/user/openclaw-gateway.service`) and run `systemctl --user` as root.

**Alternative — global .env:**

```bash
mkdir -p ~/.openclaw
echo 'OLLAMA_API_KEY=ollama-local' >> ~/.openclaw/.env
```

Restart the gateway after editing `.env`.

### 4.2 No explicit Ollama provider; set default model

Ensure there is **no** `models.providers.ollama` (or openai pointing at Ollama) in `~/.openclaw/openclaw.json`. Then set the default model:

```bash
openclaw configure set agents.defaults.model.primary "ollama/llama3.1:latest"
```

Use a model you pulled (e.g. `ollama/llama3.3`). Restart the gateway, then:

```bash
openclaw models list
```

You should see `ollama/...` entries.

---

## Phase 5: Telegram pairing

OpenClaw uses **pairing** for Telegram DMs by default: the first DM from you (or any new user) returns a **pairing code**; the message is not processed until you approve it.

1. Open Telegram and send a message to your bot (e.g. “Hi”).
2. The bot replies with a short pairing code (or “access not configured” and a code).
3. On Optimus, approve the code:

```bash
openclaw pairing list telegram
openclaw pairing approve telegram <CODE>
```

After approval, send another message; the agent should reply using Ollama.

---

## Phase 6: Workspace (SOUL.md, IDENTITY.md)

Create the agent’s identity and behavior files in **`~/.openclaw/workspace/`** (for the user that runs the gateway).

**IDENTITY.md:**

```markdown
# Identity

You are a friendly, capable AI assistant (e.g. ClawFriend or the name you prefer).

- **Tone:** Conversational, helpful, concise.
- **Scope:** General conversation, coding help, and tasks the user asks for.
```

**SOUL.md:**

```markdown
# Soul (behavior)

- Respond **directly** to the user. Do not meta-analyze or describe the message; just reply.
- No commentary like "You asked me to…" — answer as in a normal chat.
- Keep replies natural and concise unless the user asks for more.
```

Restart the gateway if you want these loaded immediately.

---

## Phase 7: Verify end-to-end

```bash
openclaw gateway status
openclaw status
openclaw health
openclaw models list
```

Send a Telegram message to your bot. The agent should reply. If not:

- Check logs: `openclaw logs --follow` (or `journalctl --user -u openclaw-gateway -f`).
- Confirm pairing: `openclaw pairing list telegram` and approve your code if pending.
- Confirm health and model: `openclaw health` and `openclaw models list`.

---

## Summary checklist

- [ ] Phase 0: Piko bot stopped; old OpenClaw state and service removed.
- [ ] Phase 1: Node ≥22; Ollama running; at least one model pulled.
- [ ] Phase 2: OpenClaw CLI installed.
- [ ] Phase 3: `openclaw onboard --install-daemon` with **Telegram**, Skip auth, Node, daemon.
- [ ] Phase 4: OLLAMA_API_KEY in gateway environment; no explicit ollama provider; default model set; gateway restarted; `openclaw models list` shows ollama models.
- [ ] Phase 5: First Telegram DM → pairing code → `openclaw pairing approve telegram <CODE>`.
- [ ] Phase 6: `~/.openclaw/workspace/IDENTITY.md` and `SOUL.md` created.
- [ ] Phase 7: `openclaw health` OK; Telegram message gets a reply.

---

## Optional: Cursor / SSH skill on MacBook

To have the OpenClaw agent run Cursor or commands on your MacBook, add the skill and SSH config **after** the agent is working over Telegram. See your existing Cursor skill notes in this repo.

---

## References

- Install: https://docs.clawd.bot/install  
- Getting started: https://docs.clawd.bot/start/getting-started  
- Onboarding wizard: https://docs.clawd.bot/start/wizard  
- Ollama provider: https://docs.clawd.bot/providers/ollama  
- Telegram channel: https://docs.clawd.bot/channels/telegram  
- Uninstall: https://docs.clawd.bot/install/uninstall  
- Environment variables: https://docs.clawd.bot/environment  
