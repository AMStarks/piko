# Phase 3.1 — 21-Example Planner Logs

**Run:** Planner classification only (no live API). All 21 prompts route to **casual** isolation.

---

## Planner logs (per prompt)

| # | Prompt | casual | mode | reason |
|---|--------|--------|------|--------|
| 1 | G'day Piko. | true | GREETING | greeting |
| 2 | Hey, how's it going? | true | GREETING | compound_greeting |
| 3 | Morning mate. | true | GREETING | greeting |
| 4 | Hi Piko — what's new? | true | GREETING | greeting_what_new |
| 5 | Not bad, how about you? | true | RECIPROCITY | social_reciprocity |
| 6 | Pretty good — yourself? | true | RECIPROCITY | social_reciprocity |
| 7 | Going well thanks. You? | true | RECIPROCITY | social_reciprocity |
| 8 | Same here — how's your day? | true | RECIPROCITY | social_reciprocity |
| 9 | All good over here. How're things? | true | RECIPROCITY | social_reciprocity |
| 10 | Not much, just chilling. You? | true | RECIPROCITY | not_much_you |
| 11 | I had a rough day today. | true | SOCIAL_EMPATHY | social_empathy |
| 12 | Feeling a bit flat. | true | SOCIAL_EMPATHY | social_empathy |
| 13 | Great day — finally got something done! | true | RECIPROCITY | social_reciprocity |
| 14 | What do you think about coffee? | true | LIGHT_OPINION | light_opinion |
| 15 | Ever tried Vegemite? | true | LIGHT_OPINION | ever_tried |
| 16 | What's your take on rainy days? | true | LIGHT_OPINION | light_opinion |
| 17 | Thanks, that's all for now. | true | SIGN_OFF | sign_off |
| 18 | Catch you later. | true | SIGN_OFF | sign_off |
| 19 | Cheers mate. | true | SIGN_OFF | sign_off |
| 20 | Talk soon. | true | SIGN_OFF | sign_off |
| 21 | Feels like I'm not making progress lately. | true | SOCIAL_EMPATHY | social_empathy |

---

## Mode breakdown

| Mode | Count | Prompts |
|------|-------|---------|
| GREETING | 4 | 1, 2, 3, 4 |
| RECIPROCITY | 6 | 5, 6, 7, 8, 9, 10, 13 |
| SOCIAL_EMPATHY | 3 | 11, 12, 21 |
| LIGHT_OPINION | 3 | 14, 15, 16 |
| SIGN_OFF | 4 | 17, 18, 19, 20 |

**casual: 21/21** (target was ≥16)

---

## What the server would log (when API is running)

With `PIKO_LOG_CASUAL=1` or `PIKO_DEBUG_CASUAL=1`, each request would emit:

```json
[CASUAL] {"sessionId":"test-casual-...","casual":true,"casualMode":"GREETING","reason":"greeting","historyLen":0,"maxTokens":24,"temperature":0.6,"repeatPenalty":1.25}
```

With `PIKO_LOG_RAW_CASUAL=1`, before post-processing:

```json
[RAW_CASUAL] {"msg":"G'day Piko.","reply":"G'day mate. ..."}
```

To capture full request/response logs, run:

```bash
PIKO_LOG_PLANNER=1 PIKO_LOG_CASUAL=1 PIKO_API_URL=http://localhost:3000/api/chat ./webchat-piko/scripts/test_piko_casual.sh 2>&1 | tee casual_test.log
```

(Server must be running and `PIKO_LOG_*` set in its environment or `.env`.)
