# Cursor CLI Integration Setup

**Date:** February 2, 2026  
**Status:** Skill created, SSH setup needed

---

## Current Status

✅ Cursor skill created at `~/.openclaw/skills/cursor-skill.js`  
✅ Skill registered in `openclaw.json`  
⏳ SSH key generated on Optimus  
⏳ SSH key needs to be added to MacBook  

---

## Step 1: Add SSH Key to MacBook

### On Optimus (already done):
```bash
# SSH key created: ~/.ssh/id_optimus_to_macbook.pub
```

### On MacBook:
1. **Get the public key from Optimus:**
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121 "cat ~/.ssh/id_optimus_to_macbook.pub"
   ```

2. **Add to MacBook's authorized_keys:**
   ```bash
   # On MacBook
   mkdir -p ~/.ssh
   echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

3. **Enable Remote Login (if not already):**
   - System Settings → General → Sharing → Remote Login
   - Enable "Remote Login"
   - Allow access for your user

4. **Test SSH connection from Optimus:**
   ```bash
   # On Optimus
   ssh -i ~/.ssh/id_optimus_to_macbook starkers@<MACBOOK_IP> "cursor --version"
   ```

---

## Step 2: Update Cursor Skill Configuration

Edit `~/.openclaw/skills/cursor-skill.js` on Optimus and update:

```javascript
macbookHost = '192.168.0.XXX' // Replace with actual MacBook IP
```

Or set via environment variable:
```bash
export OPTIMUS_MACBOOK_HOST="192.168.0.XXX"
```

---

## Step 3: Install Cursor CLI on MacBook (if not already)

```bash
# On MacBook
curl -fsSL https://cursor.sh/install.sh | sh
cursor --version
```

---

## Step 4: Test Cursor Integration

### Via Telegram:
1. Send message to OpenClaw bot: "Run cursor --help on my MacBook"
2. OpenClaw should execute: `ssh ... "cd /Users/starkers/Projects && cursor --help"`

### Direct test:
```bash
# On Optimus
ssh -i ~/.ssh/id_optimus_to_macbook starkers@<MACBOOK_IP> "cd /Users/starkers/Projects && cursor --help"
```

---

## Usage Examples

Once set up, you can use OpenClaw via Telegram:

- **"Apply this change to my project: refactor auth module"**
  → Executes: `cursor apply "refactor auth module"`

- **"Chat with Cursor about my codebase"**
  → Executes: `cursor chat "explain this codebase"`

- **"Run cursor --help"**
  → Executes: `cursor --help`

---

## Troubleshooting

- **SSH connection fails:** Check MacBook IP, firewall, Remote Login enabled
- **Cursor not found:** Install Cursor CLI on MacBook
- **Permission denied:** Check SSH key is in `~/.ssh/authorized_keys` on MacBook
- **Timeout:** Increase timeout in skill (currently 5 minutes)

---

**Next:** After SSH is configured, test end-to-end workflow.
