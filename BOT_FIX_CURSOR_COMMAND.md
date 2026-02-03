# Fix: Bot Treating /cursor as Chat (Easter Egg Reply)

**Problem:** You sent `/cursor --version` in Telegram and the bot replied with the LLM’s “Easter egg” answer instead of running Cursor on your MacBook.

**Cause:** The bot is sending **every** message to Ollama. The `/cursor` handler either isn’t in the code on Optimus, or it runs **after** the LLM, so the model sees "/cursor --version" as normal text and invents a reply.

**Fix:** Handle `/cursor` **first**, before any Ollama call. If the message is a `/cursor` command, run SSH + Cursor, send the result, and **return** without calling Ollama.

---

## What to Change on Optimus

SSH to Optimus and edit the bot:

```bash
ssh -i ~/.ssh/id_optimus root@192.168.0.121
sudo nano /root/telegram-ollama-bot/bot.js
```

Find where incoming messages are handled (e.g. in `processMessage` or the handler that calls Ollama). At the **very start** of that logic, add a block like this so it runs **before** anything that calls Ollama:

```javascript
// Handle /cursor FIRST - before Ollama (so the LLM doesn't "interpret" it)
if (message && (message.startsWith('/cursor ') || message === '/cursor')) {
  const command = message === '/cursor' ? '--version' : message.slice(8).trim();
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  try {
    const sshCmd = `ssh -i /root/.ssh/id_optimus_to_macbook -o StrictHostKeyChecking=no starkers@192.168.0.245 "cd /Users/starkers/Projects && cursor ${command.replace(/"/g, '\\"')}"`;
    const { stdout, stderr } = await execAsync(sshCmd, { timeout: 120000 });
    const output = (stdout || stderr || 'Done.').trim();
    const reply = output.length > 4000 ? output.slice(0, 4000) + '\n… (truncated)' : output;
    return await sendMessage(chatId, reply);
  } catch (err) {
    console.error('[ERROR] /cursor failed:', err.message);
    return await sendMessage(chatId, 'Cursor error: ' + err.message);
  }
}
```

- Use **full path for the key**: `/root/.ssh/id_optimus_to_macbook` (bot runs as root).
- Keep your real MacBook IP if it’s not `192.168.0.245`.
- This handles both `/cursor` (no args → run `cursor --version`) and `/cursor --version` or `/cursor &lt;anything&gt;`.

Then **restart the bot**:

```bash
sudo systemctl restart clawfriend-bot.service
```

After that, `/cursor --version` in Telegram should return the Cursor CLI version from your MacBook, not an LLM “Easter egg” reply.
