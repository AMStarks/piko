# Phased plan: Control Box → Notion-like UI

Get the Piko Control Box to a similar UI and interaction model to Notion, in incremental phases. Each phase ships something usable; later phases build on the same patterns.

**Reference:** [CONTROL_BOX_NOTION_STYLE_INVESTIGATION.md](./CONTROL_BOX_NOTION_STYLE_INVESTIGATION.md) for feasibility and data-model alignment.

---

## Overview

| Phase | Focus | Outcome |
|-------|--------|--------|
| **1** | Learning repo as “databases” | API + control-learning.html: three database-style views (sticky ideas, tensions, rabbit-hole), add/edit/delete rows. |
| **2** | Notion-like shell | Shared layout: sidebar nav + content area; consistent styling across all control pages. |
| **3** | Database pattern everywhere | Prompts, Intents, Moltbook (and any future lists) use the same table/row pattern; optional drag-to-reorder. |
| **4** | Polish & optional block feel | Inline edit, “open row as page” (modal/slide-over), optional block-style editor for one full-page doc. |

---

## Phase 1 — Learning repo as “databases”

**Goal:** Anyone can edit Piko’s learning repo (sticky ideas, tensions, rabbit-hole notes) from the control box, with a Notion-like “database = table of rows” experience. No Notion account required.

**Deliverables:**

1. **Backend: Learning API**
   - `GET /api/control/learning` → `{ databases: [ { id, name, description } ] }` (sticky-ideas, tensions, rabbit-hole).
   - `GET /api/control/learning/:id` → structured content:
     - `sticky-ideas` / `tensions`: `{ items: string[] }`
     - `rabbit-hole`: `{ blocks: [{ title, content }] }`
   - `PUT /api/control/learning/:id` → body same shape; write to `data/learning/*.md` using existing format (bullets, `## Date: Title` + body) so notion-sync stays compatible.
   - Reuse the same parsing/writing logic as `scripts/notion-sync.js` (or small shared helpers) so file format is single source of truth.

2. **Frontend: control-learning.html**
   - Entry: link from main control dashboard (“Learning repo” or “Sticky ideas & tensions”).
   - **Navigation:** Tabs or left sub-nav: Sticky ideas | Tensions | Rabbit-hole notes.
   - **Per “database”:**
     - Table-like view: one row per item (sticky/tension) or per block (rabbit-hole with Title + Content columns).
     - Row actions: Edit (inline or modal), Delete.
     - “New sticky” / “New tension” / “New note” button.
   - Edit: modal or slide-over with text input (and for rabbit-hole: title + textarea for content). Save updates in-memory then PUT to API; on success refresh list.
   - No drag reorder in Phase 1 (can add in Phase 3).

3. **Server route**
   - Serve `control-learning.html` at `/control-learning` (same pattern as `/control-prompts`).

**Acceptance:** User can open Control → Learning, switch between the three “databases,” add/edit/delete items, and see changes persist; files remain compatible with notion-sync.

**Rough effort:** Backend 1–2 hrs, frontend 2–3 hrs.

---

## Phase 2 — Notion-like shell

**Goal:** The whole control box feels like one app with a consistent Notion-like layout: sidebar for navigation, main content area, shared typography and spacing.

**Deliverables:**

1. **Shared layout**
   - **Sidebar (left):** Collapsible on narrow viewports. Links:
     - Dashboard (current control.html)
     - Prompts
     - Learning (new)
     - Moltbook
     - (Optional later: Intents, Settings)
   - **Main area:** Content for the selected section. No full-page reload if we keep it simple (each link = new page load to existing HTML pages); or a single-page shell that loads fragments (optional).
   - Use the same CSS variables and card/table styles across control.html, control-prompts.html, control-learning.html, control-moltbook.html so the shell looks consistent.

2. **Layout implementation options**
   - **A (simplest):** Each control page (control.html, control-prompts.html, etc.) includes the same sidebar markup + styles (e.g. from a shared snippet or small inline template). No build step.
   - **B:** One “shell” page (e.g. control.html) that is the single entry; “Prompts”, “Learning”, “Moltbook” load in an iframe or fetch + innerHTML into the main area. More app-like, slightly more JS.
   - **Recommendation:** Start with **A** (shared sidebar on each page) for speed and clarity; move to B only if we want no full reloads.

3. **Visual tweaks**
   - Sidebar: subtle background, active state for current section.
   - Main: max-width for readability, consistent padding.
   - Cards/tables: same border-radius, spacing, and hover states as in the investigation doc (table-like rows, clear “row” affordance).

**Acceptance:** From any control page, user sees the same sidebar and can jump to Dashboard, Prompts, Learning, Moltbook; all pages share the same look and feel.

**Rough effort:** 2–3 hrs for shared sidebar + styles (option A).

---

## Phase 3 — Database pattern everywhere

**Goal:** Every list-like surface in the control box uses the same “database/table” pattern: rows, add/edit/delete (where applicable), consistent table styling. Optional drag-to-reorder for learning (and optionally prompts order).

**Deliverables:**

1. **Prompts as a database**
   - Prompts list becomes a table: columns e.g. File, Description, Last modified (if we track it), Actions (Open, or inline “Edit”).
   - “Open” can still go to a full-page editor (current control-prompts flow) or evolve to “open row as page” (modal/slide-over) in Phase 4.
   - Styling matches Learning tables (same header row, row hover, button style).

2. **Intents as a table**
   - If we already expose intents (or add an Intents view): table columns e.g. Type (reminder/scheduled/queue), Due/At, Summary/Command, Actions (e.g. Cancel). Read-only or with cancel/delete.
   - Same card/table styling as Learning and Prompts.

3. **Moltbook posts**
   - Already a list; restyle as a table: e.g. Title, Date, Actions (Prune/checkbox). Keeps current prune behavior.

4. **Drag-to-reorder (optional)**
   - Learning: drag handle on each row; on drop, reorder array and PUT to API.
   - Can use native HTML5 drag-and-drop or a small library; keep it simple.
   - Tensions: respect “max 5” in UI (e.g. disable “New tension” when length ≥ 5).

**Acceptance:** Prompts, Learning, Intents (if present), Moltbook all use the same table/row visual language and interaction patterns where applicable; learning rows can be reordered if we implement drag.

**Rough effort:** 2–4 hrs depending on Intents exposure and drag-and-drop.

---

## Phase 4 — Polish and optional block feel

**Goal:** Refine the experience to feel closer to Notion: inline edit where it fits, “open row as page” for long content, optional block-style editing for one full-page document.

**Deliverables:**

1. **Inline edit**
   - In Learning (and optionally Prompts table): click a cell to edit in place; blur or Enter saves that row/cell. Reduces clicks for short edits.

2. **Open row as page**
   - For rabbit-hole (and optionally a long prompt): “Open” opens a slide-over or modal with title + full body (textarea or simple markdown). Save/Cancel. Keeps the main view as a table while allowing long-form edit.

3. **Optional: block-style editor for one doc**
   - One designated “full-page” doc (e.g. Journal or MEMORY) edited as a sequence of “blocks”: each paragraph or list item is a block; “Add block” inserts below; optional block type (paragraph, heading, bullet). No slash command required; can be a simple split (one block per line or per `\n\n`). Lower priority; only if we want a clear “Notion block” feel for at least one page.

4. **Visual polish**
   - Empty states (“No sticky ideas yet — add one”), loading states, save confirmation (e.g. toast or brief “Saved”).
   - Accessibility: focus order, labels, keyboard (Enter to save, Escape to cancel in modals).

**Acceptance:** Inline edit works for at least Learning; long content can be edited in a dedicated panel; UI feels responsive and consistent.

**Rough effort:** 2–4 hrs for inline + “open as page”; block editor extra if desired.

---

## Dependency order

- **Phase 1** must be done first (learning API + control-learning.html).
- **Phase 2** can be done right after Phase 1, or in parallel if different people touch backend vs frontend (Phase 2 is frontend-only for the shell).
- **Phase 3** builds on Phase 2’s shared layout and Phase 1’s table pattern; apply the pattern to Prompts, Intents, Moltbook.
- **Phase 4** builds on Phase 3’s tables and Phase 1’s learning UI; adds inline edit and “open as page.”

---

## Out of scope (for this plan)

- Full WYSIWYG or rich-text editor.
- Slash commands (`/`) for block types.
- Multiple database views (board, calendar) per dataset.
- Real-time collaboration or presence.
- Notion API sync from the control box (sync remains script + cron; control box and Notion both edit the same files via their own paths).

---

## Summary

| Phase | What ships |
|-------|------------|
| **1** | Learning repo editable in Control Box via three “databases” (sticky, tensions, rabbit-hole) with add/edit/delete. |
| **2** | Shared Notion-like shell: sidebar nav + content area, consistent styling across control pages. |
| **3** | Prompts, Intents, Moltbook use the same table/row pattern; optional drag-to-reorder for learning. |
| **4** | Inline edit, “open row as page” for long content, optional block-style editor for one doc, polish. |

This gets the Control Box to a similar UI and interaction model to Notion without building a full block engine or rich-text stack.
