# OpenClaw Fresh Setup - Complete Status

**Date:** February 2, 2026, 01:23 AEDT  
**Status:** Core setup complete, manual steps remaining

---

## ✅ Completed Steps

### 1. Clean Installation
- ✅ Removed old OpenClaw installation (v2026.1.30 from npm)
- ✅ Cleaned up config files and systemd services
- ✅ Removed workspace files that caused meta-analysis bug

### 2. Build from Source
- ✅ Installed pnpm (v10.28.2)
- ✅ Cloned OpenClaw from GitHub (latest main branch)
- ✅ Built from source successfully
- ✅ Installed globally via `npm link`
- ✅ Version: 2026.1.30 (from source)

### 3. Ollama Integration
- ✅ Verified Ollama running (Docker container: `legion-ollama`)
- ✅ Models available: `mistral:latest`, `llama3.1:latest`, `llama3.2:latest`
- ✅ Configured OpenClaw to use Ollama at `http://localhost:11434/v1`
- ✅ Model set: `openai/llama3.1:latest`
- ✅ Context window: 16384, Max tokens: 512
- ✅ Auth profile configured

### 4. Workspace Configuration
- ✅ Created minimal workspace files:
  - `SOUL.md`: Aggressive conversational instructions (no meta-analysis)
  - `IDENTITY.md`: ClawFriend personality
  - `USER.md`: User context (Telestai/Stan, Sydney, AEDT)
- ✅ Removed problematic files: `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`
- ✅ Bootstrap max chars: 8000

### 5. Cursor Integration
- ✅ Created Cursor skill at `~/.openclaw/skills/cursor-skill.js`
- ✅ Registered skill in `openclaw.json`
- ✅ Generated SSH key for MacBook access: `~/.ssh/id_optimus_to_macbook`

### 6. Gateway Service
- ✅ Systemd service installed and running
- ✅ Gateway active on port 8081
- ✅ Config validated and fixed

---

## ⏳ Manual Steps Required

### Step 1: Set Up Telegram Channel

**Run on Optimus:**
```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw channels add telegram
```

**When prompted, paste your bot token:**
```
8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g
```

**After adding, send a message to your bot on Telegram. Then approve pairing:**
```bash
openclaw pairing approve telegram <PAIRING_CODE>
```

**Test:** Send "Hey mate" to your bot. Should get natural response (not meta-analysis).

---

### Step 2: Add SSH Key to MacBook

**On MacBook:**

1. **Get the public key:**
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121 "cat ~/.ssh/id_optimus_to_macbook.pub"
   ```
   
   **Public key:**
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJpTaYuOrgZO8/F4Qnd4PQMqVCS7iAQ9yBbfHwYZG2SJ optimus-to-macbook
   ```

2. **Add to authorized_keys:**
   ```bash
   mkdir -p ~/.ssh
   echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJpTaYuOrgZO8/F4Qnd4PQMqVCS7iAQ9yBbfHwYZG2SJ optimus-to-macbook" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

3. **Enable Remote Login:**
   - System Settings → General → Sharing → Remote Login
   - Enable for your user

4. **Test connection from Optimus:**
   ```bash
   ssh -i ~/.ssh/id_optimus root@192.168.0.121
   ssh -i ~/.ssh/id_optimus_to_macbook starkers@<MACBOOK_IP> "cursor --version"
   ```

5. **Update Cursor skill with MacBook IP:**
   ```bash
   # On Optimus
   nano ~/.openclaw/skills/cursor-skill.js
   # Update: macbookHost = '192.168.0.XXX' (replace XXX with actual IP)
   ```

---

### Step 3: Install Cursor CLI on MacBook (if needed)

```bash
curl -fsSL https://cursor.sh/install.sh | sh
cursor --version
```

---

## 🧪 Testing

### Test 1: Telegram Conversation
1. Send `/new` to bot (fresh session)
2. Send `Hey mate`
3. **Expected:** Natural response like "Hey! How can I help you?"
4. **Not expected:** Meta-analysis, JSON, code snippets

### Test 2: Cursor Integration
1. Send to bot: "Run cursor --help on my MacBook"
2. **Expected:** Cursor CLI help output
3. **If fails:** Check SSH connection, Cursor CLI installed, MacBook IP correct

---

## 📊 Current Configuration

**OpenClaw Config:** `~/.openclaw/openclaw.json`
- Model: `openai/llama3.1:latest`
- Ollama endpoint: `http://localhost:11434/v1`
- Bootstrap max: 8000 chars
- Gateway port: 8081

**Workspace:** `~/.openclaw/workspace/`
- `SOUL.md`: Conversational instructions
- `IDENTITY.md`: ClawFriend personality
- `USER.md`: User context

**Skills:** `~/.openclaw/skills/`
- `cursor-skill.js`: Cursor CLI integration

**SSH Key:** `~/.ssh/id_optimus_to_macbook`
- Public key ready to add to MacBook

---

## 🔧 Troubleshooting

### Gateway not starting:
```bash
journalctl --user -u openclaw-gateway.service -f
openclaw doctor --fix
```

### Config errors:
```bash
openclaw doctor --fix
cat ~/.openclaw/openclaw.json | jq '.'
```

### Ollama not responding:
```bash
docker ps | grep ollama
curl http://localhost:11434/api/tags
```

### Telegram not working:
```bash
openclaw plugins list
openclaw plugins enable telegram
systemctl --user restart openclaw-gateway.service
```

---

## 📝 Next Steps After Manual Setup

1. ✅ Test Telegram conversation (should be natural, not meta-analysis)
2. ✅ Test Cursor CLI execution via Telegram
3. ✅ Monitor performance (response times, GPU usage)
4. ✅ Fine-tune model if needed (try `llama3.2:latest` for speed, `mistral:latest` for nuance)

---

## 🎯 Success Criteria

- [ ] Telegram bot responds conversationally (no meta-analysis)
- [ ] Cursor CLI commands execute via Telegram
- [ ] Response times < 10 seconds for simple queries
- [ ] GPU acceleration working (check `nvidia-smi` during inference)

---

**Setup Time:** ~30 minutes  
**Remaining Manual Steps:** 2 (Telegram pairing, SSH key on MacBook)  
**Estimated Time to Complete:** 10 minutes

---

**Last Updated:** February 2, 2026, 01:23 AEDT
