# Gmail OAuth – Do this now

A Cloudflare tunnel is running and `.env` is configured.

## 1. Restart the Piko server

So it picks up `PIKO_BASE_URL`:

```bash
# If using node directly:
cd webchat-piko && node server.js

# If using systemd on Optimus:
ssh root@192.168.0.121 'systemctl restart piko-webchat'
```

## 2. Add redirect URI in Google Cloud Console

The credentials page should be open in your browser. If not: https://console.cloud.google.com/apis/credentials

1. Click your **OAuth 2.0 Client ID** (Web application)
2. Under **Authorized redirect URIs**, click **Add URI**
3. Add exactly:
   ```
   https://constraints-conflicts-linda-track.trycloudflare.com/api/oauth/gmail/callback
   ```
4. Click **Save**

## 3. Set Base URL in the Piko app

1. Open the Piko app on your phone
2. Go to **Settings** (gear icon)
3. Set **Base URL** to:
   ```
   https://constraints-conflicts-linda-track.trycloudflare.com
   ```
4. Save / dismiss

## 4. Try Add account (Gmail)

Go to **Settings → Integrated apps → Google Workspace → Add account**. The OAuth popup should complete without the private-IP error.

---

**Note:** The tunnel URL changes each time you restart Cloudflare Tunnel. When it does, run `./scripts/set-tunnel-url.sh` again, update the redirect URI in Google Console, and update Base URL in the app.
