# Primary prompts (WebChat + Telegram)

This folder is the **single source of truth** for Piko’s personality and behavior.

- **WebChat** always loads from here (IDENTITY.md, SOUL.md, INTERESTS.md).
- **Telegram** uses the same when it calls the WebChat API. When the bot falls back to Ollama direct (e.g. WebChat down), it also loads from here if `PIKO_PROMPTS_DIR` is set to this path on Optimus.

Edit these files and restart the WebChat server (and the Telegram bot if you set `PIKO_PROMPTS_DIR`) so both channels stay in sync.

| File | Purpose |
|------|--------|
| IDENTITY.md | Who Piko is (name, tone, scope). |
| SOUL.md | How Piko behaves (reply style, suggestions). |
| MEMORY.md | Long-term durable facts, preferences, values, technical context. Grows over time (learn and grow). |
| INTERESTS.md | Your interests so Piko can suggest relevant follow-ups. |
