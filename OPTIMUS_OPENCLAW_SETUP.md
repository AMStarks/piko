# OpenClaw Setup Guide for Optimus Server

This guide walks you through setting up OpenClaw on your Optimus server to control Cursor projects remotely from your iPhone.

## Server Information

- **Hostname**: Optimus
- **Local IP**: 192.168.0.121
- **External IP**: 114.73.209.140 (port 2222)
- **OS**: Ubuntu 24.04
- **SSH Key**: `~/.ssh/id_optimus`

## Prerequisites

✅ OpenClaw is already installed (v2026.1.30)
✅ Node.js v22.22.0 is installed
✅ Server is accessible via SSH

## Step 1: Initial Configuration

### 🆓 FREE Option: Use Ollama (Recommended!)

**You already have Ollama running on Optimus!** This means you can use OpenClaw **completely free** without paying for APIs.

See `OLLAMA_SETUP.md` for detailed instructions. Quick version:
1. Run onboarding with `--auth-choice skip`
2. Configure OpenClaw to use `http://localhost:11434/v1` (Ollama's OpenAI-compatible API)
3. Use model `llama3.1:latest` (already installed)

**Cost: $0/month** ✅

### Option A: Automated Setup (Paid APIs)

1. **Set your API key** (choose one):
   ```bash
   # For Anthropic Claude
   export ANTHROPIC_API_KEY='your-anthropic-key-here'
   
   # OR for OpenAI
   export OPENAI_API_KEY='your-openai-key-here'
   
   # OR use FREE Ollama (recommended!)
   export USE_OLLAMA=true
   ```

2. **Run the setup script**:
   ```bash
   # Copy script to server
   scp -i ~/.ssh/id_optimus openclaw-setup.sh root@192.168.0.121:/root/
   
   # SSH into server
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   
   # Make executable and run
   chmod +x openclaw-setup.sh
   ./openclaw-setup.sh
   ```

### Option B: Manual Setup

**For FREE Ollama setup:**
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121

# Run onboarding (skip API key, we'll configure Ollama after)
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --flow quickstart \
  --mode local \
  --auth-choice skip \
  --gateway-port 8080 \
  --gateway-bind lan \
  --gateway-auth token \
  --gateway-token $(openssl rand -hex 32) \
  --install-daemon

# Then configure Ollama (see OLLAMA_SETUP.md)
```

**For paid APIs:**
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121

# Run onboarding (replace YOUR_API_KEY with your actual key)
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --flow quickstart \
  --mode local \
  --auth-choice anthropic-api-key \
  --anthropic-api-key YOUR_API_KEY \
  --gateway-port 8080 \
  --gateway-bind lan \
  --gateway-auth token \
  --gateway-token $(openssl rand -hex 32) \
  --install-daemon
```

**Save the gateway token** - you'll need it for dashboard access.

## Step 2: Set Up WhatsApp Channel

This allows you to message OpenClaw from your iPhone via WhatsApp.

```bash
# On the Optimus server
openclaw channels login --channel whatsapp
```

This will display a QR code. On your iPhone:

1. Open WhatsApp → Settings → Linked Devices
2. Tap "Link a Device"
3. Scan the QR code displayed in the terminal
4. Wait for "Connected" confirmation

You can now message your OpenClaw agent via WhatsApp!

## Step 3: Set Up Telegram Channel (Alternative)

If you prefer Telegram:

```bash
# On the Optimus server
openclaw channels login --channel telegram
```

Follow the prompts to:
1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Get your bot token
3. Enter it when prompted

## Step 4: Install Cursor Integration

### Install cursor-agent Skill

The cursor-agent skill allows OpenClaw to interact with Cursor on your MacBook.

```bash
# On the Optimus server
# Option 1: Ask OpenClaw to install it (once WhatsApp/Telegram is connected)
# Message your agent: "Install cursor-agent skill from awesome-openclaw-skills GitHub"

# Option 2: Manual installation
cd ~/.openclaw/skills
git clone https://github.com/VoltAgent/awesome-openclaw-skills.git
# Or find the cursor-agent skill in the community repo
```

### Set Up SSH Access to MacBook

OpenClaw needs to SSH into your MacBook to run Cursor CLI commands.

1. **Generate SSH key on Optimus** (if not exists):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_macbook -N ""
   cat ~/.ssh/id_macbook.pub
   ```

2. **Add public key to MacBook**:
   ```bash
   # On your MacBook
   cat ~/.ssh/id_macbook.pub >> ~/.ssh/authorized_keys
   ```

3. **Test SSH connection**:
   ```bash
   # On Optimus server
   ssh -i ~/.ssh/id_macbook your-macbook-username@your-macbook-ip
   ```

4. **Configure OpenClaw to use this SSH key**:
   - Add SSH config or environment variable pointing to the key
   - Update cursor-agent skill config with MacBook connection details

## Step 5: Install Cursor on Optimus (Optional)

If you want Cursor to run directly on the server (where your projects are):

```bash
# Download Cursor for Linux
wget https://cursor.com/download/linux -O cursor.deb
sudo dpkg -i cursor.deb

# Or use the AppImage version
wget https://cursor.com/download/linux -O cursor.AppImage
chmod +x cursor.AppImage
```

**Note**: Cursor on Linux may have limited features compared to macOS. The SSH bridge to MacBook is often preferred.

## Step 6: Configure Project Access

Tell OpenClaw about your projects:

```bash
# Message your agent via WhatsApp/Telegram:
# "My projects are in /opt/legion on this server. 
#  I also have a MacBook at [IP] with Cursor installed. 
#  Set up access to both."
```

Or configure manually in OpenClaw's workspace settings.

## Step 7: Test the Workflow

1. **From your iPhone**, message your OpenClaw agent:
   ```
   "List my projects in /opt/legion"
   ```

2. **Test Cursor integration**:
   ```
   "Use Cursor to check the status of the Legion project"
   ```

3. **Test autonomous task**:
   ```
   "Monitor the Legion project for any issues and fix them using Cursor"
   ```

## Useful Commands

### Check OpenClaw Status
```bash
systemctl status openclaw
# or
pm2 status  # if using PM2
```

### View Logs
```bash
journalctl -u openclaw -f
# or
tail -f ~/.openclaw/logs/*.log
```

### Restart OpenClaw
```bash
systemctl restart openclaw
```

### Access Dashboard
```bash
# On your MacBook or any machine on the network
open http://192.168.0.121:8080
# Use the gateway token you saved earlier
```

## Troubleshooting

### OpenClaw not responding
- Check if service is running: `systemctl status openclaw`
- Check logs: `journalctl -u openclaw -n 100`
- Restart: `systemctl restart openclaw`

### WhatsApp/Telegram not connecting
- Ensure the channel is enabled in config
- Check network connectivity
- Re-run `openclaw channels login --channel whatsapp`

### Cursor commands failing
- Verify SSH access to MacBook works manually
- Check cursor-agent skill is installed and enabled
- Ensure Cursor CLI is available on MacBook

### Gateway not accessible
- Check firewall: `ufw status`
- Verify gateway is bound to LAN: check config at `~/.openclaw/config.yaml`
- Test local access first: `curl http://localhost:8080`

## Next Steps

1. ✅ Complete onboarding with API key
2. ✅ Set up WhatsApp/Telegram channel
3. ✅ Install cursor-agent skill
4. ✅ Configure SSH to MacBook
5. ✅ Test basic commands
6. ✅ Set up autonomous monitoring for Legion project
7. ✅ Explore Zeroa integration (if desired)

## Resources

- [OpenClaw Docs](https://docs.openclaw.ai/)
- [OpenClaw GitHub](https://github.com/clawdbot/clawdbot)
- [Community Skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [OpenClaw Discord](https://discord.gg/openclaw)

---

**Questions?** Check the OpenClaw community on Discord or X (@openclaw) 🦞
