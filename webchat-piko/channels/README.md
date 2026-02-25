# Piko channels

Extra surfaces (WhatsApp, Signal, Discord, etc.) that forward messages to Piko WebChat `POST /api/chat`. Same Wisdom Core, same brain — **channel parity**.

- **No marketplace.** Adapters run locally; you control pairing and allowlist.
- **Allowlist:** Add your ID per channel (e.g. `/allow whatsapp 1234567890@s.whatsapp.net`) from WebChat so Piko accepts messages from that channel.

## WhatsApp (Baileys)

1. `cd channels/whatsapp && npm install`
2. `PIKO_WEBCHAT_URL=http://localhost:3000 node bot.js`
3. Scan the **QR code** in the terminal (WhatsApp → Linked devices → Link a device).
4. Auth is stored in `channels/whatsapp/auth/` (do not commit). Next runs reuse it.

**Env:** `PIKO_WEBCHAT_URL` — Piko server base URL.

## Discord / Slack / Blue Bubbles

Adapters live in the repo root `adapters/` (discord, slack, bluebubbles). Use the same pattern:

- Set `PIKO_WEBCHAT_URL` to your Piko server.
- Set channel-specific tokens (e.g. `DISCORD_TOKEN`).
- Run the adapter process. Allowlist the channel/source from WebChat if required.

## Security

- **Local only.** No ClawHub-style marketplace; no remote skill install.
- **You approve** who can talk to Piko per channel via allowlist.
- Same corpus, truth engine, and wisdom on every channel.
