# Telegram Pairing - Next Steps

**Status:** Channel configured ✅  
**Account Name:** Piko  
**DM Policy:** Pairing (recommended)

---

## Step 1: Send Message to Bot

1. **Open Telegram** on your iPhone
2. **Find your bot** (the one with token `8129322096:...`)
3. **Send a message** like "Hello" or "Hey"

---

## Step 2: Get Pairing Code

OpenClaw will respond with something like:

```
OpenClaw: access not configured. Your Telegram user id: 5772950940
Pairing code: ABC12345
Ask the bot owner to approve with: openclaw pairing approve telegram <code>
```

**Copy the pairing code** (e.g., `ABC12345`)

---

## Step 3: Approve Pairing

**On Optimus:**
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw pairing approve telegram <PAIRING_CODE>
```

Replace `<PAIRING_CODE>` with the actual code from Step 2.

---

## Step 4: Test!

Send "Hey mate" to your bot. You should get a **natural, conversational response** (not meta-analysis).

---

## Troubleshooting

**Bot not responding:**
- Check gateway is running: `systemctl --user status openclaw-gateway.service`
- Check logs: `journalctl --user -u openclaw-gateway.service -f`

**No pairing code:**
- Make sure you sent a message to the bot first
- Wait a few seconds for OpenClaw to process

**Pairing fails:**
- Make sure you're using the exact code (case-sensitive)
- Check the code hasn't expired (try sending another message)

---

**Ready!** Send a message to your bot now.
