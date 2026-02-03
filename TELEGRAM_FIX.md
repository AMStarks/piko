# Telegram Setup Fix

**Issue:** Config error and command syntax

---

## Fixed Issues

1. ✅ **Config error fixed:** Changed `skills` from array to object
2. ✅ **Telegram plugin:** Needs to be enabled first

---

## Correct Steps

### Step 1: Enable Telegram Plugin

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
openclaw plugins enable telegram
systemctl --user restart openclaw-gateway.service
```

### Step 2: Add Telegram Channel

**Option A: Interactive (Recommended)**
```bash
openclaw channels add
# Follow prompts, select Telegram, paste token
```

**Option B: Direct with token**
```bash
openclaw channels add telegram --token 8129322096:AAGsSGIN5zlKE16tpOKPZ82LXzJVpKNpM8g
```

**Option C: Login method**
```bash
openclaw channels login --channel telegram
# Then paste token when prompted
```

### Step 3: Approve Pairing

1. Send a message to your bot on Telegram
2. OpenClaw will respond with a pairing code
3. Approve:
```bash
openclaw pairing approve telegram <PAIRING_CODE>
```

---

## Current Status

- ✅ Config fixed (skills is now object)
- ⏳ Telegram plugin needs enabling
- ⏳ Channel needs adding

---

**Try:** `openclaw channels add` (interactive) after enabling the plugin.
