# Telegram Setup - Step by Step

**Status:** Plugin enabled, ready to configure

---

## Quick Setup

Run this on Optimus:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels add
```

**Then:**
1. Select **"Yes"** when asked "Configure chat channels now?"
2. Select **"Telegram"** from the list
3. When prompted for token, paste:
   ```
   8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g
   ```
4. Press Enter

---

## After Adding Channel

1. **Send a message to your bot on Telegram** (e.g., "Hello")
2. **OpenClaw will respond with a pairing code** like:
   ```
   OpenClaw: access not configured. Your Telegram user id: 5772950940
   Pairing code: ABC12345
   ```
3. **Approve the pairing:**
   ```bash
   openclaw pairing approve telegram ABC12345
   ```
   (Replace `ABC12345` with the actual code)

---

## Test

Send "Hey mate" to your bot. Should get a natural, conversational response!

---

## Troubleshooting

**If "openclaw channels add" doesn't work:**
- Make sure gateway is running: `systemctl --user status openclaw-gateway.service`
- Check plugin is enabled: `openclaw plugins list | grep telegram`

**If pairing fails:**
- Make sure you sent a message to the bot first
- Check gateway logs: `journalctl --user -u openclaw-gateway.service -f`

---

**Ready to go!** Just run `openclaw channels add` and follow the prompts.
