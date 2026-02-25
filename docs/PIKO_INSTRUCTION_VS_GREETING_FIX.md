# Instruction-like messages: don’t reply with only a greeting

**What happened:** User sent: *"Set up my email for Moltbook login: andrewmartinstarkey@gmail.com"* and Piko replied with *"Hi — how are things going today?"* — i.e. the request was ignored and a generic greeting was returned.

**Cause:** The response planner (`lib/planner.js`) classifies some messages as **casual** (greeting/small talk) so the system prompt tells the model to give “one short warm line only.” The message didn’t match the literal greeting/small-talk patterns, but the model still produced a greeting (e.g. due to length, tone, or context). To reduce this, we now treat messages that **look like an instruction or request** as **not casual**, so the planner doesn’t force a one-line greeting and the model gets the normal response plan.

**Change:** In `lib/planner.js` we added:

- **`INSTRUCTION_LIKE_PATTERN`** — matches phrases like “set up”, “configure”, “login”, “sign up”, “register”, “add my email”, or the presence of `@` (e.g. email address).
- If the user message matches this pattern, we **do not** set `casual = true`, so the turn is planned as a normal reply (medium verbosity, full plan) and the model is not instructed to reply with only a short greeting.

**Result:** Messages such as “Set up my email for Moltbook login: user@example.com” are no longer planned as casual, so Piko should acknowledge the request and answer (e.g. “I can’t set your Moltbook login from here — that’s done on moltbook.com. If you meant something else, say what you’d like.”) instead of replying with only “Hi — how are things?”.

**Note:** Moltbook account/email setup is done on Moltbook’s site; Piko cannot perform it. The fix ensures Piko responds to the request instead of deflecting with a greeting.
