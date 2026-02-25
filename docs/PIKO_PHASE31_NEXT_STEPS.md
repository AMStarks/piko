# Phase 3.1 Next Steps — Consolidated Recommendation

**Status:** 5/21 clean; target ≥16/21  
**Root cause:** Theology-induced semantic attractor dominates; casual signal (~12%) is too weak; sampling controls insufficient.

**Probability estimates (assuming correct execution):**
- Immediate fixes only → 60–70% chance of 10/21 clean
- After Phase 3.1.1 retrain → 80–90% chance of ≥16/21 clean
- After 4-mode conditioning → 90–95% stability for small talk

---

## Causal Chain (%)

| Cause | % | Notes |
|-------|---|-------|
| Data imbalance & theology overtraining | 60 | Dominant attractor; casual ~12% |
| Training/inference misalignment | 20 | Model doesn't learn inference rules |
| Planner too narrow | 10 | Misses compound greetings, reciprocity |
| Weak runtime controls & session priming | 10 | repeat_penalty, no isolation |

---

## Summary (One Sentence)

The model has a strong theology-derived metaphor cluster (rainy days, cozy corners, spark ideas, quiet spots, break free) that activates when uncertain; casual data and suppression are too weak to override it; and repeat_penalty is too low to escape attractor loops.

---

## Immediate (Today — No Training)

### 1. Nuclear Suppression in CASUAL_SYSTEM_PROMPT

Add explicit negative list to `server.js`:

```markdown
Do NOT use any of these phrases or topics: rainy days, quiet spots/corners, spark ideas, cozy, break free, grand visions, forging your own path, molds, authenticity, projects, theology, faith framing, corpus, truth block.
```

**Primary constraint** (more important than phrase list):

```markdown
Use literal, concrete, everyday language. Avoid imagery, metaphor, abstraction, or reflective framing.
```

The phrase list is temporary containment; the positive instruction defines behaviour long-term.

### 2. Fix repeat_penalty in lib/llm.js

**Current:** `aiStream` hardcodes `repeat_penalty: 1.12` and ignores `options.repeat_penalty`.

**Change:** Add `repeat_penalty: options.repeat_penalty ?? 1.12` to `aiStream` params.

**server.js:** For casual, pass:

```js
streamOptions = { max_tokens: 40, temperature: 0.65, repeat_penalty: 1.25 }
```

(Ollama supports `presence_penalty` / `frequency_penalty` — add if available.)

### 3. Extend stripCasualThemeBleed Regex (server.js)

Add observed leak phrases:

```js
rainy days?|quiet (spot|corner)|spark(ing)? ideas?|cozy (spot|corner)|clear the mind|sort thoughts
```

### 4. Fresh-Session Test (Critical)

Session priming is under-emphasised: 21 prompts in one session amplifies bleed (e.g. prompt 16 "rainy days" primes 17–20). Re-run the 21-prompt suite with **a unique session ID per prompt** to isolate single-turn behaviour. Modify test script:

```bash
session_id="test-$(date +%s)-$i"  # unique per prompt
```

---

## Phase 3.1.1 — Corrective Training (24–48h)

### 5. Oversample Casual to 18–20%

In `merge-datasets.js`, raise target ratio from 12% to ~18–20% for this corrective run.

### 6. Casual Lexical Anchor Pack (~1,000 examples)

Generate literal, metaphor-free casual data:

| Category    | Count | Constraint                      |
|------------|-------|----------------------------------|
| Greetings  | 200   | Literal only                    |
| Reciprocity| 200   | No add-ons, no metaphor         |
| Light opinions | 200 | Weather literal: "Fine by me — stay indoors" not "Rainy days clear the mind" |
| Short empathy | 150 | Empathy + 1 short Q max; no reframing |
| Capability | 100  | Plain answers                    |
| Sign-offs  | 100   | Nothing else                     |
| Neutral    | 50    | "Pretty standard" style          |

**Lexical blacklist** (disallow in casual responses):
rain, storm, spark, flame, path, journey, vision, mold, break free, clear the mind, sort thoughts, perspective, cozy, corner, quiet spot, wander, flow, reflect, ponder, forge, growth, purpose, meaning, identity, depth, transform, authentic, essence, mindset.

### 7. Scripts to Implement

- **`generate-casual-anchor-pack.js`** — Template-based generation with validator.
- **`lib/lexicalValidator.js`** — Blacklist check for casual data.
- Integrate validator in `merge-datasets.js` for `category === 'casual'`.

### 8. Theology Audit & Clean

- Grep theology chunks for: rainy, cozy, spark, quiet corner, break free, grand visions.
- **Nuance:** Do not over-clean. Remove casual-tone metaphor phrases; keep identity content. Avoid everyday conversational metaphors in theology data. You are separating domains, not sterilising theology.
- Re-run chunking and merge after edits.

---

## Phase 3.2 — Architecture (After 3.1.1)

### 9. Minimal 4-Mode Conditioning

Add mode header to system prompt:

```
MODE: GREETING | SOCIAL | TOPIC | REFLECTION
```

Planner assigns mode. Inject at top of system prompt.

- **GREETING:** Max 1 sentence, ≤12 words, literal.
- **SOCIAL:** 1–2 sentences, literal, empathy allowed.
- **TOPIC:** On-topic; no worldview injection unless asked.
- **REFLECTION:** Full identity allowed.

### 10. Entropy Separation

| Mode      | temperature | repeat_penalty | presence_penalty | max_tokens |
|-----------|-------------|----------------|------------------|------------|
| GREETING/SOCIAL | 0.65   | 1.25          | 0.2              | 40         |
| TOPIC     | 0.85        | 1.15          | 0.1              | 500        |
| REFLECTION| 0.9         | 1.12          | 0                | 1000       |

### 11. Semantic Drift Probability (SDP) Diagnostic

Implement `lib/semanticDriftAnalyzer.js`:

- Score each response 0–1 for metaphor density, abstract density, repetition, length.
- Target: casual turns < 0.15.
- Use for before/after comparison and regression checks.
- Add to server.js post-generation for casual: if SDP > 0.15, log warning.

---

## Do Not Do

- **Regex whack-a-mole** — Control class behaviour (literal vs metaphor) via prompt + training, not endless token lists.
- **Casual oversample > 20%** — Risk flattening identity; 18–20% is corrective only.
- **Rely on regex alone** — Combine with sampling + anchor pack.
- **Skip session isolation in tests** — Results will be misleading.

---

## Order of Execution

| Step | Action                          | When     |
|------|----------------------------------|----------|
| 1    | Nuclear suppression + literal constraint in CASUAL_SYSTEM_PROMPT | Today    |
| 2    | Fix aiStream repeat_penalty; pass 1.25 for casual | Today    |
| 3    | Extend stripCasualThemeBleed regex | Today    |
| 4    | Re-run 21-prompt suite with fresh session per prompt | Today    |
| 5–8  | Phase 3.1.1 training (anchor pack, oversample, theology audit) | 24–48h   |
| 9–11 | 4-mode conditioning, entropy, SDP diagnostic | After 3.1.1 |

---

## Success Criteria

- **After immediate fixes:** ≥10/21 clean, 0 Vegemite-style loops, reduced bleed on sign-offs.
- **After 3.1.1:** ≥16/21 clean, mean SDP < 0.2 for casual.
- **After 3.2:** Stable 4-mode separation, SDP in CI.

---

## Bottom Line

The flaw is not model capacity. Qwen 2.5 7B can do clean casual conversation.  
The flaw is: theology owns semantic gravity; casual has no strong literal attractor; sampling is too weak to escape the attractor.

Fix gravity (anchor pack), fix entropy (repeat_penalty, presence_penalty), add mode conditioning.  
Then the system will stabilise.
