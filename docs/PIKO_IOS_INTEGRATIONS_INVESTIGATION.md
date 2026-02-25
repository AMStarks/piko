# Piko — iOS integrations investigation: giving Piko access to all listed apps

**Goal:** For every app listed in **Settings → Integrated apps** (Server + iPhone), clarify what “Piko has access” means and what is required so Piko can read, use, or automate that app.

**Source:** `Piko-iOS/Piko/IntegratedApp.swift` and `docs/PIKO_OPENCLAW_INTEGRATIONS_AND_APPS.md`.

---

## 1. Summary: what “Piko has access” means

| Category | Where Piko runs | “Access” = |
|----------|------------------|------------|
| **Server** | Optimus / Piko server | Server holds API keys or OAuth tokens; server-side code (skills, scripts, cron) can call the service’s API on behalf of Piko. |
| **iPhone** | Piko iOS app on device | iOS app has permission (EventKit, etc.) or system hook (Share Extension, App Intents); data flows device → server when needed, or user action (Share to Piko) sends content to chat. |

So: **server integrations** = configure on Optimus (env, scripts, skills). **iPhone integrations** = add capabilities and UI in the Piko iOS app (permissions, Share Extension, App Intents).

---

## 2. Server integrations (Piko server has access)

These are configured on the **Piko server** (env vars, scripts, skills). The iOS app only **displays** status (“Connected” vs “Configure on server”).

| App | Current status | What “Piko has access” means | What’s needed |
|-----|----------------|------------------------------|----------------|
| **Notion** | Configure on server | Server can read/write Notion DBs; sync with `data/learning/` (sticky ideas, tensions, rabbit-hole). | `NOTION_TOKEN` + 3 database IDs in `.env`; `scripts/notion-sync.js` + cron (push/pull). **Already implemented.** Set token and DB IDs → “Connected”. |
| **Google Workspace** | Configure on server | Server can read Calendar, Tasks, Gmail, Docs/Sheets (e.g. “what’s on my calendar”, “add task”, “summarize this email”). | Google Cloud project + OAuth 2.0 (or service account); store refresh token; skills or scripts calling Google APIs. Not yet implemented. |
| **Slack** | Configure on server | Server can post to Slack, read channels, react. | Slack app + Bot Token (and optionally OAuth for “post as user”); adapter in `adapters/slack/` exists; wire to Piko API and optional skills. |
| **Telegram** | Connected | Bot receives/sends messages; same session as WebChat. | Already done (bot + `PIKO_UNIFIED_SESSION_ID=main`). |
| **GitHub** | Configure on server | Server can list PRs/issues, read repo, optionally push (e.g. version learning repo). | GitHub token (classic or fine-grained); skill or script calling GitHub API. Not yet implemented. |
| **RSS / Feeds** | Configure on server | Server fetches feeds; content flows into rabbit-hole or daily digest. | No key for public feeds; skill `/rss add <url>` + cron to fetch and append to notes. Partially in plan; implement when needed. |
| **Web Search** | Configure on server | Server can run Tavily/Serper/Brave searches for rabbit-hole or answers. | `TAVILY_API_KEY` or `SERPER_API_KEY` in env; already used in chat/search flows. Mark “Connected” when keys set if desired. |
| **PDF** | Configure on server | Server extracts text from PDFs (URL or path) for worldview or summaries. | No key; skill `/pdf extract <url>` or script using a PDF library. Not yet implemented. |
| **Moltbook** | Connected | Server posts, comments, reads feed; journal and goals. | `MOLTBOOK_API_KEY` in env; poster + comment-run + cron. Already done. |

**To give Piko access to all server apps:** Implement or complete each row (Notion = config only; Google/Slack/GitHub/RSS/PDF = implement skills or adapters; Web Search = already used, optional status bump).

---

## 3. iPhone integrations (Piko app on device has access)

These run in the **Piko iOS app**. “Piko has access” means the app can either (a) read/write the system app (Reminders, Notes, Calendar, Mail, Files) with user permission, or (b) participate in system flows (Share to Piko, Shortcuts).

| App | Current status | What “Piko has access” means | What’s needed (iOS) |
|-----|----------------|------------------------------|----------------------|
| **Reminders** | Coming soon | Piko can read reminder lists and add reminders (e.g. “add to Reminders” from chat, or show “today’s reminders” in app). | **EventKit:** Add `NSRemindersFullAccessUsageDescription` (and optionally `NSRemindersUsageDescription`) to Info.plist; use `EKEventStore`, `requestFullAccessToReminders()`, then `calendars(for: .reminder)`, create/fetch `EKReminder`. Optionally: server intent “remind me on device” → iOS app receives (e.g. via push or sync) and creates reminder locally. |
| **Notes** | Coming soon | Piko can read/write Apple Notes (e.g. “append to Notes”, “read my note X”). | **Notes:** No public Notes API. Options: (1) **Share Extension** — user shares from Notes into Piko (Piko receives text). (2) **Shortcuts** — user runs shortcut “Append to Notes” with text from Piko (Piko app opens Shortcuts URL or passes text). (3) **Third‑party** — e.g. Notes stored in iCloud and accessed via CloudKit (complex). Simplest: “Share to Piko” from Notes; Piko cannot create Notes without Shortcuts/Workflow. |
| **Calendar** | Coming soon | Piko can show events and add events (e.g. “what’s on my calendar”, “add event tomorrow 3pm”). | **EventKit:** Add `NSCalendarsFullAccessUsageDescription` (or usage description for write-only); `EKEventStore`, `requestAccess(to: .event)`; fetch events, create `EKEvent`. Same pattern as Reminders. |
| **Mail** | Coming soon | Piko can open Mail to compose or, with permission, list recent mail. | **Limited:** No direct “read inbox” API without Mail extension. Options: (1) **mailto:** — open URL to compose (always available). (2) **Share Extension** — user shares an email (or its content) to Piko. (3) **Server-side Gmail** — for “read mail” use Google Workspace integration on server, not iOS Mail app. So “access” on iPhone = compose via mailto + share to Piko. |
| **Files** | Coming soon | User can open Files or share a file into Piko; Piko can open Files app to a folder. | **Document picker / Share:** (1) In Piko app: add document picker (UIDocumentPickerViewController) so user can attach a file and send to Piko (upload to server or paste content). (2) **Share Extension** — “Share to Piko” from Files. (3) **Open in place** — `shareddocuments://` or similar to open Files app. |
| **Shortcuts** | Coming soon | User can run “Ask Piko” or “Send to Piko” from Siri/Shortcuts; Piko can trigger Shortcuts (e.g. “run my morning shortcut”). | **App Intents (Siri/Shortcuts):** (1) **Expose an intent** from Piko app, e.g. “Send message to Piko” (accepts text) → app opens and sends to API. (2) **URL scheme** — `piko://send?text=...` so Shortcuts can open Piko with a message. (3) **Reverse:** Piko server cannot trigger iOS Shortcuts directly; user could say “run shortcut X” and app opens Shortcuts URL (e.g. `shortcuts://run-shortcut?name=...`) if we add that. |

**Safari / Brave** (open URL, Share to Piko) is not a separate row in IntegratedApp but is part of “Share to Piko”: implement a **Share Extension** so from Safari/Brave (or any app) the user can “Share → Piko” and the shared URL (or text) is sent to Piko chat.

---

## 4. Implementation order (to give Piko access)

**Server (Optimus)** — already or mostly there:

1. **Notion** — Set `NOTION_TOKEN` and 3 DB IDs; run notion-sync cron. Then mark as Connected in iOS if we add a status API.
2. **Web Search** — Already used (Tavily/Serper). Optional: show “Connected” when keys set.
3. **Slack** — Use `adapters/slack/`; configure token and Piko base URL; run adapter. Then “Connected”.
4. **Google / GitHub / RSS / PDF** — Add skills or scripts when you want them; then “Configure on server” until implemented.

**iOS (Piko app)** — add capabilities in this order:

1. **Share Extension** — “Share to Piko” from Safari, Notes, Mail, Files. Single extension: receive URL/text and open Piko app with that content sent to chat (or store and send on next open). Gives “access” in the sense “user can send content from any app to Piko.”
2. **Reminders** — EventKit + Info.plist keys; screen or intent “Add to Reminders” (and optionally “Show my reminders”). Piko server can already create in-app reminders (`/remind`); this adds **native Reminders app** sync if desired.
3. **Calendar** — EventKit + Info.plist; “What’s on my calendar” (read) and “Add event” (write). Similar to Reminders.
4. **Shortcuts / App Intents** — “Send message to Piko” intent + optional URL scheme so Siri/Shortcuts can invoke Piko.
5. **Mail** — mailto: for compose; Share from Mail for “send this to Piko.”
6. **Files** — Document picker in Piko to attach file; Share to Piko from Files.
7. **Notes** — Read/write is limited; rely on Share to Piko from Notes and optionally Shortcuts for “append to note.”

---

## 5. Info.plist and entitlements (iOS)

For **Reminders** and **Calendar**, add to `Piko-iOS/Piko/Info.plist` (or target’s Info tab):

- **Reminders:**  
  - `NSRemindersFullAccessUsageDescription` (e.g. “Piko adds and reads reminders so you can say ‘remind me’ in chat.”)  
  - On iOS 18+, full access is required for write; read-only may use `NSRemindersUsageDescription` where supported.
- **Calendar:**  
  - `NSCalendarsFullAccessUsageDescription` or `NSCalendarsUsageDescription` (e.g. “Piko shows and adds calendar events.”)

For **Share Extension** you add a new target (Share Extension) and an **App Group** so the extension can pass data to the main app (or open the app with a URL that includes the shared content).

---

## 6. Where each piece lives

| Integration | Where implemented | Config / permission |
|-------------|-------------------|---------------------|
| Notion | `webchat-piko/scripts/notion-sync.js` + server learning API | Server: `.env` (NOTION_*). iOS: display only. |
| Telegram | Existing bot (e.g. clawfriend-bot) | Server: bot token. iOS: display only. |
| Moltbook | `webchat-piko/scripts/moltbook-poster.js` + server | Server: `.env` MOLTBOOK_API_KEY. iOS: display only. |
| Slack | `adapters/slack/` | Server: Slack bot token + PIKO_WEBCHAT_URL. iOS: display only. |
| Reminders (iOS) | Piko-iOS app | iOS: EventKit + Info.plist reminders usage. |
| Calendar (iOS) | Piko-iOS app | iOS: EventKit + Info.plist calendar usage. |
| Share to Piko | Piko-iOS app (new Share Extension target) | iOS: App Group + URL scheme or paste on open. |
| Shortcuts | Piko-iOS app (App Intents + optional URL scheme) | iOS: Intent definition + `piko://` URL scheme. |

---

## 7. Summary: “Piko has access” checklist

- **Server apps:** Piko has access when the server has the right credentials and code (Notion: token + DB IDs + sync; Slack: adapter running; Google/GitHub/RSS/PDF: implement when needed). iOS only shows status.
- **iPhone apps:** Piko has access when the iOS app has the right capability:
  - **Reminders / Calendar** — EventKit + Info.plist usage strings.
  - **Share to Piko** — Share Extension + way to get shared content into chat.
  - **Shortcuts** — App Intents (“Send to Piko”) + optional `piko://` URL.
  - **Mail** — mailto: + Share from Mail.
  - **Files** — Document picker + Share to Piko.
  - **Notes** — Share to Piko; full read/write not available from app.

Use this doc as the single place to decide and implement “Piko has access” for each listed iOS and server app.
