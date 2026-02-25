# Phase 3.1 Implementation Summary

**What happened, what was done, and where changes were made.**

---

## 1. What Happened (Context)

- **Problem:** The 21-prompt casual reciprocity test was stuck at **5/21 clean**. Most prompts (compound greetings, reciprocity, light opinions, emotional disclosure, sign-offs) were **not** classified as casual, so they hit the **full identity path** (IDENTITY + SOUL + corpus + theology). That activated the “attractor” (rainy mornings, spark ideas, cozy corners, advice like “jot down what’s stressing you”), causing theme bleed and long/off-tone replies.
- **Root cause:** The **planner (router)** was too narrow. The casual path itself was fine when used; the issue was **how rarely it was used**.
- **Direction:** Fix the router first (instrument → expand planner → add rules → tighten caps), then re-measure. No model swap; runtime fixes only for this phase.

---

## 2. What Was Done (Implementation)

### 2.1 Plan document

- **File:** `docs/PIKO_PHASE31_STEP_FORWARD_PLAN.md`
- **Changes:**
  - Defined order of operations: instrument → expand planner → no-advice rule → tighten caps → forbidden list → re-run 21 suite.
  - Added **PIKO_LOG_PLANNER** diagnostic (log prompt, casual, reason in planner).
  - Expanded **no-advice** rule with: *“For emotional statements (‘rough day’, ‘feeling flat’), respond with empathy only. Do not offer advice, solutions, reframing, or worldview unless asked.”*
  - Added success criterion: *“If <12/21 clean after runtime fixes → diagnose raw output (prompts hitting full path) before training.”*
  - Added **Validation** bash snippet for running the 21-suite with `PIKO_LOG_PLANNER=1` and `PIKO_LOG_CASUAL=1`.

### 2.2 Planner (router) — `webchat-piko/lib/planner.js`

- **New patterns:**
  - **LIGHT_OPINION** — `^what('?s| do you think) (about|of) \w+` (e.g. “What do you think about coffee?”).
  - **LIGHT_OPINION_TAKE** — `^what'?s your take on ` (e.g. “What’s your take on rainy days?”).
  - **SOCIAL_EMPATHY** — e.g. “I had a rough day”, “Feeling a bit flat”, “Feels like…”, “rough day”, “long week”.
  - **SIGN_OFF** — e.g. “Thanks, that’s all for now”, “Catch you later”, “Cheers mate”, “Talk soon”, “bye”, “see you”.
  - **GREETING_WHAT_NEW** — `^(hi|hey|hello)\s+piko\s*[—\-]\s*what'?s new` (e.g. “Hi Piko — what’s new?”).
  - **NOT_MUCH_YOU** — `^not much.+\s+(you|yourself)\s*[.?]?\s*$` (e.g. “Not much, just chilling. You?”).
  - **EVER_TRIED** — `^ever tried \w+` (e.g. “Ever tried Vegemite?”).
- **GREETING_PATTERN** — Extended with `|\s+mate[\s!?.]*` so “Morning mate.” counts as greeting.
- **Casual gating:** All of the above (plus existing greeting, compound greeting, reciprocity, short ack, what-up-to) can set casual.
- **casualMode:** Planner now returns `casualMode`: `GREETING` | `RECIPROCITY` | `SOCIAL_EMPATHY` | `LIGHT_OPINION` | `SIGN_OFF` for per-mode caps.
- **PIKO_LOG_PLANNER:** When `PIKO_LOG_PLANNER=1`, logs `[PLANNER] Prompt: "…" | casual: true|false | reason: …`.

**Result:** **21/21** of the 21-suite prompts are classified as casual (target was ≥16).

### 2.3 Server — `webchat-piko/server.js`

- **CASUAL_SYSTEM_PROMPT:**
  - **Forbidden words:** rain, rainy, spark, cozy, path, journey, forge, growth, reflect, ponder, quiet corner, clear the mind, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, perspective.
  - **No-advice rule:** “Do not provide advice, coping strategies, or suggestions unless explicitly requested.”
  - **Empathy-only for emotional:** “For emotional statements (‘rough day’, ‘feeling flat’), respond with empathy only. Do not offer advice, solutions, reframing, or worldview unless asked.”
  - **Nuclear suppression:** Expanded “Do NOT use” list (rainy days/mornings, quiet spots, spark ideas, cozy, break free, grand visions, forging your own path, molds, authenticity, projects, theology, faith framing, corpus, truth block, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, clear the mind, sort thoughts).
- **Per-mode caps (casual only):**
  - **GREETING:** max_tokens 24, temperature 0.6.
  - **RECIPROCITY:** max_tokens 28, temperature 0.65.
  - **SOCIAL_EMPATHY / LIGHT_OPINION / SIGN_OFF:** max_tokens 32, temperature 0.65.
- **Instrumentation:**
  - **PIKO_LOG_CASUAL / PIKO_DEBUG_CASUAL:** After building `historyPart` and `casualMaxTokens`/`casualTemp`, logs `[CASUAL]` with sessionId, casual, casualMode, reason, historyLen, maxTokens, temperature, repeatPenalty.
  - **PIKO_LOG_RAW_CASUAL:** Before stripMetaSlip/stripCasualThemeBleed/fixEchoReply/firstSentence, logs `[RAW_CASUAL]` with message slice and raw reply slice (for mash-up diagnosis).
- **stripCasualThemeBleed:** Regex extended with: rainy mornings, jot down, regrouping, overwhelming, productive, stimulating, wander, flow.
- **Repetition fallback:** For casual replies, if `uniqueWords / words.length < 0.6`, replace reply with `"Hey — what's good?"`.

### 2.4 Docs and logs

- **docs/PIKO_PHASE31_21_EXAMPLES_LOGS.md** — Table of all 21 prompts with planner result (casual, mode, reason) and mode breakdown.
- **docs/PIKO_PHASE31_IMPLEMENTATION_SUMMARY.md** — This file.

---

## 3. Where Changes Were Made (File List)

| File | Changes |
|------|--------|
| **docs/PIKO_PHASE31_STEP_FORWARD_PLAN.md** | Order of ops, PIKO_LOG_PLANNER, no-advice + empathy-only text, success criterion, validation bash snippet. |
| **webchat-piko/lib/planner.js** | New patterns (LIGHT_OPINION, LIGHT_OPINION_TAKE, SOCIAL_EMPATHY, SIGN_OFF, GREETING_WHAT_NEW, NOT_MUCH_YOU, EVER_TRIED); GREETING_PATTERN +mate; casual gating; casualMode; PIKO_LOG_PLANNER. |
| **webchat-piko/server.js** | CASUAL_SYSTEM_PROMPT (forbidden list, no-advice, empathy-only, nuclear list); casualMaxTokens/casualTemp from plan.casualMode; [CASUAL] and [RAW_CASUAL] logs; stripCasualThemeBleed extended; repetition fallback. |
| **docs/PIKO_PHASE31_21_EXAMPLES_LOGS.md** | New: 21-example planner log table and mode breakdown. |
| **docs/PIKO_PHASE31_IMPLEMENTATION_SUMMARY.md** | New: this implementation summary. |

**Not changed:** `lib/llm.js` (already passed options through), `scripts/test_piko_casual.sh` (already used unique session per prompt).

---

## 4. How to Re-run and Interpret Logs

1. **Planner-only (no server):**  
   `PIKO_LOG_PLANNER=1 node -e "const { createResponsePlan } = require('./webchat-piko/lib/planner'); ..."`  
   → See which prompts get `casual: true` and which `reason`/`casualMode`.

2. **Full 21-suite (server must be running):**  
   `PIKO_LOG_PLANNER=1 PIKO_LOG_CASUAL=1 PIKO_API_URL=http://localhost:3000/api/chat ./webchat-piko/scripts/test_piko_casual.sh 2>&1 | tee casual_test.log`  
   → Server logs show `[PLANNER]` (if planner env is set in server) and `[CASUAL]` per request; script output shows API replies.

3. **Mash-up diagnosis:**  
   Set `PIKO_LOG_RAW_CASUAL=1` on the server and re-run the suite; inspect `[RAW_CASUAL]` to see model output before post-processing.

---

## 5. Bottom Line

- **What happened:** Planner was underpowered; most of the 21 prompts went to full identity and triggered theme bleed.
- **What was done:** Instrumentation, planner expansion (21/21 casual), no-advice + empathy-only rule, per-mode caps, forbidden list and nuclear suppression in CASUAL_SYSTEM_PROMPT, extended stripCasualThemeBleed, repetition fallback.
- **Where:** `docs/PIKO_PHASE31_*.md`, `webchat-piko/lib/planner.js`, `webchat-piko/server.js`.

Next step: run the 21-suite against a live server and count clean responses (target ≥12/21 from runtime fixes; ≥16/21 after Phase 3.1.1 training if needed).
