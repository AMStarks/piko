# OpenClaw and Piko Share the Same Telegram Token

**Issue:** Only one process can call Telegram `getUpdates` per bot token. OpenClaw gateway was using the same token as Piko (ClawFriend), causing `Conflict: terminated by other getUpdates request`.

**Done on Optimus (Feb 2026):**
1. **Telegram disabled in OpenClaw:** `/root/.openclaw/openclaw.json` → `channels.telegram.enabled` set to `false` (via jq).
2. **OpenClaw user service stopped, disabled, and masked** so it doesn’t respawn and compete for the token:
   - `XDG_RUNTIME_DIR=/run/user/0 systemctl --user stop openclaw-gateway.service`
   - `systemctl --user disable openclaw-gateway.service`
   - `systemctl --user mask openclaw-gateway.service` (prevents accidental start)
   - Unit file: `/root/.config/systemd/user/openclaw-gateway.service`
   - To undo mask later: `systemctl --user unmask openclaw-gateway.service`

**If you want OpenClaw again (without Telegram):** Start it manually or re-enable the user service. Telegram will stay disabled in config, so no conflict with Piko.

**If you want OpenClaw to use Telegram again:** You must choose: either Piko **or** OpenClaw uses the token, not both. Set `channels.telegram.enabled` back to `true` in OpenClaw and stop `clawfriend-bot.service` on Optimus (or use a different bot token for one of them).
