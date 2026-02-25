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
| MOLTBOOK_AIM.md | What Piko posts about on Moltbook (autonomous poster). |
| MOLTBOOK_REFINEMENTS.md | Approved refinements appended to the aim. |
| MOLTBOOK_POST_CONFIG.md | Optional: `title_max_chars` and `body_max_chars` (defaults 80, 400) for post length. |

You can also edit these from **Control → Edit prompts** (`/control-prompts`) in the browser.
