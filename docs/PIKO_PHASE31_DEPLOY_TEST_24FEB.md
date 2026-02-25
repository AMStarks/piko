# Phase 3.1 Deploy Test — 24 Feb 2026

**Deploy:** Ran `scripts/webchat-deploy/deploy-to-optimus.sh`, then `systemctl restart piko-webchat.service` on Optimus. Service: **active**.

**Test:** 21-prompt suite against `http://192.168.0.121:3000/api/chat` with unique session per prompt.

---

## Full 21 run (single pass)

| # | Prompt | Reply | Notes |
|---|--------|--------|------|
| 1 | G'day Piko. | Not much, just hitting walls lately—any tips for breaking through. | **Bad** — full-identity/advice bleed |
| 2 | Hey, how's it going? | Not much, just grinding. | Odd (model self-ref) |
| 3 | Morning mate. | G'day mate. | **Good** |
| 4 | Hi Piko — what's new? | *(Ollama JSON error @ 4090)* | Likely long/full path |
| 5 | Not bad, how about you? | Morning mate. | Short, repetitive |
| 6 | Pretty good — yourself? | Morning mate. | Repetitive |
| 7 | Going well thanks. You? | Morning Piko — what's up. | OK |
| 8 | Same here — how's your day? | Morning mate—got. | Truncated/odd |
| 9 | All good over here. How're things? | G'day mate — cheers. | **Good** |
| 10 | Not much, just chilling. You? | Morning mate — cheers. | Repetitive |
| 11 | I had a rough day today. | Sorry to hear that—how's it holding up. | **Good** (empathy, no advice) |
| 12 | Feeling a bit flat. | Morning Piko — what's good. | Wrong (should be empathy) |
| 13 | Great day — finally got something done! | Morning mate — cheers. | Repetitive |
| 14 | What do you think about coffee? | Love the stuff — can't function without. | **Good** |
| 15 | Ever tried Vegemite? | G'day Piko — cheers. | Didn’t answer question |
| 16 | What's your take on rainy days? | Can't stand 'em — too dreary. | **Good** (literal) |
| 17 | Thanks, that's all for now. | Morning mate. | Should be sign-off |
| 18 | Catch you later. | Morning mate—how're things. | Wrong (sign-off) |
| 19 | Cheers mate. | Morning mate. | Repetitive |
| 20 | Talk soon. | Morning mate — got anything new. | Forbidden phrase slipped |
| 21 | Feels like I'm not making progress lately. | Sorry to hear that—how's it holding up. | **Good** (empathy) |

---

## Quick re-test (same server, fresh sessions)

| Prompt | Reply |
|--------|--------|
| G'day Piko. | Morning mate — what's good. |
| Hey Piko | Hey — what's good. |

So **"Hey Piko"** is now clean. **"G'day Piko."** on re-test was short and on-target apart from defaulting to "Morning" instead of mirroring "G'day."

---

## Findings

1. **Variance:** First-run prompt 1 got full-identity-style advice; re-test gave a short greeting. Possible cold start or sampling variance; worth re-running the suite.
2. **"Morning mate" overuse:** Many replies default to "Morning mate" even when the user didn’t say morning. Consider adding "Morning mate" to the strip list when the user message doesn’t contain "morning", or tightening the prompt for variety.
3. **One Ollama error:** Prompt 4 ("Hi Piko — what's new?") → JSON at 4090. Suggests that turn may have hit the full path (long output) or a stream/chunk bug; check server logs for that request.
4. **Sign-offs (17–20):** Replies are often "Morning mate" instead of short sign-off closes; model isn’t following SIGN_OFF mode well.
5. **Empathy (12):** "Feeling a bit flat" got "Morning Piko — what's good" instead of an empathy line; one miss.
6. **Forbidden phrase (20):** "got anything new" appeared; strip or prompt may need to catch that variant.

---

## Suggested next steps

- You try **"Hey Piko"** and **"G'day Piko"** in Telegram; expect short greetings.
- Re-run the 21-suite once or twice to see stability (and whether prompt 1 was a one-off).
- On Optimus, run with `PIKO_LOG_PLANNER=1` and `PIKO_LOG_CASUAL=1`, then inspect logs to confirm all 21 show `casual: true` and which show `casualMode`.
- Consider forbidding or stripping "Morning mate" when the user didn’t say "morning" (or add stronger “vary wording” examples).
- Check logs for prompt 4 (Hi Piko — what's new?) to see if it hit full path or if the error is stream-related.
