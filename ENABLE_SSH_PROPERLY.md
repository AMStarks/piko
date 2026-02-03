# Enable SSH/Remote Login Properly

**Issue:** SSH connection refused - Remote Login may not be fully enabled

---

## Check Current Status

**Check if Remote Login is enabled:**
```bash
sudo systemsetup -getremotelogin
```

**Check if SSH service is running:**
```bash
ps aux | grep sshd | grep -v grep
```

---

## Enable Remote Login (GUI Method - Recommended)

Since the command requires Full Disk Access, use System Settings:

1. **System Settings** → **General** → **Sharing**
2. **Toggle ON:** Remote Login
3. **Click OK** on the hostname dialog
4. **Wait 10-15 seconds** for SSH service to start

---

## Enable Remote Login (Terminal Method)

**If you have Full Disk Access enabled:**

```bash
sudo systemsetup -setremotelogin on
```

**Or enable SSH service directly:**

```bash
sudo launchctl load -w /System/Library/LaunchDaemons/ssh.plist
```

---

## Verify SSH is Running

**Check SSH process:**
```bash
ps aux | grep sshd | grep -v grep
```

**Should show:** `/usr/sbin/sshd` process

**Check SSH is listening:**
```bash
sudo lsof -i :22
```

**Should show:** `sshd` listening on port 22

---

## Test Connection

**After enabling, test locally:**
```bash
ssh starkers@localhost "echo 'SSH works!'"
```

**Or test with IP:**
```bash
ssh starkers@192.168.0.245 "echo 'SSH works!'"
```

---

## If Still Not Working

1. **Check firewall:**
   - System Settings → Network → Firewall
   - Ensure SSH (port 22) is allowed

2. **Restart SSH service:**
   ```bash
   sudo launchctl unload /System/Library/LaunchDaemons/ssh.plist
   sudo launchctl load -w /System/Library/LaunchDaemons/ssh.plist
   ```

3. **Check system logs:**
   ```bash
   log show --predicate 'process == "sshd"' --last 5m
   ```

---

**Status:** Enable Remote Login in System Settings, then verify SSH is running
