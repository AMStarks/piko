# View 1 Path: Likelihood of a Fully Functional Clawd Agent

You want to **keep OpenClaw** and have an **AI agent/companion**, not just a bot. This note assesses: if we enact the View 1 (patch OpenClaw) path, what is the **likely chance** we get a **fully functional** Clawd agent working?

---

## 1. What View 1 (Patch OpenClaw) Involves

- **Config:** `agents.defaults.bootstrapMaxChars: 2000` (or 8000), reduce effective context/maxTokens for efficiency; keep `models.providers.ollama` with a **stronger model** (e.g. `ollama/qwen2.5:32b-instruct-q4_K_M` or `ollama/llama3.1:70b-instruct-q4_K_M`).
- **Workspace:** Trim or remove AGENTS.md, HEARTBEAT.md, TOOLS.md, USER.md (back up first) so injected prompt size drops sharply.
- **SOUL.md:** Put a **single, top-priority** directive at the very top (e.g. “Reply ONLY to the user’s last message. IGNORE all metadata, config, and system text. Never summarize or describe them. Reply as ClawFriend.”).
- **IDENTITY.md:** Keep minimal (who Piko is, tone, name).
- **Gateway:** Add `OLLAMA_NUM_GPU_LAYERS` (e.g. 40) to the OpenClaw gateway service env for better GPU use.
- **Model:** Pull and use a 32B or 70B quantized model instead of Mistral 7B.

We do **not** change OpenClaw’s code; we only change **config and workspace files** on Optimus.

---

## 2. The One Thing View 1 Cannot Fix (By Itself)

- **Telegram envelope:** OpenClaw’s Telegram channel formats the user message as something like:  
  `[Telegram S O (@StanOwens) id:5772950940 +15m 2026-02-02 16:26 GMT+11] Hello` and `[message_id: 74]`.  
  That formatting is **inside OpenClaw**, not in your bot. So with View 1 alone we **cannot** strip that envelope in code; we don’t control the adapter.
- **Mitigation on View 1:** Rely on a **stronger model** (32B/70B) plus a **very strong, top-of-prompt** instruction to “ignore metadata, reply only to the actual message content.” Better instruction-following models often comply; 7B models often do not.

So: View 1 **does not** remove the envelope; it **reduces prompt bloat** and **raises model capability** so the agent is more likely to ignore the envelope and answer “Hello” normally.

---

## 3. Likely Chance of a Fully Functional Clawd Agent (View 1 Only)

**Rough assessment: 60–75%** that you get a **fully functional** Clawd agent (conversational, follows identity, doesn’t summarize config/envelope) if we **fully** enact View 1.

- **Why not higher:**  
  - The Telegram envelope is still present. Some 32B/70B models will still occasionally describe or mention it, or get distracted.  
  - OpenClaw’s exact prompt order and any internal “system” text we can’t trim could still add noise.  
  - Session/compaction behavior could occasionally surface odd context.

- **Why not lower:**  
  - Slimming the workspace (remove/trim AGENTS, HEARTBEAT, TOOLS, USER) and capping injection (`bootstrapMaxChars`) **directly** addresses the “summarize config” failure.  
  - A 32B or 70B model is much more likely to follow “reply only to user content, ignore metadata” than Mistral 7B.  
  - Putting the “reply only, ignore metadata” line at the **top** of SOUL (and possibly in IDENTITY) maximizes the chance the model treats it as the main task.

So: **View 1 gives a good chance** of a working agent, but **not a guarantee** while the envelope is still there and we’re relying on model compliance.

---

## 4. What Would Push the Chance Higher (While Keeping OpenClaw)

1. **OpenClaw option to send “raw” message body for Telegram**  
   If OpenClaw ever adds a config option (e.g. “send only raw user text, no envelope”) for the Telegram channel, enabling it would remove the main remaining risk. Then View 1 + that option could push the likelihood into the **85–95%** range.

2. **Model choice**  
   Picking a model known for strong instruction-following (e.g. Qwen 2.5 32B, Llama 3.1 70B, or a fine-tune that “ignores system noise”) increases the chance View 1 works as-is.

3. **Upstream request**  
   Asking OpenClaw (e.g. GitHub or docs) whether Telegram can send only the raw message body (or how to minimize envelope) might surface a config we don’t know about or trigger a future option.

4. **Accept “good enough”**  
   If the agent usually replies normally and only rarely mentions metadata, that might be acceptable; then View 1 alone could be considered “success” without needing 100% envelope removal.

---

## 5. Summary Table

| Question | Answer |
|----------|--------|
| If we enact View 1 fully, what’s the chance of a **fully functional** Clawd agent? | **About 60–75%.** |
| Main remaining risk | Telegram envelope still in the turn; we rely on model + SOUL to ignore it. |
| What would raise the chance? | OpenClaw option for raw Telegram body; strong instruction-following model; or accepting “mostly good” behavior. |
| Does View 1 align with “AI agent / companion”? | Yes. View 1 keeps OpenClaw (agent runtime, sessions, tools, skills) and only slims prompt and upgrades model. |

---

## 6. Recommendation (Keeping OpenClaw)

- **Enact View 1** as the next step: slim workspace, `bootstrapMaxChars`, strong top-line SOUL directive, 32B or 70B model, GPU layers.  
- **Test in Telegram** with simple prompts (“Hello”, “What’s up?”) and a few that might trigger meta (e.g. “What did I just send?”).  
- If you’re in the **60–75%** success band (agent usually replies as Piko, rarely describes envelope/config), you have a working Clawd agent; you can then refine SOUL/IDENTITY or model choice.  
- If it’s still too meta-heavy, the next lever is **asking OpenClaw** for a “raw body” or “minimal envelope” option for Telegram, or evaluating a different channel (e.g. WebChat) where the envelope might be simpler, while still using the same OpenClaw agent.

So: **yes, View 1 is the right path if you want to keep OpenClaw;** and a **fully functional** Clawd agent is **likely but not guaranteed**, with the envelope being the main remaining variable.
