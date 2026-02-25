# Piko: OpenClaw-style integrations and integrable apps

How Piko can use OpenClaw-style skills and which apps/services we can integrate so Piko can read, use, and automate. Includes a **list of integrable apps** for the iOS Settings menu and backend priorities.

---

## 1. Piko’s skill model today

Piko already has a **local skills** layer (`webchat-piko/skills/index.js`):

- **Pattern + handler**: each skill is `{ pattern, handler }` — e.g. `/notes`, `/todo`, `/summarize <url>`.
- **No ClawHub dependency**: skills are **your own code** in `skills/`; no public registry, no `clawhub install`.
- **First match wins**: message is checked against built-in commands, then skills, then Ollama chat.
- **Batteries included**: `/notes` (add/list), `/todo` (add/list/done), `/summarize <url>` (fetch and strip HTML).

So Piko is already “OpenClaw-style” in spirit: extensible via local skills. The question is **which external apps/services** to wire in next and **how** (new skills, env keys, optional scripts).

---

## 2. OpenClaw categories that map to Piko

| OpenClaw category   | Piko use case                          | Priority |
|---------------------|----------------------------------------|----------|
| **Notion / Google Workspace** | Sync with knowledge repo; pairs with `data/learning/`, worldview | High |
| **Web / Research**  | Search, RSS, scraping → better rabbit-hole notes | High |
| **Messaging**       | Slack, Telegram (you already have Telegram); multi-channel | Medium |
| **PDF / Data**      | PDF text extraction, ETL → literature for worldview distillation | High |
| **Dev tools (GitHub)** | Version learning repo, PRs | Medium |
| **Content / Social**| LinkedIn, Twitter-style posting (like Moltbook) | Low |
| **System / DevOps** | Logs, file/process mgmt on Optimus    | Low |

**Security (from your note):** ClawHub has had malware in top skills. For Piko we **do not** use the public ClawHub registry as-is. We **audit** any skill code, run risky stuff in a **sandbox** (e.g. Docker) where possible, and keep **our own skills dir** (no blind `clawhub install`).

---

## 3. List of apps we can integrate (for Piko to read/use)

This is the list that can drive the **iOS Settings → Integrated apps** menu and backend roadmap. Each item is an app or service Piko could eventually read from, write to, or trigger.

### 3.1 Backend / server integrations (Piko server or Optimus)

Configured via env vars or server-side config; the iOS app can **list** them and show “Configure on server” or connection status when we have an API.

| App / Service     | What Piko can do | How (skill / script) |
|-------------------|------------------|-----------------------|
| **Notion**        | Read/write pages, DBs; sync with `data/learning/` or sticky ideas | Notion API + skill (e.g. `/notion query`, `/notion add`) |
| **Google Workspace** | Calendar (events), Tasks, Gmail (read/send), Docs/Sheets | Google APIs + OAuth; skills for calendar/tasks/email |
| **Slack**         | Send messages, read channels, post as Piko | Slack API + skill (e.g. `/slack post #channel`) |
| **Telegram**      | Already integrated (bot); list as “connected” | Existing bot |
| **GitHub**        | PRs, issues, read repo; version learning repo | GitHub API + skill (e.g. `/github pr list`) |
| **RSS / Atom**    | Fetch feeds for rabbit-hole or daily digest | Skill `/rss add <url>`, cron to pull into notes |
| **Brave Search / Serper / Tavily** | Web search for rabbit-hole (you may already use Tavily) | Existing or new skill |
| **PDF (local or URL)** | Extract text for worldview corpus or summaries | Skill `/pdf extract <url or path>`; script for batch |
| **Databases (SQLite, etc.)** | Store learning, claims, structured data | Skills + `data/` or dedicated DB file |
| **Moltbook**      | Already integrated (post, comment, journal) | Existing poster + comment-run |

### 3.2 iOS / device integrations (from the Piko app on iPhone)

The **native app** can list these so the user sees “Piko can work with…”. Actual integration is via URL schemes, Share Extension, or system APIs where allowed.

| App (iOS)     | What Piko can do | How |
|---------------|------------------|-----|
| **Reminders** | Read lists, add reminders (e.g. “remind me in 1 hour”) | Reminders API (with permission) or `x-apple-reminderkit://` / Shortcuts |
| **Notes**     | Read/write Apple Notes (if we add Notes API or Shortcuts) | Notes API (limited) or Shortcuts / Share Sheet |
| **Calendar**  | Show events, add events | EventKit (with permission) or `ical://` |
| **Mail**      | Open Mail to compose, or list recent (if we get permission) | `mailto:` or Mail framework |
| **Files**     | Open Files app to a folder; optionally pass file to Piko server | `shareddocuments://` or document picker |
| **Safari / Brave** | Open URL, “Share to Piko” (send URL to chat) | URL scheme, Share Extension |
| **Shortcuts** | Run Piko from Shortcuts (e.g. “Ask Piko”) | Siri Shortcuts / App Intents (custom intent to send message to Piko) |

**Note:** Deep “read/write” from the iOS app into other apps often needs **App Intents**, **Extensions**, or **system permissions**. The first step is to **list** these in Settings as “Integrable apps”; then we add concrete flows (e.g. “Share to Piko”, “Add to Reminders via Piko”) as we implement them.

---

## 4. Prioritized “integrate next” for Piko

**Immediate value (match your stack):**

1. **Notion or Google Workspace** — Knowledge sync with `data/learning/`, sticky ideas, or worldview metadata.
2. **Web / Research** — Strengthen rabbit-hole (Tavily/Serper already; optional RSS skill).
3. **PDF** — Extract text from literature → feed worldview corpus or distillation script.
4. **Messaging** — List Slack as integrable; you already have Telegram.

**Strategic:**

5. **GitHub** — Version `data/learning/` or publish worldview docs.
6. **Social (LinkedIn/Twitter-style)** — Moltbook already; list others if we add skills later.

**iOS app (Settings list):**

- Show the same list (Notion, Google, Slack, Telegram, GitHub, RSS, PDF, Reminders, Notes, Calendar, etc.) in **Settings → Integrated apps**.
- Each row: app name, short “Piko can…” line, status: “Connected” / “Configure on server” / “Coming soon”.
- Tapping can open server config docs or a future “Connect” flow.

---

## 5. Security and implementation notes

- **Audit skills**: Any new skill (Notion, Slack, PDF, etc.) is code we review; no blind install from ClawHub.
- **Sandbox**: Run untrusted or heavy scripts (e.g. PDF, ETL) in Docker or a restricted process when possible.
- **Secrets**: API keys and OAuth tokens in env or a secrets store, never in the repo or client app.
- **Own skills dir**: New integrations = new entries in `skills/index.js` or new skill modules we control; no public registry pull.

---

## 6. Summary: list of integrable apps (for menu and roadmap)

**Server / backend (Piko can read, write, or automate):**  
Notion, Google Workspace (Calendar, Tasks, Gmail, Docs), Slack, Telegram (connected), GitHub, RSS/Atom, Brave Search/Serper/Tavily, PDF (extract), Moltbook (connected), Databases (e.g. SQLite).

**iOS / device (Piko app can open, share, or list):**  
Reminders, Notes, Calendar, Mail, Files, Safari/Brave (Share to Piko), Shortcuts.

Use this list in the **iOS Settings → Integrated apps** section and as the backbone for which skills to add next on the server.
