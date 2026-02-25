# Piko Discord adapter

Forwards Discord messages to Piko WebChat `POST /api/chat` and sends the reply back to the channel.

## Setup

1. **Create a Discord bot** at [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → Reset Token and copy the token.
2. **Enable Message Content Intent** for the bot (Bot → Privileged Gateway Intents → Message Content Intent: ON).
3. **Invite the bot** to your server (OAuth2 → URL Generator → scopes: `bot`; permissions: Send Messages, Read Message History, View Channels).

## Env

| Env | Required | Description |
|-----|----------|-------------|
| `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`) | Yes | Bot token from Discord Developer Portal. |
| `PIKO_WEBCHAT_URL` | Yes | Piko WebChat base URL (e.g. `http://localhost:3000` or `http://192.168.0.121:3000` on LAN). |

## Run

```bash
cd adapters/discord
npm install
DISCORD_TOKEN=your_token PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js
```

Or from repo root:

```bash
cd adapters/discord && npm install && npm start
```

Set env in a `.env` file (do not commit) or systemd:

```ini
Environment=DISCORD_TOKEN=your_token
Environment=PIKO_WEBCHAT_URL=http://localhost:3000
```

## Deploy on Optimus

1. Copy this folder to Optimus (e.g. `/root/adapters/discord`).
2. Run `npm install` in that folder.
3. Set `DISCORD_TOKEN` and `PIKO_WEBCHAT_URL=http://localhost:3000` (or `http://127.0.0.1:3000` if WebChat runs on same host).
4. Run under systemd or PM2; ensure WebChat (`piko-webchat.service`) is running first.

Same brain as WebChat and Telegram: one Piko, multiple channels.
