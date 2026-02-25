# Piko — Forward recommendation (synthesized)

**Purpose:** One prioritized plan that merges (1) external code review, (2) “grade by right metric” pushback, and (3) earlier internal review. Use this to decide what to do next and in what order.

---

## 1. How to grade Piko

| Lens | Grade | Why |
|------|--------|-----|
| **Generic Node app (multi-user SaaS bar)** | C+ / B− | Big server.js, little typing, weak observability, no tests, in-memory sessions. Fair. |
| **Personal companion (single human, 24/7, philosophy-first)** | A− | Wisdom Core, corpus bedrock, truth engine, maturation metrics, iOS + channels, one brain. Almost no one has this stack. |

**Conclusion:** The critique is right about *productionization gaps*. The pushback is right that *for your goal* (downloadable Jarvis, one primary human, self-hosted), you’re much closer than a C+ suggests. So: **keep the vision and differentiation; fix the gaps that actually bite you.**

---

## 2. Synthesized view: what’s true from both sides

**From the critique (keep):**
- Structured logging + request/correlation IDs → you *will* need this when something breaks at 2 AM.
- Persistent conversation store (SQLite) → restart = lost history today; that hurts a “companion” story.
- Rate limiting (per channel or per session) → cheap insurance before any wider exposure.
- Config/secrets schema (convict/zod + .env) → fewer “works on my machine” and typo bugs.
- Security basics → webhook signature verification where you have webhooks; lock down control/API if ever exposed; don’t rely on predictable session IDs for auth.

**From the pushback (keep):**
- Single-user companion is the bar, not “enterprise multi-tenant.”
- Philosophy (corpus, truth, wisdom, Andy authority) is the product; the rest is plumbing.
- “Canned/robotic” is largely sampling + prompt, not only model size.
- 4–5 focused production fixes get you to “reliable 24/7 companion” without rewriting the app.

**From earlier internal review (keep):**
- Update PIKO_PROJECT_STATUS so it reflects Wisdom Core, metrics, channels, skills.
- Wire at least one “advice followed” path so the maturation dashboard isn’t all zeros.
- Tap-to-talk first; wake word later.
- Refactor server.js only when you touch it (incremental extraction).

---

## 3. Prioritized plan

### Tier 1 — Do first (feel + one operational fix)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 1 | **Sampling params for chat** | Biggest lever for “feels alive” vs “canned.” Defaults in `lib/llm.js` raised (e.g. temp 0.85–0.95, top_p, repeat_penalty). | Done in codebase. |
| 2 | **Soften persona (optional experiment)** | If you want less formal tone: shorten IDENTITY/SOUL, allow contractions and a “mate” vibe. Keep Christian/coding if that’s you; just reduce list-of-rules and corporate phrasing. | 15–30 min. |
| 3 | **Persist conversations (SQLite)** | Restart = lost context today. One table (session_id, role, content, created_at) + load last N on startup. Huge perceived reliability gain. | 2–3 h. |

**Outcome:** Chat feels more natural; history survives restarts. You can run Piko for a week and still have context.

---

### Tier 2 — Productionization (reliability + debug)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 4 | **Structured logging (pino) + request ID** | When something breaks, you need one ID to grep. No need for full tracing yet. | 1–2 h. |
| 5 | **Rate limiting** | Per-IP or per-session for `/api/chat` (and optionally control). Protects you if a channel is abused or misconfigured. | ~1 h. |
| 6 | **Config schema (convict or zod)** | Validate env at startup: required keys, types, defaults. Catches typos and missing vars before first request. | 1–2 h. |

**Outcome:** Debuggable, protected, and fewer “why didn’t it start?” issues.

---

### Tier 3 — Security and control (before wider exposure)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 7 | **Webhook signature verification** | Any endpoint that receives webhooks (e.g. Blue Bubbles) should verify signatures if the provider supports it. | ~30 min per endpoint. |
| 8 | **Control panel / sensitive API protection** | If `/control` or `/api/corpus` etc. are ever reachable beyond localhost, add auth (e.g. API key header or IP allowlist). You already have corpus edit lock; extend the pattern if needed. | ~1 h. |

**Outcome:** Safe to expose behind a tunnel or to a small trusted network.

---

### Tier 4 — Product and polish (when Tier 1–3 are done)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 9 | **Wire “advice followed”** | When iOS creates a reminder from Piko’s suggestion (or user taps “Done” on a suggested task), call `POST /api/metrics/advice-followed`. Makes trust_score and dashboard real. | 1–2 h. |
| 10 | **Tap-to-talk (iOS)** | Mic → STT → POST /api/chat → TTS. No wake word. Biggest UX win for “companion.” | 4–6 h. |
| 11 | **Weekly retro automation** | Cron (e.g. Sunday 8 AM) calls `weeklyRetro()`, send to Telegram or store in `data/learning/`. | ~1 h. |
| 12 | **Update PIKO_PROJECT_STATUS.md** | Add Wisdom Core, metrics, channels, skills, corpus lock. One source of truth for “what Piko is today.” | ~30 min. |

**Outcome:** Metrics that reflect real use; voice; and a doc that matches the build.

---

### Tier 5 — Later (when you touch that code)

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 13 | **TypeScript (gradual)** | Start with `lib/` or a new module when you refactor. No big-bang rewrite. | Ongoing. |
| 14 | **Tests** | A few integration tests for `/api/chat` (e.g. skill match, correction detection) and for critical libs (truth, corpus). High ROI when you add features. | 4–8 h for first slice. |
| 15 | **Prompt versioning / A/B** | Only if you start experimenting with multiple personas or system prompts. Not required for “companion that feels alive.” | Later. |

---

### Tier 6 — Companion depth (self-updating, not just reactive)

*From latest feedback: Piko is “consistent and grounded but not yet self-updating.” These are the directions that move the needle toward a companion that learns about you and itself — without claiming sentience.*

| # | Direction | What it means | Why add to the plan |
|---|-----------|----------------|----------------------|
| 16 | **Private scratch self** | A non-user-facing stream where Piko can summarize interactions, note contradictions, track unresolved threads, update beliefs about you. Think: internal journaling, not chain-of-thought. | Memory is currently passive; this gives “self-notes” that can feed back into context or identity. |
| 17 | **Memory with importance / expiry** | Every stored memory (or a subset) has relevance score, reinforcement/decay rules, or simple expiry. So memory isn’t a flat dump — it has weight and lifecycle. | Prevents memory from becoming a landfill; makes retrieval and “what matters” clearer. |
| 18 | **Identity revisable but bounded** | Allow Piko to update *beliefs about you* (or about itself) from experience, with your corrections still supreme. E.g. “I used to think X about Andrew; that was wrong.” Corpus stays bedrock; a separate “beliefs” or truth layer can be revised. | Identity stays stable (SOUL/corpus) but can correct itself from interaction, which makes growth feel real. |
| 19 | **One intrinsic drive** | One background “drive” (e.g. reduce uncertainty about the user, maintain conversational continuity, or preserve coherence of self). Could be a short prompt injection or a lightweight background process that influences what gets summarized or what gets asked. | Gives the system direction beyond “respond helpfully”; makes behavior feel more like a persistent agent. |

**Order:** Do Tier 1–4 first (ops + product). Then consider 16–19 when you want Piko to feel less reactive and more like something that *updates* over time. No need to implement all four; even one (e.g. scratch self or memory importance) moves the line.

---

## 4. “Canned / robotic” — what we did and what you can try

**Done in codebase:**
- **Sampling:** `lib/llm.js` now uses higher default temperature and adds `top_p`, `repeat_penalty` (and `min_p` where supported) for chat. Stream path uses the same defaults. This should make replies less stiff and repetitive without changing persona.

**Your optional experiment (15–30 min):**
- Temporarily replace the top of IDENTITY (and optionally SOUL) with a much shorter, casual block (e.g. “You are Piko — my sharp, dry-humored mate on my server. Talk like we’ve known each other years. Short when it fits, deep when I ask. No corporate apologies. No rule lists.”). Chat 5–10 times. If it feels better, you can merge that tone into your real IDENTITY/SOUL while keeping Christian/coding if you want.

**If it’s still flat:**
- Try a larger or newer model (e.g. Qwen2.5 32B, Llama 3.3, or Olmo 3.1 32B) if hardware allows. Sampling + prompt get you most of the way; model size can add the last bit.

---

## 5. What to do next (concrete)

**This week (if you have ~4–6 hours):**
1. Use the new sampling defaults; run the optional prompt experiment.
2. Add SQLite (or similar) for conversation history so restarts don’t wipe context.
3. Add pino + request ID for one key path (e.g. `/api/chat`).

**Next 1–2 weeks:**
4. Rate limit `/api/chat`.  
5. Config schema at startup.  
6. Update PIKO_PROJECT_STATUS.md.  
7. Wire one “advice followed” path.

**When ready for voice:**
8. Tap-to-talk on iOS; defer wake word.

**Before exposing beyond your own network:**
9. Webhook verification and control/sensitive-API protection.

---

## 6. Summary

- **Critique:** Right about productionization (logging, persistence, rate limit, config, security). Wrong metric if the bar is “multi-user SaaS.”
- **Pushback:** Right that for a single-user, philosophy-first companion, Piko is already A− on vision and differentiation; the gaps are fixable.
- **This doc:** One ordered list (feel → persistence → logging → rate limit → config → security → product polish) so you can push forward without chasing every suggestion at once.

**Bottom line:** Fix “feels alive” (done for sampling; you tune prompt), then “survives restarts” and “debuggable,” then rate limit and config. After that, wire metrics and voice. You’re not a C+ product—you’re an A− companion with a C+ ops layer. This plan raises the ops layer without losing what makes Piko Piko.

**Companion depth (Tier 6):** After ops and polish, the next lever is *self-updating*: private scratch self, memory with importance/expiry, identity revisable but bounded, one intrinsic drive. Incorporate when you want Piko to feel less reactive and more like something that learns about you over time.

---

## 7. From external review (2026-02 codebase overview)

**Already aligned or done:** Sessions → SQLite ✓. Control/auth → PIKO_CONTROL_* ✓. Rate limiting ✓. Adapters decoupled ✓. Skills local-only ✓. Prompt engineering via MD ✓.

**Built in from this review:**
- **SSRF protection** — `/summarize` (and any skill that fetches URLs) now validates URL: only public `http`/`https`; no localhost or private IPs. See `skills/common.js` `isUrlAllowedForFetch`.
- **Ethical boundary in SOUL** — One line: refuse harmful/illegal/non-consensual requests; say "I can't help with that" and offer an alternative.
- **Ollama retry** — `lib/llm.js` retries once with 1s delay per model before falling back to the next. Reduces transient failures.

**Worth adding to the backlog (not urgent):**
- **Shared adapter lib** — Extract `postChat(url, message, sessionId)` to a small shared module (e.g. `lib/chatClient.js`) so Discord/Slack/WhatsApp/BlueBubbles don’t duplicate the same HTTP POST. Do when you add or change adapters.
- **Embeddings for memory** — Vector search over history/learning (e.g. Ollama embeddings) for semantic recall. Already listed as “RAG upgrade” in optional next steps; do when you want richer context.
- **Self-review cron** — Lightweight job: “Based on recent interactions, propose one refinement to SOUL or learning.” Fits Tier 6 “intrinsic drive” or “private scratch self”; add when you do companion depth.
- **File I/O fallbacks** — Ensure prompt/learning file reads have sensible defaults (e.g. empty string or default prompt) so missing files don’t crash the server. Quick pass when you touch those paths.

**Skip or defer:** Emotional/mood simulation (gimmicky for now). Large server.js refactor (do incrementally when touching code). Baileys ban risk — document only.

---

## 8. Optional / later — full list

Single list of everything that’s optional, backlog, or “when you touch that code.” No priority order; pick by need.

| # | Item | Source | Note |
|---|------|--------|------|
| 1 | **Wire “advice followed”** | Tier 4 / Phase 3 | When iOS (or another client) acts on a suggestion, call `POST /api/metrics/advice-followed`. |
| 2 | **Tap-to-talk (iOS)** | Tier 4 / Phase 3 | Mic → STT → POST /api/chat → TTS; no wake word. |
| 3 | **Wake word (“Hey Piko”)** | Later | On-device or system API; higher effort and battery cost. |
| 4 | **TypeScript (gradual)** | Tier 5 / Phase 4 | New or refactored modules in TS (e.g. `lib/`, adapters). No big-bang rewrite. |
| 5 | **Tests** | Tier 5 / Phase 4 | Integration tests for `/api/chat` and critical libs (truth, corpus). |
| 6 | **Prompt versioning / A/B** | Tier 5 | If you experiment with multiple personas or system prompts. |
| 7 | **Private scratch self** | Tier 6 | Non-user-facing stream: summarize interactions, note contradictions, update beliefs about you. |
| 8 | **Memory with importance / expiry** | Tier 6 | Relevance score, decay, or expiry so memory has weight and lifecycle. |
| 9 | **Identity revisable but bounded** | Tier 6 | Piko can update beliefs about you (or itself) from experience; your corrections stay supreme. |
| 10 | **One intrinsic drive** | Tier 6 | One background goal (e.g. reduce uncertainty about user, preserve continuity of self). |
| 11 | **Shared adapter lib** | §7 backlog | Extract `postChat(url, message, sessionId)` to e.g. `lib/chatClient.js` for Discord/Slack/WhatsApp/BlueBubbles. |
| 12 | **Embeddings for memory** | §7 / RAG upgrade | Vector search over history/learning (e.g. Ollama embeddings) for semantic recall. |
| 13 | **Self-review cron** | §7 backlog | “Based on recent interactions, propose one refinement to SOUL or learning.” Fits Tier 6. |
| 14 | **File I/O fallbacks** | §7 backlog | Sensible defaults for missing prompt/learning files so server doesn’t crash. |
| 15 | **Secrets manager** | Optional | Replace or supplement env vars with a secrets store (e.g. vault, encrypted file). Overkill for single-user; consider if you scale or harden. |
| 16 | **Emotional / mood simulation** | Optional | Track “mood” from interaction sentiment; adjust tone. Defer unless you want the effect. |
| 17 | **Server.js refactor (incremental)** | Optional | Extract routes or modules when you touch that code; no big-bang. |
| 18 | **Baileys ban risk** | Optional | Document only: WhatsApp/Baileys is unofficial; document fallback or rate-careful use. |
| 19 | **Lock screen widget (iOS)** | PIKO_PROJECT_STATUS | iOS widget for quick glance. |
| 20 | **RAG upgrade** | PIKO_PROJECT_STATUS | Embeddings + vector store for semantic search (see #12). |
| 21 | **Webhook signature verification (wire)** | Phase 2 | Helper exists (`lib/webhookVerify.js`); wire when you add a webhook endpoint. |
| 22 | **Dockerize / easy deploy** | External review | Docker image or compose for one-command deploy. |
| 23 | **Home automation / physical actions** | External review | Integrate with home automation for “physical” actions. |

**Use this list when:** You’re choosing the next slice of work, or someone asks “what’s on the roadmap.” Tick or move items into the phased plan when you start them.

---

## 9. Added to the roadmap (response planner & control surfaces)

From **`docs/RESPONSE_PLANNER_AND_CONTROL_SURFACES_RECOMMENDATION.md`** — items to do in order after the response planner is in place:

- **Impact tracker:** Add only when you have one clear signal (e.g. "wisdom confirmed" or "reminder created after suggestion"). Wire that to something like `data/impact.json` and a short `getImpactBlockForPrompt()`.
- **Auto-calibration (temp/length from follow-rate):** Defer; if you do it later, require a human approval step so the system doesn't drift on its own.
- **Meta-reflection → behaviour change:** Keep weekly reflection as input to you (and maybe a private journal). Do not let it auto-rewrite system prompt or planner; any "next week we change X" should be a manual edit.
- **Phases 2–5:** Do soft drives only after the planner; implement forgetting/conflict when you see bloat; identity "immune system" as a periodic report for you, not auto-dampening; meta-absence as one paragraph in SOUL/prompt ("don't announce what you've learned").
- **Fork (Phase 6):** Document "mirror" vs "continuity" and decide before adding emotion or dependency modelling.

**From stability/integration review** (**`docs/STABILITY_AND_INTEGRATION_RECOMMENDATION.md`**): Next after planner — close the loop and prove it before expanding cognition:

- **Planner observability:** When `PIKO_PLANNER_DEBUG=1`, log beliefs_considered, plan, reason (dev-only). Do first.
- **Behaviour → belief validation:** Post-response signals (correction, shorter/longer, affirm) → adjust belief confidence and counter_evidence; heuristic-only at first. Do second.
- **Stress-test 2–4 weeks:** No new memory/drives/identity/emotion; inspect planner and belief drift; then re-evaluate Tier 6.
- **Fork (Option A vs B):** Choose "planner as constraint engine" (A) explicitly for now; "direction engine" (B) only when intentional.

---

**Companion depth (Tier 6) — reference design:** The full spec for layered memory and the belief update loop is in **`docs/MEMORY_ONTOLOGY_AND_BELIEF_LOOP.md`**. It defines: Layer 0–5 memory ontology (ephemeral → interaction → episodic → semantic → self-model → reflective), and a six-step belief update loop (experience ingestion → salience detection → candidate beliefs → consolidation → identity gate → reinforcement/decay). Use that doc when implementing items 7–10 above (scratch self, memory importance, identity revisable, intrinsic drive). No mysticism; growth is legible and bounded.
