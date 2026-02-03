# WhatsApp Channel Setup Instructions

## ✅ What's Ready

- ✅ WhatsApp plugin enabled
- ✅ WhatsApp channel added to OpenClaw
- ✅ Gateway running and ready

## 📱 Setup Steps

The WhatsApp channel requires an **interactive session** to display and maintain the QR code connection. Here's how to complete the setup:

### Option 1: Run Directly on Server (Recommended)

1. **SSH into Optimus**:
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   ```

2. **Start WhatsApp login**:
   ```bash
   openclaw channels login --channel whatsapp
   ```

3. **QR Code will appear** - Keep the terminal open!

4. **On your iPhone**:
   - Open WhatsApp
   - Go to Settings → Linked Devices
   - Tap "Link a Device"
   - Scan the QR code displayed in the terminal

5. **Wait for confirmation** - You should see "Connected" or similar message

### Option 2: Use the Setup Script

Run the provided script (it will SSH in for you):

```bash
./setup-whatsapp.sh
```

**Note**: The script will still require you to scan the QR code, but it handles the SSH connection.

## 🔍 Verify Connection

After scanning the QR code, verify the channel is connected:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels list
```

You should see WhatsApp listed as connected.

## 🧪 Test the Connection

Once connected, send a test message from your iPhone to the OpenClaw WhatsApp number:

```
"Hello! Can you help me with coding tasks?"
```

Your OpenClaw agent (using Mistral Large) should respond!

## ⚠️ Troubleshooting

### QR Code Times Out
- Make sure you run the command in an **interactive terminal** (not via script)
- Keep the terminal session open while scanning
- Try running the command again if it times out

### Can't Scan QR Code
- Make sure your iPhone and server are on the same network (or server is accessible)
- Check that WhatsApp is updated on your iPhone
- Try closing and reopening WhatsApp

### Channel Not Appearing
```bash
# Check if plugin is enabled
openclaw plugins list | grep whatsapp

# Re-enable if needed
openclaw plugins enable whatsapp
systemctl --user restart openclaw-gateway
```

## 📝 Next Steps After WhatsApp Setup

1. ✅ Test messaging from iPhone
2. ⏳ Install cursor-agent skill for Cursor integration
3. ⏳ Configure SSH to MacBook for Cursor CLI access
4. ⏳ Test end-to-end workflow

---

**Ready to pair?** Run `openclaw channels login --channel whatsapp` on the server in an interactive session!
