# Piko "unnatural chat" — review synthesis

Synthesis of external deep dives on why chat feels canned/stiff, with codebase corrections and what we adopted.

---

## 1. Corrections (review vs actual code)

| Review claim | Actual code | Note |
|--------------|-------------|------|
| Planner injects `challenge_level: 0.8` or `[PLAN: high verbosity]` | Planner uses **strings**: `verbosity` low/medium/high, `challenge_level` low/moderate. Injected as `**Response plan (this turn):** verbosity X, tone Y, …` | No numeric 0.8; plan line is one sentence, not a tag. |
| Sampling conservative: `temp=0.7?`, no top_p/repeat_penalty | **`lib/llm.js`**: `temperature: 0.9`, `top_p: 0.92`, `repeat_penalty: 1.12`, `min_p: 0.06` for Ollama | Sampling already warm; not the main lever. |
| History in-memory only | **SQLite** `sessionStore` (conversations.db); last 20 loaded. | Persisted; no "in-memory only" bloat. |

So: planner *does* add explicit constraints every turn; sampling is already fairly loose; history is persisted and capped.

---

## 2. Agreed diagnosis (why it feels unnatural)

- **Cognition-first vs momentum-first**  
  Pipeline is: beliefs → planner → LLM. That gives coherent, constrained output. Natural chat often follows rhythm and short-term context more than full belief state. We optimize for stability; that can feel "processed."

- **Planner visibility**  
  Every turn gets a full "Response plan (this turn): verbosity X, tone Y, follow-up questions N, challenge Z." The model sees a spec and tends to fulfill it in a structured way (lists, balanced tone). So even with low verbosity + warm tone, the *presence* of a plan nudges toward "constructed" replies.

- **No conversational phase / mode**  
  We don't model "right now we're in small talk" vs "technical" vs "reflective." So every message goes through the same cognitive funnel. The review's "conversation phase model" or "surface modulation layer" is the right direction: a lightweight sense of *moment* (greeting, casual, technical) that slightly overrides or simplifies the plan for that turn.

- **Over-smooth output**  
  Damping and consistency reduce the small variability (tone shifts, occasional short/lazy replies) that makes human chat feel natural. We didn't add "controlled imperfection," so replies can feel a bit too even.

- **Support-bot defaults**  
  Models default to "How can I assist you today?" style. We've added explicit anti-canned rules and examples; more is better (we keep tightening SOUL/IDENTITY and the final style reminder).

---

## 3. What we've already done (this pass + earlier)

- **Corpus:** "From corpus" only for direct factual corpus questions; never for greetings/status/small talk.
- **SOUL:** Anti-meta, anti support-bot phrase list, good/bad small-talk example, "Reply like a person."
- **Style reminder:** One line at end of system prompt: "No From corpus for greetings/small talk; no How can I assist you today?; one short line when that fits."
- **Greeting detection:** Short "hi/hey/hello" etc. → verbosity low, tone warm.
- **Session:** Per-channel sessions; "main" cleared so app doesn't carry old Tripview/corpus cruft.
- **Sampling:** Already temp 0.9, top_p 0.92, repeat_penalty 1.12 (no change needed for "conservative" claim).

---

## 4. What we added from the review (lightweight "casual" path)

- **Planner:**  
  - Expanded beyond strict greeting regex to **casual small-talk**: short messages (≤80 chars) matching phrases like "how are things", "what's new", "learned anything", "not much", "how's it going", etc.  
  - For greeting or casual small-talk we set `verbosity: low`, `tone: warm`, `follow_up_questions: 0` and **`casual: true`** on the plan.

- **Server:**  
  - When **`plan.casual`** is true, we **replace the full plan line** with a single short instruction:  
    `**This turn:** Casual. One short line, no lists, no structure. Reply like a mate.`  
  - So for greetings and small-talk the model no longer sees "verbosity low, tone warm, follow-up questions 0, challenge low, assume familiarity true" and instead gets one simple "casual, one line, no structure" nudge. That reduces visible optimization and should help flow.

No new "conversation phase" service or turn-level state; just a broader casual detector and a simpler plan line for those turns.

---

## 5. Deferred (not implemented)

- **PIKO_PLANNER_OFF** or disabling planner for some turns — we keep the planner; we only soften *how* it's expressed for casual turns.
- **Full conversational phase model** (Greeting / Casual / Technical / Reflective / Closing) with mode-specific depth and tempo — agreed as the right direction; deferred to a later "interaction dynamics" layer.
- **Turn momentum state** (ephemeral "interaction_mode" from last 2–3 messages) — deferred.
- **Micro-style / conversational_variability layer** — deferred.
- **History compaction** beyond last 20 (e.g. trim to 50, dedup) — optional later; we have session-reset for clean slate.
- **Model upgrade** (e.g. 32B/70B) — doc-only; set `OLLAMA_MODEL` when hardware allows.
- **Fine-tuning / LoRA** for persona — long-term; not in this pass.

---

## 6. Summary

- **Root cause** is not one bug but **interaction dynamics**: we optimized for cognitive coherence and stability; natural chat benefits from a sense of *moment* and slightly less visible structure for small talk.
- **Implemented:** Stricter corpus use, stronger anti-canned SOUL + style reminder, **casual small-talk detection** in planner, and a **short "casual" plan line** so greetings and small-talk get "One short line, no lists, reply like a mate" instead of the full plan. Sampling was already warm; no change there.
- **Next steps (when you want to go further):** Add a thin "conversation phase" or "surface modulation" layer (mode from last few messages, mode influences plan or final prompt line only; no belief changes). Optionally try a larger model via `OLLAMA_MODEL` if hardware allows.

This keeps identity and belief safety intact while giving casual turns a simpler, less engineered nudge.
