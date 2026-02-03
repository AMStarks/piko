# Enable Remote Login on MacBook

**Issue:** SSH connection refused - Remote Login needs to be enabled

---

## Step 1: Enable Remote Login

1. **Open System Settings** (or System Preferences on older macOS)
2. **Go to:** General → Sharing
3. **Enable:** Remote Login
4. **Allow access for:** Your user (`starkers`)

**Or via Terminal:**
```bash
sudo systemsetup -setremotelogin on
```

---

## Step 2: Verify SSH is Running

**Check if SSH is running:**
```bash
sudo launchctl list | grep ssh
```

**If not running, start it:**
```bash
sudo launchctl load -w /System/Library/LaunchDaemons/ssh.plist
```

---

## Step 3: Check Firewall

**If firewall is enabled**, allow SSH:

1. **System Settings** → **Network** → **Firewall**
2. **Options** → **Allow incoming connections** for SSH
3. Or add SSH (port 22) to allowed services

---

## Step 4: Test Connection

**From Optimus server**, test:

```bash
ssh -i ~/.ssh/id_optimus_to_macbook starkers@192.168.0.245 "echo 'SSH works!'"
```

**If it works**, the bot will work too!

---

## Step 5: Verify SSH Key is Added

**On MacBook**, check:

```bash
cat ~/.ssh/authorized_keys | grep optimus-to-macbook
```

Should show:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJpTaYuOrgZO8/F4Qnd4PQMqVCS7iAQ9yBbfHwYZG2SJ optimus-to-macbook
```

---

## Troubleshooting

**Connection refused:**
- ✅ Enable Remote Login (System Settings → Sharing)
- ✅ Check firewall allows SSH
- ✅ Verify SSH service is running

**Permission denied:**
- ✅ Check SSH key is in `~/.ssh/authorized_keys`
- ✅ Check permissions: `chmod 600 ~/.ssh/authorized_keys`

**Host key verification failed:**
- ✅ Bot code uses `-o StrictHostKeyChecking=no` (should be fine)

---

**Once Remote Login is enabled, test with:**
```
/cursor --version
```
