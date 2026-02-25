# Gmail “Connect” UX — same result, one-click flow

**Goal:** Same outcome as today (server has `GMAIL_REFRESH_TOKEN` and can run EA look-in / Gmail API) but the user only does: **Connect Gmail** → pick account (on phone or type email) → done. No Playground, no manual .env editing.

---

## Approach (standard OAuth 2.0 code flow)

This is the same flow used by “Sign in with Google” / “Connect Gmail” in most apps.

1. **User:** Clicks **Connect Gmail** in Control → Integrations (or Dashboard).
2. **App:** Redirects the user to Google’s authorization URL with:
   - `client_id`, `redirect_uri`, `scope` (e.g. `gmail.readonly` + `gmail.modify`),
   - `response_type=code`, `access_type=offline`, `prompt=consent` (so we get a refresh token),
   - `state` (random, for CSRF).
3. **User:** Signs in with Google (on phone or desktop), picks account, grants permissions.
4. **Google:** Redirects back to **our** URL with `?code=...&state=...`.
5. **App:** Callback route exchanges `code` for tokens (POST to `https://oauth2.googleapis.com/token`), gets **refresh_token**, persists it (e.g. to `.env` or a token file), then redirects to a “Gmail connected” page or back to Control.

**End state:** Server has the same `GMAIL_REFRESH_TOKEN` (and existing `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`). EA look-in and `/gmail` behave exactly as they do now. No change to `ea-lookin.js` or existing Gmail usage.

---

## What we’d add

### Server (e.g. in `server.js` or a small oauth helper)

- **`GET /api/oauth/gmail/start`**  
  - Control-protected (or public if you want “connect from anywhere”).  
  - Builds Google auth URL:  
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=...&access_type=offline&prompt=consent&state=...`  
  - `redirect_uri` = our callback (see below).  
  - Redirects the user (302) to that URL.

- **`GET /api/oauth/gmail/callback`**  
  - Receives `?code=...&state=...` (and optionally `error=...`).  
  - Validates `state` (match what we stored or pass in).  
  - POST to `https://oauth2.googleapis.com/token` with `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`.  
  - Response contains `refresh_token`.  
  - Persist it: e.g. append or update `GMAIL_REFRESH_TOKEN=...` in `/root/webchat-piko/.env` (or write to `data/gmail-refresh-token.txt` and have the server read it at runtime so no restart needed).  
  - Redirect to `/control-integrations?gmail=connected` (or a small “Gmail connected” page that links back to Control).

**Requirements:**  
- `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` must already be set (one-time setup: Google Cloud Web application client).  
- Redirect URI in Google Cloud must **exactly** match the callback URL (scheme, host, path, no trailing slash unless we use it).

### Control UI

- **Integrations page:** When Gmail is **not** configured, show a button/link: **Connect Gmail** → points to `/api/oauth/gmail/start`.  
- When Gmail **is** configured, keep showing “Configured (alert if unread ≥ 1)” and optionally “Reconnect” if you want to allow re-auth.

### Redirect URI constraint (important for “standard” self-hosted)

- Google allows `http://localhost` (and common variants) for redirect_uri without HTTPS.  
- For any **non-localhost** URL (e.g. `http://192.168.0.121:3000`), Google **requires HTTPS** for the redirect_uri. So a plain LAN URL won’t work for the callback unless you use a tunnel or a real domain.

**Options for self-hosted “standard” users:**

1. **Domain + HTTPS:** If Piko is at `https://piko.yourdomain.com`, use `https://piko.yourdomain.com/api/oauth/gmail/callback` as the authorized redirect URI in Google Cloud. User opens Control on phone or desktop, clicks Connect Gmail, completes flow.  
2. **Tunnel (e.g. Cloudflare Tunnel / ngrok):** Run a tunnel so the instance is reachable at `https://xxx.trycloudflare.com` (or similar). Add that callback URL in Google Cloud. User connects via that URL.  
3. **Localhost only:** For dev, use `http://localhost:3000/api/oauth/gmail/callback`; user must open Control on the same machine.

So the **one-time setup** that remains for the deployer is: create Google Cloud project, enable Gmail API, create **Web application** OAuth client, add the **exact** callback URL (HTTPS for non-localhost), and add test users (or publish). After that, **end users** (or the same person) only do “Connect Gmail” → sign in → done.

---

## Security notes

- **State:** Use a random `state` in the start URL and verify it in the callback to avoid CSRF.  
- **Callback:** Only allow Control-authorized clients to hit `/api/oauth/gmail/start` if you want (so only people who can open Control can connect Gmail). Callback is hit by redirect from Google, so it must be reachable by the user’s browser; validate `state` and don’t expose tokens in the URL.  
- **Token storage:** Write refresh token to a file the server can read, with restricted permissions (e.g. `chmod 600`), not in logs or HTML.

---

## Summary

| Current flow (bleak) | New flow (same result) |
|----------------------|-------------------------|
| Create Google project, enable API, create Web client, add redirect URI, add test user | Same one-time setup (done by deployer) |
| Open OAuth Playground, paste client id/secret, authorize, copy refresh token, SSH and edit .env | User clicks **Connect Gmail** → signs in with Google (phone or desktop) → done |
| Manual restart (if .env changed) | Optional: server reads token from file and skips restart; or callback triggers restart |

Implementation is a small number of routes (start + callback), a way to persist the refresh token, and a “Connect Gmail” entry point in Control. No change to how EA look-in or Gmail API use the token.
