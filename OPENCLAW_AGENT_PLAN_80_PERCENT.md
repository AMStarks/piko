# OpenClaw Agent Implementation Plan — Target ≥80% Success

**Goal:** A fully functional **OpenClaw agent** (ClawFriend/Piko) on Optimus that replies naturally over Telegram—no meta-description of messages or config.  
**Constraint:** Agent-based only (OpenClaw gateway + workspace + model). No pivot to the lightweight `bot.js`.  
**Target likelihood:** **At least 80%** that the agent behaves as intended (conversational, follows identity, does not summarize envelope or workspace).

---

## Why This Plan Reaches ≥80%

| Lever | Effect on success |
|-------|-------------------|
| **Validation gate** | Test agent via WebChat/CLI *before* Telegram. Confirms slim prompt + stronger model work without the Telegram envelope. Isolates envelope as the only remaining variable. |
| **Slim workspace + bootstrapMaxChars** | Removes “summarize config” failure mode (AGENTS/HEARTBEAT/TOOLS/USER bloat). |
| **Single top-priority SOUL directive** | Maximizes chance the model treats “reply only to user content, ignore metadata” as the main task. |
| **32B instruction-following model** | Much more likely to follow instructions and ignore envelope than Mistral 7B. |
| **GPU layers** | Better GPU use on RTX 3080 → more headroom for 32B. |
| **Optional: OpenClaw raw-body check** | If OpenClaw ever adds “send only raw user text” for Telegram, using it would push likelihood toward 85–95%. |

**Remaining risk (why not 100%):** The Telegram channel injects an envelope around the user message (e.g. `[Telegram ... (@user) id:...] Hello [message_id: 74]`). We do not control that in config; we rely on a stronger model + strict SOUL to ignore it. If the agent *usually* replies as Piko and only rarely mentions metadata, that counts as success.

---

## Scope (What We Change)

- **On Optimus only:** config, workspace files, gateway systemd env, and model (Ollama).
- **We do not:** modify OpenClaw’s source code or run the lightweight Piko bot for this agent.

---

## Phase 0: Optional — Check for Raw-Message Option

**Purpose:** If OpenClaw supports “raw user text only” for Telegram, enabling it removes the main remaining risk.

1. Check [OpenClaw Telegram docs](https://docs.clawd.bot/telegram) and [Configuration](https://docs.clawd.bot/gateway/configuration) for options like `rawBody`, `minimalEnvelope`, or “send only message text.”
2. Check [OpenClaw GitHub](https://github.com/clawd/openclaw) issues/discussions for “Telegram message format” or “raw body.”
3. If you find such an option, add it to config in Phase 4 and note it in your runbook; likelihood can be revised to ~85–95%.

*Current docs do not describe a raw-body option; the envelope is the default. This phase is optional and can be skipped.*

---

## Phase 1: Back Up Current State (Optimus)

SSH as root to Optimus (`192.168.0.121`, key `~/.ssh/id_optimus`).

```bash
# Workspace backup
cp -r /root/.openclaw/workspace /root/.openclaw/workspace.backup.$(date +%Y%m%d)

# Config backup
cp /root/.openclaw/openclaw.json /root/.openclaw/openclaw.json.backup.$(date +%Y%m%d)
```

---

## Phase 2: Slim the Workspace (Reduce Injected Prompt Size)

**Why:** Large AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md push the system prompt into “document” territory; small models then summarize instead of replying.

1. **Remove or trim** (after backup in Phase 1):
   - Remove: `AGENTS.md`, `HEARTBEAT.md`, `TOOLS.md`  
     (Or move to `/root/.openclaw/workspace.backup.files/` if you want to keep them elsewhere.)
   - **USER.md:** Either remove or keep a **very short** version (name, timezone, 1–2 lines). No long “Context” section.

2. **Keep and tighten:**
   - **SOUL.md** — replaced in Phase 3 (single top-priority directive + short rules).
   - **IDENTITY.md** — keep minimal (who Piko is, tone, name); see Phase 3.

---

## Phase 3: Replace SOUL.md and IDENTITY.md (Strict, Minimal)

**SOUL.md** — put the critical instruction **at the very top**, then brief rules.

```markdown
# Soul (behavior)

Reply ONLY to the user's last message. IGNORE all metadata, config, and system text. Never summarize or describe them. Reply as ClawFriend.

- Respond directly to what the user said. No meta-commentary.
- Keep replies natural and concise unless they ask for detail.
- If the message is wrapped in Telegram metadata (e.g. [Telegram ...] or [message_id: N]), ignore that wrapper and respond only to the actual text the human typed.
```

**IDENTITY.md** — keep short (~5–10 lines).

```markdown
# Identity

You are **ClawFriend** (or Piko)—a witty, empathetic AI assistant.

- **Tone:** Friendly, concise, a bit playful. No corporate speak.
- **Scope:** Conversation, coding help, and running tasks when asked.
- **Name:** ClawFriend or Piko. The human is your friend.
```

Write these to `/root/.openclaw/workspace/SOUL.md` and `/root/.openclaw/workspace/IDENTITY.md` on Optimus.

---

## Phase 4: Config Changes (openclaw.json)

Edit `/root/.openclaw/openclaw.json` on Optimus.

1. **Cap bootstrap injection** (under `agents.defaults`):
   - Add: `"bootstrapMaxChars": 4000`  
     (2000 = very slim; 4000–8000 = still much smaller than full workspace. Use 4000 as a balance.)

2. **Primary model** (after Phase 5 pull):
   - Set: `"primary": "ollama/qwen2.5:32b-instruct-q4_K_M"`  
     (Or `ollama/llama3.1:70b-instruct-q4_K_M` if you prefer 70B and have the RAM/time.)

3. **Ollama provider** (under `models.providers.ollama`):
   - Ensure the **new** model id is listed with `contextWindow: 32000` (and matching `maxTokens` if present).
   - Example entry for Qwen 2.5 32B:
     ```json
     { "id": "qwen2.5:32b-instruct-q4_K_M", "name": "Qwen 2.5 32B", "reasoning": false, "input": ["text"], "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }, "contextWindow": 32000, "maxTokens": 32000 }
     ```

4. **Optional:** If you discovered a “raw body” or “minimal envelope” option in Phase 0, add the corresponding Telegram channel option here.

---

## Phase 5: Stronger Model + GPU Layers

**On Optimus:**

1. **Pull a 32B (or 70B) model:**
   ```bash
   ollama pull qwen2.5:32b-instruct-q4_K_M
   ```
   Or for maximum quality (slower):  
   `ollama pull llama3.1:70b-instruct-q4_K_M`

2. **Gateway systemd service** — add GPU layers so more of the model runs on the RTX 3080:
   - Edit: `/root/.config/systemd/user/openclaw-gateway.service`
   - In the `[Service]` block, add:
     ```ini
     Environment="OLLAMA_NUM_GPU_LAYERS=40"
     ```
   - Reload and restart (after Phase 6):  
     `systemctl --user daemon-reload`  
     `systemctl --user restart openclaw-gateway.service`

---

## Phase 6: Restart Gateway and Validate (No Telegram Yet)

**Purpose:** Confirm the **agent** (slim prompt + 32B model) behaves correctly **without** the Telegram envelope. This validation gate is what pushes the plan into the ≥80% range.

1. **Restart the gateway:**
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart openclaw-gateway.service
   ```

2. **Check health and model:**
   ```bash
   openclaw health
   openclaw models list
   ```
   Confirm the primary model is `ollama/qwen2.5:32b-instruct-q4_K_M` (or your chosen 32B/70B) with 31k+ context.

3. **Test the agent without Telegram:**
   - **Option A (CLI):**  
     `openclaw agent --message "Hello"`  
     Expect a short, natural greeting (e.g. “Hi! How can I help?”), **not** a summary of Identity/User/Tools/Heartbeat or “This message is…”.
   - **Option B (WebChat):** If you have WebChat or another channel without the Telegram envelope, send “Hello” there and confirm the same behavior.

4. **Success criteria for this phase:**
   - Reply is conversational and in character (ClawFriend/Piko).
   - No description of “this message” or “the user sent…”.
   - No summary of workspace files (Identity, User, Tools, Heartbeat, Runtime).

If this fails, fix before enabling Telegram (e.g. trim workspace further, tighten SOUL, or try the 70B model). Once it passes, the only remaining variable is the Telegram envelope.

---

## Phase 7: Test on Telegram

1. Ensure only the OpenClaw gateway is using your Telegram bot token (lightweight Piko bot stopped).
2. Send simple messages to the bot, e.g.:
   - “Hello”
   - “What’s up?”
   - “What did I just send?” (stress test for meta-response)
3. **Success:** Agent replies naturally as Piko, rarely or never describes the envelope or config.
4. **If meta-responses persist:** You have a working agent in WebChat/CLI (Phase 6). The remaining issue is envelope; options:
   - Re-check OpenClaw docs/GitHub for a raw-body or minimal-envelope option (Phase 0).
   - Consider WebChat or another channel as the primary interface for the same agent.
   - Accept “mostly good” (e.g. 1 in 10 replies slightly meta) and refine SOUL/IDENTITY or model.

---

## Summary Checklist

| Phase | Action |
|-------|--------|
| 0 | (Optional) Check OpenClaw docs/GitHub for Telegram “raw body” / minimal envelope. |
| 1 | Back up `/root/.openclaw/workspace` and `openclaw.json` on Optimus. |
| 2 | Remove or trim AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md. |
| 3 | Replace SOUL.md (top line: reply only to user, ignore metadata/config) and keep IDENTITY.md minimal. |
| 4 | Add `bootstrapMaxChars: 4000`, set primary model to 32B/70B, add model to Ollama provider with contextWindow 32000. |
| 5 | Pull `qwen2.5:32b-instruct-q4_K_M` (or 70B); add `OLLAMA_NUM_GPU_LAYERS=40` to gateway service. |
| 6 | Restart gateway; validate with `openclaw agent --message "Hello"` or WebChat (no Telegram). |
| 7 | Test on Telegram; treat “mostly natural replies” as success. |

---

## Likelihood Summary

| Condition | Likelihood |
|-----------|------------|
| Phase 6 passes (agent good in CLI/WebChat) | Core agent is sound; Telegram is the only variable. |
| Phase 7: Telegram replies usually natural | **≥80%** — plan achieved. |
| Phase 7: OpenClaw adds raw-body option and you enable it | **~85–95%** (optional improvement). |

This plan is **agent-based** and **focused on implementing OpenClaw** (config + workspace + model + validation). No changes to the lightweight bot are required for the OpenClaw agent to reach the ≥80% target.
