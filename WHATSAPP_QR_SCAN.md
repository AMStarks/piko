# WhatsApp QR Code Scanning Instructions

## ⚠️ Important: Interactive Session Required

The WhatsApp QR code pairing **requires an interactive terminal session** that stays open while you scan. The QR code connection times out if the session closes.

## 🚀 Quick Setup (Recommended)

**Run this script in your terminal** (it will handle everything):

```bash
./complete-whatsapp-setup.sh
```

This script will:
1. SSH into Optimus
2. Start WhatsApp login
3. Display QR code
4. Keep connection alive while you scan

## 📱 Step-by-Step Manual Setup

If you prefer to do it manually:

1. **Open a terminal on your MacBook**

2. **SSH into Optimus**:
   ```bash
   ssh -i ~/.ssh/id_optimus -t root@192.168.0.121
   ```
   (The `-t` flag allocates a pseudo-terminal for interactive use)

3. **Start WhatsApp login**:
   ```bash
   openclaw channels login --channel whatsapp
   ```

4. **QR code will appear** - Keep the terminal open!

5. **On your iPhone**:
   - Open WhatsApp
   - Go to **Settings** → **Linked Devices**
   - Tap **"Link a Device"**
   - **Scan the QR code** from the terminal

6. **Wait for confirmation** - You should see "Connected" or similar

7. **Press Ctrl+C** to exit once connected

## ✅ Verify Connection

After scanning, verify it worked:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels status
```

You should see WhatsApp as "linked" or "connected".

## 🧪 Test It!

Once connected, send a message from your iPhone to the OpenClaw WhatsApp number:

```
"Hello! Can you help me with coding tasks?"
```

Your OpenClaw agent (using Mistral Large) should respond!

## ⚠️ Troubleshooting

### QR Code Times Out
- **Make sure you're using an interactive terminal** (not a script)
- **Keep the terminal session open** while scanning
- The QR code refreshes every few seconds - scan the latest one

### Can't See QR Code Clearly
- Zoom in on your terminal
- Make sure terminal font is readable
- Try a different terminal app if needed

### Connection Fails
- Check your iPhone and server are on the same network (or server is accessible)
- Make sure WhatsApp is updated
- Try closing and reopening WhatsApp
- Run the login command again

### Still Not Connected
```bash
# Check channel status
openclaw channels status

# Try logging in again
openclaw channels login --channel whatsapp

# Check gateway is running
systemctl --user status openclaw-gateway
```

## 📝 What Happens After Connection

Once WhatsApp is linked:
- ✅ You can message OpenClaw from your iPhone
- ✅ OpenClaw will use Mistral Large for responses
- ✅ All conversations are private (running locally)
- ✅ You can ask it to help with coding, projects, etc.

---

**Ready?** Run `./complete-whatsapp-setup.sh` or follow the manual steps above!
