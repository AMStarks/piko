# How to tune Piko in chat

Short guide to making Piko sound more natural, more concise, or more focused. **Restart the server** after editing prompts so the new text is loaded.

---

## 1. Control panel — Prompts (main lever)

Open **Control → Prompts** in the browser: `http://<your-server>:3000/control-prompts` (or from the main control dashboard).

| File | What it controls |
|------|------------------|
| **IDENTITY.md** | Who Piko is: tone (concise, matter-of-fact), scope (coding, conversation), name, how to handle greetings. Edit here to soften or tighten the persona. |
| **SOUL.md** | Behaviour: strict rule (respond only to message content), no meta-commentary, natural conversation rules, greeting length, no role recital. **Use this to fix “bot-like” or meta replies.** |
| **INTERESTS.md** | Topics Piko uses for follow-ups (“what’s up?”, suggestions). Bullets or short paragraphs; keep short. |
| **MEMORY.md** | Durable facts and preferences (user preferences, values, technical context). Affects what Piko “knows” long-term. |

**Workflow:** Open the file → edit in the textarea → Save. Then **restart the webchat process** (e.g. `systemctl restart piko-webchat.service` on Optimus) so `loadSystemPrompt()` picks up the new content.

---

## 2. Control panel — Mind

**Control → Mind** (`/control-mind`): primary human, goals, tensions, self-model.

- **Primary human:** Name or identifier used in corpus and prompts. Set here or via env `PIKO_PRIMARY_HUMAN`.
- **Goals / tensions:** Feed into the planner (follow-up questions, challenge level). Editing these changes how proactive or challenging Piko is, not the raw wording of replies.

For **chat tone and wording**, Prompts (above) matter more than Mind.

---

## 3. Environment variables that affect chat

Set these in `.env` on the server (or in the systemd override for `piko-webchat.service`). Restart after changing.

| Env | Effect | Default |
|-----|--------|--------|
| **OLLAMA_MODEL** | Model used for chat (e.g. `llama3.1:latest`, `mistral:latest`). | `llama3.1:latest` |
| **PIKO_LEARNING_CHAT_INJECT** | Inject recent learning / sticky ideas / pending question into system prompt. Set to `0` to disable. | enabled |
| **PIKO_RAG** | Inject RAG chunks from `data/learning/*.md` into the prompt. Set to `0` to disable. | enabled |
| **PIKO_RAG_MAX_CHARS** | Max characters of RAG context. | 1500 |
| **PIKO_CONTROLLED_DIVERGENCE** | Add a line encouraging Piko to sometimes offer a different angle or gentle challenge. Set to `1` to enable. | off |
| **PIKO_DIVERGENCE_PROMPT** | Custom line when divergence is on. Default: *"Occasionally offer a different angle or gently challenge an assumption when it fits; do not simply echo the user."* | (see code) |
| **PIKO_PLANNER_DEBUG** | Log planner output (verbosity, tone, reason) each turn. Set to `1` to debug why replies are long or formal. | off |

Chat **temperature** and **top_p** are fixed in code (`lib/llm.js`: temperature 0.9, top_p 0.92). To change them, edit `lib/llm.js` and redeploy.

---

## 4. Quick fixes for “too bot-like” or “too formal”

1. **SOUL.md** — Ensure the “Natural conversation” block is present: no improvement suggestions, no “(Note: …)”, greetings in one short line, no menu of options, no role recital. Add or tighten those bullets if needed.
2. **IDENTITY.md** — Add or keep: “Sound like a person, not a support bot”; “For greetings, one short line; no intro paragraph, no list of topics.”
3. **Planner** — Short greeting-like messages (e.g. “hi”, “hello”, “checking in”) already get **verbosity low** and **tone warm** so the model is nudged to one short reply. No config change needed.
4. **PIKO_PLANNER_DEBUG=1** — Turn on for a few turns and check logs: if you see `verbosity medium` or `tone analytical` for simple hellos, the greeting detector may not be matching (e.g. different phrasing). Adjust the message or the planner pattern if needed.

---

## 5. Restart after tuning

- **Prompt edits (IDENTITY, SOUL, INTERESTS, MEMORY):** System prompt is loaded once at startup. **Restart required.**
- **Env vars:** **Restart required.**
- **Mind (goals, tensions, primary human):** Loaded when building the prompt each request. No restart needed for Mind-only changes.

On Optimus:

```bash
ssh root@192.168.0.121  # or your Optimus host
systemctl restart piko-webchat.service
```

---

## 6. Redeploy (after code or prompt file changes in the repo)

From your machine, from the repo root:

```bash
./scripts/webchat-deploy/deploy-to-optimus.sh
ssh root@192.168.0.121 "cd /root/webchat-piko && npm install && systemctl restart piko-webchat.service"
```

This syncs `webchat-piko/` (including `prompts/*.md`) to Optimus, installs deps, and restarts the service. Server-side edits to prompts in the control panel are stored on the server only; they are not overwritten by rsync because `data/` is excluded and prompts live under `webchat-piko/prompts/`, which *is* synced. So: **edits made in the Control UI are on the server disk**; the next deploy will overwrite `prompts/` with the repo version. To keep UI edits, copy the changed prompt content back into the repo and commit, or edit only on the server and don’t redeploy prompts from the repo.
