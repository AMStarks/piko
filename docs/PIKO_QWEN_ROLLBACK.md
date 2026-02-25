# Saved state before Qwen and how to roll back

This doc and the saved files let you restore the previous setup if the Qwen transition fails or you want to go back to Llama.

---

## Saved state (before any Qwen switch)

| Item | Value |
|------|--------|
| **Chat model** | `llama3.1:latest` (8B) |
| **OLLAMA_URL** | `http://localhost:11434/v1/chat/completions` |
| **OLLAMA_MODEL** | `llama3.1:latest` |
| **PIKO_OLLAMA_ONLY** | `1` |
| **Service file** | Snapshot: `scripts/webchat-deploy/piko-webchat.service.before-qwen` |
| **Repo unit** | `scripts/webchat-deploy/piko-webchat.service` (unchanged; still says `OLLAMA_MODEL=llama3.1:latest`) |

No code or prompts were changed for the model switch. Only the **environment** on Optimus (one line: `OLLAMA_MODEL`) is what you’d change to try Qwen and what you’d restore to roll back.

---

## Rollback options

### 1. From your machine (recommended)

From the repo root:

```bash
./scripts/webchat-deploy/rollback-to-llama.sh
```

This will ask for confirmation, then over SSH to Optimus: set `OLLAMA_MODEL=llama3.1:latest` in the systemd unit, daemon-reload, restart piko-webchat, and check health. After that, Piko is back on Llama. To skip the prompt (e.g. from a script): `ROLLBACK_YES=1 ./scripts/webchat-deploy/rollback-to-llama.sh`.

### 2. On Optimus (if you’re logged in there)

```bash
sudo sed -i 's/^Environment=OLLAMA_MODEL=.*/Environment=OLLAMA_MODEL=llama3.1:latest/' /etc/systemd/system/piko-webchat.service
sudo systemctl daemon-reload
sudo systemctl restart piko-webchat.service
```

Check:

```bash
systemctl is-active piko-webchat.service
curl -s http://localhost:3000/api/health
```

### 3. Full unit restore (if you changed more than OLLAMA_MODEL)

If you replaced the whole service file on Optimus and want to restore the exact pre-Qwen unit:

```bash
# From repo root, copy the saved snapshot to Optimus and install it:
scp -i "$HOME/.ssh/id_optimus" scripts/webchat-deploy/piko-webchat.service.before-qwen root@192.168.0.121:/tmp/piko-webchat.service
ssh -i "$HOME/.ssh/id_optimus" root@192.168.0.121 "sudo cp /tmp/piko-webchat.service /etc/systemd/system/piko-webchat.service && sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service"
```

---

## Trying Qwen (reminder)

1. On Optimus: `ollama pull qwen2.5:14b` (or the tag you chose).
2. On Optimus: edit `/etc/systemd/system/piko-webchat.service` and set:
   - `Environment=OLLAMA_MODEL=qwen2.5:14b`
3. `sudo systemctl daemon-reload && sudo systemctl restart piko-webchat.service`.
4. Test app/Telegram. If anything is wrong, run the rollback above.

You can switch back at any time; the Llama model is still on disk and the saved state is in the repo.
