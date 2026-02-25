# Gmail OAuth: Fix “Access blocked” when using a private IP

If you see **“Access blocked: Authorization Error”** with a message like:

> device_id and device_name are required for private IP: `http://192.168.0.121:3000/api/oauth/gmail/callback`

Google is blocking the flow because the **redirect URI** uses a **private IP** over HTTP. Google only allows:

- **localhost** (for development on the same machine), or  
- A **public HTTPS** URL (production or tunnel).

So when the Piko server runs on a LAN IP (e.g. `192.168.0.121`) and you open “Add account” from the **iOS app** (or another device), the redirect URI is that private URL and Google rejects it.

## Fix: Use an HTTPS tunnel (recommended for phone/device testing)

Use a tunnel so the server is reachable at a public **https** URL, then point both the server and the app at that URL.

### 1. Start a tunnel to your Piko server

**Option A: Use the setup script (updates .env automatically)**

From `webchat-piko`:

```bash
./scripts/set-tunnel-url.sh
```

Or if your server is on another host (e.g. Optimus):

```bash
./scripts/set-tunnel-url.sh http://192.168.0.121:3000
```

The script starts the tunnel, updates `PIKO_BASE_URL` in `.env`, and prints the next steps. Keep the script running (tunnel stays up) or run `cloudflared tunnel --url http://localhost:3000` in a separate terminal.

**Option B: Run manually**

```bash
cloudflared tunnel --url http://localhost:3000
```

Use the `https://` URL it gives you.

### 2. Set the base URL on the server

In `webchat-piko/.env`:

```env
PIKO_BASE_URL=https://your-tunnel-url.ngrok-free.app
```

(No trailing slash. Replace with your actual tunnel URL.)

Restart the Piko server so it uses this for OAuth redirects.

### 3. Add the redirect URI in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Open your **OAuth 2.0 Client ID** (Web application).
3. Under **Authorized redirect URIs**, add:
   ```text
   https://your-tunnel-url.ngrok-free.app/api/oauth/gmail/callback
   ```
4. Save.

### 4. Point the iOS app at the tunnel

In the Piko app: **Settings** → **Base URL** → set to your tunnel URL, e.g.:

```text
https://your-tunnel-url.ngrok-free.app
```

Then try **Add account** again for Gmail. The OAuth flow will use the HTTPS redirect URI and the “private IP” error should go away.

## Summary

| Step | What to do |
|------|------------|
| 1 | Run ngrok or Cloudflare Tunnel to port 3000; note the **https** URL. |
| 2 | Set `PIKO_BASE_URL=https://...` in `webchat-piko/.env` and restart the server. |
| 3 | In Google Cloud Console, add `https://.../api/oauth/gmail/callback` to Authorized redirect URIs. |
| 4 | In the app, set Base URL to the same `https://...` tunnel URL. |

For production, use a real domain and HTTPS instead of a tunnel; the same `PIKO_BASE_URL` and redirect URI pattern apply.
