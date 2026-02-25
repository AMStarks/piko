# Piko Slack adapter

Forwards Slack messages to Piko WebChat `POST /api/chat` and posts the reply in the channel. Uses **Socket Mode** (no public URL required).

## Setup

1. **Create a Slack app** at [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.
2. **Enable Socket Mode:** Settings → Socket Mode → Enable. Create an **App-Level Token** with `connections:write`; copy it as `SLACK_APP_TOKEN`.
3. **Bot token:** OAuth & Permissions → Scopes → Bot Token Scopes: add `app_mentions:read`, `chat:write`, `channels:history`, `groups:history`, `im:history`, `mpim:history`. Install to workspace; copy **Bot User OAuth Token** as `SLACK_BOT_TOKEN`.
4. **Subscribe to events (optional for DMs):** Event Subscriptions → Enable → Subscribe to bot events: `message.channels`, `message.groups`, `message.im`, `message.mpim` if you want the bot to hear all messages. Or invite the bot with `@botname` and use `app_mentions:read` only.

## Env

| Env | Required | Description |
|-----|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (xoxb-…). |
| `SLACK_APP_TOKEN` | Yes | App-Level Token (xapp-…) for Socket Mode. |
| `PIKO_WEBCHAT_URL` | Yes | Piko WebChat base URL (e.g. `http://localhost:3000`). |

## Run

```bash
cd adapters/slack
npm install
SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js
```

Or from repo root:

```bash
cd adapters/slack && npm install && npm start
```

## Deploy on Optimus

1. Copy this folder to Optimus (e.g. `/root/adapters/slack`).
2. Run `npm install`.
3. Set `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `PIKO_WEBCHAT_URL=http://localhost:3000`.
4. Run under systemd or PM2; ensure WebChat (`piko-webchat.service`) is running first.

Same brain as WebChat, Telegram, and Discord: one Piko, multiple channels.
