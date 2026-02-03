# Enable SSH on MacBook — Do This Now

**Your screenshot was System Settings → Network** (Wi‑Fi, Firewall). Remote Login is **not** there. It’s under **General → Sharing**.

---

## Option A: System Settings (correct place)

1. Open **System Settings**.
2. In the **left sidebar**, click **General**.
3. Click **Sharing** (in the right-hand list under General).
4. Find **Remote Login** and turn the toggle **ON**.
5. Wait 10–15 seconds, then test (see “Verify” below).

---

## Option B: Terminal (no Full Disk Access needed)

If the GUI doesn’t stick or you prefer the command line, load the SSH daemon directly:

```bash
sudo launchctl load -w /System/Library/LaunchDaemons/ssh.plist
```

Enter your Mac password when prompted. Then verify (see below).

---

## Verify SSH is running

Run these **on your MacBook** in Terminal:

**1. Is anything listening on port 22?**
```bash
sudo lsof -i :22
```
You should see a line with `sshd` and `*:22` or `localhost:22`. If you see nothing, SSH is still off.

**2. Is sshd running?**
```bash
ps aux | grep sshd | grep -v grep
```
You should see `/usr/sbin/sshd`. If not, try Option B again or Option A.

**3. Test local SSH**
```bash
ssh starkers@localhost "echo 'SSH works!'"
```
You should get `SSH works!` and no “Connection refused”.

---

## If it still says “Connection refused”

- After Option A: wait 15 seconds and run the verify steps again.
- After Option B: if `launchctl load` gives an error, paste it and we can fix it.
- Check: **System Settings → General → Sharing** — is **Remote Login** actually ON (green)? If it’s grey or off, turn it ON there; that’s the source of truth.

---

**Summary:** Remote Login = **General → Sharing**, not Network. Use Option A or B, then verify with `sudo lsof -i :22` and `ssh starkers@localhost "echo 'SSH works!'"`.
