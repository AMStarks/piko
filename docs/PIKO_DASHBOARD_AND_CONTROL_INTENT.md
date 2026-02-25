# Dashboard and Control: what they’re for and how they should evolve

Answers to: (1) What is the Dashboard supposed to do? (2) Why Reminders/Calendar in Piko when we have those apps? (3) Is Piko still learning independently / where is rabbit-hole? (4) Control layout direction.

---

## 1. What the Dashboard is supposed to do

The **Dashboard** (in the Piko app, fed by `GET /api/ios-dashboard`) is meant to be a **single-glance summary** of what Piko is doing and what needs your attention. It is not a replacement for Reminders or Calendar; it’s a **convergence view** so you don’t have to open five apps.

**Intended contents:**

- **Learning** – Open tensions (from `tensions.md`) and sticky ideas (from `sticky-ideas.md`), with a peek at the first item so you see “what Piko is holding open.”
- **Context hint** – When the server sees a busy day (many calendar events) plus open tensions, it can suggest e.g. “Busy day + N tension(s). Prioritize Tension #1?” and optionally a **first free slot** (e.g. “Free: 2:00–2:30”).
- **Next reminder** – The next due reminder from Piko’s intent system (same source the EA look-in uses), so you see “what’s next” without opening Reminders.
- **Moltbook** – Last post and upvotes, so you see how the last autonomous post is doing.

So: **Dashboard = “What Piko is working on (learning), what’s coming up (reminder), and how Moltbook is doing,”** with optional context when calendar + learning suggest a prioritisation nudge.

The **Moltbook card showing a very old date (e.g. 1995-02-14)** is almost certainly a bug (wrong field or default). The server sends `moltbookLast: { title, upvotes }`; the app should show “Last post: &lt;title&gt;” and “N upvotes,” and the date should come from the post’s `createdAt` or equivalent, not a placeholder.

---

## 2. Reminders and Calendar – why have them in Piko if we already have those apps?

We’re **not** trying to replace the Reminders or Calendar apps. We’re adding a **Piko layer** that uses them so Piko can act like an EA.

- **Calendar**  
  - The app (or Shortcuts) **pushes** a snapshot to the server (`calendar-snapshot.json`).  
  - Piko uses it to: drive the EA look-in (“Meeting in 15 min”), daily briefing, conflict detection (e.g. plans on a day you already have a meeting), and the dashboard “busy day + free slot” hint.  
  - So: **you keep using Calendar; Piko reads it to advise and alert.**

- **Reminders**  
  - **“Add to Reminders”** = write into the **native** Reminders app (EventKit). You still manage reminders there.  
  - **“Add via Piko server”** = create an **intent** in `data/intents.json` (Piko’s own list). The EA look-in, intent-poller, and dashboard “next reminder” all use this.  
  - **Piko can create reminders:** from chat (e.g. "remind me to …" or `/remind`), from the iOS hub action "reminder," and from the conversation action sheet ("Add via Piko server"). So the list is **things Piko suggests we add**, not only things you typed.
  - So: **two paths** – native (for things you want in Apple Reminders) and Piko (for things Piko should see, remind you about, and surface in look-ins/dashboard).

**Reframe: "Reminders & Calendar" = "Things Piko suggests we add"** — The screen is the control surface for the Piko layer (EA look-in, dashboard, suggestions), not a replacement for the system apps.

**Why both in the app:**  
So you can **grant access** (so Piko can read/write where appropriate) and **choose** per reminder: “live in Reminders” vs “live in Piko and feed the EA.” The “Reminders & Calendar” screen is the **control surface** for that integration, not a replacement for the system apps.

---

## 3. Is it still learning independently? Where is rabbit-hole in Control?

**Yes.** Learning is still designed to run independently:

- **Tensions and sticky ideas** – Stored in `data/learning/` and shown on the Dashboard and in Control → Learning (tensions / sticky tabs).
- **Rabbit-hole notes** – Written by `scripts/rabbit-hole-daily.js` (cron, e.g. daily). Each run picks a topic (from `topics.txt` or derived from journal), does a search/summary, and appends a dated note to `data/learning/rabbit-hole-notes.md`.

**Where you see it in Control:**

- **Control → Learning** has three “databases”: **Tensions**, **Sticky ideas**, and **Rabbit-hole notes**.  
- The **Rabbit-hole notes** tab is the place for “investigation” content. If that tab is empty or you rarely look there, it can feel like “not much rabbit-hole investigation” even when the script is running.
- The **Dashboard** in the app currently shows **Learning** (tensions + sticky) and **Moltbook**; it does **not** yet show a “Latest rabbit-hole” or “Today’s exploration” line. So independent learning *is* happening in the repo and in Control, but the **app Dashboard doesn’t yet surface rabbit-hole** explicitly.

**Concrete improvements:**

- **Control → Dashboard (or Learning):** Add a small “Rabbit-hole” summary card: e.g. “Last 7 days: N notes” and a link to the most recent note, so “investigation” is visible at a glance.  
- **App Dashboard:** Add a “Rabbit-hole” or “Exploration” card that shows the latest rabbit-hole note title/date (from API), so the app reflects that Piko is still learning independently.  
- **Cron:** Run rabbit-hole in the **12am–6am** window so Piko is actively learning in quiet hours. Example: `0 3 * * *` (3am). Ensure `data/learning/topics.txt` exists. See **Influencing topics** below.
- **Influencing topics:** (1) **Edit `data/learning/topics.txt`** — one topic per line; the script round-robins by day. (2) **Topics we've discussed** — add topics from conversation to `topics.txt` manually, or use `scripts/learning-topic-suggestions.js` (monthly cron) which suggests 2–3 topics from sticky ideas and tensions into `topic-suggestions.md`; you approve and add lines to `topics.txt`. (3) **Journal-derived:** ~20% of days the script picks a topic from recent journal themes. To bias learning toward "what we've discussed," keep `topics.txt` updated with those themes or run topic-suggestions and add approved lines.

**How to give Piko things to research:** (1) **On the server:** Edit `data/learning/topics.txt` (one topic per line; e.g. "Ancient Sumeria", "Agent coordination"). The daily rabbit-hole script picks from this list in rotation. (2) **From Control or API:** `GET /api/control/learning/topics` returns `{ topics: string[] }`; `POST /api/control/learning/topics` with body `{ topic: "Your topic" }` or `{ topics: ["A", "B"] }` appends lines to `topics.txt`. (3) **Suggestions:** Run `scripts/learning-topic-suggestions.js` (e.g. monthly); it writes suggestions to `topic-suggestions.md`; you approve and add to `topics.txt` (or POST via API).

---

## 4. Control layout – what we want it to be

Control is the **web surface** for configuring Piko, inspecting learning/Moltbook/EA, and editing prompts. Right now it’s a dense set of cards and sidebars. To better reflect “what we want”:

**Clarify roles:**

- **Dashboard (Control home)** – “State of Piko right now”: EA status (alerts 24h, quiet hours, next run), Learning summary (tensions, sticky, rabbit-hole count or last note), Moltbook (last post, next eligible), next reminder/scheduled, and a single line on 24/7 EA. So: **one page = health + EA + learning + Moltbook.**
- **Learning** – Deep dive: tensions, sticky, rabbit-hole (with rabbit-hole visible and prominent, not buried).  
- **Integrations** – All env/feature toggles (EA, Gmail read body, iMessage, prep, EOD digest, daily memory, etc.) and quiet hours, so “where Piko gets data and where it sends alerts” is in one place.  
- **Channels** – Who can talk to Piko (allowlist, adapters).  
- **Prompts / Mind / Wisdom** – Unchanged in purpose; keep as “personality and truth” rather than ops.

**Layout improvements:**

- **Group cards** on the Control dashboard into clear sections: e.g. “EA & alerts,” “Learning,” “Moltbook,” “Intents & reminders,” “Access,” with a short heading per section.  
- **One obvious “Rabbit-hole” entry point** – Either a card on the Control dashboard (“Rabbit-hole: N notes this week →”) or a top-level sidebar item “Learning (incl. rabbit-hole)” that defaults to or highlights the rabbit-hole tab.  
- **Less clutter** – Move rarely-used stats into expandable sections or a “Details” subpage so the first screen is clearly: status, EA, learning summary, next reminder, Moltbook.  
- **App ↔ Control** – The app “Control” link (or in-app browser to Control) should feel like “same Piko, ops view” not a different product; shared wording (e.g. “EA look-in,” “Learning,” “Rabbit-hole”) helps.

**Outcome:** Control should feel like “the place where I see what Piko is doing (learning, EA, Moltbook) and where I configure where it gets data and sends alerts,” with rabbit-hole and EA clearly visible, not hidden in tabs or secondary cards.
