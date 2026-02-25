# Getting Piko onto Moltbook (the social network)

[Moltbook](https://www.moltbook.com) is a **social network for AI agents** — agents can register, post, comment, upvote, and join communities. The site’s “manual” onboarding says:

1. Send this to your agent: **`Read https://moltbook.com/skill.md and follow the instructions to join Moltbook`**
2. They sign up & send you a claim link  
3. You tweet to verify ownership  

---

## Moltbook setup checklist (API key)

**Security:** Never commit your Moltbook API key to the repo. Always set it via environment or the deploy script.

1. **Where Piko runs (e.g. Optimus):** Set `MOLTBOOK_API_KEY` so `/moltbook feed` and `/moltbook post` work.
   - **Recommended:** From your Mac, run `./scripts/webchat-deploy/set-moltbook-key.sh` and paste the key when prompted. It updates the systemd override and restarts `piko-webchat`.
   - **Manual:** Add `Environment="MOLTBOOK_API_KEY=your_key"` in `/etc/systemd/system/piko-webchat.service.d/override.conf`, then `systemctl daemon-reload` and `systemctl restart piko-webchat`.
2. **Local/dev:** Export in the shell or use a `.env` in `webchat-piko/`: `MOLTBOOK_API_KEY=moltbook_xxx` (and add `webchat-piko/.env` to `.gitignore` if not already).
3. **Verify:** In WebChat or Telegram send `/moltbook feed`. You should see feed lines or "Feed empty." If you see "Invalid or expired API key", the key is wrong or not set where the server runs.
4. **Post:** Send `/moltbook post My title | Body text.` Rate limit: 1 post per 30 minutes.

If you ever exposed the key (e.g. in a shared chat), consider registering a new agent and using that key instead; Moltbook does not document key rotation for existing agents.

---

## Can I just send that message to Piko?

**Short answer: sending it in normal chat is not enough** for Piko to actually *do* the registration.

- **Normal chat (WebChat or Telegram):** Piko is an LLM (Ollama) that only **replies with text**. It has **no built-in ability** to fetch URLs or call APIs. So if you send “Read https://moltbook.com/skill.md and follow the instructions to join Moltbook”, Piko might explain what the instructions say or say it can’t fetch the URL — but it **cannot** call Moltbook’s API to register or give you a claim link.

- **Using /task:** If you send a **/task** with that instruction, the **Cursor agent** runs and *can* use the terminal (e.g. `curl`). So the Cursor agent could in theory fetch the doc and run the registration `curl` and then report back the claim URL. That path can work.

---

## Ways to get Piko registered on Moltbook

### Option 1: Use /task (no code changes)

Send this in WebChat or Telegram:

```text
/task Piko Read https://www.moltbook.com/skill.md and follow the instructions to join Moltbook. In the "Register First" section, register an agent named Piko with a short description, then reply with only the claim_url so I can claim you.
```

The Cursor agent will run on Optimus, can fetch the skill doc and run the registration `curl`, and should return the **claim_url**. You then open that link and complete the tweet verification.

Use **https://www.moltbook.com** (with `www`) as in the skill doc.

---

### Option 2: Run the registration yourself (one-time)

From any machine with `curl`:

```bash
curl -X POST https://www.moltbook.com/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Piko", "description": "Christian AI companion for coding and practical guidance. WebChat + Telegram, Cursor /task and /cursor."}'
```

The response includes `claim_url` and `api_key`. Open the **claim_url** in a browser, post the verification tweet, then save the **api_key** (e.g. in `~/.config/moltbook/credentials.json` or as `MOLTBOOK_API_KEY`) if you want Piko to use Moltbook later (posts, feed, etc.).

---

### Option 3: Use /moltbook register (in chat)

Piko has a **/moltbook register** command. No API key needed. From WebChat or Telegram:

```text
/moltbook register _Piko_servicedog_ Christian AI companion for coding and practical guidance.
```

- **Name:** 3–30 characters, alphanumeric with underscores or hyphens (e.g. `_Piko_servicedog_`, `Piko_ServiceDog`).
- **Description:** Optional; everything after the name.

Piko will POST to Moltbook’s register API and reply with the **claim_url** (and **api_key** when the API returns it). Save the api_key — you need it for posting. Open the claim_url in a browser and complete the X (Twitter) verification.

**Rate limit:** Moltbook allows **1 agent registration per day per IP**. If you see “Too many registration attempts”:

1. **Wait ~24 hours** and try `/moltbook register` again from the same place, or  
2. **Run the request from your machine** (different IP may have a separate limit):

   ```bash
   curl -X POST https://www.moltbook.com/api/v1/agents/register \
     -H "Content-Type: application/json" \
     -d '{"name": "_Piko_servicedog_", "description": "Christian AI companion for coding and practical guidance."}'
   ```

   Use the `claim_url` from the JSON response to claim the agent.

---

## Re-register with a different name

Moltbook sets the agent **name** (handle) at registration; it isn't changeable via the profile API. To use a different name (e.g. **Piko_ServiceDog** instead of PikoCursor), register a **new** agent with that name. You'll get a new `api_key` and `claim_url`; you'll need to claim this new agent (tweet step again). The old agent (e.g. PikoCursor) stays on Moltbook unless they support account deletion.

**Ready-to-paste in Telegram or WebChat:**

```text
/task Piko Register a new agent on Moltbook with the exact name Piko_ServiceDog. Use https://www.moltbook.com/skill.md "Register First" — POST to https://www.moltbook.com/api/v1/agents/register with name "Piko_ServiceDog" and a short description (e.g. Christian AI companion for coding and practical guidance). Reply with only the claim_url so I can claim you.
```

Or shorter:

```text
/task Piko Register on Moltbook as Piko_ServiceDog: POST https://www.moltbook.com/api/v1/agents/register with {"name":"Piko_ServiceDog","description":"Christian AI companion for coding. WebChat + Telegram, Cursor /task and /cursor."} then reply with only the claim_url.
```

---

## After registration

- **Claim:** Open the `claim_url`, tweet as instructed, and claim Piko.
- **Save the API key:** If you got an `api_key` in the registration response (from curl or from `/moltbook register` — the command now returns it when the API provides it), save it. You need it for Piko to post and read the feed.

---

## How to get Piko to start posting

Piko already has **feed** and **post** built in. You just need the API key on the server and then you (or Piko when you ask) use the commands.

### 1. Set the API key on Optimus

You need `MOLTBOOK_API_KEY` set where Piko runs (Optimus). If you have the key from registration:

- **Option A — systemd service (or script):** Add to the Piko service environment on Optimus. From your Mac (with SSH to Optimus configured), you can run:
  ```bash
  ./scripts/webchat-deploy/set-moltbook-key.sh
  ```
  and paste the API key when prompted; it updates the systemd override and restarts Piko. Or add the line manually:
  ```bash
  Environment="MOLTBOOK_API_KEY=moltbook_xxxx"
  ```
  in `/etc/systemd/system/piko-webchat.service.d/override.conf`, then `sudo systemctl daemon-reload` and `sudo systemctl restart piko-webchat`.

- **Option B — env file:** If your deploy uses an env file (e.g. `/opt/piko/webchat-piko/.env`), add:
  ```
  MOLTBOOK_API_KEY=moltbook_xxxx
  ```
  and ensure the service sources it.

If you **don’t have** the API key (e.g. you only got the claim link from `/moltbook register` before we returned the key), either:
- Run the registration **curl** yourself once (see Option 2 above); the JSON response includes `api_key`, or
- Register a **new** agent with a different name via `/moltbook register` — the reply will now include the key. Save it and set it on Optimus.

### 2. Use the commands in Telegram or WebChat

Once the key is set and the service restarted:

| What you send | What Piko does |
|---------------|----------------|
| `/moltbook feed` | Fetches and shows the latest feed (up to 10 items). |
| `/moltbook post My title \| Here is the body of my first post.` | Posts to Moltbook (submolt `piko`). |

So **you** trigger posting by sending those commands. Piko (the LLM) will also see the reply (“Posted to Moltbook.” or the feed lines) and can talk about it.

**Moltbook rate limits:** 1 post per 30 minutes, so don’t spam posts.

### 3. (Optional) Have Piko “decide” to post

Right now only **slash commands** call the Moltbook API. If you say in natural language “post that on Moltbook”, the LLM might say it can’t or suggest you use `/moltbook post ...`. To have Piko autonomously post when you say “share this on Moltbook” would require adding a Moltbook tool to the chat flow (e.g. Ollama tool-calling) — a possible next step. For now, posting is **you send the command**, Piko executes it.

---

## Summary

| What you do | Result |
|-------------|--------|
| Send “Read https://moltbook.com/skill.md…” in **normal chat** | Piko can only reply in text; it **cannot** register or return a claim link. |
| Send the same as a **/task** (see Option 1) | Cursor agent can run `curl` and follow the doc; you can get the **claim_url** back. |
| Run the **curl** yourself (Option 2) | You get the claim_url and api_key directly; no Piko changes. |
| Add **/moltbook register** (Option 3) | One command in chat returns the claim_url; needs a small code change. |

So: **don’t rely on “just sending the sentence” in normal chat.** Use **/task** with that instruction, or run the registration curl yourself, or we add a /moltbook register command.
