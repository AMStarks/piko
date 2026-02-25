# Phase 3.1 Step-Forward Plan

**Status:** 5/21 clean; target ≥16/21  
**Refined diagnosis:** Planner coverage is the dominant leak. Most reciprocity/compound prompts never hit casual isolation. When casual is used, it works. Fix the router and tighten gating; instrumentation first.

---

## Core Insight

> You built a powerful identity system. You underpowered the router.  
> The router must be more intelligent than the identity. Right now it's weaker.

---

## Order of Operations

| Step | Action | Why |
|------|--------|-----|
| 1 | **Instrument before fixing** | Cannot optimize blind. Log classification, history, mode, params. |
| 2 | **Expand planner coverage** | 90% of 21-suite must hit casual. If 16+ miss, nothing else matters. |
| 3 | **Add "No advice unless asked"** | Fixes prompts 11 & 21 (helper bias, not theology). |
| 4 | **Tighten casual caps** | GREETING: 20–24 tokens; SOCIAL: 28; LIGHT_OPINION: 32. |
| 5 | **Upstream forbidden list** | Move suppression pre-generation; don't rely on regex. |
| 6 | **Re-run 21 suite with logging** | Verify routing; inspect raw outputs for mash-up diagnosis. |

---

## Step 1 — Instrument Before Fixing

**Add per-request logs** (server.js, before LLM call):

```js
// Log: session_id, plan.casual, plan.reason, history length, mode, params
if (process.env.PIKO_LOG_CASUAL === '1' || process.env.PIKO_DEBUG_CASUAL === '1') {
  console.log('[CASUAL]', JSON.stringify({
    sessionId: key?.slice(0, 20),
    casual: plan.casual,
    reason: plan.reason,
    historyLen: historyPart.length,
    maxTokens: plan.casual ? 40 : 4000,
    temperature: plan.casual ? 0.65 : 0.9,
    repeatPenalty: plan.casual ? 1.25 : 1.12,
  }));
}
```

**Raw output log** (before stripCasualThemeBleed, fixEchoReply, firstSentence):

```js
if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
  console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
}
```

Run 21-suite with `PIKO_DEBUG_CASUAL=1 PIKO_LOG_RAW_CASUAL=1` to confirm:
- Which prompts get `casual: true`
- Raw reply before post-processing (mash-up diagnosis)

---

## Step 2 — Expand Planner Coverage

**Current gap:** Test prompts that still miss casual:
- "Hey, how's it going?" — COMPOUND_GREETING should match; verify.
- "Not bad, how about you?" — HOW_ABOUT_YOU_FOLLOWUP should match; verify.
- "Hi Piko — what's new?" — CASUAL_PATTERN has "what's new" but may need "hi piko" prefix.
- "What do you think about coffee?" — Light opinion; add LIGHT_OPINION pattern.
- "I had a rough day today." — Light emotional; add SOCIAL_EMPATHY pattern.
- "Thanks, that's all for now." / "Catch you later." / "Cheers mate." / "Talk soon." — Add SIGN_OFF pattern.

**Add patterns** (lib/planner.js):

```js
/** Light opinions: "What do you think about X?" */
const LIGHT_OPINION = /^what('?s| do you think) (about|of) \w+/i;
/** Light emotional disclosure: "I had a rough day", "Feeling a bit flat" */
const SOCIAL_EMPATHY = /^(i had a rough|feeling (a )?bit|i'm (feeling )?(a )?bit|rough day|long week)/i;
/** Sign-offs */
const SIGN_OFF = /^(thanks,? (that'?s )?all|catch you (later|soon)|cheers( mate)?|talk soon|gotta run|see you|bye)[\s!?.]*$/i;
```

**Extend casual logic:**

```js
const isLightOpinion = trimmed.length <= 80 && LIGHT_OPINION.test(norm);
const isSocialEmpathy = trimmed.length <= 100 && SOCIAL_EMPATHY.test(norm);
const isSignOff = trimmed.length <= 60 && SIGN_OFF.test(norm);

const casual = (isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity ||
  isCompoundGreeting || isWhatUpTo || isLightOpinion || isSocialEmpathy || isSignOff) && !looksLikeInstruction;
```

**Planner diagnostic log** (lib/planner.js):

```js
if (process.env.PIKO_LOG_PLANNER === '1') {
  console.log(`[PLANNER] Prompt: "${trimmed}" | casual: ${casual} | reason: ${casual ? (plan.reason || 'greeting/reciprocity/ack') : 'full'}`);
}
```

Run 21-suite with `PIKO_LOG_PLANNER=1` → count how many hit `casual: true`. Target ≥16.

**Target:** 16+ of 21 prompts must set `casual: true`. Run with instrumentation and count.

---

## Step 3 — Add "No Advice Unless Asked"

In CASUAL_SYSTEM_PROMPT (server.js), add:

```markdown
- Do not provide advice, coping strategies, or suggestions unless explicitly requested.
- For emotional statements ("rough day", "feeling flat"), respond with empathy only. Do not offer advice, solutions, reframing, or worldview unless asked.
```

This fixes helper bias on prompts 11 ("I had a rough day"), 12 ("Feeling a bit flat"), and 21 ("Feels like I'm not making progress") — they should get empathy, not "jot down what's stressing you."

---

## Step 4 — Tighten Casual Caps by Mode

**Current:** Single `max_tokens: 40` for all casual.

**Proposed:** Planner returns `casualMode` (GREETING | RECIPROCITY | SOCIAL_EMPATHY | LIGHT_OPINION | SIGN_OFF). Server uses:

| Mode | max_tokens | temperature |
|------|------------|-------------|
| GREETING | 24 | 0.6 |
| RECIPROCITY / SHORT_ACK | 28 | 0.65 |
| SOCIAL_EMPATHY / LIGHT_OPINION / SIGN_OFF | 32 | 0.65 |

(Implement as `plan.casualMode` from planner; default 28 if not set.)

---

## Step 5 — Upstream Forbidden List

Prepend to CASUAL_SYSTEM_PROMPT:

```markdown
Forbidden words: rain, rainy, spark, cozy, path, journey, forge, growth, reflect, ponder, quiet corner, clear the mind, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, perspective.
```

Use literal, concrete language only. No imagery, metaphor, abstraction.

---

## Step 6 — Nuclear Suppression (Expanded)

Add to CASUAL_SYSTEM_PROMPT rules:

```markdown
- Do NOT use: rainy days/mornings, quiet spots/corners, spark(ing) ideas, cozy, break free, grand visions, forging your own path, molds, authenticity, projects, theology, faith framing, corpus, truth block, jot down, regrouping, overwhelming, productive, stimulating, wander, flow, clear the mind, sort thoughts.
- Use literal, concrete, everyday language only.
```

---

## Step 7 — Sampling (Already Partially Done)

Confirm in server.js casual branch:
- `repeat_penalty: 1.3`
- `presence_penalty: 0.6`
- `frequency_penalty: 0.4`
- `temperature: 0.65`
- `max_tokens` per mode (24–32)

Confirm lib/llm.js passes these through.

---

## Step 8 — Post-Process

- Extend stripCasualThemeBleed with: `jot down`, `regrouping`, `overwhelming`, `productive`, `stimulating`, `wander`, `flow`, `rainy mornings`.
- Add repetition fallback: if unique words / total words < 0.6, replace with "Hey — what's good?"

---

## Mash-Up Diagnosis

If raw output (before stripping) contains:
> "Pretty good — yourself? Not bad, you? G'day — same here. Rainy mornings..."

Then:
- **If pre-strip:** Prompt ambiguity or system prompt has multiple example patterns that model concatenates. Simplify examples.
- **If post-strip:** Server-side concatenation bug. Trace storage/append logic.

Log raw output to decide.

---

## Validation

1. Deploy instrumentation + planner expansion + no-advice + caps + forbidden list.
2. Run with logging:

   ```bash
   PIKO_LOG_PLANNER=1 PIKO_LOG_CASUAL=1 PIKO_API_URL=http://localhost:3000/api/chat ./webchat-piko/scripts/test_piko_casual.sh 2>&1 | tee casual_test_$(date +%Y%m%d).log
   ```

   (Add `PIKO_LOG_RAW_CASUAL=1` when diagnosing mash-ups.)
3. Count: How many of 21 have `casual: true` in logs? Target ≥16.
4. Count: How many clean responses? Target ≥12–15/21.
5. If mash-ups persist, inspect raw logs.

**If <12/21 clean after runtime fixes** → check logs for: which prompts still show `casual: false` (missed routing), and raw output before stripping (mash-up source). Do this before proceeding to training.

---

## Phase 3.1.1 Training (After Runtime Fixes)

If runtime fixes yield ≥12/21 clean:
- Oversample casual to 18–20%
- Add literal anchor pack (~1,000 examples)
- Theology audit (remove attractor sentences)
- Train / export / deploy
- Target: ≥16/21 clean

---

## Success Criteria

| Milestone | Target |
|-----------|--------|
| Planner coverage | ≥16/21 prompts hit casual |
| After runtime fixes | ≥12/21 clean |
| After 3.1.1 retrain | ≥16/21 clean |

**If <12/21 clean after runtime fixes** → diagnose raw output (prompts hitting full path) before training.

---

## Files to Modify

| File | Changes |
|------|---------|
| lib/planner.js | Add LIGHT_OPINION, SOCIAL_EMPATHY, SIGN_OFF; extend casual; optional casualMode |
| server.js | Instrumentation logs; CASUAL_SYSTEM_PROMPT (no-advice, forbidden list, nuclear suppression); per-mode max_tokens; raw output log |
| lib/llm.js | Confirm options passed through (already done) |
| scripts/test_piko_casual.sh | Unique session per prompt (already done) |

---

## Bottom Line

Fix the router. Tighten entropy. Add no-advice rule. Instrument and inspect raw outputs. Then re-measure. Expected: 5/21 → 12–15/21 from runtime fixes alone; 16+ after retrain.
