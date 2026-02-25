# Piko Lock Screen Widget

The server exposes an ultra-light endpoint for a lock screen (or home screen) widget.

## Server: `GET /api/widget`

Returns minimal JSON:

```json
{
  "tensions": 2,
  "nextReminder": "Tension #1 tomorrow",
  "moltbook": "2 upvotes"
}
```

- **tensions** — count of open items in `data/learning/tensions.md`
- **nextReminder** — text of next due reminder (from intents), or `null`
- **moltbook** — e.g. `"N upvotes"` from last Moltbook post, or `null`

No auth required. Use the same **Base URL** as the Piko app (e.g. `https://your-server/api/widget`).

## iOS Widget target (PikoWidget)

1. In Xcode: **File → New → Target** → **Widget Extension** (e.g. Lock Screen + Home Screen).
2. Name it **PikoWidget**.
3. In the widget timeline/provider, **GET** `{BaseURL}/api/widget` (use App Group or shared UserDefaults for Base URL from main app).
4. Display:
   - `tensions` → e.g. "2️⃣ Tensions open"
   - `nextReminder` → "📅 Next: …"
   - `moltbook` → "👍 …"
5. **URL** on tap: `piko://open` (or your app’s dashboard URL) so opening the widget launches Piko.

Result: at a glance you see tensions count, next reminder, and Moltbook; tap to open the dashboard and resolve in seconds.
