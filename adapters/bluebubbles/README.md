# Piko BlueBubbles (iMessage) adapter

Receives webhooks from a **BlueBubbles** server (macOS iMessage bridge), forwards the message to Piko `POST /api/chat`, and sends the reply back via BlueBubbles REST API.

**Requires:** BlueBubbles server running on a Mac (see [BlueBubbles](https://bluebubbles.app/)).

## Env

| Env | Required | Description |
|-----|----------|-------------|
| `PIKO_WEBCHAT_URL` | Yes | Piko WebChat base URL (e.g. `http://localhost:3000` or your Optimus URL). |
| `BLUEBUBBLES_URL` | Yes | BlueBubbles server URL (e.g. `http://your-mac:1234`). |
| `BLUEBUBBLES_API_KEY` | Yes | API key from BlueBubbles server (needed to send replies). |
| `BLUEBUBBLES_WEBHOOK_PORT` | No | Port for this adapter (default `3010`). |

## Run

```bash
cd adapters/bluebubbles
PIKO_WEBCHAT_URL=http://localhost:3000 BLUEBUBBLES_URL=http://192.168.0.245:1234 BLUEBUBBLES_API_KEY=your_key node server.js
```

## BlueBubbles webhook setup

In BlueBubbles server settings, set the **webhook URL** to `http://this-machine:3010/webhook` (or your tunnel URL). Payload expected: `{ "message": "user text", "chatGuid": "..." }` (or `data.message.text` / `data.chat.guid`). This adapter will POST to Piko and send the reply via BlueBubbles API.

Same brain as WebChat, Telegram, Discord, Slack, WhatsApp: one Piko, multiple channels. **macOS only** (BlueBubbles runs on Mac).
