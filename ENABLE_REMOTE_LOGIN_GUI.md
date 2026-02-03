# Enable Remote Login via System Settings

**Issue:** Command requires Full Disk Access - use GUI instead

---

## Step-by-Step (System Settings)

### Method 1: System Settings (Recommended)

1. **Open System Settings** (or System Preferences on older macOS)
2. **Click:** General (in sidebar)
3. **Click:** Sharing
4. **Toggle ON:** Remote Login
5. **Allow access for:** Your user (`starkers`)

**That's it!** Remote Login is now enabled.

---

### Method 2: Check Current Status

**To verify Remote Login is enabled:**

```bash
systemsetup -getremotelogin
```

Should return: `Remote Login: On`

---

## Alternative: Enable via GUI Only

If you prefer not to use Terminal:

1. **System Settings** → **General** → **Sharing**
2. **Find:** Remote Login
3. **Toggle it ON**
4. **Select:** Allow access for "starkers"

---

## Verify SSH is Working

**Once enabled, test from Optimus:**

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121 "ssh -i ~/.ssh/id_optimus_to_macbook starkers@192.168.0.245 'echo SSH works!'"
```

**Or test locally first:**

```bash
ssh starkers@localhost "echo SSH works!"
```

---

## After Enabling

Once Remote Login is enabled:

1. ✅ SSH will work from Optimus
2. ✅ Bot can execute Cursor commands
3. ✅ Test with: `/cursor --version` in Telegram

---

**Status:** Enable Remote Login in System Settings → General → Sharing
