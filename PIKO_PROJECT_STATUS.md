# Piko — Project Status Summary

**Last updated:** February 2026 (Wisdom Core, metrics, channels, skills, Phase 1 productionization).

---

## What Piko Is

Piko is a **philosophically grounded AI companion** with a **temporal self** (learning repo, sticky ideas, tensions, rabbit-hole notes) and **epistemic invariants**. It runs as:

1. **WebChat backend** (`webchat-piko/`) — Node server that serves chat UI, APIs, control panel, and cron-driven learning/Moltbook flows.
2. **iOS app** (`Piko-iOS/`) — Native client with chat, Reminders/Calendar/Notes/Mail integrations, Share Extension, dashboard, and Settings with integration toggles.
3. **Optional Telegram** — Same backend can be used by a Telegram bot; Telegram works without the phone needing to reach your server (server talks to Telegram cloud).

---

## Server (webchat-piko) — Current State

### ✅ Implemented

| Area | Details |
|------|--------|
| **LiteLLM** | All chat, health, control, and 8 scripts use `lib/llm.js` (`ai()`, `aiStream()`). Primary model configurable; fallback to Claude/OpenAI when Ollama unavailable. `GET /api/models` lists primary + available models. |
| **Unified heartbeat** | **node-cron** runs every **5 minutes** in-process: `checkTensions()`, `checkMoltbookFeedback()`, `learningHeartbeat()`. Reduces reliance on external cron for basic pulse. Existing standalone scripts (heartbeat.js, rabbit-hole-daily, moltbook-poster, etc.) still exist for heavier daily/weekly jobs. |
| **/api/health** | Returns `{ ok, llm, model }` and pings the LLM. **Optional API key:** set `PIKO_HEALTH_API_KEY` (or `HEALTH_API_KEY`); then requests must send `Authorization: Bearer <key>` or `x-api-key: <key>`. If unset, health remains open. |
| **Simple RAG** | For each chat message, **getRagContext(message)** scans `data/learning/*.md`, splits into chunks, scores by keyword overlap with the user message, returns **top 3** chunks (capped at `PIKO_RAG_MAX_CHARS`, default 1500). Injected into system prompt as “Relevant context from your learning”. Disable with `PIKO_RAG=0`. |
| **Chat & streaming** | POST /api/chat (body or JSON), optional `stream: true` for SSE. System prompt from prompts/ (IDENTITY, SOUL, MEMORY, INTERESTS) + recent learning block + sticky snippet + pending question + **RAG context** + learning-inquiry nudge. |
| **Learning pipeline** | Rabbit-hole → sticky ideas → tensions (file-based in `data/learning/`). Scripts: rabbit-hole-daily, meta-reflection-weekly, learning-topic-suggestions, learning-inquiry, notion-sync, files-patterns, context-synthesis, daily-briefing. |
| **Control panel** | `/control`, `/control-moltbook`, `/control-prompts`, `/control-learning`, `/control-mind`, `/control-wisdom`, `/control-wisdom-metrics`, `/control-channels`. Optional lock: `PIKO_CONTROL_ALLOWED_IP` or `PIKO_CONTROL_HEADER`. |
| **Wisdom Core** | Fixed corpus (`data/corpus/`, 4 docs, cached summary); truth engine (claims, corrections, wisdom_cache); nightly distillation (2AM); correction detection in chat; wisdom affirmation (“w001 is spot on”); top wisdom by confirmed×age. See `webchat-piko/docs/WISDOM_CORE_PLAN.md`. |
| **Maturation metrics** | `data/metrics/` (wisdom_growth, relationship, truth_engine); GET /api/metrics; POST /api/metrics/advice-followed; /control-wisdom-metrics dashboard; weekly retro cron (Sunday 8AM, Telegram or file). |
| **Channels** | WhatsApp in `webchat-piko/channels/whatsapp` (Baileys); /control-channels; Discord/Slack/Blue Bubbles in repo `adapters/`. Same brain, allowlist per channel. |
| **Local skills** | Auto-load from `skills/*.js` (notes, todo, summarize + custom). No marketplace; local only. |
| **Intents & iOS hub** | `data/intents.json` for reminders/queue; POST /api/ios-hub for reminder, notes_capture, inquiry, files_recent; GET /api/ios-dashboard (tensions, reminders, Moltbook, contextHint, freeSlot). |
| **Moltbook** | Feed, post, list, prune; MOLTBOOK_API_KEY. Poster and comment scripts use LiteLLM. |
| **Productionization (Phase 1)** | Conversations in SQLite (`data/conversations.db`); structured logging (pino) + request ID; rate limit on POST /api/chat (60/min per IP); config validation at startup; corpus edit lock (`PIKO_CORPUS_EDIT_ALLOWED_IP` / `PIKO_CORPUS_EDIT_HEADER`). |
| **Other** | /cursor, /task (Optimus/Docker optional), /search (Tavily/Serper), /news, /gmail unread, Notion preview, GET /api/widget. |

### Env (summary)

- **LLM:** `MODEL_PRIMARY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (LiteLLM fallbacks).
- **Health:** `PIKO_HEALTH_API_KEY` or `HEALTH_API_KEY` (optional).
- **RAG:** `PIKO_RAG=0` to disable; `PIKO_RAG_MAX_CHARS` (default 1500).
- **Learning inject:** `PIKO_LEARNING_CHAT_INJECT=0` to disable recent learning/sticky/pending-question inject.
- **Moltbook, Telegram, Notion, Tavily/Serper, News, Gmail, Grok, Cursor:** see README and DEPLOYMENT_CHECKLIST.

---

## iOS App (Piko-iOS) — Current State

### ✅ Implemented

| Area | Details |
|------|--------|
| **Chat** | Main view with message list, input bar, send. Uses `viewModel.baseURL` (persisted) for POST /api/chat. |
| **Settings** | Base URL, UI style (Neutral/Retro), **Integrated apps** with Server and iPhone sections. Each integration has an **icon left of name** and either a **toggle** (on/off) or status text (“Connected”, “Available”, “Configure on server”, “Coming soon”). |
| **Integration toggles** | Reminders, Notes, Calendar, Mail, Files, Shortcuts (iPhone) can be turned on/off. State persisted in UserDefaults; Reminders and Mail **toolbar buttons** only show when their integration is on. “Configure on server” rows are **tappable** and open the server control panel URL. |
| **Open server control panel** | Settings → Server → “Open server control panel” opens `{Base URL}/control` in Safari. Caption explains API keys/OAuth are set on the server. |
| **Reminders** | EventKit Reminders; sheet with today’s reminders, add reminder, optional due date. Toolbar icon when Reminders integration is on. |
| **Calendar** | EventKit Calendar; shown in Reminders sheet (today’s events). |
| **Mail** | **Available** (not “Coming soon”). When on, toolbar envelope icon opens **MailComposeView** (system compose sheet). If device can’t send mail, alert suggests adding a Mail account. |
| **Share Extension** | “Share to Piko” from Notes, Safari, etc.; payload to App Group, main app sends to server as notes_capture. |
| **Dashboard** | Sheet with tensions count, next reminder, Moltbook, context hint, free slot (from GET /api/ios-dashboard). |
| **App connection** | App must reach Base URL. **127.0.0.1** on the phone is the phone itself — use a **tunnel** (e.g. ngrok) or same-Wi‑Fi **computer IP** so the app can reach the server. Telegram does not require the phone to reach the server. |

### Docs

- `Piko-iOS/docs/CONFIGURE_ON_SERVER.md` — How “configure on server” works and how to open the control panel from the app.
- `Piko-iOS/docs/SHARE_EXTENSION_SETUP.md` — Share Extension and App Group setup.

---

## What We Just Finished (This Pass)

1. **Phase 1 productionization** — SQLite conversation store (history survives restarts); pino structured logging + request ID; rate limiting (60/min per IP on /api/chat); config validation at startup; control panel optional lock (`PIKO_CONTROL_ALLOWED_IP` / `PIKO_CONTROL_HEADER`).
2. **Weekly retro cron** — Sunday 8AM runs `weeklyRetro()` from lib/metrics; sends to Telegram if configured, else appends to `data/learning/weekly-retro.md`.
3. **Wisdom Core, metrics, channels, skills** — (Earlier pass.) Corpus, truth engine, nightly wisdom, /control-wisdom, /control-wisdom-metrics; channels/whatsapp + /control-channels; skills auto-load from `skills/*.js`.

---

## Deployment (Optimus)

- Deploy with `scripts/webchat-deploy/deploy-to-optimus.sh`.
- On server: `npm install`, `systemctl restart piko-webchat.service`.
- Ensure `.env` has required keys (LiteLLM, Moltbook, etc.). Optional: set `PIKO_HEALTH_API_KEY` for health auth.
- Cron: standalone scripts (heartbeat.js, rabbit-hole-daily, etc.) can remain in system cron for daily/weekly jobs; the in-process 5‑min heartbeat covers lightweight pulse.

---

## Optional Next Steps (Not Done)

- **Wire “advice followed”** — When user acts on a suggestion (e.g. iOS creates reminder from Piko), call POST /api/metrics/advice-followed.
- **Tap-to-talk (iOS)** — Mic → STT → POST /api/chat → TTS; no wake word initially.
- **Lock screen widget** (iOS).
- **Webhook signature verification** — When adding webhook endpoints, verify provider signatures.
- **RAG upgrade** — e.g. embeddings + vector store for semantic search.
- **Companion depth (Tier 6)** — Private scratch self, memory importance/expiry, identity revisable but bounded, intrinsic drive. See `docs/PIKO_FORWARD_RECOMMENDATION.md`.

---

## Summary Table

| Component | Status |
|-----------|--------|
| LiteLLM (server + scripts) | ✅ Done |
| Unified 5‑min heartbeat (node-cron) | ✅ Done |
| /api/health + optional API key | ✅ Done |
| Simple RAG (learning/*.md → top‑3) | ✅ Done |
| iOS: integrations + toggles + icons | ✅ Done |
| iOS: Mail compose + “Open server control panel” | ✅ Done |
| iOS: Configure-on-server explanation + doc | ✅ Done |
| Production slices (Reminders, briefing, Share, dashboard, Moltbook) | ✅ Done |
| Wisdom Core (corpus, truth, wisdom, correction detection) | ✅ Done |
| Maturation metrics + /control-wisdom-metrics | ✅ Done |
| Channels (WhatsApp in webchat-piko/channels) + /control-channels | ✅ Done |
| Local skills (auto-load skills/*.js) | ✅ Done |
| Phase 1 productionization (SQLite, pino, rate limit, config, control lock) | ✅ Done |

**Piko is in production shape:** server with LiteLLM, Wisdom Core, in-process heartbeat, SQLite conversations, structured logging, rate limiting, and optional control/corpus locks; iOS app with chat, integrations, toggles, Mail, and “configure on server” flow. See `docs/PHASED_COMPLETION.md` for the full roadmap.
