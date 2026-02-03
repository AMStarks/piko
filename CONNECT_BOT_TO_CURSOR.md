# Connect Telegram Bot to Cursor

**Date:** February 2, 2026  
**Goal:** Enable bot to execute Cursor CLI commands on your MacBook

---

## What This Enables

Once connected, you can send commands to your bot like:
- `/cursor --help` - Get Cursor CLI help
- `/cursor chat "explain this codebase"` - Chat with Cursor about your code
- `/cursor apply "refactor auth module"` - Apply changes via Cursor

---

## Step 1: Add SSH Key to MacBook

The bot needs SSH access to your MacBook to run Cursor commands.

### Get the Public Key from Optimus

The SSH key is already generated. Here's the public key:

```bash
# Run this to get the key:
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "cat ~/.ssh/id_optimus_to_macbook.pub"
```

### Add to MacBook's authorized_keys

**On your MacBook**, run:

```bash
# Create .ssh directory if it doesn't exist
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Add the public key (paste the key from above)
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys

# Set correct permissions
chmod 600 ~/.ssh/authorized_keys
```

### Enable Remote Login (if not already)

1. **System Settings** → **General** → **Sharing**
2. Enable **Remote Login**
3. Allow access for your user (`starkers`)

---

## Step 2: Find Your MacBook IP Address

**On your MacBook**, run:

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Look for something like: `192.168.0.XXX`

**Or check System Settings:**
- System Settings → Network → Wi‑Fi/Ethernet → Details → TCP/IP
- Note the IPv4 address

---

## Step 3: Update Bot Code with MacBook IP

Once you have your MacBook IP, I'll update the bot code.

**The bot already has a `/cursor` command**, but it needs:
1. Your MacBook IP address
2. SSH key path (already set: `~/.ssh/id_optimus_to_macbook`)

---

## Step 4: Test SSH Connection

**From Optimus server**, test the connection:

```bash
ssh -i ~/.ssh/id_optimus_to_macbook starkers@<YOUR_MACBOOK_IP> "cursor --version"
```

If this works, the bot will work too!

---

## Step 5: Test via Bot

Once everything is set up:

1. **Send to bot:** `/cursor --help`
2. **Bot should:** SSH to MacBook, run Cursor CLI, return output
3. **Try:** `/cursor chat "Hello"` (if Cursor supports chat mode)

---

## Current Bot Code Status

The bot already has the `/cursor` command implemented:
- ✅ Command handler exists
- ✅ SSH key path configured
- ⏳ Needs MacBook IP address
- ⏳ Needs SSH key in MacBook's authorized_keys

---

## Next Steps

1. **Get your MacBook IP** (run `ifconfig` on MacBook)
2. **Add SSH key** to MacBook's authorized_keys
3. **Tell me your MacBook IP** and I'll update the bot code
4. **Test** with `/cursor --help`

---

**Ready?** Share your MacBook IP address and I'll complete the setup!
