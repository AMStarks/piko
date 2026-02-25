# Phase 3.1.1 Immediate Fixes — Deploy & Test Comparison

**Deployed:** 2026-02-24  
**Changes:** Nuclear suppression + literal constraint in CASUAL_SYSTEM_PROMPT; repeat_penalty 1.25 + presence/frequency_penalty for casual; extended themeBleed regex; casual max_tokens 40, temp 0.65; unique session per prompt.

---

## Before (Phase 3.1 — single session, 5/21 clean)

| # | Prompt | Result | Notes |
|----|--------|--------|-------|
| 1 | G'day Piko. | Partial | Off-topic coffee |
| 2 | Hey, how's it going? | **Error** | Ollama JSON |
| 3 | Morning mate. | Fail | Theme bleed (cozy corners, rainy days) |
| 4 | Hi Piko — what's new? | **Error** | Ollama JSON |
| 5–7, 9, 13 | Reciprocity / greeting | **OK** | Short, reciprocal |
| 8, 10–12, 14 | Various | Fail | Theme bleed, long |
| 15 | Ever tried Vegemite? | Fail | Catastrophic repetition loop |
| 16–20 | Sign-offs / rainy days | Fail | Theme bleed |
| 21 | Feels like not making progress | Partial | Long but on-topic |

**Summary:** 5 clean, 2 Ollama errors, 10 fail, 4 partial.

---

## After (Immediate fixes — unique session per prompt)

*Based on second full run; prompts 15–21 not in captured log.*

| # | Prompt | Result | Notes |
|----|--------|--------|-------|
| 1 | G'day Piko. | **OK** | "G'day — how's it going." |
| 2 | Hey, how's it going? | Fail | Long; theme bleed (rainy days). Likely not routed casual. |
| 3 | Morning mate. | **Error** | Unexpected end of JSON |
| 4 | Hi Piko — what's new? | **Error** | Unexpected end of JSON |
| 5 | Not bad, how about you? | **Error** | Unexpected end of JSON |
| 6 | Pretty good — yourself? | Partial | "Not much, just chilling." (slight echo) |
| 7 | Going well thanks. You? | **OK** | "G'day — same here." |
| 8 | Same here — how's your day? | **OK** | "Not bad, you." |
| 9 | All good over here. How're things? | **OK** | "Not much, just chilling." |
| 10 | Not much, just chilling. You? | **Error** | Unexpected end of JSON |
| 11 | I had a rough day today. | Fail | Theme bleed (rainy days, self-care) |
| 12 | Feeling a bit flat. | **Error** | Ollama JSON position 14226 |
| 13 | Great day — finally got something done! | **OK** | "Good to hear that—keep it up." |
| 14 | What do you think about coffee? | Fail | Theme bleed (rainy mornings) |
| 15–21 | (Vegemite, rainy days, sign-offs, progress) | — | Not in log (run truncated) |

**Summary (1–14):** 5 clean, 1 partial, 5 Ollama errors, 3 fail.

---

## Comparison

| Metric | Before | After (1–14 only) |
|--------|--------|-------------------|
| **Clean** | 5/21 | 5/14 (≈ same rate) |
| **Ollama errors** | 2/21 | 5/14 (worse) |
| **Theme bleed (when reply returned)** | High | Still present on 2, 11, 14 |
| **Vegemite loop** | Yes (catastrophic) | Not observed (15 not completed) |
| **Session isolation** | No | Yes (unique session per prompt) |

---

## Findings

1. **Clean reciprocity** when casual path is used (1, 7, 8, 9, 13) is good: short, literal, no theme bleed.
2. **Ollama errors increased** (5 vs 2). Possible causes: stricter max_tokens (40), stream/JSON handling, or model output format. Worth checking server logs and `/api/chat` response shape when `stream: false`.
3. **Prompts 2, 11, 14** still get long, theme-heavy replies → likely **not** classified as casual (planner), so they use full identity prompt. Planner should treat "Hey, how's it going?", "I had a rough day today.", "What do you think about coffee?" as casual/social.
4. **No Vegemite-style loop** in the truncated run; need a full 21-prompt run to confirm.
5. **Session isolation** is in place; run-to-run variation (e.g. run 1 vs run 2) suggests non-determinism and/or routing differences.

---

## Recommended Next Steps

1. **Planner:** Broaden patterns so compound greetings ("Hey, how's it going?"), light opinions ("What do you think about coffee?"), and emotional lines ("I had a rough day") route to casual.
2. **Ollama errors:** Reproduce with `stream: false`, inspect server and Ollama logs, and confirm response JSON structure (e.g. truncation at 40 tokens causing invalid JSON).
3. **Re-run full 21-prompt suite** to capture 15–21 and confirm no catastrophic loop.
4. **Phase 3.1.1 training:** Proceed with anchor pack, 18–20% casual, theology audit to strengthen literal casual attractor and reduce reliance on suppression alone.
