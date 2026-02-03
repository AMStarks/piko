# OpenClaw on Optimus — Plain-Language Breakdown

A simple explanation of what you’re doing and what “root vs another user” means.

---

## What you’re doing in one sentence

You’re **resetting everything** on your server (Optimus), then **installing OpenClaw from scratch** so you can talk to an **AI agent** over **Telegram** (using Ollama on the server, no second phone number).

---

## The big picture

1. **Optimus** = your server (the Linux machine at 192.168.0.121).
2. **OpenClaw** = the “brain” that runs on Optimus. It receives your Telegram messages, talks to Ollama (the local AI), and sends replies back.
3. **Ollama** = the part that actually runs the AI model on Optimus (already there in Docker).
4. **Telegram** = how you talk to the agent (your existing bot, e.g. @pikotheservicedog_bot).

So: **You (Telegram) → OpenClaw (on Optimus) → Ollama (on Optimus) → reply back to you.**

---

## “Root” vs “another user” — in plain English

When you **SSH into Optimus**, you log in as **somebody**. That “somebody” is an **account** on the server.

- **Root** = the main admin account. When you type `ssh root@192.168.0.121` and log in, you *are* root. Everything you do is “as root.” Files you create live under `/root/` (root’s home folder).
- **Another user** = any other account, e.g. a user you created like `starkers` or `openclaw`. If you type `ssh starkers@192.168.0.121`, you’re “starkers.” Files you create live under `/home/starkers/` (that user’s home folder).

**“Run the gateway as root or another user”** means:

- **If you run everything as root:**  
  You SSH in as root, run `openclaw onboard` as root. Then OpenClaw’s files and config live in **root’s home**: `/root/.openclaw`. When we say “edit `~/.openclaw/openclaw.json`,” for you that means **/root/.openclaw/openclaw.json**.

- **If you run everything as another user (e.g. starkers):**  
  You SSH in as that user, run `openclaw onboard` as that user. Then OpenClaw’s files live in **that user’s home**, e.g. `/home/starkers/.openclaw`. So “edit `~/.openclaw/openclaw.json`” means **/home/starkers/.openclaw/openclaw.json**.

**Rule of thumb:** Use **one** account for the whole OpenClaw setup. Whichever account you use when you run `openclaw onboard` is the one that “owns” OpenClaw. All the steps that say “edit ~/.openclaw/…” mean “edit the .openclaw folder **in that account’s home directory**.”

---

## The seven phases, in simple terms

| Phase | In plain English |
|-------|-------------------|
| **0. Reset** | Turn off the old Piko bot and delete any old OpenClaw stuff so we start clean. |
| **1. Prerequisites** | Make sure the server has Node 22+ and Ollama is running and reachable. |
| **2. Install OpenClaw** | Install the OpenClaw program on the server (like installing an app). |
| **3. Onboard** | Run a setup wizard: say “use Telegram,” “use Ollama (no cloud key),” “install as a background service.” You paste your Telegram bot token when it asks. |
| **4. Ollama** | Tell OpenClaw “use Ollama” by setting one environment variable (OLLAMA_API_KEY) and **not** adding the old broken config. Restart the gateway. |
| **5. Telegram pairing** | Send a message to your bot; it will reply with a short code. On the server you run `openclaw pairing approve telegram <CODE>` so it knows you’re allowed to talk to it. |
| **6. Workspace** | Create two small files (IDENTITY.md and SOUL.md) that describe who the agent is and how it should behave. |
| **7. Verify** | Check that the gateway is healthy and that when you message the bot, it replies. |

---

## Things that often confuse people

- **“Gateway”** = the OpenClaw process that runs in the background on Optimus. It listens for your Telegram messages and talks to Ollama. “Start the gateway” = start that process (often via `systemctl --user start openclaw-gateway`).
- **“State” or “state directory”** = where OpenClaw keeps its config and data. That’s the `~/.openclaw` folder. “Reset state” = delete that folder (and re-set up from the wizard).
- **“Pairing”** = OpenClaw’s way of saying “only these people can talk to the agent.” The first time you message the bot, it sends you a code; you approve that code on the server so your Telegram user is “paired” and future messages get answered.
- **“Implicit Ollama”** = we let OpenClaw **auto-detect** Ollama by setting OLLAMA_API_KEY and **not** adding the old manual provider config. That avoids the “provider not registered” bug you hit before.

---

## Quick “which user am I?” check

On Optimus, run:

```bash
whoami
```

- If it prints **root** → you’re root. Your OpenClaw folder is **/root/.openclaw**.
- If it prints something else (e.g. **starkers**) → you’re that user. Your OpenClaw folder is **/home/starkers/.openclaw** (replace starkers with what `whoami` printed).

Use that same account for every step in the guide so all paths and “~” refer to the same place.
