# Piko design brief for agent scaffolding (cross-project reference)

Use this doc in **another project** (e.g. an AI agent scaffolding that has a manager agent and sub-agents) to align with or reuse what Piko does. No code—concepts, contracts, and patterns only.

---

## 1. What Piko is (one sentence)

**Piko** is an AI that learns from experience and exploration through **persistent, inspectable state** (no weight updates); **strategy is human-only**, tactics and knowledge accumulation are agent-driven.

---

## 2. Learning definition (portable)

> **Learning** = future actions are measurably influenced by past outcomes, through **persistent, inspectable state**, without altering model weights.

Everything below exists to satisfy that.

---

## 3. Four primitives (reusable in any agent)

| Primitive | Meaning | Where it lives (Piko) | In a manager agent |
|-----------|---------|------------------------|--------------------|
| **Observation** | What happened (raw signal) | Engagement, posts, feedback, exploration search results | Task outcomes, sub-agent results, events, blockers |
| **Reflection** | What the agent thinks about it (tactical) | Journal (four bullets: worked / didn’t / try next / avoid) | Project journal or “run log” with same structure |
| **Direction** | Where we’re trying to go (strategy) | Aim + refinements (human-approved only) | Project goals + approved tactics (human-approved) |
| **Action** | What the agent does next | Post to Moltbook, or chat reply | Create/assign tasks, call sub-agents, escalate to human |

**Rule:** Only **direction** is human-controlled. Observation is descriptive; reflection is tactical; action is bounded by direction.

---

## 4. Single loop (one loop only)

```
Observe → Signal guard
   ├─ No signal → Act (using existing reflection + direction)
   └─ Signal → Reflect → Persist reflection → Act
```

- **Signal guard:** Write a reflection entry only when something meaningful changed (e.g. new outcome, failure, new input). Prevents reflection spam.
- **Act:** Always allowed within direction; uses latest reflection + direction to decide next step.

---

## 5. Two layers of learning

| Layer | Who updates it | Durability |
|-------|----------------|------------|
| **Tactical** | Agent (when signal guard fires) | Can roll off; overwritten by context |
| **Strategic** | Human only (approve/reject proposals) | Durable; in every “act” prompt until changed |

Learning becomes **durable** only when tactical patterns are turned into strategic rules (e.g. refinements) and the human approves. The agent can propose; the human disposes.

---

## 6. Invariants (non-negotiable)

- **No self-rewriting of direction** — The agent cannot change its own aim, goals, or approved tactics. Only a human can.
- **No hidden state** — If it affects behaviour, it lives in a known artifact (journal, refinements, memory, exploration notes).
- **Inspectable** — All state is readable (files or DB); no opaque “memory” the human can’t see.

---

## 7. Extra layer in Piko: proactive exploration

Besides **reactive** learning (observe → reflect → act), Piko has **proactive** learning:

- **Daily exploration:** Pick a topic, search, write a short structured note (what I learned / why it caught my attention / what it made me question). Stored in `rabbit-hole-notes.md`.
- **Meta-reflection (weekly):** Look at last N notes + journal; write “what keeps recurring, what I’m drawn to, tensions.” Optional: update “sticky ideas” (themes that stuck).
- **Use in behaviour:** Recent exploration and sticky ideas are injected into the **prompt** (e.g. chat) with **epistemic humility** (“I’ve been looking into…”, not “I understand…”).

So: **reactive** = adapt from outcomes; **proactive** = grow from deliberate exploration. Both feed the same prompt; neither changes direction without human approval.

---

## 8. How to “communicate” this to the scaffolding project

**Option A — Copy this file**  
Drop this markdown into the scaffolding repo (e.g. `docs/PIKO_DESIGN_BRIEF.md` or `reference/piko-learning-contract.md`). When you or an AI work on the manager agent, open it and say: “Align the manager’s learning loop with this; here’s our task schema and sub-agent interface.”

**Option B — Point and summarise**  
In the scaffolding repo, add a short `README` or `DESIGN.md` section that says:

- “Our manager agent’s learning contract follows the Piko design: see [link or path to this brief]. In short: observe (task outcomes), reflect (journal when signal), direction (human-only), act (assign/call sub-agents). No self-rewriting of goals; all state inspectable.”

**Option C — Cursor chat in the other project**  
In the scaffolding project, you can say:

- “We’re aligning with the Piko learning design. Here’s the brief: [paste §1–6 above, or attach this file]. Our manager has tasks and sub-agents. Implement: (1) observation = task outcomes + sub-agent results; (2) reflection = project journal with four-bullet structure, only when signal; (3) direction = project goals + approved tactics, human-only; (4) action = create/assign tasks. Keep state in [our task store / files] and never let the agent change goals or approved tactics.”

---

## 9. Minimal checklist for alignment

- [ ] **Observation** is defined (what the manager “sees”: task list, outcomes, sub-agent outputs).
- [ ] **Reflection** is a stored artifact (e.g. journal or run-log), written only when a **signal guard** fires (something changed).
- [ ] **Direction** is separate and human-only (goals, scope, approved tactics); the agent never writes to it.
- [ ] **Action** is clearly scoped (e.g. create/assign tasks, call sub-agents, escalate); prompt includes direction + latest reflection.
- [ ] All state is **inspectable** (files or DB you can read).
- [ ] (Optional) Proactive exploration: manager can “explore” topics and store notes that later inform its prompt.

---

## 10. Where the full detail lives (this repo)

If the scaffolding project needs implementation detail (file layouts, prompts, cron), that lives in the **Piko repo**:

- Learning contract and loop: `webchat-piko/docs/LEARNING.md`
- Full view (loop + verification + improvements): `docs/PIKO_LEARNING_FULL_VIEW.md`
- Exploration and growth (rabbit holes, meta-reflection, sticky ideas): `docs/PIKO_LEARNING_EXPLORATION_AND_GROWTH.md`
- Build and deploy plan for exploration: `docs/PIKO_LEARNING_EXPLORATION_BUILD_AND_DEPLOY_PLAN.md`

This brief is the **portable summary**; those docs are the **reference implementation**.
