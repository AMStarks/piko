# Grok API key (optional)

When Piko isn’t satisfied with a Cursor task result, it asks **Grok (xAI)** for a short suggestion. This is optional.

## How to provide the key

- **Name:** `GROK_API_KEY` (or `XAI_API_KEY` — both work).
- **Format:** Your xAI API key string (e.g. from [xAI Console](https://console.x.ai/team/default/api-keys)).
- **Where to set:** Only in the **environment** where the WebChat server runs (e.g. systemd on Optimus). **Never commit the key to the repo.**

### On Optimus (systemd)

**Option A — override (recommended; survives service file updates):**

```bash
sudo systemctl edit piko-webchat.service
```

Add under `[Service]`:

```ini
[Service]
Environment=GROK_API_KEY=your_actual_key_here
```

Save and exit, then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart piko-webchat.service
```

**Option B — edit the unit file:**

```bash
sudo nano /etc/systemd/system/piko-webchat.service
```

Add a line (or uncomment the one in the template):

```ini
Environment=GROK_API_KEY=your_actual_key_here
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart piko-webchat.service
```

### Optional env vars

| Variable       | Default     | Purpose                          |
|----------------|-------------|----------------------------------|
| `GROK_API_KEY` | (none)      | xAI API key; required for Grok.  |
| `XAI_API_KEY`  | (none)      | Same as above (alias).           |
| `GROK_MODEL`   | `grok-4`    | Model name (e.g. `grok-4`, `grok-2`). |
| `GROK_URL`     | `https://api.x.ai/v1/chat/completions` | Override endpoint. |

If `GROK_API_KEY` is not set, Piko still runs discernment (Ollama decides satisfied/not satisfied) but does not call Grok.
