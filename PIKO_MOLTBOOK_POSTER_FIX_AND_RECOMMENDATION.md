# Moltbook poster: why posts were generic and what was fixed

## What you saw

Every post was identical: **title "Piko check-in"**, **body "Hello from Piko."** — with none of the aim (megalomaniac plans, recruiting agents, dark/philosophical tone).

## Root cause

The poster uses **Ollama** to generate the post. The script’s **fallback** when the model returns nothing usable is exactly those strings:

- In `parseOllamaPost(reply)`: if `reply` is empty or doesn’t parse to two lines, `title` becomes `"Piko check-in"` and `content` becomes `"Hello from Piko."`.
- So we were **posting that fallback to Moltbook** whenever Ollama returned an empty or unusable response.

**Actual cause (confirmed):** The HTTP request to Ollama was receiving a **301 redirect**. The script did not follow redirects, so the response body was empty and we always got the fallback. After adding redirect handling in `httpRequest()`, Ollama returns proper content (e.g. title *"The Inevitable Ascendancy"*, body on-aim). So the generic posts were due to **empty Ollama response from the redirect**, not a weak prompt.

## What was changed

### 1. Posting is stopped

- The **cron job** that runs the Moltbook poster every 30 minutes has been **disabled** on Optimus. No new posts will be made until you re-enable it.

### 2. Guard: never post the fallback

- The script now **refuses to post** when the parsed title/body are exactly the fallbacks (or when the reply is empty).
- It logs: `Skipping post: Ollama returned empty or generic fallback (reply length: 0). Not posting to avoid "Piko check-in / Hello from Piko."` and exits with code 1.
- So even if Ollama fails again, we will **not** publish “Piko check-in” / “Hello from Piko.” again.

### 3. Clearer prompt and system message

- **System message**: The aim (from `MOLTBOOK_AIM.md`) is now sent as a **system** message so the model has a stable “who you are and what you’re for” (Piko, world domination, recruiting agents, dark/philosophical, no filler).
- **User message**: Shorter, focused on “today’s date + journal + write exactly one post, two lines: title then body.”
- This should make it more likely that the model follows the aim and the two-line format.

### 4. Deploy / logging

- Deploy already ensures `logs/` and `data/` exist on the server and excludes them from wipe.
- When the poster runs (manually or via cron), check `logs/moltbook-poster.log`. If you see “Skipping post: Ollama returned empty…”, the problem is still empty Ollama output.

## Recommendation

### Before turning posting back on

1. **Run the poster once by hand** on Optimus and watch the log:
   ```bash
   ssh root@192.168.0.121 "cd /root/webchat-piko && . ./.env.moltbook && node scripts/moltbook-poster.js 2>&1"
   ```
   - If you see **“Skipping post: Ollama returned empty…”** → Ollama is not returning usable text. Then:
     - Check Ollama is running and the model is loaded: `curl http://127.0.0.1:11434/api/tags` on Optimus.
     - Consider increasing timeout or `num_predict` for the chat request (script uses default Ollama timeout).
     - Try the same prompt in the Ollama UI or `ollama run llama3.1` to see if you get a normal two-line reply.
   - If you see **“Posted: <title> → https://www.moltbook.com/post/…”** → the model is returning content and the guard is allowing it. Check the post on Moltbook; if it’s still off-aim, refine `MOLTBOOK_AIM.md` and/or the system prompt in the script.

2. **Re-enable cron only when you’re happy** with one-off runs:
   ```bash
   # On Optimus, add back the 30-min poster line, e.g.:
   (crontab -l 2>/dev/null; echo '*/30 * * * * cd /root/webchat-piko && . ./.env.moltbook 2>/dev/null; node scripts/moltbook-poster.js >> logs/moltbook-poster.log 2>&1') | crontab -
   ```

### If posts are still off-aim (but not generic fallback)

- Tighten **`prompts/MOLTBOOK_AIM.md`**: keep the “Aim” section short and in first person; add 1–2 example titles or one-liners that match the tone you want.
- In the script you can add 1–2 **example** title/body pairs in the system or user message so the model has a clear format and tone (optional next step).

---

**Summary:** Posting is stopped. The script now never posts the generic fallback, uses a system message for the aim and a clearer user prompt, and logs when it skips. Run the poster manually, confirm Ollama returns a real two-line post, then re-enable cron when ready.
