# Speech naturalness harness

Goal: **make the model talk naturally to the human.** This harness runs long conversations against the live model, logs every turn, then you (or an agent) review failures and correct prompts—and **revert** if the corrections made things worse.

## What it does

1. **Run** — Send many prompts (greetings, small talk, “what can you do?”, etc.) to `/api/chat` in one session. Run for N turns or up to 8 hours.
2. **Check** — Scan the log for unnatural replies: meta slip, canned phrases, formal openings, role recital, long lists after “hey”.
3. **Correct** — Edit `webchat-piko/prompts/SOUL.md`, `IDENTITY.md`, or server leading rule / meta filter to address the patterns that showed up.
4. **Re-run & compare** — Run again (e.g. 100–200 turns), run the checker, compare failure rate. If it’s worse, **revert** the prompt edits.

## Run the harness

From repo root (or from this directory with `node run.js`):

```bash
# 500 turns, 3s delay between each (default)
node scripts/speech-naturalness/run.js --turns 500

# Run for 8 hours (delay between turns so we don’t hammer the server)
node scripts/speech-naturalness/run.js --duration 8 --delay 5000

# Against Optimus
PIKO_WEBCHAT_URL=https://your-optimus-host node scripts/speech-naturalness/run.js --turns 200

# Custom log path
node scripts/speech-naturalness/run.js --turns 300 --out ./my-run.json
```

- Uses session `naturalness-test` (or `PIKO_NATURALNESS_SESSION`) so it doesn’t pollute your main chat.
- Log is written to `scripts/speech-naturalness/data/naturalness-run-YYYYMMDD-HHMM.json` unless you pass `--out`.

## Check the log

```bash
node scripts/speech-naturalness/check.js scripts/speech-naturalness/data/naturalness-run-20250206-1430.json
```

Output: counts by tag (meta, canned, formal, role, long, list, verbose, ok) and the first 30 failure samples. Use this to decide what to add to SOUL/IDENTITY or the server’s meta-slip filter.

## Correct then revert

1. **Before editing:** Ensure prompts are committed (or on a branch) so you can revert.
2. **Edit** `webchat-piko/prompts/SOUL.md` and/or `IDENTITY.md` (and optionally server `leadingRule` / `META_SLIP_PATTERN` in `server.js`) based on the checker report.
3. **Redeploy** (or restart the server) so the model sees the new prompts.
4. **Re-run** the harness with a smaller set (e.g. `--turns 200`), then run **check.js** again.
5. **Compare** failure rate (and sample failures). If the new run is **worse**, revert the prompt edits:
   ```bash
   git checkout -- webchat-piko/prompts/SOUL.md webchat-piko/prompts/IDENTITY.md
   # and any server.js edits
   ```
6. If the new run is **better**, keep the edits and optionally run a longer run to confirm.

## Agent / automated loop

You can have an AI agent:

1. Start the harness (e.g. `run.js --duration 8` or `--turns 1000`) and wait for it to finish (or run it in the background and poll for the log file).
2. Run `check.js` on the log and read the report.
3. Propose concrete edits to SOUL, IDENTITY, or server (e.g. new anti-canned phrase, stronger “one short line” rule).
4. Apply the edits, restart the server (or redeploy), run a **shorter** run (e.g. 100 turns), run check again.
5. If failure rate went **up**, revert the edits and stop (or try a different correction). If it went **down**, keep and optionally run longer to validate.

Revert is always: restore the prompt files (and server.js if changed) to the previous version so the model behaviour is back to the baseline you had before the correction attempt.
