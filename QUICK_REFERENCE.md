# OpenClaw Quick Reference

## Server Access
```bash
# Local network
ssh -i ~/.ssh/id_optimus root@192.168.0.121

# External
ssh -i ~/.ssh/id_optimus -p 2222 root@114.73.209.140
```

## OpenClaw Status
```bash
# Check if running
systemctl status openclaw

# View logs
journalctl -u openclaw -f

# Restart
systemctl restart openclaw
```

## Channel Setup
```bash
# WhatsApp
openclaw channels login --channel whatsapp

# Telegram
openclaw channels login --channel telegram
```

## Common Commands (via WhatsApp/Telegram)

### Project Management
- `"List projects in /opt/legion"`
- `"Check status of Legion project"`
- `"Show me recent changes in Legion"`

### Cursor Integration
- `"Use Cursor to review the Legion codebase"`
- `"Fix bugs in Legion using Cursor agent"`
- `"Implement feature X in Legion with Cursor"`

### Autonomous Tasks
- `"Monitor Legion for issues and auto-fix with Cursor"`
- `"Run tests in Legion and report results"`
- `"Continue working on the auth refactor we discussed"`

## Configuration Files
- Config: `~/.openclaw/config.yaml`
- Workspace: `~/.openclaw/workspace`
- Logs: `~/.openclaw/logs/`

## Gateway Access
- URL: `http://192.168.0.121:8080`
- Auth: Token (save from onboarding)

## Projects on Optimus
- **Legion**: `/opt/legion` - Agent farm web service
- **Halo**: `/opt/halo`
- **S9Crawler**: `/opt/s9crawler` (running via PM2)
