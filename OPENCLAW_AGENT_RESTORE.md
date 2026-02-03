# Restore OpenClaw (Agent) Instead of Lightweight Bot

**Goal:** Run the **OpenClaw agent** (gateway, workspace SOUL/IDENTITY, skills, tools) with Ollama + Telegram, not the lightweight Piko bot.

---

## Why OpenClaw vs Bot

| | **OpenClaw (agent)** | **Lightweight bot (current)** |
|---|----------------------|-------------------------------|
| **What it is** | Full agent: gateway, workspace files (SOUL.md, IDENTITY.md), skills (Cursor), tools, memory, session loop | Single script: Telegram ↔ Ollama + /cursor and /task via SSH |
| **You get** | Agent loop, tools, workspace identity, extensibility | Simple chat + a few commands only |

You wanted the **agent**; we only have the bot running because OpenClaw hit a provider bug. The fix is to use OpenClaw’s **official Ollama path** so the agent works.

---

## What Went Wrong Before

- OpenClaw was configured with **explicit** provider config (e.g. `models.providers.openai` or `models.providers.ollama` with `baseUrl`).
- In the version you had, that config **did not** register the provider in the gateway’s API registry → “No API provider registered for api: undefined”.
- So we added a **lightweight bot** that talks to Ollama directly and left OpenClaw stopped.

---

## Fix: Use Official Ollama Integration

OpenClaw’s docs (docs.clawd.bot/providers/ollama) say:

- **Do not** define an explicit `models.providers.ollama` (or openai-with-Ollama) entry.
- Set **`OLLAMA_API_KEY`** to any value (e.g. `ollama-local`). Then OpenClaw **auto-discovers** models from `http://127.0.0.1:11434` and registers the Ollama provider correctly.

So the bug is avoided by using **implicit discovery** instead of explicit config.

---

## Steps on Optimus (Restore OpenClaw Agent)

### 1. Install/update OpenClaw

Use the latest release so you get the current Ollama behavior:

```bash
ssh root@192.168.0.121   # or your Optimus host
npm install -g openclaw@latest
# Or, if you use the GitHub build: pull latest and rebuild.
```

### 2. Enable Ollama via environment (implicit discovery)

On Optimus, set:

```bash
export OLLAMA_API_KEY="ollama-local"
```

Add that to the **OpenClaw gateway** environment (e.g. in its systemd unit or wherever the gateway is started), not only your shell. Example for systemd:

```ini
[Service]
Environment="OLLAMA_API_KEY=ollama-local"
```

### 3. Remove explicit Ollama/openai provider config

Edit `~/.openclaw/openclaw.json` (or the config your gateway uses) and **remove** or comment out the explicit Ollama/openai provider block that was used for Ollama, for example:

- Remove `models.providers.ollama` with `baseUrl: "http://localhost:11434/v1"`.
- Or remove the `openai` provider entry that pointed at Ollama.

Keep the rest of the config (agents defaults, Telegram channel, skills, etc.). You only need to stop defining Ollama explicitly so OpenClaw can use **implicit** discovery.

Set the default model to an Ollama model that will be discovered, e.g.:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "ollama/llama3.1:latest" }
    }
  }
}
```

(Adjust model name to one you have in Ollama and that appears after discovery.)

### 4. Stop the lightweight bot so OpenClaw can use Telegram

Only one process can use the same Telegram bot token (getUpdates):

```bash
sudo systemctl stop clawfriend-bot
# Or whatever the Piko/lightweight bot service is named.
```

### 5. Start the OpenClaw gateway

```bash
# If using systemd (user or system):
systemctl --user start openclaw-gateway
# Or:
sudo systemctl start openclaw-gateway
```

Check logs to confirm no “provider not registered” errors and that Ollama models are discovered.

### 6. Telegram channel

- If the Telegram channel was already set up and paired, it should work again once the gateway is running and only the lightweight bot is stopped.
- If you need to re-add or re-pair: use `openclaw channels add` and the pairing flow (e.g. `openclaw pairing approve telegram <code>`).

### 7. Workspace (SOUL.md, IDENTITY.md) for OpenClaw

OpenClaw’s workspace is on Optimus at:

- **`/root/.openclaw/workspace/`**

Put or edit there:

- **SOUL.md** – how the agent behaves (conversation rules, no meta-commentary, etc.).
- **IDENTITY.md** – who the agent is (name, tone, personality).

Those are the files the **OpenClaw agent** reads. The IDENTITY.md and SOUL.md in the Piko repo under `telegram-bot/` are only for the **lightweight bot** when it’s the one running.

---

## Optional: Keep the lightweight bot as fallback

If you want to keep the option to switch back to the bot:

- Use a **different** Telegram bot token for OpenClaw (one bot = agent, one bot = Piko), or
- When you want to use OpenClaw, stop the lightweight bot and start the gateway; when you want the bot, stop the gateway and start the bot (same token, only one active).

---

## Quick reference

| Item | Where |
|------|--------|
| OpenClaw config | `~/.openclaw/openclaw.json` (on Optimus) |
| OpenClaw workspace (SOUL, IDENTITY) | `/root/.openclaw/workspace/` |
| Ollama (implicit) | Set `OLLAMA_API_KEY`, no explicit `models.providers.ollama` |
| Telegram | Stop lightweight bot; start OpenClaw gateway; same or new token |

---

## If something still fails

- Check gateway logs for “provider” or “ollama” errors.
- Run `openclaw models list` (or equivalent) and confirm Ollama models appear.
- Confirm Ollama is reachable from the gateway: `curl http://localhost:11434/api/tags` on Optimus.

Once OpenClaw runs with Ollama via implicit discovery, you have the **agent** (with SOUL, IDENTITY, skills, tools) instead of only the lightweight bot.
