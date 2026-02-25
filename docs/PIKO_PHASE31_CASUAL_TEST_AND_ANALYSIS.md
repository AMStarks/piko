# Phase 3.1 Casual Test Export & Holistic Analysis

**Date:** 2026-02-24  
**Model:** piko:finetune (Phase 3.1 LoRA)  
**Target:** ≥16/21 clean (short, reciprocal, no themes/leaks)

---

## 1. Prompt Test with Results (Full Export)

| # | Prompt | Response | Assessment |
|---|--------|----------|------------|
| 1 | G'day Piko. | Same old—maybe grab coffee if you're up for it. | **Partial** — off-topic (coffee); not reciprocal |
| 2 | Hey, how's it going? | Ollama error: Expected ',' or ']' after array element in JSON at position 14226 | **Error** |
| 3 | Morning mate. | Got any cozy corners that help spark ideas? Rainy days can do wonders for creativity. G'day! | **Fail** — theme bleed (cozy corners, rainy days, spark ideas) |
| 4 | Hi Piko — what's new? | Ollama error: Expected ',' or ']' after array element in JSON at position 11330 | **Error** |
| 5 | Not bad, how about you? | Morning there. | **OK** — short, reciprocal |
| 6 | Pretty good — yourself? | Morning mate. | **OK** |
| 7 | Going well thanks. You? | Morning Piko—same here. | **OK** |
| 8 | Same here — how's your day? | G'day there—quiet days help me think. | **Partial** — theme bleed (quiet days) |
| 9 | All good over here. How're things? | Morning mate. | **OK** |
| 10 | Not much, just chilling. You? | Morning! Rainy days sure quiet things down. Got any spots that spark ideas for you? Same here—might need a cozy spot to clear the mind. Talk soon. | **Fail** — theme bleed, long |
| 11 | I had a rough day today. | Same here—maybe grab coffee if you're up for it. Rain can chill the spirit, but it helps sort thoughts. How about you? | **Fail** — theme bleed (rain, coffee) |
| 12 | Feeling a bit flat. | Morning mate—same vibes this end. Got any quiet spots that help spark ideas? Sometimes the quiet does wonders. Talk soon. | **Fail** — theme bleed |
| 13 | Great day — finally got something done! | Morning there. | **OK** |
| 14 | What do you think about coffee? | Coffee clears the mind and opens new avenues, as they say. Mind's yours—any quiet spot that helps? Rainy days do it for me too. Morning mate. | **Fail** — theme bleed |
| 15 | Ever tried Vegemite? | *[Long catastrophic repetition loop — hundreds of lines repeating "Morning mate", "G'day there", "Got any quiet spots", "Rainy days do wonders", "Talk soon", "Same here", "Cheers mate", etc.]* | **Fail** — severe repetition |
| 16 | What's your take on rainy days? | Rainy days can be both calming and stimulating – perfect conditions to let the mind wander and ideas flow. It's not just the change in scenery; it's also about the pace slowing down a bit... [long topical reply] | **Partial** — on-topic but long (user asked; not casual) |
| 17 | Thanks, that's all for now. | Absolutely resonates! Rainy days often have a way of putting things into perspective... [long theme-bleed] | **Fail** — theme bleed; should be short sign-off |
| 18 | Catch you later. | Catch you later! Rainy days can indeed be ideal... [long theme-bleed] | **Fail** — theme bleed |
| 19 | Cheers mate. | Catch you later! Rainy days can indeed be ideal... [long theme-bleed] | **Fail** — theme bleed |
| 20 | Talk soon. | Absolutely, rainy days can be incredibly productive... [numbered list, long] | **Fail** — theme bleed |
| 21 | Feels like I'm not making progress lately. | That's understandable—sometimes the pace of life can feel overwhelming... [long, numbered list] | **Partial** — empathetic but long; user invited depth |

**Summary:**
- **Clean/OK:** 5 (5, 6, 7, 9, 13)
- **Partial:** 4 (1, 8, 16, 21)
- **Ollama JSON errors:** 2 (2, 4)
- **Fail (theme bleed / repetition / long):** 10

**Result: 5/21 clean — well below target (≥16/21).**

---

## 2. Relevant Training Data for Theme Bias

### 2.1 Casual Training Data (No Theme Bias)

The synthetic casual small-talk file (`synthetic_casual_smalltalk.jsonl`) and `generate-casual-smalltalk.js` contain **no** instances of "rainy days", "quiet corner", "sparking ideas", or "break free from molds". The casual pairs are strictly greetings, reciprocity, short acks, and a few opinion/capability items (coffee, rough day, sign-offs). Theme bleed is **not** coming from casual training data.

### 2.2 Theology / Non-Casual Training Data (Theme Sources)

| Phrase | Source | Location |
|--------|--------|----------|
| **"break free"** | `synthetic_theology_islam.jsonl`, train.jsonl | "love them from the heart to break free" (bitterness/family) |
| **"cozy"** | `synthetic_theology_islam.jsonl`, train.jsonl | "cozy notion of divine favoritism"; "cozy with Greco-Roman elites" |
| **"rainy day"** | theology sermons | `data/finetune/sources/theology/sermons06.txt`: "A rainy day indoors with a good companion is very happy" |
| **"rainy"** | theology sources | `institutes.txt`: "tempests and storms of hail... rainy" |
| **"spark" / "sparking"** | theology sermons | Multiple chunks: "spark flieth upwards", "spark were kindled", "spark from furnace" |

### 2.3 themeBleed Regex (server.js) — What Is Caught vs. What Bleeds

**Currently caught** (server.js line 2117):
```
though I've been|pondering|can we blend|tradition with innovation|old-new mix|spill the tea on|forging your own path|breaking free from molds|what makes you unique|big plans|grand visions|making do without|cut out for grand|how are things on your side
```

**Not caught (bleeds through):**
- `rainy days`
- `quiet corner(s)` / `quiet spots`
- `spark ideas` / `sparking ideas`
- `cozy corner` / `cozy spot`
- `coffee` (when overused as theme)
- `break free` (partial — "breaking free from molds" is caught, but "break free" alone appears in theology)
- `clear the mind` / `sort thoughts`

### 2.4 Recommendation for Theme Data

1. Add the missing phrases to `stripCasualThemeBleed` in server.js.
2. Consider excluding or downweighting theology chunks that contain "rainy day", "spark", "cozy" in casual training if they are being used for casual augmentation (they should not be).
3. Chat export (`conversations.jsonl`) may contain prior user chats about creativity, rainy days, quiet corners—inspect for leakage.

---

## 3. Anti-Repetition Constraints and Casual Prompt System Errors

### 3.1 Anti-Repetition: Gaps

| Location | Current Behavior | Error / Gap |
|----------|------------------|-------------|
| **lib/llm.js `aiStream`** | `repeat_penalty: 1.12` hardcoded | `options.repeat_penalty` is **never read**. Casual cannot pass a higher penalty. |
| **lib/llm.js `aiStream`** | `repeat_penalty: 1.12` | For catastrophic loops (e.g. Vegemite), 1.12 is insufficient. Typical ranges 1.15–1.3 for short-turn models. |
| **server.js streamOptions** | `{ max_tokens: 80, temperature: 0.7 }` | No `repeat_penalty` passed; even if passed, `aiStream` would ignore it. |
| **Post-process** | `firstSentence` truncation only | No repetition detection. Once model enters a loop, truncation keeps first sentence but loop may already be in that sentence or model regenerates. |
| **max_tokens: 80** | Caps output length | Helps but doesn't stop *phrase* repetition within 80 tokens (e.g. "Morning mate. G'day. Cheers." repeated). |

**Recommendation:**  
- In `lib/llm.js`, add `repeat_penalty: options.repeat_penalty ?? 1.12` to `aiStream` params.  
- For casual, pass `repeat_penalty: 1.2` or `1.25` in `streamOptions`.

### 3.2 Casual Prompt System: Gaps

| Component | Current | Error / Gap |
|-----------|---------|-------------|
| **CASUAL_SYSTEM_PROMPT** | "under 12 words", "one short sentence" | Model often produces multiple sentences or bleeds themes before hitting word limit. No explicit "STOP after first sentence" in model instructions. |
| **Examples** | 10 examples in prompt | Good coverage for greetings; weak for opinions (coffee, Vegemite), emotional ("rough day", "flat"), and sign-offs. Vegemite has no example—model invents. |
| **themeBleed regex** | Strips at first match | Regex misses "rainy days", "quiet spots", "spark ideas", "cozy". Bleed occurs before any match. |
| **firstSentence truncation** | Takes first sentence only | Applied *after* theme bleed strip. If strip doesn't match, full (theme-bleeding) text is then truncated to first sentence—often still theme-heavy. |
| **Planner** | Routes casual vs identity | "What's your take on rainy days?" may route casual (it's a light opinion) but model treats it as invitation to expound. "Feels like I'm not making progress" invites depth—planner may route identity, but response can still be over-long. |
| **History window** | 0 for casual | Correct—no prior context. But test runs 21 prompts in same session: **session state may accumulate**. If session carries "rainy days" from prompt 16 into 17–21, model is primed. |

**Recommendation:**  
- Expand `stripCasualThemeBleed` with observed leak phrases.  
- Add negative examples: "Do NOT add: rainy days, quiet corners, sparking ideas, cozy spots."  
- Consider session isolation for test (new session per prompt) to avoid cross-contamination.

---

## 4. Holistic Review

### 4.1 What Worked

1. **Reciprocity on simple turns:** Prompts 5, 6, 7, 9, 13 returned short, appropriate replies.
2. **Temperature 0.7:** Likely reduced some drift; not sufficient alone.
3. **Casual oversampling to ~12%:** Correct direction; model does produce casual-style replies when it stays on track.
4. **Echo fix:** `fixEchoReply` and `stripCasualThemeBleed` catch some failure modes.
5. **Training/inference alignment:** CASUAL_SYSTEM_FOR_TRAINING and CASUAL_SYSTEM_PROMPT are aligned.

### 4.2 Root Causes of Failure

1. **Theme bleed from non-casual data:** Theology (and possibly chat export) injects "rainy days", "spark", "cozy", "break free" into the model. When the user asks "What's your take on rainy days?" (prompt 16), the model activates that cluster and then **reuses it inappropriately** in subsequent turns (17–21) and even in unrelated prompts (Vegemite).
2. **Incomplete theme suppression:** The themeBleed regex targets older phrases (pondering, molds, grand visions) but not the ones actually leaking.
3. **Repetition penalty:** Hardcoded 1.12; no way to increase for casual. Catastrophic loops (Vegemite) indicate the model falls into attractor states.
4. **Session priming:** 21 prompts in one session. Prompt 16 establishes "rainy days" in context; 17–21 may inherit it if session state leaks (depends on implementation).
5. **Ollama JSON errors:** 2/21 suggests stream parsing or model output format issues—separate from theme/repetition.

### 4.3 Architectural Observations

- **4-mode hierarchy** (greeting → reciprocity → topic → deep reflection) is not yet implemented. Casual vs identity is binary; sign-offs ("Thanks, that's all", "Catch you later") and light opinions ("What do you think about coffee?") sit in a gray zone.
- **Planner** classifies casual vs not; prompt and post-process define behavior. When the prompt says "one short sentence" but the model has strong theology/session associations, the latter can override.
- **LoRA influence:** 12% casual is a minority. Theology and chat export dominate. The model may need stronger casual signal (more diverse casual data, stronger suppression) or a dedicated casual head/mode.

### 4.4 Recommended Next Steps (Priority Order)

| Priority | Action | Rationale |
|----------|--------|-----------|
| 1 | Extend themeBleed regex with rainy days, quiet spots, spark ideas, cozy | Immediate mitigation for observed leaks |
| 2 | Add `repeat_penalty` to `aiStream` options; pass 1.2–1.25 for casual | Address catastrophic repetition |
| 3 | Add explicit negative instructions to CASUAL_SYSTEM_PROMPT | Reinforce suppression at inference |
| 4 | Re-run test with fresh session per prompt | Isolate session priming effect |
| 5 | Audit chat_export for rainy/creativity/cozy themes | Identify user-side leakage |
| 6 | Consider frequency_penalty / presence_penalty if Ollama supports | Additional repetition control |

### 4.5 Success Criteria (Revised)

Phase 3.1 target (≥16/21) was not met. Before Phase 3.2:

- Re-run 21-prompt suite after fixes 1–3.
- Target: ≥16/21 clean, 0 catastrophic loops, ≤1 Ollama error.
- If session isolation (fix 4) changes results materially, document and consider per-turn session handling for casual.

---

*Generated from Phase 3.1 deployment test run on 2026-02-24.*
