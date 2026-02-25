# Piko — Future Builds (What We’re Not Chasing Now)

**Purpose:** Items we explicitly deprioritize for the current “next build” so we don’t dilute focus. Revisit when daily value or platform goals change.

---

## 1. More channels (Signal, Teams, Matrix, Zalo, Google Chat)

- **Why not now:** We already have WebChat, Telegram, Discord, Slack, WhatsApp, and BlueBubbles/iMessage. That covers the surfaces most single users need.
- **When to revisit:** Add a specific channel only when you have a concrete use case (e.g. “I need Piko in Teams for work”).

---

## 2. Full gateway semantics / multi-agent routing

- **Why not now:** HTTP + `sessionId` + profiles (`main`/`work`) already give session isolation and behavior switching. A full WebSocket “gateway” and per-session *models* add complexity without proportional daily gain for a single user.
- **When to revisit:** If you run multiple distinct agents (e.g. “coding” vs “writing” vs “support”) and want routing/failover at the gateway level.

---

## 3. ClawHub-style skills registry

- **Why not now:** Local `skills/` loader is a strength: private, simple, no phoning home. A public registry and auto-install are ecosystem play, not core to “Piko works for me.”
- **When to revisit:** When you have several skills and want to share or discover them (e.g. community or multi-machine installs).

---

## 4. Native apps / Voice Wake (“Hey Piko”)

- **Why not now:** WebChat + Voice button (Web Speech API) covers in-session voice input. Always-on wake word and native macOS/iOS/Android apps are a large surface (audio pipeline, permissions, app store).
- **When to revisit:** When “hands-free from across the room” or “Piko in the menu bar” becomes a must-have.

---

## 5. Browser CDP, nodes (camera, location, screen record)

- **Why not now:** High complexity and platform-specific code; most daily value comes from chat, tools, intents, and adapters we already have.
- **When to revisit:** If you need “browse this page and click X” or “what do you see from my camera” as first-class flows.

---

## 6. Profiles as real agent configs (profiles.json)

- **Why not now:** We already have per-session profile name plus optional model, toolsAllowed, and sandbox in sessions.json. That's enough for "main vs work" and per-channel policy. A full profiles.json with named definitions (main, work, focus) and riskLevel/costLevel is more structure than we need for the current build.
- **When to revisit:** When you want many named "modes" (e.g. focus, support, coding) with reusable definitions and clear risk/cost tiers.

---

## 7. Skills as installable modules (metadata, /skills list, capabilities)

- **Why not now:** The local skills loader and showcase skills (notes, todo, summarize) already work. Adding a formal skill contract (name, description, exampleCommands, capabilities, one-file-per-skill) and `/skills list` / `/skills info` is polish, not a blocker for the backlog or state API.
- **When to revisit:** When you have many skills and want discovery, documentation, and capability/safety metadata in one place.

---

## 8. Cost and risk as first-class / approvals

- **Why not now:** We have per-session toolsAllowed and sandbox; that's enough to limit risk per channel. Explicit riskLevel/costLevel and a sensitive-skill approval flow add moving parts and edge cases we don't need yet.
- **When to revisit:** When you share Piko with others or add high-risk skills (e.g. financial, system) and want a clear "requires approval" step.

---

**Summary:** These stay in the backlog. Current focus is (1) persistent goals and intent queues and (4) state API; then polish, safety, and ergonomics as already shipped (allowlists, per-session config, logging/metrics, doctor, showcase skills, quickstart, recovery, intent visibility).
