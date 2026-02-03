# Why Piko Replied With a "Message Description" Instead of a Normal Reply

## What you saw

When you messaged Piko on Telegram, the reply was something like:

> This message appears to be a text fragment from a conversation on the Telegram messaging service. It seems that someone with the ID 5772950940 (@StanOwens) has sent a message, and this is the 74th message in the thread. The message was created at approximately 16:26 GMT+11 on February 2nd, 2026.

So the agent **described** the message (metadata) instead of **replying** to what you said (e.g. "Hello").

---

## Root cause

OpenClaw’s Telegram channel sends the **user message** to the model in a wrapped format that includes metadata. The session transcript on Optimus showed the actual user turn sent to the model:

```
[Telegram S O (@StanOwens) id:5772950940 +15m 2026-02-02 16:26 GMT+11] Hello
[message_id: 74]
```

So the model sees:

1. A **prefix**: `[Telegram ... (@StanOwens) id:5772950940 ... 16:26 GMT+11]`
2. The **actual text**: `Hello`
3. A **suffix**: `[message_id: 74]`

Mistral (and many general-purpose models) tend to treat that kind of structured block as something to **describe** (e.g. “this is a Telegram message from user X, message 74, at time Y”) rather than as “the user said Hello, reply to that.” So the model produced a meta-description of the envelope instead of replying to “Hello.”

SOUL.md already said “Do not analyze or describe the message—just reply,” but the **format** of the turn (metadata-first) was strong enough that the model still described the envelope.

---

## Fix applied

**SOUL.md** in the OpenClaw workspace on Optimus (`/root/.openclaw/workspace/SOUL.md`) was updated with an explicit **Telegram message format** section:

- The message may be wrapped with a prefix like `[Telegram ... (@username) id:...]` and a suffix like `[message_id: N]`.
- **Ignore the metadata.** Reply only to the actual message content (what the human typed).
- Never describe or summarize the envelope (who sent it, message ID, time). Just respond to what they said.

No config change was needed; the gateway does not need a restart for SOUL.md changes (they are read when building the system prompt for each run).

---

## What to do next

Send another message to Piko on Telegram (e.g. “Hi” or “Hello”). The agent should now reply to the **content** of your message (e.g. a short greeting back) instead of describing the message envelope.

If it still describes the message, we can add the same “Telegram message format” instructions to IDENTITY.md or tighten the wording further.
