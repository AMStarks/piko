# Telegram Setup for OpenClaw

Telegram creates a **bot contact** that you can message directly - much better than WhatsApp's linked device approach!

## Step 1: Create a Telegram Bot

1. **Open Telegram** on your iPhone
2. **Search for** `@BotFather` (official Telegram bot creator)
3. **Start a chat** with BotFather
4. **Send**: `/newbot`
5. **Follow the prompts**:
   - Choose a name for your bot (e.g., "Optimus AI" or "OpenClaw")
   - Choose a username (must end in `bot`, e.g., `optimus_ai_bot`)
6. **BotFather will give you a token** - it looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
7. **Copy that token** - you'll need it in the next step

## Step 2: Add Telegram Channel to OpenClaw

Once you have the bot token, run this command:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "openclaw channels add --channel telegram --token YOUR_BOT_TOKEN_HERE"
```

Replace `YOUR_BOT_TOKEN_HERE` with the token BotFather gave you.

## Step 3: Find Your Bot in Telegram

1. **Search for your bot** in Telegram using the username you created (e.g., `@optimus_ai_bot`)
2. **Start a chat** with it
3. **Send a message** like "Hello!" 
4. **OpenClaw should respond!**

## Benefits of Telegram

✅ **Appears as a contact** - You can message it directly  
✅ **Works reliably** - No QR code scanning needed  
✅ **Persistent** - Bot stays connected  
✅ **Easy to find** - Search for your bot by username  

## Troubleshooting

If the bot doesn't respond:
- Make sure you restarted the gateway after enabling the plugin
- Check that the token is correct (no extra spaces)
- Verify the gateway is running: `systemctl status openclaw`
