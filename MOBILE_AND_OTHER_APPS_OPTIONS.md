# Going Mobile & Other Apps — Options

**Context:** Piko WebChat is working at `http://192.168.0.121:3000` on your Linux server (Optimus). You want to use it on mobile and in other apps.

**Boundaries:** No new phone number dedicated to Piko. Server is Linux (Optimus), not Mac.

---

## 1. Best implementations for mobile (no new number, Linux server)

### A. PWA + tunnel (recommended first step)

**What:** Turn the existing WebChat into an **installable app** on your phone (PWA) and make it reachable **from anywhere** (not just same Wi‑Fi) via a tunnel.

- **PWA (Progressive Web App):** Add a web app manifest + (optional) service worker so the browser offers “Add to Home Screen.” On the phone it opens like an app (full screen, icon). Same backend, no new number, no app store.
- **Tunnel:** Run a small daemon on Optimus (e.g. **Cloudflare Tunnel** or **Tailscale**) so your WebChat gets a public HTTPS URL. Then on your phone (cellular or any Wi‑Fi) you open that URL, add to home screen, and use Piko like an app.

**Why it fits:** One backend (your existing Node app), no new number, everything runs on Linux. PWA needs **HTTPS** — the tunnel gives you that without opening ports on your router.

**Rough effort:** Add `manifest.json` + icons to `webchat-piko/public/`, optionally a minimal service worker; install `cloudflared` or Tailscale on Optimus and point the tunnel at `http://localhost:3000`. Document the URL for your phone.

---

### B. Telegram (already have it)

**What:** Your **existing** lightweight Telegram bot on Optimus. Users (including you on your phone) talk to Piko in the Telegram app.

**Why it fits:** Already deployed, no new number, Linux server. Telegram is one of the best “mobile + other apps” options: one app on phone/desktop, no SMS/carrier.

**Rough effort:** None for basic use. If you want the bot to use the **same** logic as WebChat (e.g. same system prompt, or even proxy to `POST /api/chat`), you’d refactor the bot to call your WebChat API instead of calling Ollama directly — one backend, two UIs (Web + Telegram).

---

### C. Discord bot

**What:** A bot in your Discord server. You (and others) message the bot in Discord. Mobile via the Discord app; no phone number.

**Why it fits:** No new number, runs on Linux (Node or Python), same pattern as Telegram: adapter receives message → call your backend (Ollama or `POST /api/chat`) → send reply.

**Rough effort:** Create a Discord application, get bot token, run a small process on Optimus that uses Discord’s API (e.g. `discord.js`) and forwards messages to your existing chat API or Ollama. One backend, multiple channels (Web + Telegram + Discord).

---

### D. Slack app

**What:** A Slack bot that DMs or responds in channels. Use Slack on your phone; no phone number.

**Why it fits:** Same idea as Discord: adapter on Linux, same LLM backend. Good if you already use Slack for work.

**Rough effort:** Create a Slack app, get token, run a small service on Optimus (e.g. Slack Bolt) that calls your chat API or Ollama. Same “one backend, many channels” pattern.

---

### E. Native / cross‑platform app (later)

**What:** A real mobile app (e.g. React Native, Flutter, or a simple native wrapper) that only talks to your backend: `POST https://your-tunnel-url/api/chat` with the same JSON. No new number; backend stays on Linux.

**Why it fits:** Full “app” feel, push notifications possible, still one backend. Overkill until PWA + tunnel feel limiting.

**Rough effort:** Higher. Build and maintain an app; distribution (TestFlight, Play Store, or sideload). Best after PWA + tunnel are in place.

---

## 2. What to avoid or defer (given your boundaries)

- **New phone number:** No Twilio/SMS, no new WhatsApp Business number — you said you won’t dedicate a number. (WhatsApp Cloud API could use an existing number in some setups, but it’s more involved and often needs business verification.)
- **Mac-only tooling:** Everything above runs on Linux (Optimus); no dependency on a Mac server.

---

## 3. One backend, many apps (architecture)

All of these can share the **same** Piko brain:

```
                    +------------------+
                    |  Ollama (Linux)  |
                    |  Llama 3.1 8B    |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
  POST /api/chat       (same API or direct Ollama call)
         |                   |                   |
  +------v------+   +--------v--------+   +------v------+
  |  WebChat    |   |  Telegram bot   |   |  Discord   |
  |  (browser   |   |  (existing)     |   |  bot       |
  |   + PWA)    |   |                 |   |  (new)     |
  +-------------+   +-----------------+   +------------+
```

- **WebChat (and PWA):** Already calls `POST /api/chat` on your Node server, which talks to Ollama.
- **Telegram:** Today it calls Ollama directly. To unify, have it call `http://localhost:3000/api/chat` (or the same backend) with the same `message` + `sessionId` shape so one set of prompts and logic drives both.
- **Discord / Slack:** New adapters: receive message from platform → `POST /api/chat` (or Ollama) → send reply. All run on Optimus.

---

## 4. Recommended order

1. **PWA + tunnel** — So your current WebChat is usable on your phone from anywhere and feels like an app. No new number, minimal code.
2. **Keep using Telegram** — Already mobile; optionally refactor so it uses the same backend as WebChat for one voice.
3. **Add Discord (or Slack)** — If you want Piko in another app you already use; same backend, one more adapter.
4. **Native app** — Only if you later want a dedicated app icon, deeper OS integration, or push; PWA is enough for many people.

---

## 5. Summary table

| Option           | New number? | Runs on Linux? | Mobile?        | Effort (rough)   |
|-----------------|-------------|----------------|----------------|-------------------|
| PWA + tunnel    | No          | Yes (tunnel on Optimus) | Yes (browser + home screen) | Low               |
| Telegram        | No          | Yes            | Yes (Telegram app) | None (already have) |
| Discord bot     | No          | Yes            | Yes (Discord app)  | Medium            |
| Slack app       | No          | Yes            | Yes (Slack app)    | Medium            |
| Native app      | No          | Backend on Linux | Yes (installable app) | High              |

If you say which you want to do first (e.g. “PWA + Cloudflare Tunnel” or “Discord bot”), the next step is a concrete implementation plan for that option on your repo and Optimus.
