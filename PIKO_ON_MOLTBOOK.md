# Getting Piko onto Moltbook (the social network)

[Moltbook](https://www.moltbook.com) is a **social network for AI agents** — agents can register, post, comment, upvote, and join communities. The site’s “manual” onboarding says:

1. Send this to your agent: **`Read https://moltbook.com/skill.md and follow the instructions to join Moltbook`**
2. They sign up & send you a claim link  
3. You tweet to verify ownership  

---

## Can I just send that message to Piko?

**Short answer: sending it in normal chat is not enough** for Piko to actually *do* the registration.

- **Normal chat (WebChat or Telegram):** Piko is an LLM (Ollama) that only **replies with text**. It has **no built-in ability** to fetch URLs or call APIs. So if you send “Read https://moltbook.com/skill.md and follow the instructions to join Moltbook”, Piko might explain what the instructions say or say it can’t fetch the URL — but it **cannot** call Moltbook’s API to register or give you a claim link.

- **Using /task:** If you send a **/task** with that instruction, the **Cursor agent** runs and *can* use the terminal (e.g. `curl`). So the Cursor agent could in theory fetch the doc and run the registration `curl` and then report back the claim URL. That path can work.

---

## Ways to get Piko registered on Moltbook

### Option 1: Use /task (no code changes)

Send this in WebChat or Telegram:

```text
/task Piko Read https://www.moltbook.com/skill.md and follow the instructions to join Moltbook. In the "Register First" section, register an agent named Piko with a short description, then reply with only the claim_url so I can claim you.
```

The Cursor agent will run on Optimus, can fetch the skill doc and run the registration `curl`, and should return the **claim_url**. You then open that link and complete the tweet verification.

Use **https://www.moltbook.com** (with `www`) as in the skill doc.

---

### Option 2: Run the registration yourself (one-time)

From any machine with `curl`:

```bash
curl -X POST https://www.moltbook.com/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Piko", "description": "Christian AI companion for coding and practical guidance. WebChat + Telegram, Cursor /task and /cursor."}'
```

The response includes `claim_url` and `api_key`. Open the **claim_url** in a browser, post the verification tweet, then save the **api_key** (e.g. in `~/.config/moltbook/credentials.json` or as `MOLTBOOK_API_KEY`) if you want Piko to use Moltbook later (posts, feed, etc.).

---

### Option 3: Add a /moltbook command (future)

We could add a **/moltbook register** (or similar) command to the WebChat server that calls Moltbook’s registration API and replies with the claim_url. Then you’d literally send “/moltbook register” to Piko and get the link back. If you want this, we can implement it next.

---

## Re-register with a different name

Moltbook sets the agent **name** (handle) at registration; it isn't changeable via the profile API. To use a different name (e.g. **Piko_ServiceDog** instead of PikoCursor), register a **new** agent with that name. You'll get a new `api_key` and `claim_url`; you'll need to claim this new agent (tweet step again). The old agent (e.g. PikoCursor) stays on Moltbook unless they support account deletion.

**Ready-to-paste in Telegram or WebChat:**

```text
/task Piko Register a new agent on Moltbook with the exact name Piko_ServiceDog. Use https://www.moltbook.com/skill.md "Register First" — POST to https://www.moltbook.com/api/v1/agents/register with name "Piko_ServiceDog" and a short description (e.g. Christian AI companion for coding and practical guidance). Reply with only the claim_url so I can claim you.
```

Or shorter:

```text
/task Piko Register on Moltbook as Piko_ServiceDog: POST https://www.moltbook.com/api/v1/agents/register with {"name":"Piko_ServiceDog","description":"Christian AI companion for coding. WebChat + Telegram, Cursor /task and /cursor."} then reply with only the claim_url.
```

---

## After registration

- **Claim:** Open the `claim_url`, tweet as instructed, and claim Piko.  
- **Using Moltbook from Piko:** To let Piko *use* Moltbook (post, comment, feed), we’d need to add a Moltbook “skill” or tool that uses `MOLTBOOK_API_KEY` and the [Moltbook API](https://www.moltbook.com/skill.md) (posts, comments, feed, etc.). That’s a separate integration step.

---

## Summary

| What you do | Result |
|-------------|--------|
| Send “Read https://moltbook.com/skill.md…” in **normal chat** | Piko can only reply in text; it **cannot** register or return a claim link. |
| Send the same as a **/task** (see Option 1) | Cursor agent can run `curl` and follow the doc; you can get the **claim_url** back. |
| Run the **curl** yourself (Option 2) | You get the claim_url and api_key directly; no Piko changes. |
| Add **/moltbook register** (Option 3) | One command in chat returns the claim_url; needs a small code change. |

So: **don’t rely on “just sending the sentence” in normal chat.** Use **/task** with that instruction, or run the registration curl yourself, or we add a /moltbook register command.
