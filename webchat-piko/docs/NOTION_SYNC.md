# Notion sync (learning repo ↔ Notion)

Syncs Piko’s learning repo with three Notion databases so you can edit on mobile and have Piko reflect changes.

## What syncs

| Local file | Notion database |
|------------|-----------------|
| `data/learning/sticky-ideas.md` | Sticky ideas DB |
| `data/learning/tensions.md` | Tensions DB |
| `data/learning/rabbit-hole-notes.md` | Rabbit-hole notes DB |

- **Push** (`--push`): Replaces all pages in each database with current file content (archives existing pages, then creates new ones).
- **Pull** (`--pull`): Overwrites the three local files with content from the databases.

## 1. Get a Notion API token (≈5 min)

1. Go to [notion.so](https://notion.so) → **Settings** → **Connections** → **Develop your own integrations**.
2. **New integration** → name it (e.g. “Piko sync”), pick workspace.
3. Copy the **Internal Integration Token** (starts with `secret_`).

## 2. Create the three databases in Notion

Create three databases (in any Notion page). Each must have:

- A **title** property (e.g. “Name”) — used for row title.
- A **rich text** property (e.g. “Content”) — used for the main text.

Then:

1. Open each database in Notion.
2. Click **•••** → **Add connections** → select your Piko integration (so it can read/write).
3. Copy the **database ID** from the URL:
   - URL shape: `https://www.notion.so/workspace/DATABASE_ID?v=...`
   - `DATABASE_ID` is the 32-char hex block (sometimes with hyphens; use the part before `?`).

## 3. Environment variables

In `webchat-piko/.env` (or export before running):

```bash
NOTION_TOKEN=secret_xxxxxxxxxxxx
NOTION_DATABASE_ID_STICKY_IDEAS=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID_TENSIONS=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID_RABBIT_HOLE=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Optional (if your DBs use different property names):

```bash
NOTION_PROP_TITLE=Name
NOTION_PROP_CONTENT=Content
```

## 4. Run the script

From `webchat-piko/`:

```bash
# Load .env if you use one
set -a && source .env && set +a

# Push local files → Notion (replaces existing rows)
node scripts/notion-sync.js --push

# Pull Notion → local files
node scripts/notion-sync.js --pull
```

## 5. Cron (on Optimus)

Use a wrapper that loads `.env`, then run push and pull on a schedule so edits on your phone flow back into Piko.

Example wrapper `scripts/run-notion-sync.sh`:

```bash
#!/bin/bash
cd "$(dirname "$0")/.."
set -a
[ -f .env ] && source .env
set +a
case "$1" in
  push) node scripts/notion-sync.js --push ;;
  pull) node scripts/notion-sync.js --pull ;;
  *)   echo "Usage: $0 push|pull"; exit 1 ;;
esac
```

Make it executable: `chmod +x scripts/run-notion-sync.sh`

Cron examples:

```bash
# Push learning repo to Notion (e.g. hourly at :05)
5 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh push >> /root/webchat-piko/logs/notion-sync.log 2>&1

# Pull Notion changes (e.g. hourly at :10, so mobile edits show up in Piko)
10 * * * * cd /root/webchat-piko && ./scripts/run-notion-sync.sh pull >> /root/webchat-piko/logs/notion-sync.log 2>&1
```

Create log dir: `mkdir -p /root/webchat-piko/logs`.

## Immediate value after integration

- Edit a sticky idea or tension in Notion on your phone → within a cron cycle Piko’s chat sees the updated `data/learning/` files.
- Mark a tension resolved in Notion → next meta-reflection can acknowledge it.
- Rabbit-hole notes stay in sync for editing from anywhere.

## Status

- **Script:** `scripts/notion-sync.js` (push = replace, pull = overwrite local).
- **Dependency:** `@notionhq/client` in `package.json`.
- **iOS:** “Integrated apps” lists Notion as “Configure on server”; once token + DB IDs + cron are set on the server, Notion is effectively connected.
