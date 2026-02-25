# Control box vs Notion UI — can we mimic Notion for the learning repo?

**Goal:** Let people who don’t use Notion still control Piko’s learning repo (sticky ideas, tensions, rabbit-hole notes) via the control box, with a UI and workflow that feel similar to Notion.

---

## 1. Notion UI (relevant bits)

- **Block-based pages:** Everything is a block (text, heading, bullet, to-do, database). You add blocks with `/` (slash command) and optional type (e.g. `/todo`, `/table`).
- **Databases:** Table / board / list views. Each row is a “page” with **properties** (columns): Name (title), rich text, select, date, etc. You click a cell to edit inline; you can open a row as a full page for longer content.
- **Structure:** “Database” = collection of rows with the same property set. Our learning repo maps to three such collections:
  - **Sticky ideas** — list of text items (one “property”: content).
  - **Tensions** — list of text items (same; max 5 in docs).
  - **Rabbit-hole notes** — list of blocks with **title** (e.g. `## 2026-02-06: Topic`) and **content** (body).
- **Interaction:** Add row, edit cell/content inline or in a panel, delete row, reorder (drag handle). No need for full WYSIWYG or slash commands to get the same *functionality*.

So the “Notion-like” core we care about is: **database-as-table**, **rows as items**, **inline or form edit**, **add/delete/reorder**.

---

## 2. Piko control box today

- **control.html:** Dashboard of **cards** (Health, Prompts, Metrics, Intents, Sessions, Moltbook, Goals, Journal, Pending proposal). Mostly read-only; a few actions (approve/reject aim, prune posts). No learning-repo editing.
- **control-prompts.html:** **List of files** → click one → **single textarea** for the whole file → Save. Pattern: list → pick item → full-text edit → persist.
- **control-moltbook.html:** List of posts with checkboxes and prune.

So we already have:
- List → select → edit (prompts).
- Cards and tables in HTML/JS, no framework.

We do **not** yet have:
- Any API that reads/writes the learning repo (`data/learning/sticky-ideas.md`, `tensions.md`, `rabbit-hole-notes.md`).
- A “database view” (rows = items, add/edit/delete/reorder) in the control UI.

---

## 3. Feasibility: yes, we can mimic Notion-style behavior

We don’t need to clone Notion’s full block editor or slash commands. We only need to mirror the **data and workflow**:

| Notion concept        | In control box equivalent                          |
|-----------------------|----------------------------------------------------|
| Three “databases”     | Three sections: Sticky ideas, Tensions, Rabbit-hole notes |
| Table view (rows)     | Table or card list: one row per item               |
| Row = page with props | Row = one sticky / one tension / one note block    |
| Edit property         | Inline text input or “Edit” → modal/side panel     |
| Add row               | “Add sticky” / “Add tension” / “Add note” button   |
| Delete row            | “Delete” or trash icon per row                     |
| Reorder               | Drag handle + reorder (optional; can start without) |

**Implementation scope (realistic):**

1. **Backend:** Add learning-repo API (same pattern as prompts):
   - `GET /api/control/learning` → list the three “databases” (sticky-ideas, tensions, rabbit-hole).
   - `GET /api/control/learning/:id` → return structured content (e.g. `{ items: [...] }` for sticky/tensions, `{ blocks: [{ title, content }] }` for rabbit-hole).
   - `PUT /api/control/learning/:id` → accept same structure, write back to the correct `.md` file (using same format as notion-sync: bullets for sticky/tensions, `## Date: Title` + body for rabbit-hole).

2. **Frontend:** New page **control-learning.html** (linked from main control dashboard):
   - Tabs or sidebar: **Sticky ideas** | **Tensions** | **Rabbit-hole notes**.
   - Each section:
     - **Table-like layout:** one row per item; columns e.g. “Content” (and “Title” for rabbit-hole). Optional drag handle column for reorder later.
     - **Inline edit:** click row to edit in place, or “Edit” opens a small form/modal (title + content for rabbit-hole, single field for sticky/tensions).
     - Buttons: “Add sticky” / “Add tension” / “Add note” (and “Delete” per row).
   - Save writes the current list/blocks to the API (PUT). Optional “Revert” to reload from server.

3. **File format:** Keep the same as now (and as notion-sync expects):
   - `sticky-ideas.md`: `# ...\n\n- idea1\n- idea2\n`
   - `tensions.md`: `# ...\n\nMax 5 entries.\n\n- tension1\n- tension2\n`
   - `rabbit-hole-notes.md`: `# ...\n\n## 2026-02-06: Topic\n\nbody...\n\n## ...`

Then:
- **Notion users:** Keep using Notion + sync (push/pull); control box and Notion both edit the same files (with cron/sync).
- **Non-Notion users:** Use only the control box to edit the same learning repo; same impact on Piko.

So: **Yes, it’s possible to mimic Notion’s UI and functionality in the control box** in the sense of: same three “databases,” row-based add/edit/delete (and optionally reorder), and persistence to the same `data/learning/` files. We do **not** need a block-based editor or slash UI to achieve that.

---

## 4. What we’re not doing (by default)

- **Full block editor:** Slash commands, arbitrary block types, drag-and-drop blocks inside a page. Overkill for three fixed “databases” with simple row shapes.
- **Rich text:** Notion’s bold/italic/links inside a cell. We can keep plain text (or a single markdown textarea per row) to avoid a rich-text dependency.
- **Multiple views:** Notion’s table vs board vs list. A single table-like view per “database” is enough for v1.

If we ever want “true” blocks inside one big page, we could add a fourth section “Free-form notes” backed by one more file and a simple block parser (e.g. one block per `##` or per `- `); that’s an extension, not required for parity with the current three Notion DBs.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| Can we mimic Notion’s *functionality* (edit learning repo via “databases” and rows) in the control box? | **Yes.** |
| Can we mimic Notion’s *look and feel* roughly (table of rows, add/edit/delete, optional reorder)? | **Yes.** |
| Do we need a full Notion-style block editor or slash commands? | **No.** |
| What’s needed? | Learning API (GET/PUT by resource) + **control-learning.html** with three database-style sections and row-level add/edit/delete (and optional reorder). Same file formats as notion-sync so both paths stay in sync. |

Result: Notion becomes **one** way to impact Piko; the control box becomes **another** way to edit the same learning repo, for those who don’t use Notion.
