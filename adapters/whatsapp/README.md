# Piko WhatsApp adapter

Forwards WhatsApp messages to Piko WebChat `POST /api/chat` and sends the reply back. Uses **Baileys** (multi-device, no official API).

## Setup

1. **Node:** `cd adapters/whatsapp && npm install`
2. **First run:** `PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js` — a **QR code** appears in the terminal; scan it with WhatsApp (Linked Devices → Link a device).
3. **Auth:** State is saved in `./auth`. Do not commit this folder. Next runs reuse it (no QR unless logged out).

## Env

| Env | Required | Description |
|-----|----------|-------------|
| `PIKO_WEBCHAT_URL` | Yes | Piko WebChat base URL (e.g. `http://localhost:3000`). |

## Run

```bash
cd adapters/whatsapp
npm install
PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js
```

Same brain as WebChat, Telegram, Discord, Slack: one Piko, multiple channels.

**Note:** Baileys is unofficial and may break if WhatsApp changes. Do not use for spam.
