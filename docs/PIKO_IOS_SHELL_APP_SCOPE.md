# Piko native iOS shell app — scope and tunnel

**Goal:** A minimal native iOS app to test Piko on iPhone: chat UI (send message, see reply) talking to the existing Piko API. Optimus stays the server; we use a **tunnel** so the phone can reach it without opening the LAN to the internet.

---

## 1. What the iOS app does (scope)

| Feature | Scope |
|--------|--------|
| **Chat** | Single conversation: text input, send, show Piko’s reply. Same session as WebChat/Telegram if we send `sessionId: "main"` (unified session). |
| **API** | `POST /api/chat` with `{ "message": "…", "sessionId": "main" }`. Response: `{ "reply": "…" }` or SSE when `stream: true`. |
| **Streaming** | Optional: support `stream: true` and SSE so replies appear incrementally. V1 can be non-streaming only. |
| **Auth** | None today (chat is unauthenticated). Tunnel or future app can add token/header if we add auth later. |
| **Config** | Base URL (e.g. `https://your-tunnel-url`) must be set somewhere: in-app settings, or hardcoded for a single test tunnel. |

**Out of scope for “shell”:** History persistence (can use in-memory or simple store), /commands, Control UI, Moltbook, multi-profile. Just “talk to Piko” over the existing API.

---

## 2. Why a tunnel?

- **Optimus** runs Piko on `192.168.0.121:3000` (LAN). It is **not** exposed to the internet (correct for security).
- **iPhone** may be on the same WiFi (could hit `http://192.168.0.121:3000` directly) or on cellular / another network (cannot reach 192.168.x.x).
- **Tunnel:** A small process on Optimus (or your Mac) creates an **outbound** connection to a tunnel provider and exposes a **public HTTPS URL** that forwards to `localhost:3000`. The phone then calls that URL; no need to open ports or put Optimus in the DMZ.

So: **we need a tunnel to overcome server security** (no direct inbound from internet to Optimus) and to work when the phone is not on the same LAN.

---

## 3. Can we do it on existing Optimus?

**Yes.** No change to Piko itself. You only need:

1. **Tunnel client on Optimus** (or on a machine that can reach Optimus; see below).
2. **Public URL** that forwards to `http://127.0.0.1:3000` (or `http://192.168.0.121:3000` if the tunnel runs on another host).
3. **iOS app** that uses that URL as the base for `POST /api/chat`.

**Where to run the tunnel**

- **Option A — On Optimus:** Run tunnel client (e.g. cloudflared or ngrok) on Optimus; it forwards `localhost:3000` to a public URL. Easiest if you’re happy installing one extra binary and a config (or token) on Optimus.
- **Option B — On your Mac:** Run tunnel client on the Mac, forwarding to `http://192.168.0.121:3000`. The public URL then reaches Piko via your LAN. Good for testing without touching Optimus; the Mac must be on and running the tunnel when you use the app.

---

## 4. Tunnel options (all work with existing Optimus)

| Tool | How it works | Pros | Cons |
|------|----------------------|-----|-----|
| **Cloudflare Tunnel (cloudflared)** | Outbound daemon; you get a hostname like `piko-optimus.yourdomain.com` or a free `*.trycloudflare.com` URL. | Free, HTTPS, no open ports, can add Access (auth). | Need Cloudflare account for a stable name; free trycloudflare URLs change each run. |
| **ngrok** | Outbound agent; you get e.g. `https://abc123.ngrok.io` → localhost:3000. | Simple, HTTPS, good for quick tests. | Free tier URL changes each run; paid for fixed subdomain. |
| **Tailscale** | VPN; iPhone and Optimus get Tailscale IPs; app uses `https://100.x.x.x:3000` or Tailscale Funnel. | No third-party proxy; private mesh. | Requires Tailscale on Optimus and on iPhone (or use Funnel for a public URL). |

**Recommendation for “test on iPhone”:**  
- **Quick test:** ngrok or `cloudflared tunnel --url http://localhost:3000` (trycloudflare). Run on Optimus or Mac; put the printed URL in the iOS app.  
- **Stable / nicer:** Cloudflare Tunnel with a fixed hostname, or Tailscale Funnel, so the app can use one base URL.

---

## 5. iOS app requirements (summary)

| Requirement | Detail |
|-------------|--------|
| **Platform** | Native iOS (Swift / SwiftUI) as a “shell” to test Piko. |
| **Network** | HTTPS base URL pointing at the tunnel (e.g. `https://piko-xxx.trycloudflare.com` or your cloudflared/ngrok URL). No direct LAN IP in production if the phone is off-WiFi. |
| **API** | `POST <baseURL>/api/chat` with JSON body `{ "message": "<user text>", "sessionId": "main" }`. Handle `{ "reply": "…" }` or SSE if streaming. |
| **Security** | Today: no auth on Piko; security = tunnel URL not guessable and (optional) tunnel-side auth (e.g. Cloudflare Access). Later: optional API key or token in app. |
| **Optimus** | No code changes. Only run a tunnel client that forwards to `http://127.0.0.1:3000` (if on Optimus) or `http://192.168.0.121:3000` (if on Mac). |

---

## 6. Minimal implementation checklist

**Tunnel (on Optimus or Mac):**

- [ ] Install cloudflared or ngrok (or Tailscale).
- [ ] Start tunnel to `http://127.0.0.1:3000` (Optimus) or `http://192.168.0.121:3000` (Mac).
- [ ] Note the public HTTPS URL.

**iOS app (new repo or Xcode project):**

- [ ] SwiftUI: one screen with `TextField` + “Send” and a scroll view / list for messages.
- [ ] On send: `URLSession` POST to `<baseURL>/api/chat` with `{"message": "...", "sessionId": "main"}`.
- [ ] Parse JSON `reply` and append to the conversation; show errors (e.g. 502, timeout).
- [ ] Base URL: configurable (e.g. Settings screen or compile-time constant for testing).
- [ ] Optional: `stream: true` and SSE parsing for incremental replies.

**Test:**

- [ ] From iPhone (WiFi or cellular), open app, send a message, confirm Piko’s reply appears.
- [ ] Confirm unified session: same thread as WebChat/Telegram if `sessionId: "main"` and PIKO_UNIFIED_SESSION_ID=main on server.

---

## 7. Conclusion

- **Comments:** Comment support was added and tested (test script: `scripts/test-moltbook-comment.js`). Comments API returns 401 with an invalid key; with a real key you may still see 401 until Moltbook fix the endpoint. Changes to `server.js` were reverted; you can re-add `/moltbook comment <post-id> [content]` when the API works.
- **iOS shell app:** Feasible on **existing Optimus** with a **tunnel** (cloudflared, ngrok, or Tailscale). No server changes required; only a tunnel client and a small native iOS app that calls `POST /api/chat` at the tunnel URL.
