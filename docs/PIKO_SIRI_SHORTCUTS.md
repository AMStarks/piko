# Piko + Siri Shortcuts

Use Siri or the Shortcuts app to trigger Piko without opening the app.

## Prerequisites

- Piko iOS app installed with **Base URL** set (Settings → Server) to your Piko server (e.g. `https://your-tunnel.ngrok.io` or `http://192.168.0.121:3000` when on same network).
- For "Piko inquiry" via URL: the app must be installed so the `piko://` URL scheme opens it.

---

## 1. Piko inquiry (voice or tap)

**Goal:** Send a preset message to Piko and get a reply (app opens with message prefilled, or you send via hub).

### Option A: Open Piko with prefilled message (no server call until you send)

1. Shortcuts app → **New Shortcut**.
2. Add action **Open URL**.
3. URL:  
   `piko://send?text=What%20should%20I%20focus%20on%20today%3F`  
   (Replace with your question; use `%20` for space, `%3F` for `?`.)
4. Name the shortcut **"Piko inquiry"**.
5. Optional: **Add to Siri** → say "Hey Siri, Piko inquiry".

Result: Piko app opens with the text in the input field; tap Send to get a reply.

### Option B: Send directly to server (app can be closed)

1. Shortcuts app → **New Shortcut**.
2. Add action **Get Contents of URL**.
   - URL: `https://YOUR-PIKO-SERVER/api/ios-hub`
   - Method: **POST**
   - Headers: `Content-Type` = `application/json`
   - Request Body: **JSON**  
     `{"action":"inquiry","text":"What's my latest tension?","source":"shortcuts"}`
3. (Optional) Add **Show Result** or **Speak Text** with the `reply` from the JSON response.
4. Name the shortcut **"Piko ask"** and add to Siri if you like.

Result: Server runs the inquiry and returns a reply; Shortcut can show or speak it.

---

## 2. Latest tension (quick check)

**Goal:** Ask Piko to summarize your open tensions or surface the latest one.

- Same as **Option A** above with URL:  
  `piko://send?text=Summarize%20my%20open%20tensions%20in%20one%20sentence`
- Or **Option B** with body:  
  `{"action":"inquiry","text":"What's my latest tension?","source":"shortcuts"}`

Piko (with access to learning repo) will answer from your tensions.

---

## 3. Add reminder from Siri

**Goal:** "Hey Siri, add reminder to Piko" → create a reminder on the server (and optionally in iOS Reminders if the app does it).

- **Get Contents of URL** → POST to `https://YOUR-PIKO-SERVER/api/ios-hub`  
  Body: `{"action":"reminder","text":"YOUR TEXT","due":"tomorrow","source":"shortcuts"}`
- For **text**, use a Shortcuts variable (e.g. "Ask for Input" or clipboard).

---

## 4. Quick capture (notes to Piko)

- **Open URL**: `piko://send?text=CLIPBOARD_OR_INPUT`  
  or POST to hub with `{"action":"notes_capture","text":"..."}`.

Use **Get Clipboard** or **Ask for Input** in Shortcuts to supply the text.

---

## 5. "Hey Siri → Piko summarize"

**Goal:** Summarize recent Messages (or other content) via Share sheet → Piko.

- Shortcuts: **Open URL** → `piko://send?text=Summarize%20recent%20Messages`  
  (Or use Share sheet from Messages → Share → Piko to send the conversation; then use this shortcut to ask for a summary in chat.)
- Add to Siri: "Piko summarize".

---

## 6. "Hey Siri → Piko tension"

**Goal:** Instant inquiry about Tension #1 (or "my tensions").

- **Open URL**: `piko://send?text=What%27s%20your%20take%20on%20Tension%20%231%3F`  
  or `piko://inquiry?tension=1` if your app supports it (prefill: "What's your take on Tension #1?").
- Add to Siri: "Piko tension".

---

## 7. "Hey Siri → Piko reminders"

**Goal:** List today's reminders (from EventKit).

- Use Shortcuts **Find Reminders** (List: All, filter by Due: Today), then **Show Result** or **Speak Text**.
- Or **Open URL** → `piko://open` to open Piko, then use the Reminders & Calendar sheet in the app to see today's reminders.

Add to Siri: "Piko reminders".

---

## Server base URL in Shortcuts

If you use Option B (direct API), store your base URL once:

1. In Shortcuts, create a **Text** action with your URL (e.g. `https://xxx.ngrok.io`).
2. Use **Set Variable** → name it `PikoBaseURL`.
3. In **Get Contents of URL**, set URL to: **PikoBaseURL** + `/api/ios-hub`.

Then you can change the server in one place.

---

## Troubleshooting

- **"Cannot connect"** — Check Base URL in Piko app Settings; use HTTPS for remote, or same Wi‑Fi for local IP.
- **piko:// doesn't open app** — Reinstall the app and ensure the URL scheme is in Info.plist (`piko`).
- **403 / Not allowed** — Hub allows all sources by default; if you added allowlist, ensure `shortcuts` or the source you send is allowed.
