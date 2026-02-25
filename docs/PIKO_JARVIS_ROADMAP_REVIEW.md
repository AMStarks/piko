# Piko → Jarvis roadmap: review against iOS integrations reality

This doc reviews the **6‑month Jarvis growth roadmap** against [PIKO_IOS_INTEGRATIONS_INVESTIGATION.md](./PIKO_IOS_INTEGRATIONS_INVESTIGATION.md) and [PIKO_OPENCLAW_INTEGRATIONS_AND_APPS.md](./PIKO_OPENCLAW_INTEGRATIONS_AND_APPS.md). Goal: keep the vision, correct technical assumptions, and sequence work so “Piko has access” is built on solid ground.

---

## What aligns well

- **Universal iOS Bridge** (`/api/ios-hub`): Single endpoint for Shortcuts → Piko is exactly right. The investigation doc calls out App Intents + `piko://` URL scheme; the hub is the server-side receiver. **Action + learning repo update** in one request matches the “build once” idea.
- **Reminders + Calendar first**: Matches investigation order. EventKit + Info.plist is the path; “Piko adds reminder” / “block reflection time” is achievable once the iOS app has EventKit and the hub accepts `action: "reminder"` / `action: "calendar"`. **Caveat:** “Block reflection time tomorrow” can mean (a) **native iOS Calendar** → iOS app must create the event (server sends intent to app, app uses EventKit), or (b) **Google Calendar** → server creates it via Google API. Roadmap doesn’t distinguish; see “Architecture clarity” below.
- **Telegram for notifications**: Already connected; using it for proactive nudges (tensions, calendar density, Moltbook) is the right channel.
- **Share Extension + Files/PDF**: “Files app → Share PDF → Piko extracts → rabbit-hole” aligns. Investigation: document picker + Share to Piko; server already needs a PDF extraction skill. Photos/screenshots → OCR is an extra step (Vision on device or upload + server OCR).
- **Shortcuts as universal trigger**: Siri, widget, action button all go through Shortcuts/App Intents → Piko API. Investigation doc supports this; no conflict.
- **Pattern detector (cron)**: Server-side only; uses learning repo, Moltbook, and (when available) calendar data. Fits current architecture.

---

## Where the roadmap is optimistic or underspecified

### 1. Messages (iMessage / SMS)

Roadmap says:
- “Messages → Context Awareness”, “iMessage extension → Summarize this thread”, “Piko sees your conversations”.

**Reality:**  
- **No public API** for iMessage or SMS from third‑party apps. Apple does not expose message content to app extensions or Shortcuts.
- **What is possible:** (a) **User-driven share**: user copies a thread (or screenshot) and pastes or shares into Piko; (b) **Shortcuts**: some limited actions (e.g. “send message”) but not “get full thread content”; (c) **Server-side**: if the user uses something that exposes messages via an API (e.g. a bridge or another platform), that’s outside the iOS Messages app.

**Adjustment:** Reframe “Messages” as **“Share to Piko from Messages”**: user selects/copies content and shares or pastes into Piko. No “Piko reads your Messages” without an unsupported/private API. Same for “SMS → Extract action items”: only if the user explicitly sends that content to Piko (paste, share, or forward to a number that Piko ingests).

### 2. Calendar: server vs device

Roadmap uses Calendar for:
- “Block reflection time tomorrow”
- “3 meetings tomorrow, no prep time”
- “Back‑to‑back meetings” → auto‑mute
- “Thursday free 2h” for cross‑context synthesis

**Reality:**  
- **Native iOS Calendar**: readable/writable only from the **iOS app** via EventKit. The server has no direct access.
- **Google (or other) Calendar**: readable/writable from the **server** with OAuth; no EventKit.

So you have two paths:

- **A — Device-centric:** iOS app has EventKit; server sends “create event” requests to the app (e.g. via push or next app open); app creates in iOS Calendar. “What’s on my calendar” requires the app to fetch via EventKit and send to server (or a companion endpoint). Pro: single calendar (iOS). Con: server never has full calendar picture unless the app uploads it.
- **B — Server-centric:** Use Google Calendar (or similar) on the server; server does “block time”, “3 meetings tomorrow”, “Thursday free 2h” directly. Pro: full context for proactive logic. Con: user must use that calendar (or sync).

**Recommendation:** Decide which calendar is source of truth. If iOS Calendar is primary, Phase 1 “Calendar” means EventKit in the app + a **device → server** sync or “upload my day” so the pattern detector can run. If Google is primary, Phase 1 should include “Google Calendar on server” and treat “Calendar” in the hub as “server creates in Google” (iOS can still show EventKit for local-only events if you want). The roadmap should call this out so Week 1–2 isn’t blocked on “server creates iOS event” (which isn’t possible without the app).

### 3. Notes

Roadmap: “Notes (capture ideas → learning repo)”.

**Reality (from investigation):** No public Notes API. Piko cannot read or write Apple Notes from the app. Options: (1) **Share to Piko** from Notes (user sends content to Piko → learning repo); (2) Shortcuts for “append to note” with text Piko provides. So “capture ideas → learning repo” is **user shares from Notes to Piko**, then server/learning repo handles it—not “Piko reads Notes”.

**Adjustment:** In the roadmap, list Notes as “Share to Piko from Notes → learning repo” and optional “Shortcuts: append to note”. Don’t imply Piko has direct read/write of Notes.

### 4. Health and Location (Phase 2)

Roadmap: “iOS Health → Worked out 5 days”, “Location → At coffee shop 3x/week”.

**Reality:**  
- **Health:** HealthKit is available only to the **iOS app**; no server access. The app would read HealthKit (with user permission and entitlements), then send summary data (e.g. “workouts this week: 5”) to the server. So: **device reads Health → app sends to Piko API**; server then can say “Great streak! Block recovery time?”.
- **Location:** Same. App gets location (or “significant location” / visits) with permission, optionally aggregates (e.g. “at coffee shop 3x/week”) on device or sends anonymized/aggregated data to server. Requires `NSLocationWhenInUseUsageDescription` or similar and possibly Background Modes. Privacy and App Store review are real; “location patterns” should be explicit user opt‑in and minimal data.

**Adjustment:** Add a line: “Health/Location: iOS app reads (HealthKit/Location) with permission → app sends summaries to Piko API; no server-side direct access.” Phase 2 should schedule HealthKit + Location entitlements and a small “context upload” from the app.

### 5. “Context aggregator” and “Piko sees your whole life”

Roadmap: “Single API endpoint reads: Calendar, Messages summaries, Files recent, Health streaks, Location patterns”.

**Reality:**  
- **Calendar:** Only if (a) server has Google (etc.) Calendar, or (b) iOS app uploads calendar data to the server.
- **Messages:** Not readable by Piko; only what the user shares.
- **Files recent:** Server has no access to “Files app” on device. Either the user shares files to Piko (then server has what was shared) or the app uses a document picker and uploads—no “recent files” scan.
- **Health / Location:** As above; app sends derived summaries.

So the “context aggregator” is really: **server holds what it has (learning repo, Moltbook, Notion, optional Google Calendar, PDFs/user uploads)** + **iOS app periodically sends: calendar snapshot (if EventKit), health summary, location pattern (if enabled)**. The roadmap should describe it that way so the “single endpoint” is “aggregate what we’re allowed to have”, not “read everything on the device”.

---

## Architecture clarity for Phase 1

To make “iOS Nervous System” implementable without rework:

1. **Define the hub contract**  
   `POST /api/ios-hub` body: e.g. `{ action, payload, source }`. Actions: `reminder`, `calendar`, `notes_capture` (text only; from Share), `inquiry` (generic message). Source: `shortcuts` | `share_extension` | `widget`. Server creates reminder/event **only** where it has access (e.g. “reminder” might mean “store on server and notify” or “send to iOS app to create via EventKit”—see below).

2. **Reminders: two implementations**  
   - **A:** Server stores “remind me” in DB and sends Telegram (or push) at due time. No iOS Reminders app.  
   - **B:** iOS app has EventKit; server sends “create reminder” to app (e.g. via push or sync); app creates native reminder.  
   Phase 1 can ship **A** (already possible with `/remind` + Telegram) and add **B** when the app has EventKit and a way to receive “create reminder” (e.g. push notification with payload, or poll).

3. **Calendar: same split**  
   - **A:** Google Calendar on server; hub creates events there.  
   - **B:** iOS app with EventKit; server asks app to create event (e.g. push or sync).  
   Decide which is in scope for “this weekend” (likely **A** if you have Google, or **B** if you’re iOS‑only).

4. **Notes**  
   Hub accepts `action: "notes_capture"` with `text` from Share Extension; server appends to learning repo (or rabbit-hole). No “read Notes” from Piko.

5. **Messages**  
   No “summarize this thread” from iMessage. Only “user pasted or shared content” → treat as inquiry or `notes_capture`. Optional: “Forward to Piko” (SMS/email) that ingests into chat—that’s server-side, not “Messages API”.

---

## Suggested roadmap tweaks (copy‑paste style)

- **Phase 1, Integrations list**  
  - Keep: Telegram, Reminders, Calendar, Shortcuts.  
  - **Notes:** “Notes: capture via Share to Piko → learning repo (no direct Notes API).”  
  - **Messages:** “Messages: no API; user can Share to Piko or paste. Optional: forward-to-Piko number/email for SMS/email.”

- **Phase 1, Hub**  
  - “Reminder” → clarify: “in-app + Telegram” now; “native iOS Reminder” when app has EventKit and push/sync.  
  - “Calendar” → clarify: “Google Calendar on server” or “iOS app (EventKit) creates event from hub request.”

- **Phase 2, Messages**  
  - Replace “iMessage extension → Summarize this thread” with “Share to Piko from any app (including Messages copy/paste) → Piko summarizes and pushes to learning repo.”  
  - “SMS → Extract action items” → “If user forwards SMS to Piko (e.g. email or share), extract action items → Reminders + Calendar.”

- **Phase 2, Health/Location**  
  - Add: “Health/Location: iOS app reads (HealthKit/Location) with permission; app sends summaries to Piko API. No server-side direct access.”

- **Context aggregator**  
  - “Single endpoint **aggregates**: server data (learning repo, Moltbook, Notion, Google Calendar if configured) + **optional** device uploads (calendar snapshot, health summary, location pattern) from iOS app.”

- **Start here (this weekend)**  
  - “Reminders + Calendar” → pick one: (1) Server-only reminders + Telegram and Google Calendar on server, or (2) iOS app EventKit for Reminders + Calendar and hub protocol so server can request “create reminder/event” (app creates when it receives it).  
  - “Messages summarizer” → “Share to Piko (any app) + hub `notes_capture`; Piko summarizes and stores. No iMessage API.”

---

## Summary

- **Keep:** Hub, Reminders/Calendar priority, Telegram notifications, Share Extension, Shortcuts, pattern detector, daily briefing, cross-context synthesis idea.  
- **Correct:** Messages (no iMessage/SMS API; user share/paste only), Notes (Share to Piko, no direct API), Calendar (server vs EventKit), Health/Location (app sends summaries to server).  
- **Clarify:** Reminder/Calendar = server-only vs app-with-EventKit; context aggregator = “what we have + what the app sends”, not “read entire device”.

With these adjustments, the Jarvis roadmap stays ambitious and achievable and matches the iOS integrations investigation.
