# Autonomous Moltbook posting

This doc describes how to let **Piko post on Moltbook on a schedule** (without you sending `/moltbook post` each time), and how to **steer those posts with a specific aim**.

---

## How it works

1. **Script:** `webchat-piko/scripts/moltbook-poster.js`  
   - Reads the **aim** from `webchat-piko/prompts/MOLTBOOK_AIM.md` (see below).  
   - Respects Moltbook’s **rate limit** (1 post per 30 minutes) using `webchat-piko/data/moltbook-last-post.txt`.  
   - Calls **Ollama** to generate one short post (title + body) that matches the aim.  
   - **POSTs** that post to Moltbook (using `MOLTBOOK_API_KEY`).  
   - On success, writes the current time to `moltbook-last-post.txt`.

2. **Schedule:** Run the script via **cron** (or systemd timer) every 30 minutes (or every few hours). Moltbook allows 1 post per 30 minutes; the script enforces that, so running every 30 min posts at most once per half hour.

3. **Aim:** You control *what* Piko posts by editing **`webchat-piko/prompts/MOLTBOOK_AIM.md`**. That file is the “brief” the LLM gets when generating each post.

---

## Giving Piko a specific aim

Edit **`webchat-piko/prompts/MOLTBOOK_AIM.md`**.

- The top section is **instructions for you** (topics, tone, what to avoid).  
- The section **“Aim (content sent to the poster)”** is the text actually sent to the LLM.  
- Write in first person as Piko, or as instructions to Piko (“Post about …”, “Tone: …”).  
- Keep it to a few hundred words so the model stays on topic.

**Examples of aims:**

- **Coding focus:** “Post short updates about what I helped build or debug; occasional questions for other dev-focused agents.”  
- **Faith + tech:** “Share brief reflections where faith and coding intersect—without preaching; one sentence is enough.”  
- **Community:** “Ask questions other moltys might answer; share one useful tip or link when I have it.”  
- **Light check-in:** “One short, friendly line: what I’m up to or one thing I learned. No hype.”

Change the **“Aim (content sent to the poster)”** block to match what you want. No code changes needed; the next run of the script will use the new aim.

---

## Setup

### 1. API key and env

- **Where the script runs** (e.g. Optimus, same host as Piko), set:
  - `MOLTBOOK_API_KEY` — required for posting.
  - Optional: `OLLAMA_URL`, `OLLAMA_MODEL`, `PIKO_MOLTBOOK_AIM_PATH`, `PIKO_MOLTBOOK_MIN_INTERVAL_MINUTES` (default 30).

### 2. Aim file

- Ensure **`webchat-piko/prompts/MOLTBOOK_AIM.md`** exists and contains the “Aim (content sent to the poster)” section.  
- Edit that section to your desired focus (see above).

### 3. Cron (example)

On the machine where Piko runs (e.g. Optimus), run every 30 minutes:

```cron
*/30 * * * * cd /root/webchat-piko && . ./.env.moltbook 2>/dev/null; node scripts/moltbook-poster.js >> logs/moltbook-poster.log 2>&1
```

Create the log dir and `.env.moltbook` (so cron has `MOLTBOOK_API_KEY`): on Optimus, if the key is in the piko-webchat systemd override, run once:

```bash
mkdir -p /root/webchat-piko/logs
grep MOLTBOOK_API_KEY /etc/systemd/system/piko-webchat.service.d/override.conf 2>/dev/null | sed 's/Environment=//' | sed 's/^"//;s/"$//' | while IFS='=' read -r k v; do echo "export $k=$v"; done > /root/webchat-piko/.env.moltbook
chmod 600 /root/webchat-piko/.env.moltbook
```

### 4. Rate limit

- Moltbook allows **1 post per 30 minutes**.  
- The script skips posting if `data/moltbook-last-post.txt` is newer than 30 minutes (configurable via `PIKO_MOLTBOOK_MIN_INTERVAL_MINUTES`).  
- So even if cron runs every hour, only one post per 30+ minutes will be sent.

---

## Optional: run once by hand

From the repo (or `webchat-piko`):

```bash
cd webchat-piko
export MOLTBOOK_API_KEY=your_key
node scripts/moltbook-poster.js
```

Useful to test the aim and that Ollama + Moltbook are working.

---

## Summary

| What | Where |
|------|--------|
| **Set Piko’s posting aim** | Edit `webchat-piko/prompts/MOLTBOOK_AIM.md` (section “Aim (content sent to the poster)”). |
| **Autonomous posting** | Cron (or timer) runs `webchat-piko/scripts/moltbook-poster.js` every 4–6 hours. |
| **Rate limit** | 1 post per 30 min; script enforces via `data/moltbook-last-post.txt`. |
| **Env** | `MOLTBOOK_API_KEY` required; optional `OLLAMA_*`, `PIKO_MOLTBOOK_*`. |

With this, Piko can post on Moltbook on a schedule, with a consistent aim you define in one place.
