# Piko conversation & casual: synthesis and recommendation

**Purpose:** One consolidated view that merges (1) the conversation review and stripMetaSlip fix, (2) the external feedback you received, and (3) a clear recommendation so you can take it to another model for a second opinion.

---

## 1. What we agree on

### 1.1 The “Hey — what’s up?” bug was real and is fixed

- **Symptom:** User says “Good, good. I’m just doing some work. Want to chat for a while?” → Piko replies “Hey — what’s up?” (contextually wrong).
- **Cause:** `stripMetaSlip(reply)` replaced **any** reply containing “I’m here to help” or “what’s on your mind today” with a **single** fallback “Hey — what’s up?” for every message, with no regard for what the user just said.
- **Fix (implemented):** `stripMetaSlip(reply, userMessage)`; when the user message matches an invitation-to-chat pattern, we use a **conversational** fallback instead of the generic opener. Optional polish added: broader `INVITATION_TO_CHAT` pattern, three rotating fallbacks (“Sure — what’s on your mind?”, “Yeah, happy to chat — what’s up?”, “Cool — what do you want to talk about?”), and optional `PIKO_LOG_META_SLIP=1` to log when replacement happens.

**Verdict (both views):** Diagnosis was correct; fix is minimal, safe, and directly restores conversational behaviour for “Want to chat?”. No change to planner, prompts, or training.

### 1.2 The model is not ruined

- **Conclusion:** The 7B is fine. What you’re seeing is **routing + attractor strength + post-processing**, not permanent damage from fine-tuning.
- **Evidence:** When the casual path is actually used (e.g. reciprocity tests 5, 6, 7, 9), replies are clean. The failure mode is (a) many social turns still hitting the full path, and (b) theology-derived phrases dominating when they do, plus (c) one context-blind post-process step (now fixed).

### 1.3 Conversation is the key product

- **Architecture supports it:** Single entrypoint, one brain, full path gets last 30 messages (`SLICE_HISTORY`), planner is message-driven, soft_drive encourages coherence. The main leak was the meta-slip replacement; that’s addressed.
- **Companion-first, no deflection:** Fixing stripMetaSlip keeps “Sure — what’s on your mind?” (or variant) when the user invites chat, instead of resetting with “Hey — what’s up?”.

---

## 2. Two layers: conversation fix vs casual/theme fix

| Layer | What it fixes | Status |
|-------|----------------|--------|
| **Conversation (stripMetaSlip)** | “Want to chat for a while?” → wrong generic opener | **Done.** Context-aware fallback + invitation pattern + rotating replies. Deploy and re-test that flow. |
| **Casual / theme bleed** | Greetings/reciprocity still getting theology phrases, “Morning mate” overuse, 5/21 → 12–16/21 clean | **Ongoing.** Planner expansion (21/21 routing in tests), nuclear suppression, per-mode caps, and post-process are in place; live 21-suite and real use need validation. |
| **Social continuity gap** | Normal back-and-forth feels unbedded (binary casual/full causes either no history or worldview-heavy prompt) | **Implemented:** added `SOCIAL_CHAT` middle lane (short history, no theology/corpus/learning stack, 1-2 sentence conversational prompt). Needs live validation. |

So: **one fix is in and agreed (conversation); the other is the existing Phase 3.1 plan (planner + suppression + sampling + optional retrain).**

---

## 3. External feedback in short

- **StripMetaSlip fix:** Green light; precise, low-risk, testable.
- **Phase A (runtime, no training):** Confirm live planner logs, nuclear suppression in prompt, sampling (repeat_penalty 1.35, presence/frequency for casual), aggressive stripCasualThemeBleed + repetition fallback, fresh-session 21-suite → target ≥12/21 clean.
- **Phase B (after ≥12/21):** Rebalance data (theology ≤40%, casual 25%), anchor pack (literal, no attractors), Phase 3.1.1 train, then target ≥16/21.

That aligns with what’s already in `PIKO_PHASE31_STEP_FORWARD_PLAN.md`: instrument → planner → suppression → caps → re-test → train only if runtime fixes get you to the gate.

---

## 4. Recommendation (for you and for a second model)

### 4.1 Do now (no training)

1. **Deploy** the current code (stripMetaSlip with `userMessage`, `INVITATION_TO_CHAT`, rotating fallbacks, optional `PIKO_LOG_META_SLIP`, and new `SOCIAL_CHAT` lane).
2. **Re-test the exact conversation:**
   - “Hey Piko” → short reply  
   - “How are things?” → short reply  
   - “Good, good. I’m just doing some work. Want to chat for a while?” → **“Sure — what’s on your mind?”** (or one of the two other variants). No “Hey — what’s up?” here.
3. **Optional:** Run the 21-prompt suite with `PIKO_LOG_PLANNER=1` and `PIKO_LOG_CASUAL=1`; confirm how many show `casual: true` in the **live** environment (to validate that planner expansion is active where you deploy).

### 4.2 Next (if you want to push casual/theme further)

- Follow **Phase 3.1** (instrument → planner already expanded → nuclear suppression already in CASUAL_SYSTEM_PROMPT → per-mode caps already in place → re-run 21-suite with fresh sessions).
- If **≥12/21 clean** from runtime alone: proceed to **Phase 3.1.1** (rebalance, anchor pack, train, then target ≥16/21).
- If **<12/21:** use logs (which prompts got `casual: false`, raw output before strip) before doing more training.

### 4.3 Don’t do

- Don’t assume the model is broken; treat this as routing + attractor + one bad post-process step (fixed).
- Don’t skip the “Want to chat?” re-test after deploy; that’s the direct validation of the conversation fix.
- Don’t retrain before confirming runtime behaviour and logs (per Phase 3.1 plan).

---

## 5. One-sentence summary

**We fixed the conversation bug (context-blind meta-slip replacement) with a small, agreed change; the rest is the existing Phase 3.1 plan (planner + suppression + sampling + optional retrain) to get casual/theme under control, with the model and architecture still in good shape.**

---

## 6. What to ask another model

You can send something like:

- “I have a Piko chat agent (single server, planner + full/casual paths, Ollama 7B). We identified and fixed a bug where `stripMetaSlip(reply)` was replacing contextually good replies (e.g. after ‘Want to chat for a while?’) with a generic ‘Hey — what’s up?’ We now pass the user message and use a conversational fallback when the user invited chat. See `docs/PIKO_CONVERSATION_REVIEW_AND_ADVICE.md` and `docs/PIKO_SYNTHESIS_AND_RECOMMENDATION.md`. Do you see any risk or gap in this fix, or in the order of operations (conversation fix first, then casual/theme runtime fixes, then optional retrain)?”

That gives the other model enough to agree, disagree, or suggest refinements without re-deriving everything.

---

## 7. Continuity Eval (Executable)

Integrated improvements:

- **12 concrete multi-turn scenarios** in `webchat-piko/scripts/continuity-scenarios.json` (includes sign-off + re-engage).
- **0-5 scoring rubric** per turn and run in `webchat-piko/scripts/continuity-eval.js`:
  - continuity
  - naturalness
  - noBleed
  - noReset
  - modeFit
- **Telemetry storage** to timestamped JSON under:
  - `webchat-piko/data/conversation-eval-logs/`
- **Diagnostics per turn** in telemetry:
  - `guessed_route`
  - `reset_trigger`
  - `bleed_trigger`
  - `stilted_trigger`
  - `likely_template_fallback`
- **Summary utility**:
  - `webchat-piko/scripts/continuity-eval-report.js` (pass rate, criterion averages, diagnostics counts, lowest scenarios).
- **Raw API response capture** per turn in eval output (`raw_response` field).  
  (Model-pre-post raw needs server-side instrumentation/logs; this captures raw API payload returned by `/api/chat`.)

Run:

```bash
PIKO_API_URL=http://localhost:3000/api/chat PIKO_CONTINUITY_RUNS=3 node webchat-piko/scripts/continuity-eval.js
```

Suggested gate:

- scenario pass if avg score >= 4.0 / 5
- release gate if >= 80% scenarios pass
