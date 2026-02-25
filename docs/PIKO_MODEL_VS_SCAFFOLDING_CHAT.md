# Piko chat: model issue or scaffolding issue? (Honest diagnosis)

## What you're seeing

You said **"Hello"** and Piko replied with **"What specifically is going on with your code right now that's got you stuck?"** or **"Stuck with an edge case, huh? What makes it so tough to crack?"** — as if you were in the middle of a debugging conversation. You weren't. That's the exact failure we tried to prevent: **hallucinated context**, **missing the point**, **rambling into code** when the user just said hello.

Telestai's note is right: this "unnatural" vibe (over-imitation, wrong context, empathy gap) is common with chatbots. The question is: **is it the model or the scaffolding?**

---

## Honest answer: **both**

### 1. Scaffolding (we can fix more, and we did one more thing)

**What we already did**

- Leading rule: "Answer the question they asked; do not assume they are debugging."
- Plan line for greetings: "Casual. One short line. Reply like a mate."
- System line: "Do not assume the user is debugging or has a bug unless they said so."
- Post-filters for "I'm here to help", canned phrases, "I'm Piko." → "Piko."
- Capability questions (who are you, what can you do) get a dedicated plan line.

So the **instructions** are there. The problem is **context we send**: we were still sending the **last 20 messages** of the session to the model every time. If the app (session `main`) or Telegram had a long thread about code/debugging, the model saw:

- System: "Reply with one short line; don't assume debugging."
- Then 20 turns of: "user: how do I fix this div?", "assistant: What's the error message?", "user: still stuck", "assistant: …", … and finally "user: Hello".

For an 8B model, the **recent dialogue is the strongest signal**. It tends to "continue the conversation" (debugging) more than it obeys the system line. So it answered as if you were still on the code topic.

**Scaffolding change we just made**

- For **casual turns** (greeting or small-talk from the planner), we now send **no prior history** to the model. So when you say "Hello", the model only sees: system prompt + "Hello". It no longer sees the 20 turns of debugging. So it has nothing to "continue" except the greeting. That should remove the priming that caused "Hello" → "What's going on with your code?"

So: **history priming was a scaffolding bug.** We've addressed it for greetings/small-talk. After deploy, "Hello" should get a greeting, not a code reply.

**What scaffolding can't fix on its own**

- If the **model** routinely ignores instructions when they conflict with a strong pattern, we can only go so far with prompts and history. So the model does play a role.

### 2. Model (real limit, especially at 8B)

- **Llama 3.1 8B** is small. It's good at short, pattern-following replies, and bad at "override the obvious pattern (debugging) and do the subtle thing (greeting only)." Bigger models (e.g. 70B) follow system instructions and nuance better, with the same prompts.
- So: **same scaffolding, bigger model → more natural, fewer "wrong context" replies.** Same scaffolding, 8B → we'll still see some brittleness when the model latches onto a pattern.
- That doesn't mean we shouldn't fix scaffolding. We should. But we shouldn't expect 8B to be as reliable as a 70B (or a better-tuned model) on "reply only to this; ignore the rest."

---

## Summary table

| Cause | What it is | What we did / can do |
|-------|------------|----------------------|
| **History priming** | Sending 20 turns of debugging before "Hello" so the model continues code talk | **Fixed:** For casual (greeting/small-talk) turns we now send **no** prior history. Model sees only system + "Hello". |
| **Instruction weight** | 8B follows recent dialogue more than long system instructions | **Mitigated** by trimming history for greetings. **Further:** stronger model (e.g. 70B) when you're ready. |
| **Prompt overload** | Too much in system can dilute the "one short line" signal | Already streamlined (leading rule, plan line, no-assume-debugging). Can trim more if needed. |
| **Session mixing** | App and Telegram sharing one session so history is mixed | Per-channel sessions are in place (unless you set PIKO_UNIFIED_SESSION_ID). So app `main` and Telegram each have their own history. |

---

## What we're building and how to keep going

You're building a **companion**: one brain, memory, beliefs, natural back-and-forth. The goal is **natural** (mate-like, no hallucinated context, no "missing the point").

- **Scaffolding** is how we shape context and instructions so the model has a fair chance to behave that way. We've fixed history priming for greetings and tightened rules and filters. That's the right direction and we should keep refining (e.g. test more edge cases, trim prompt bloat if needed).
- **Model** is the ceiling. 8B will keep having limits under load (long context, conflicting cues). Moving to 70B or a model that follows instructions better will raise that ceiling without changing the product idea.

So: **we had a scaffolding issue (history priming) and we've addressed it. We also have a model limit (8B); upgrading the model will help further.** Honesty: both are real; neither is an excuse to ignore the other. Deploy the history fix, trial again on app and Telegram, and then decide whether the next step is more scaffolding tweaks or a model upgrade. You're not stuck — you're narrowing it down.
