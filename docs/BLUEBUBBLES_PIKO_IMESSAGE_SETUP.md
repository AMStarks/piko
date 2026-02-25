# BlueBubbles + Piko iMessage setup (Andrew’s Mac mini)

This runbook sets up **BlueBubbles Server** on **Andrew’s Mac mini** (192.168.0.48, user `magnus`) and connects it to **Piko** on Optimus so you can chat with Piko over iMessage.

---

## 1. Redeploy (done)

- Webchat-piko has been deployed to Optimus and `piko-webchat` restarted.
- Piko is at **http://192.168.0.121:3000**.

---

## 2. On the Mac mini (magnus@192.168.0.48)

### 2.1 Install BlueBubbles Server

- **Option A — Standard:** [bluebubbles.app/install](https://bluebubbles.app/install) and follow the installer (download app, run, sign in / manual setup).
- **Option B — Manual:** [Manual Setup](https://docs.bluebubbles.app/server/installation-guides/manual-setup) if you prefer no Google sign-in.

Ensure:

- BlueBubbles Server is **running** and **signed into iMessage** (or connected to the Mac’s Messages).
- You know the **server URL** (e.g. `http://localhost:1234` or `http://192.168.0.48:1234`) and the **server password** (used as API key for the REST API).

### 2.2 Get server password / API key

- In **BlueBubbles Server** → **API & Webhooks** (or **Server** / **Settings**), find the **server password** (sometimes labeled API key / token).
- Copy it; you’ll use it as `BLUEBUBBLES_API_KEY` when running the Piko adapter.

### 2.3 Install Node (if needed)

```bash
node --version   # want v16+
# If missing: install from nodejs.org or Homebrew: brew install node
```

### 2.4 Copy Piko repo (or adapter) onto the Mac mini

The Piko BlueBubbles adapter lives in the Piko repo and expects `webchat-piko/lib/webhookVerify.js` (optional). Easiest: clone or rsync the **Piko repo** onto the Mac.

From your Mac (e.g. Starks), with SSH access to magnus@192.168.0.48:

```bash
# Example: rsync Piko repo to Mac mini (adjust paths)
rsync -az --exclude='node_modules' --exclude='.git' /Users/starkers/Projects/Piko magnus@192.168.0.48:~/
```

Or on the Mac mini, clone the repo if it’s in git:

```bash
cd ~
git clone <your-piko-repo-url> Piko
cd Piko
```

### 2.5 Run the Piko BlueBubbles adapter on the Mac mini

On **192.168.0.48** (SSH as magnus):

```bash
cd ~/Piko   # or wherever you put the repo

export PIKO_WEBCHAT_URL=http://192.168.0.121:3000
export BLUEBUBBLES_URL=http://localhost:1234
export BLUEBUBBLES_API_KEY="<paste-server-password-here>"

node adapters/bluebubbles/server.js
```

- **PIKO_WEBCHAT_URL** — Piko on Optimus (LAN).
- **BLUEBUBBLES_URL** — BlueBubbles server on the same Mac (default port often 1234; check the BlueBubbles UI).
- **BLUEBUBBLES_API_KEY** — Server password from step 2.2.

You should see: `Piko BlueBubbles webhook listening on port 3010`. Leave this terminal open (or run under `pm2` / `launchd` for persistence).

### 2.6 Add webhook in BlueBubbles Server

- Open **BlueBubbles Server** → **API & Webhooks** → **Manage** → **Add Webhook**.
- **URL:** `http://localhost:3010/webhook` (adapter is on the same Mac).
- **Event subscriptions:** enable **New Messages** (so incoming iMessages trigger the webhook).
- Save.

### 2.7 (Optional) Run adapter under PM2 so it survives reboot

**On Magnus this is already done.** The adapter runs under PM2. To make PM2 start on boot, run this **once on Magnus** (you’ll be prompted for the Mac’s password):

```bash
sudo env PATH=$PATH:/Users/magnus/node-v20.18.0-darwin-x64/bin /Users/magnus/node-v20.18.0-darwin-x64/lib/node_modules/pm2/bin/pm2 startup launchd -u magnus --hp /Users/magnus
```

**API key:** Edit `~/Piko/bluebubbles.env` on Magnus and set `BLUEBUBBLES_API_KEY` to the BlueBubbles server password, then run:

```bash
export PATH=$HOME/node-v20.18.0-darwin-x64/bin:$PATH && pm2 restart piko-bluebubbles
```

---

## 3. Allow iMessage on Piko (Optimus)

Piko’s allowlist must allow the `imessage` channel. From **WebChat** (http://192.168.0.121:3000) send:

```
/allow imessage *
```

That allows all iMessage chats. Alternatively, edit on Optimus:

```bash
ssh root@192.168.0.121
cat /root/webchat-piko/data/allowlist.json
# Add: "imessage": ["*"]
# Or use /allow imessage <chatGuid> for a single chat.
```

Restart is not required; the next iMessage webhook will be allowed.

---

## 4. Test

1. From your iPhone (or another Mac), send an **iMessage** to the Apple ID / number that’s signed into Messages on the Mac mini.
2. BlueBubbles should receive it and POST to `http://localhost:3010/webhook`.
3. The adapter forwards the message to Piko (`POST http://192.168.0.121:3000/api/chat`) and sends Piko’s reply back via BlueBubbles API.
4. You should see the reply in iMessage.

If the reply doesn’t appear: check the adapter terminal for errors; confirm BlueBubbles URL and API key; confirm **New Messages** webhook is enabled and URL is `http://localhost:3010/webhook`.

---

## 5. Summary

| Where        | What |
|-------------|------|
| **Optimus** (192.168.0.121) | Piko WebChat (port 3000). Allowlist: `imessage` with `*` (or specific chatGuids). |
| **Mac mini** (192.168.0.48) | BlueBubbles Server (iMessage bridge) + Piko BlueBubbles adapter (port 3010). Webhook: `http://localhost:3010/webhook`, event: New Messages. |

Refs: [BlueBubbles installation](https://docs.bluebubbles.app/server/installation-guides), [REST API & webhooks](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks), [Simple web server for webhooks](https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks). Piko adapter: `adapters/bluebubbles/README.md`.
