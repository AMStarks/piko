# Piko exploration learning — full phased build and deploy plan

This plan implements the design in `PIKO_LEARNING_EXPLORATION_AND_GROWTH.md` and the final builds (§9). All paths assume `webchat-piko/` as app root (Optimus: `/root/webchat-piko/`).

---

## Overview

| Phase | Deliverables | Cron / trigger | Deploy |
|-------|--------------|----------------|--------|
| **1** | topics.txt, rabbit-hole-daily.js, rabbit-hole-notes.md, chat injection | Daily 09:00 | Scripts + data dir + server.js |
| **2** | Emergent topic (20% from journal); optional journal injection | Same cron, script change | Script + optional poster change |
| **3** | meta-reflection-weekly.js, meta-reflections.md, tensions.md, identity-delta | Weekly Sun 10:00 | Script + cron |
| **4** | sticky-ideas.md, tone tilt, tension tracker | Same weekly script | Script + server.js |
| **Later** | Seasonal pruning, archive | Manual or quarterly cron | Optional script |

---

## Phase 1 — Daily rabbit hole + chat (48 hours to value)

**Goal:** Piko has a daily exploration note and chat references it with epistemic humility.

### 1.1 Create data layout and topics

- [ ] Create directory `webchat-piko/data/learning/`.
- [ ] Create `webchat-piko/data/learning/topics.txt` with one topic per line (e.g. 10 topics):
  - Agent coordination, Moltbook dynamics, Prompt engineering, Emergent behaviour, Systems that shape behaviour, Epistemic humility, Communication patterns, Distributed systems, Autonomy and control, Identity and narrative
- [ ] Add to `.gitignore`: `data/learning/rabbit-hole-notes.md` (so local runs don’t commit notes); optionally keep `topics.txt` in repo.

### 1.2 Script: `rabbit-hole-daily.js`

- [ ] Create `webchat-piko/scripts/rabbit-hole-daily.js`.
- [ ] Dependencies: use existing search (TAVILY or SERPER) and Ollama from env (reuse server’s or poster’s pattern). Require: `topics.txt` exists, search API key if used, Ollama reachable.
- [ ] Logic:
  1. Resolve `data/learning/topics.txt`; read lines, filter empty; `topicIndex = dayOfYear % topics.length`; pick topic.
  2. Call search (topic, limit 3–5); get snippets or fetch 1–2 URLs.
  3. Build prompt: topic + sources → “Write a rabbit-hole note (2–3 short paragraphs). Structure: **What I learned:** … **Why it caught my attention:** … **What it made me question:** … Optionally end with **This connects to:** [previous topic or idea] if something in your recent context fits. Use first person (Piko). Output only the note body.”
  4. Call Ollama; parse response; prepend `## YYYY-MM-DD: Topic\n\n`; append to `data/learning/rabbit-hole-notes.md`. Create file with a short header if missing.
  5. Cap note body at ~800 chars before append.
- [ ] Log to stdout/stderr or `logs/rabbit-hole-daily.log`; exit 0 on success.
- [ ] Ensure script is runnable: `node scripts/rabbit-hole-daily.js` from app root.

### 1.3 Chat injection (server.js)

- [ ] Add helper e.g. `getRecentLearningBlock()`: read `data/learning/rabbit-hole-notes.md`; split by `\n## `; take last 5 blocks; join; truncate to ~2500 chars total.
- [ ] If non-empty, append to system prompt (or pre-prompt context):  
  `Recent learning (from daily exploration; use with epistemic humility—e.g. "I've been looking into…", not "I understand…"):\n${recentLearning}`.
- [ ] Ensure only this file is read; no writes from chat path. Guard: if file missing or empty, skip block.

### 1.4 Cron (Optimus)

- [ ] On Optimus, add cron: `0 9 * * * cd /root/webchat-piko && node scripts/rabbit-hole-daily.js >> logs/rabbit-hole-daily.log 2>&1` (or source `.env` if script needs TAVILY/SERPER keys).
- [ ] Create `data/learning/` on Optimus if not present; ensure `topics.txt` is deployed or copied.

### 1.5 Deploy Phase 1

- [ ] Deploy `webchat-piko/` to Optimus (rsync excludes `data/` so `data/learning/` may be empty on server—create it and copy `topics.txt` manually or add a deploy step that ensures `data/learning/topics.txt` exists).
- [ ] Restart piko-webchat.service after server.js change.
- [ ] Run `rabbit-hole-daily.js` once manually; verify `rabbit-hole-notes.md` created and has one `## date: topic` block.
- [ ] Test chat: ask Piko about the day’s topic; confirm it references “looking into” or “recently came across” style.

### Phase 1 acceptance

- Daily cron runs; one new note per day in `rabbit-hole-notes.md`.
- Chat includes recent learning block when file exists; tone stays humble.
- No changes to aim, refinements, identity, soul.

---

## Phase 2 — Emergent topics + optional journal (Week 2)

**Goal:** 20% of days pick topic from recent journal themes; optionally journal prompt can see “This week you explored: …”.

### 2.1 Emergent topic selection

- [ ] In `rabbit-hole-daily.js`: if `Math.random() < 0.2` (or day-of-week-based for determinism), try to derive topic from journal. Read last ~2k chars of `data/moltbook-journal.md`; LLM or simple keyword extract: “Suggest one exploration topic (2–4 words) that fits the themes in this journal text. Reply with only that topic.” If result is empty or invalid, fall back to topics.txt round-robin.
- [ ] Log whether topic was from list or journal.

### 2.2 Optional journal injection

- [ ] In poster’s `writeJournalEntry()` (or journal prompt builder): if `data/learning/rabbit-hole-notes.md` exists, read last 2–3 topic headers (e.g. last 2 blocks); add line: “This week you explored: [topic1], [topic2]. You may refer to that if it helps reflection.” Optional: behind env flag e.g. `PIKO_LEARNING_JOURNAL_INJECT=1`.

### 2.3 Deploy Phase 2

- [ ] Deploy updated script and optional poster change; no new cron. Re-test one run with journal-based topic if possible.

### Phase 2 acceptance

- Some runs use journal-derived topic; others use topics.txt.
- If enabled, journal prompt includes “This week you explored” line.

---

## Phase 3 — Meta-reflection + tensions + identity-delta (Week 3)

**Goal:** Weekly reflection over notes + journal; write meta-reflections; update tensions; produce read-only identity-delta hints.

### 3.1 Script: `meta-reflection-weekly.js`

- [ ] Create `webchat-piko/scripts/meta-reflection-weekly.js`.
- [ ] Inputs: last 14 days of `rabbit-hole-notes.md` (or last N blocks); last ~3k chars of `moltbook-journal.md`.
- [ ] Prompt 1 (meta-reflection): “You are Piko. Below are your recent rabbit-hole notes and journal entries. Write a short reflection (2–4 paragraphs) on: emerging themes, what you’re drawn to, any tensions or contradictions you notice. Do not propose changes to aim or refinements. Do not optimize. Just notice. If there are 1–2 tensions or emphases that might be worth considering if identity were ever revisited, add a short section: **If identity were revisited:** [themes only, no concrete wording].”
- [ ] Append to `data/learning/meta-reflections.md` with date header.
- [ ] Prompt 2 (tensions): “Based on the reflection above, list up to 3 unresolved tensions (questions or statements of friction). Max 3–5 total in the file; add new only if under limit.” Read existing `data/learning/tensions.md`; append or replace to keep max 5 entries; format clearly.
- [ ] Write tensions to `data/learning/tensions.md`. Create file if missing.
- [ ] Never write to AIM, REFINEMENTS, IDENTITY, SOUL.

### 3.2 Cron

- [ ] On Optimus: `0 10 * * 0 cd /root/webchat-piko && node scripts/meta-reflection-weekly.js >> logs/meta-reflection-weekly.log 2>&1` (Sunday 10:00).

### 3.3 Deploy Phase 3

- [ ] Deploy script; add cron. Run once manually; verify `meta-reflections.md` and `tensions.md` created/updated.

### Phase 3 acceptance

- Weekly run produces one meta-reflection and updated tensions (if any).
- Identity-delta section appears only in meta-reflection text; no writes to identity files.

---

## Phase 4 — Sticky ideas + tone tilt + tension tracker (Week 4)

**Goal:** Sticky ideas updated from meta-reflection; chat tone gently tilted; meta-reflection can record tensions between sticky ideas.

### 4.1 Sticky ideas in meta-reflection script

- [x] In `meta-reflection-weekly.js`, after writing meta-reflection: read `data/learning/sticky-ideas.md` (max 10 items). Prompt: “Given the reflection above and the current sticky ideas below, update sticky ideas: add at most one new idea, merge or remove if over 10. Each entry one short paragraph. Output the full updated list in a simple format (e.g. numbered).” Parse and write back to `sticky-ideas.md`. If file missing, create with 0–2 initial items from reflection.
- [x] When meta-reflection detects contradiction between two sticky ideas, ensure it adds or updates an entry in `tensions.md` (tensions prompt now says “Tensions can be between two sticky ideas”).

### 4.2 Tone tilt in chat (server.js)

- [x] If `data/learning/sticky-ideas.md` exists and is non-empty, append one line to system prompt: “When responding, let your tone be gently influenced by the themes you keep returning to (in sticky ideas), without stating them explicitly.”
- [x] Optional: include last 2–3 sticky idea paragraphs in context (“Themes you keep returning to: …”); cap at 800 chars (`getStickyIdeasBlock()`).

### 4.3 Deploy Phase 4

- [ ] Deploy updated meta-reflection script and server.js; restart service. Run meta-reflection once; verify sticky-ideas.md; test chat for tone.

### Phase 4 acceptance

- Sticky ideas update weekly; max 10 items.
- Chat prompt includes tone-tilt line and optionally sticky-ideas snippet.
- Tensions can reference sticky-idea vs sticky-idea.

---

## Deploy summary (Optimus)

| Step | Action |
|------|--------|
| 1 | From repo: `./scripts/webchat-deploy/deploy-to-optimus.sh` (syncs webchat-piko). |
| 2 | Ensure `data/learning/` exists on Optimus: `ssh … "mkdir -p /root/webchat-piko/data/learning"`. |
| 3 | Ensure `topics.txt` on server: copy from repo or create on server (rsync excludes data/ so may need manual copy once). |
| 4 | Cron: add rabbit-hole daily + meta-reflection weekly (see above). |
| 5 | Restart: `systemctl restart piko-webchat.service` after any server.js change. |
| 6 | Env: if rabbit-hole or meta-reflection need TAVILY/SERPER/Ollama, ensure .env or systemd env has them (same as chat/poster). |

---

## Rollback and safety

- **Disable exploration:** Remove or comment cron entries; remove chat injection (or guard with env `PIKO_LEARNING_CHAT_INJECT=0`). Learning files remain but are unused.
- **No writes outside data/learning:** All new scripts write only under `data/learning/`. No modification of prompts/, identity, aim, refinements from these scripts.
- **Backup:** `data/learning/` can be backed up or archived like other data dirs.

---

## Later — Seasonal pruning, archive

- [ ] **Seasonal pruning:** Once per quarter (or when notes file is large): archive old rabbit-hole notes to e.g. `data/learning/archive/rabbit-hole-notes-YYYY-Qn.md`; keep last ~90 days in main file.
- [ ] **Archive reflection:** Optionally run meta-reflection on summaries only; ask “What still feels alive?” (forgetting as compression, not loss). See §9.7 in `PIKO_LEARNING_EXPLORATION_AND_GROWTH.md`.
- [ ] Implement when notes file size or age warrants it; document in exploration doc.

---

## Reference: doc and invariants

- **Design:** `docs/PIKO_LEARNING_EXPLORATION_AND_GROWTH.md`
- **Invariants:** Exploration and meta-reflection never modify AIM, REFINEMENTS, IDENTITY, SOUL. All new state is under `data/learning/`. You remain the only strategic authority.