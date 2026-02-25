# Piko as executive assistant: conceptual sketch and implementation plan

## Goal

Piko is strong as a companion; we want it to **use its skills as an AI assistant** by “looking in on” everything it’s integrated with and **notifying the person when something happens that they’d want to know about** — like an EA for a high exec: calendar, email, reminders, queue, learning, Moltbook, etc., with proactive alerts so nothing important slips through.

---

## 1. Current integrations (code review)

| Integration | Where | What it does today | Data / trigger |
|-------------|--------|--------------------|----------------|
| **Intents (reminders, scheduled, queue)** | `data/intents.json`, `lib/intents.js`, `scripts/intent-poller.js` | Reminders → append to `pending-notifications.txt`; scheduled → POST command to `/api/chat`; optional queue “next” run. Poller runs every 5 min (cron). | Due times, status, snoozedUntil |
| **Calendar** | `data/calendar-snapshot.json`, `/api/ios-hub` action `calendar_snapshot`, `daily-briefing.js`, `proactive-patterns.js` | iOS/app pushes snapshot of events; daily briefing reports “N events today, first free slot”; proactive skips nudges if event in next hour. | events[], updatedAt; read-only on server |
| **Gmail** | `server.js` `/gmail unread` | On-demand: fetches unread (metadata), returns subject/from. No proactive read. | GMAIL_ACCESS_TOKEN or refresh token |
| **Moltbook** | `server.js` (feed, posts, register), `scripts/moltbook-poster.js`, `daily-briefing.js`, `proactive-patterns.js` | Posting, feed, last post in briefing; proactive nudge if last 3 posts underperform. | MOLTBOOK_API_KEY, data/moltbook-state.json |
| **Learning (tensions, sticky, rabbit-hole)** | `data/learning/`, control-learning, `daily-briefing.js`, `proactive-patterns.js` | Briefing surfaces tension/sticky; proactive nudge if tensions ≥2 and file stale 7+ days. | tensions.md, sticky-ideas.md, rabbit-hole-notes.md |
| **iOS hub** | `POST /api/ios-hub` | Reminder, calendar_snapshot, notes_capture, inquiry, file_capture, files_recent. Inbound from Shortcuts/app. | body.action, body.events, etc. |
| **Daily briefing** | `scripts/daily-briefing.js` (cron 6 AM) | One Telegram message: calendar today, learning, Moltbook last, next reminder. | calendar-snapshot, intents, learning, moltbook-state |
| **Heartbeat** | `scripts/heartbeat.js` | Suggests MEMORY line from history; optional Telegram nudge. | history dump, suggestions |
| **Pending notifications** | `data/pending-notifications.txt` | Intent poller appends reminder text here; **consumption** (who reads and clears?) is not fully wired — widget or app may read. | Line-delimited |
| **Weather / news** | `server.js` `/weather`, `/news` | On-demand only. No proactive. | Open-Meteo, RSS or News API |

**Gaps for EA-style behaviour:**

- **No single “look in” loop** that periodically checks all sources and decides “what should the person be told?”
- **Gmail:** Only on-demand; no “new important email” or “unread piling up” alert.
- **Calendar:** Snapshot is push-based (app sends it); no server-side “next meeting in 15 min” or “day changed, here’s today” unless daily-briefing runs once.
- **Pending notifications:** Reminders land in a file; no guarantee they’re delivered to the user (Telegram, app, or widget) in a unified way.
- **Synthesis:** Daily briefing is a fixed template. We don’t have “Piko looked at everything and decided these 3 things need your attention.”

---

## 2. How OpenClaw does it (reference)

From docs and articles:

- **Self-hosted gateway** connecting chat apps (WhatsApp, Telegram, iMessage, etc.) to AI agents. Multi-channel, one process.
- **Background tasks, cron, proactive workflows:** Can read/triage email, schedule events, send notifications. Automation runs on a schedule or trigger.
- **Email + calendar:** Gmail + Google Calendar APIs, or IMAP/CalDAV. Setup is per-user (tokens, OAuth).
- **24/7 context, conversational management:** User talks to the assistant; it can act on inbox, calendar, etc., and notify when something needs attention.

**Takeaways for Piko:**

- A single **periodic “EA loop”** (e.g. every 15–30 min) that: (1) reads from all integrated sources, (2) evaluates “what needs attention?”, (3) sends one or more notifications (Telegram, in-app, or push) with a short, human-friendly message.
- Calendar and email need to be **polled or pushed** into a form Piko can read (we already have calendar snapshot; Gmail would need a scheduled fetch or webhook).
- Notifications should be **actionable and concise** (“Meeting in 15 min: X”, “3 unread emails might need reply”, “Reminder: Y”).

---

## 3. Conceptual sketch: Piko as EA

**Idea:** One process (or cron job) runs on a schedule (e.g. every 15 or 30 minutes). It:

1. **Gathers** from every integrated source:
   - **Calendar:** Read `calendar-snapshot.json`; “next event in next 30 min?”, “events today?”
   - **Intents:** Reminders due or due soon; next scheduled command; queue length.
   - **Gmail (if configured):** Fetch unread count or last N; optionally use LLM to flag “might need reply” (sender, subject).
   - **Moltbook:** Last post performance; comments or feedback if we add that.
   - **Learning:** Stale tensions; new sticky ideas (if we track “new”).
   - **Pending notifications:** Anything in `pending-notifications.txt` that hasn’t been “delivered” yet (requires a delivery path: e.g. send to Telegram and clear, or mark as sent).

2. **Synthesizes** with an LLM (or rule-based at first):  
   “Given this context, what should the person be alerted to? Prioritise: imminent (meeting, reminder), then important (email that might need reply), then gentle nudge (learning, Moltbook). Output 0–3 short alerts.”

3. **Delivers** alerts via:
   - **Telegram** (already used for briefing and proactive): one message per run, or batched (“🔔 3 things: 1. Meeting in 15 min … 2. 5 unread emails … 3. Reminder: Call John”).
   - **In-app / widget:** If the app or widget can show “Piko’s alerts,” we expose an API (e.g. `GET /api/ea-alerts` or push to a queue the app polls).
   - **iMessage:** Via BlueBubbles adapter: Piko could send a message to the user when something needs attention (same channel as chat).

4. **Respects “busy” and preferences:**  
   - If calendar says “in meeting” now, don’t send a nudge (or only “Meeting now: X”).  
   - Optional: “quiet hours” or “EA intensity” (minimal / normal / high).

**User expectation:** “Piko looks at my calendar, email, reminders, and tells me what I might have missed or what’s coming up.” A bit of extra “thinking” time is acceptable if we frame it as “checking your calendar and inbox.”

---

## 4. Implementation plan (phased)

### Phase 1: Single “EA look-in” job and notification path (foundation)

- **New script:** `scripts/ea-lookin.js` (or `ea-check.js`).
  - Runs on cron (e.g. every 30 min, or every 15 min during “work hours”).
  - Reads: `calendar-snapshot.json`, `data/intents.json`, `data/pending-notifications.txt`, optionally `data/learning/tensions.md` and Moltbook state.
  - **No Gmail yet.** Rule-based only: e.g. “reminder due in next 15 min” → alert; “next calendar event in 30 min” → alert; “pending-notifications not empty” → send those lines to Telegram and clear file (or mark sent).
  - Single Telegram message per run: “🔔 Look-in: [bullet list of 0–3 items].” If nothing: don’t send (or optional “All clear”).
- **Delivery:** Use existing `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`. Optional: append to a small “alerts” store (e.g. `data/ea-alerts.json` with last 24h) so an API can serve the app/widget later.
- **Deploy on Optimus:** Add cron entry for the script; ensure `PIKO_WEBCHAT_URL` and Telegram env are set.

**Outcome:** Piko “looks in” on calendar + intents + pending notifications and sends one consolidated Telegram alert when there’s something to say.

**24/7 and phone/apps:** EA runs on the server on a fixed schedule (e.g. every 30 min) 24/7. It does not depend on the phone being open. Calendar etc. are pushed to the server by the iOS app or Shortcuts; the server uses the latest snapshot each run. Alerts go to Telegram/iMessage regardless of app state.

### Phase 2: Gmail in the loop

- **Scheduled Gmail read:** In `ea-lookin.js` (or a shared “sources” module), if Gmail tokens are set, fetch unread count and metadata (subject, from, date) for last N emails.
- **Rule or LLM:** Either “if unread > 5 → alert” or “LLM: look at subject/from and say which 0–2 might need quick reply.” If LLM: keep prompt short (subject + from only), one line per suggestion.
- **Alert text:** “5 unread. Possible reply: ‘Re: X’ from Y.” Include in the same consolidated Telegram message as Phase 1.

**Outcome:** Email becomes something Piko “looks in” on and can surface.

### Phase 3: LLM synthesis and “what needs attention?”

- Replace or augment rule-based logic with **one LLM call** per run: pass a structured summary (calendar next 24h, reminders due today, unread count + top 3 subjects, Moltbook last post, learning stale flag) and ask: “List 0–3 things this person should be alerted to. One line each. If nothing urgent, output: NONE.”
- Parse response; if not NONE, send as the day’s EA message. Reduces noise and allows natural-language priorities (“Meeting with X in 20 min; you mentioned wanting to prep” if we ever add prep context).

**Outcome:** Alerts feel more “EA-like” and prioritised.

### Phase 4: App/widget and delivery preferences

- **API:** `GET /api/ea-alerts` (or `GET /api/notifications`) returning last 24h of alerts (from `data/ea-alerts.json` or DB). App/widget can show “Piko’s updates.”
- **Delivery preferences:** Config or chat command: “Notify me on Telegram only” / “Telegram + in-app” / “Quiet between 22:00–07:00.” EA script respects quiet hours and channel choice.
- **iMessage:** If we want alerts via iMessage, the BlueBubbles adapter can send a message to the user when the EA job decides to notify (same “send reply” path; sessionId = imessage-<guid> for the primary chat).

**Outcome:** User chooses where they’re notified; Piko still does one “look-in” and one synthesis.

### Phase 5: Richer context and prep

- **Calendar:** “Next meeting: X in 15 min. Attendees: …” or “No meetings until 14:00.”
- **Prep:** Optional “prep for next meeting” call: LLM gets meeting title + attendee names and suggests 2–3 talking points (using memory/learning if relevant). Include in the alert or as a follow-up message.
- **Recurring digest:** Optional “end of day” or “weekly” summary (what was discussed, what’s coming, what slipped). Could use daily-memory summaries as input.

---

## 5. Recommendation

- **Start with Phase 1:** One script, calendar + intents + pending-notifications, rule-based, one Telegram message per run. Proves the “look-in” loop and delivery path without new integrations or LLM cost.
- **Then Phase 2** once Gmail OAuth/tokens are stable (scheduled fetch + unread/surface).
- **Then Phase 3** so Piko “decides” what’s worth alerting on (LLM synthesis).
- **Phases 4–5** as needed for app, iMessage, and richer prep.

**What else to enable:** Daily memory: `PIKO_DAILY_MEMORY_ENABLED=1` (done). EA: cron for `ea-lookin.js`; `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `.env`. Intent-poller cron so reminders reach pending file. Phase 2: Gmail tokens on Optimus; optional `PIKO_EA_GMAIL_MIN_UNREAD=5`. Phase 3: `PIKO_EA_USE_LLM_SYNTHESIS=1` (or `true`) and `OLLAMA_URL` so the look-in script can call the LLM; on failure, falls back to rule-based bullets.

### Phase 3 (implemented): env and behaviour

- **Env:** `PIKO_EA_USE_LLM_SYNTHESIS=1` or `true` to use LLM synthesis. `OLLAMA_URL` (and any model env used by `lib/llm.js`) must be set when cron runs (e.g. `. ./.env` in the crontab entry).
- **Behaviour:** Script builds a short context string (next calendar event in 30 min, reminders due in 15 min, pending notification lines, Gmail unread count + top subjects). It calls the LLM with a prompt: list 0–3 things to alert on; if nothing urgent, output exactly `NONE`. If the response is `NONE` or empty, no message is sent. Otherwise the returned lines are used as the bullets for the single "🔔 Look-in" Telegram message.
- **Fallback:** If the LLM call fails (timeout, missing `lib/llm`, etc.) or returns nothing parseable, the script uses the existing rule-based bullets (Phase 1+2 behaviour).
- **Conflict detection:** Context now includes "Calendar today" and "Calendar tomorrow" plus reminders and pending. The prompt instructs the LLM to check if the person may have double-booked or made plans (in reminders/pending) for a day they already have a meeting, and to alert them (e.g. "Possible conflict: you have X on your calendar and a reminder for Y that day").

### Phase 4 (implemented): App/widget and delivery preferences

- **API:** `GET /api/ea-alerts` returns last 24h of look-in messages from `data/ea-alerts.json` (`{ alerts: [ { at, text }, ... ] }`). Control access only. App/widget can poll this to show "Piko's updates."
- **Preferences:** `data/ea-preferences.json` holds `{ quietStart, quietEnd }` (e.g. `"22:00"`, `"07:00"`). `GET /api/ea-preferences` and `PUT /api/ea-preferences` (control-only) read/update it. Leave null or blank to disable quiet hours.
- **Quiet hours:** `ea-lookin.js` reads preferences at run time; if current server local time is inside the window (e.g. 22:00–07:00), it skips sending Telegram and does not clear pending notifications.
- **Control UI:** Integrations page shows "EA alerts (last 24h)" and "Quiet hours" with form to set From/To and Save. Dashboard shows EA alerts count (24h) with link to Integrations. iMessage: set PIKO_EA_IMESSAGE_CHAT_GUID plus BLUEBUBBLES_URL and BLUEBUBBLES_API_KEY; ea-lookin sends the same look-in to that chat.

### Phase 5 (implemented): Richer context and prep

- **Calendar:** Look-in uses a richer line: "Meeting in 15 min: X. Attendees: A, B" when event has attendees, or "No meetings until 14:00" when next event is after the 30 min window. Events in calendar-snapshot may include attendees/attendeeNames.
- **Prep for meeting:** When PIKO_EA_PREP_MEETING=1 and the next event is in the 30 min window, the script calls the LLM for 2–3 talking points (title + attendees) and adds one bullet "Prep: …" to the look-in message.
- **End-of-day digest:** scripts/ea-digest-eod.js runs on cron (e.g. 0 18 * * *). Sends one Telegram message: yesterday's daily-memory summary (session from PIKO_EA_EOD_SESSION, default main), look-in alerts count today, next reminder.

This gets you to “Piko notifies when things take place that a person would need to be aware of” in small, testable steps, with data and code living on Optimus and Piko “looking in” on everything it’s already integrated with.
