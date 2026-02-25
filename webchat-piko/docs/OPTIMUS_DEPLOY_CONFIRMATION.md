# Optimus deploy confirmation

**Last deploy:** Run `./scripts/webchat-deploy/deploy-to-optimus.sh` from repo root. Rsync syncs `webchat-piko/` to `root@192.168.0.121:/root/webchat-piko/` (excludes `.env`, `data/`, `logs/`, `node_modules/`).

---

## To be deployed to Optimus

**Logged:** 2025-02-06 (memory ontology and belief loop).

### Memory ontology and belief update loop
Design ref: repo root `docs/MEMORY_ONTOLOGY_AND_BELIEF_LOOP.md`.

- **data/memory/** — New directory with JSON stores: `interactions.json`, `episodic.json`, `user_beliefs.json`, `reflective.json`, `pending_beliefs.json` (Layer 1–3B, 5, pending). Deploy creates dir; rsync may exclude `data/` — on Optimus ensure `data/memory/` exists (or let app create on first run).
- **lib/memory.js** — Load/save all layers; `appendInteraction`, `appendEpisodic`, `getUserBeliefs`/`addUserBelief`, `getPendingBeliefs`/`addPendingBelief`/`setPendingBeliefs`, `getReflective`/`appendReflective`, `getMemoryBlockForPrompt(maxBeliefs, maxEpisodic)`.
- **lib/beliefLoop.js** — `ingestRecentExperience(sessionId)`: summarises last 10 exchanges via LLM, writes Layer 1; if salient, adds up to 2 candidate beliefs to pending and one episodic. `runBeliefConsolidation()`: adjusts pending confidence, promotes ≥0.7 (after identity gate) to user_beliefs, drops ≤0.15. `identityGate(proposition)`: SOUL + self_model check before promoting.
- **server.js** — After each chat reply (stream and non-stream): `setImmediate(() => beliefLoop.ingestRecentExperience(key))`. System prompt now includes `getMemoryBlockForPrompt(8, 3)` (top user beliefs + episodic). New cron: `0 3 * * *` (daily 03:00); in-process (node-cron), no new crontab entry. runs `beliefLoop.runBeliefConsolidation()`.

**On Optimus after this deploy:** No new env vars. Ensure `data/memory/` exists if rsync excludes `data/` (e.g. `mkdir -p /root/webchat-piko/data/memory`). Restart service; cron 3 AM runs automatically with existing node-cron in server.

---

## Deployed components (this deploy)

### LiteLLM integration
- **lib/llm.js** — `ai()` / `aiStream()` with primary Ollama and fallback (Claude, OpenAI).
- **server.js** — All chat/summary/discern/health/control/Notion preview use LiteLLM; **GET /api/models** added.
- **Scripts using LiteLLM:** heartbeat, moltbook-poster, moltbook-comment-run, learning-inquiry, meta-reflection-weekly, learning-topic-suggestions, rabbit-hole-daily, moltbook-aim-proposal.

### Slice 5 — Files pattern detection
- **scripts/files-patterns.js** — Daily cron: scans `data/learning/notes-capture.md` for PDF/theme patterns; Telegram nudges + topics.txt.
- **POST /api/ios-hub** `action: "files_recent"` — Accepts file names, returns `suggestedTopics`.

### Slice 6 — Context synthesis
- **scripts/context-synthesis.js** — Busy day + tensions → Telegram focus nudge + free 30min slot.
- **scripts/daily-briefing.js** — 6 AM briefing includes calendar event count + first free slot (from `data/calendar-snapshot.json`).
- **scripts/proactive-patterns.js** — Invokes context-synthesis after its own nudges.
- **GET /api/ios-dashboard** — Returns `contextHint` and `freeSlot` when calendar snapshot has busy day + tensions.

### Polish — Widget + Siri
- **GET /api/widget** — Lightweight JSON: `tensions`, `nextReminder`, `moltbook` for lock-screen widget.
- Siri shortcuts and widget setup are documented in repo **docs/** (e.g. `docs/PIKO_SIRI_SHORTCUTS.md`, `docs/PIKO_WIDGET.md`); iOS app and docs are not part of webchat-piko rsync.

---

## On Optimus after deploy

1. **Install deps (if package.json changed):**  
   `ssh -i ~/.ssh/id_optimus root@192.168.0.121 "cd /root/webchat-piko && npm install"`

2. **Restart service:**  
   `ssh -i ~/.ssh/id_optimus root@192.168.0.121 "systemctl restart piko-webchat.service"`

3. **Optional .env for LiteLLM fallbacks:**  
   On Optimus, ensure `/root/webchat-piko/.env` has `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`) if you want Claude/OpenAI when Ollama is down. `MODEL_PRIMARY` and `LITELLM_LOG` are optional.

4. **Cron (unchanged):**  
   files-patterns (daily), proactive-patterns (hourly, runs context-synthesis), daily-briefing (6 AM), intent-poller, moltbook-poster, etc. per runbook.
