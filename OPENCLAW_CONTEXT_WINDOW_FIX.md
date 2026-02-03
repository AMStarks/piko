# OpenClaw: Fix "Model context window too small (8192 tokens). Minimum is 16000."

**Symptom:** When you message the Telegram bot, you get:

```
⚠️ Agent failed before reply: Model context window too small (8192 tokens). Minimum is 16000.
```

**Cause:** OpenClaw’s agent needs a model with at least 16k context. With **implicit** Ollama discovery, OpenClaw uses the context size reported by Ollama. Mistral (and some other models) report 8192, so the agent rejects them.

**Fix:** Add an **explicit** `models.providers.ollama` block and set `contextWindow: 16000` (or higher) for the model(s) you use. OpenClaw will use that value instead of Ollama’s default.

---

## Steps on Optimus

1. **SSH to Optimus** (as the user that runs the gateway, e.g. root):

   ```bash
   ssh root@192.168.0.121
   ```

2. **Edit the config:**

   ```bash
   nano /root/.openclaw/openclaw.json
   ```

3. **Add or replace the `models` section** so it includes an explicit Ollama provider with a large enough context window.

   - If you currently have **no** `models` key, add the whole block below at the top level (same level as `gateway`, `agents`, `channels`).
   - If you already have `models.providers.ollama` with `mistral:latest` (or similar) but no `contextWindow`, add `"contextWindow": 16000` and `"maxTokens": 4096` to each model in the `models` array.

   **Full `models` block (use this if you don’t have one, or merge the `ollama` part into your existing `models.providers`):**

   ```json
   "models": {
     "providers": {
       "ollama": {
         "baseUrl": "http://127.0.0.1:11434/v1",
         "apiKey": "ollama-local",
         "api": "openai-completions",
         "models": [
           {
             "id": "mistral:latest",
             "name": "Mistral",
             "reasoning": false,
             "input": ["text"],
             "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
             "contextWindow": 16000,
             "maxTokens": 4096
           },
           {
             "id": "llama3.1:latest",
             "name": "Llama 3.1",
             "reasoning": false,
             "input": ["text"],
             "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
             "contextWindow": 16000,
             "maxTokens": 4096
           }
         ]
       }
     }
   }
   ```

   - Keep your existing `gateway`, `agents`, `channels` (and any other keys) unchanged.
   - If your default model is something else (e.g. `ollama/llama3.1:latest`), add a matching entry in the `models` array with `contextWindow: 16000`.
   - Ensure `agents.defaults.model.primary` is one of these ids with the `ollama/` prefix, e.g. `"ollama/mistral:latest"`.

4. **Restart the gateway** so the new config is loaded:

   ```bash
   systemctl --user restart openclaw-gateway.service
   ```

5. **Check models (optional):**

   ```bash
   openclaw models list
   ```

   You should see `ollama/mistral:latest` (and any others you added) with the updated context.

6. **Test in Telegram:** Send another message to your bot; the agent should reply without the context-window error.

---

## Summary

| What | Value |
|------|--------|
| Minimum context for OpenClaw agent | 16000 tokens |
| Mistral (Ollama) default reported | 8192 tokens |
| Fix | Explicit `models.providers.ollama` with `contextWindow: 16000` (or 32000) per model |

Once the explicit provider is in place and the gateway restarted, the “context window too small” error should be resolved.
