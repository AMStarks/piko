# Piko Mind — Single learning pipeline

The mind is the canonical state for **beliefs**, **goals**, **tensions**, **relationship**, and **self_model**. All learning flows through **update_mind(observation)** so that loyalty and worldview are applied in one place.

**Worldview corpus (main text):** The main “who is Piko” and worldview text comes from the **prompts** corpus: **IDENTITY.md**, **SOUL.md**, **MEMORY.md**, **INTERESTS.md** in `prompts/`. These are concatenated into the chat system prompt at startup. Edit them in **Control → Prompts** (`/control-prompts`) or directly in the repo. The **Mind** page (values, constraints, beliefs) is the structured layer used by the mind-update pipeline; the prompts corpus is the document layer that shapes how Piko speaks and what it treats as enduring context.

## Layout (`data/mind/`)

| File | Purpose |
|------|--------|
| `self_model.json` | Identity (name, primary_human, loyalty_invariants), capabilities, values, constraints. Rarely edited; primary_human can be set via `PIKO_PRIMARY_HUMAN`. |
| `beliefs.json` | List of beliefs: `{ id, text, evidence, confidence, source, last_touched }`. |
| `goals.json` | List of goals: `{ id, text, status, subgoals, last_touched }`. |
| `tensions.json` | List of tensions: `{ id, a, b, examples, last_touched }`. |
| `relationship.json` | Milestones and quality_metrics (companion_since, advice_followed, etc.). |

## Where to edit

- **Primary human** — In the **iOS app**: Settings → **Companion** → “Primary human”. (Fetched from and saved to the server.) Or in the **web control panel**: open **Mind** (`/control-mind`) and set “Primary human” there.
- **Values and constraints (worldview)** — In the **web control panel**: open **Mind** (`/control-mind`). Edit “Values” and “Constraints” (one per line), then click **Save mind**.
- **Beliefs** — Same **Mind** page: view, add, edit, or delete beliefs in the table; **Save mind** persists them.

## API

- **GET /api/mind** — Returns `{ primary_human, values, constraints, beliefs, goals, tensions }`.
- **POST /api/mind/primary-human** — Body `{ "primary_human": "Name" }`. Updates only primary human.
- **PUT /api/mind** — Body can include `primary_human`, `values`, `constraints`, `beliefs`. Updates only provided fields.

## Env

- **PIKO_PRIMARY_HUMAN** (or PIKO_PRIMARY_USER) — Fills `identity.primary_human` when loading self_model if empty. Overridden by app or control panel once set.
- **PIKO_MIND_DIR** — Override mind directory (default `data/mind`).
- **PIKO_MIND_DISABLED** — Set to `1` or `true` to disable mind updates (no-op).

## Flows that call update_mind

- **Post-chat** — After each assistant reply, the last exchange (user + assistant message) is passed to `updateMind()` in the background. No blocking of the response.
- **Bootstrap** — `node scripts/bootstrap-mind-from-learning.js` reads `data/learning/*.md` (tensions, sticky-ideas, rabbit-hole-notes) and pushes them as one observation so the mind can absorb existing content.

## Adding more call sites

Any script or handler that learns something should call:

```js
const { updateMind } = require('./lib/mind');
await updateMind(observation);  // observation = string or array of { role, content }
```

Examples: end of daily-briefing, after Moltbook feedback, after weekly meta-reflection. All updates go through the same classify-and-apply pipeline with loyalty and values in context.

## Option A migration

- **New** learning (e.g. chat) writes only via `updateMind()`.
- **Existing** markdown in `data/learning/` stays as-is; run the bootstrap script once (or periodically) to sync it into the mind. Over time you can migrate scripts to call `updateMind` instead of writing markdown directly; then markdown can become a view or legacy.
