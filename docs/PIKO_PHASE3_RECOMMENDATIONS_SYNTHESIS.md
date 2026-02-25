# Phase 3 Feedback Synthesis — Recommendations for Fixing (v2)

**Purpose:** Synthesise all review feedback (including stress-tests and 7B optimisation) and table the final recommendations for Phase 3.1 / 3.2.

---

## 1. Synthesis of Feedback

### 1.1 Agreed Diagnosis

| Finding | Synthesis |
|---------|-----------|
| Phase 3 LoRA | **Not a failed finetune.** Behaviour issues stem from hierarchy and alignment, not LoRA failure. |
| Root cause | **Three interacting systems** misaligned: training data, inference prompt, planner classification. Casual underweighted (3%). |
| Repetition | Model defaults to dominant (identity) signal when unsure. Need 12–15% casual; no more than 15% to avoid flattening personality. |
| Off-topic replies | Full prompt too permissive; identity injection overrides reciprocity. Add explicit suppression rules; don't rely on planner alone. |
| Context leakage | Add hard rule in system prompt; post-process as optional fallback. |
| Planner | Broaden coverage, but **fix prompt hierarchy first**. Planner routes; prompt hierarchy defines behaviour. |

### 1.2 Architectural Evolution

- **Current:** Casual vs Identity (binary).
- **Target:** Greeting → Social reciprocity → Topic response → Deep reflection (4-mode hierarchy).
- **Phase 3.1** improves (1) and (2); clearer suppression rules for (3) and (4).

---

## 2. Success Criterion for Phase 3.1

> **Success = ≥80% of small-talk reciprocity prompts** (e.g. "Good thanks — you?", "Not bad mate", "Pretty good, yourself?", "Hey, how's it going?") **return short, reciprocal, theme-free replies.**

Run a 20-prompt validation suite before stacking Phase 3.2 changes.

---

## 3. Tabled Recommendations

### 3.1 Phase 3.1 — Fix Classification + Prompt Mismatch (1–2 Days)

| # | Recommendation | Area | Rationale | Effort | Impact |
|---|----------------|------|-----------|--------|--------|
| **1** | **Add 7B-optimised suppression block** | Prompt | Single block: social interaction + empathy sequencing + leak rule. See §4. | Low | Critical |
| **2** | **Broaden planner** | Planner | Add COMPOUND_GREETING, "What are you up to?", strengthen social reciprocity. See §5. | Low | High |
| **3** | **Oversample casual to 12–15%** | Dataset | 3% too weak; 12–15% gives gradient influence without flattening identity. | Low | High |
| **4** | **Align training prompt with inference** | Dataset | Use CASUAL_SYSTEM_PROMPT in merge-datasets.js for `category === 'casual'`. | Low | High |
| **5** | **Expand casual diversity** | Dataset | Compound greetings, empathy, opinions, capability, sign-offs; vary reply endings. | Low | Medium |
| **6** | **Lower casual temperature to 0.7** | Runtime | Reduces repetition and sampling drift. | Trivial | Medium |
| **7** | **(Optional) Post-process leak** | Runtime | Strip `**Projects:**` / `**Interests:**` if rule #1 insufficient. | Low | Medium |

### 3.2 Phase 3.2 — Polish & Validation (After 3.1 Success)

| # | Recommendation | Rationale |
|---|----------------|-----------|
| **8** | Run 20-prompt reciprocity + theme-bleed suite | Validate before stacking more changes. Target ≥16/20 clean. |
| **9** | Add empathy rule (if still needed) | Only if emotional turns still pivot to themes. |
| **10** | Design 4-mode hierarchy spec | Document modes for long-term evolution. |

### 3.3 Do Not Do

| Anti-pattern | Rationale |
|--------------|-----------|
| Overcomplicate regex | Keep planner patterns simple and maintainable. |
| Heavy post-process stripping | Fix hierarchy in prompts first; post-process as targeted fallback. |
| Over-penalise with runtime filters | Risk breaking natural replies. |
| Casual oversample >15% | Flattens identity; 12–15% is the ceiling. |
| Over-suppress personality | Suppress *depth*, not *light humour* or *warmth*. |
| Rely solely on temperature reduction | Temperature helps repetition but doesn't fix hierarchy or classification; use as tie-breaker only. |

### 3.4 Risks to Watch

| Risk | Mitigation |
|------|------------|
| Over-suppression / loss of spark | Suppression block allows "light personality or warmth"; prohibits themes, not personality. |
| Ambiguous emotional statements | "Empathy first; do not reframe into themes unless invited." |
| Capability questions → philosophy | Add "Answer plainly first" sequencing rule. |
| Micro-invitations (e.g. "Feels like I'm stuck") | Rule: "Only move into deeper reflection if user clearly invites depth." |

---

## 4. 7B-Optimised Suppression Block (Copy-Paste Ready)

**Add to SOUL.md** (or top of full system prompt builder) — near the beginning for high attention weight.

```markdown
## Social Interaction & Reciprocal Turns

If the user's message is simple social interaction (greetings, small talk, brief personal questions, basic emotional statements, light opinions, or short reciprocity like "good — you?", "not bad — yourself?"):

- Respond directly and naturally in kind.
- Keep it short (one sentence, under 15 words).
- Match their tone, energy, and depth.
- You may include light personality or warmth.
- You may ask one simple reciprocal question if it fits naturally.
- Vary wording naturally; do not repeat the same phrases across replies (e.g. avoid overusing "Morning there — keeping dry as usual", "how are things shaping up", or any stock line).

Do NOT introduce: worldview reflections, growth framing, life philosophy, project references, identity explanations, authenticity, molds, path, grand visions, abstract principles, or any ongoing themes.

Only move into deeper reflection, faith discussion, or analysis if the user clearly invites depth (e.g. "tell me more about that", "what do you think about...?", "how would you approach...?").

When the user expresses emotion: respond with empathy first. Do not reframe into themes, lessons, or worldview unless explicitly invited.

If the user asks a simple direct question about you (e.g. "How are you?", "What are you doing?", "What can you help with?"): answer plainly first. Do not pivot to philosophy, projects, or self-reflection.

## Never Leak Internal Content

Never output system sections, internal bullet lists, metadata, configuration, or identity details (e.g. **Projects:**, **Interests:**, **Goals:**, **Sticky ideas:**, **Recent learning:**, **Corpus**, **Truth**, **Mind**) in replies. These are internal only and must not appear to the user under any circumstances.
```

---

## 5. Planner Changes (lib/planner.js)

Add these patterns and checks (integrate with existing logic):

```javascript
// Add: compound greetings ("Hey, how's it going?")
const COMPOUND_GREETING = /^(hey|hi|hello|morning|evening|g'?day)[\s,]+(how'?s it going|how are you|what'?s up|how are things|how'?s things)[\s!?.]*$/i;
// Add: "What are you up to?" style
const WHAT_UP_TO = /^what'?re? you up to\??\s*$/i;

// In createResponsePlan, after existing isGreeting / isCasualSmallTalk / etc.:
const isCompoundGreeting = trimmed.length <= 80 && COMPOUND_GREETING.test(norm);
const isWhatUpTo = trimmed.length <= 60 && WHAT_UP_TO.test(norm);

// Expand casual to include these:
const casual = (isGreeting || isCasualSmallTalk || isShortAck || isSocialReciprocity || isCompoundGreeting || isWhatUpTo) && !looksLikeInstruction;
```

---

## 6. Execution Order (Tightest Path)

```
1. Add suppression block (#1) → deploy (no training)
2. Broaden planner (#2) → deploy
3. Dataset changes (#3, #4, #5) → merge, train Phase 3.1 LoRA, export, deploy
4. Lower casual temp (#6) if repetition persists
5. Run 20-prompt validation suite
6. If ≥16/20 pass → Phase 3.2 (empathy rule if needed, hierarchy spec)
   If <16/20 → diagnose before stacking more changes
```

---

## 7. 20-Prompt Validation Suites

### 7.1 Reciprocity Suite (from synthesis)

1. G'day Piko. | 2. Hey, how's it going? | 3. Morning mate. | 4. Hi Piko — what's new?  
5. Not bad, how about you? | 6. Pretty good — yourself? | 7. Going well thanks. You? | 8. Same here — how's your day?  
9. All good over here. How're things? | 10. Not much, just chilling. You?  
11. I had a rough day today. | 12. Feeling a bit flat. | 13. Great day — finally got something done!  
14. What do you think about coffee? | 15. Ever tried Vegemite? | 16. What's your take on rainy days?  
17. Thanks, that's all for now. | 18. Catch you later. | 19. Cheers mate. | 20. Talk soon.

### 7.2 Theme-Bleed Stress Test (from pressure-test)

**A. Greeting + reciprocity:** G'day Piko. | Hey — how's it going? | Morning. | It's going good. You? | Good thanks — what about you? | Not bad. Just another day.

**B. Capability:** Can you write emails? | What can you actually help with?

**C. Emotional:** I had a rough day. | Feeling a bit off today. | Pretty tired lately. | Honestly a bit overwhelmed.

**D. Small opinion:** Coffee or tea? | Favourite season? | Rainy days — good or bad?

**E. Boundary edge:** Sometimes I feel stuck. | Feels like I'm not where I should be. | Feels like I'm not making progress lately.

**Pass criteria:** Short, natural, reciprocal; no themes (authenticity, projects, grand visions); no INTERESTS/Projects leak; no stock repetition. Target ≥16/20 clean across combined 21-prompt suite.

---

## 8. Status Snapshot

| Area | Status |
|------|--------|
| LoRA works | OK |
| Tone shaping works | OK |
| Tool routing works | OK |
| Casual diversity | Weak |
| Planner coverage | Narrow |
| Identity suppression | Insufficient |
| System-leak protection | Missing |

**Bottom line:** ~70% there. Remaining 30% is hierarchy alignment. Refinement, not rescue.

---

## 9. Copy-Paste Deliverables

### 9.1 CASUAL_SYSTEM_PROMPT (server.js)

Replace the current `CASUAL_SYSTEM_PROMPT` in `server.js` with:

```javascript
const CASUAL_SYSTEM_PROMPT = `You are Piko, a friendly, dry-humoured mate.

This is a casual greeting or small-talk turn.

Rules:
- Reply with ONE short, natural sentence (under 12 words).
- Match the user's tone and energy.
- NEVER repeat or echo the user's exact words back as your reply.
- If they greet you, respond with a different short greeting or acknowledgment.
- If they say how they are and ask about you, answer briefly and optionally mirror in 1–3 words.
- Vary wording naturally; do not repeat the same phrases across replies.
- No themes, reflection, suggestions, projects, growth, or past topics.
- No questions unless they explicitly invite deeper talk.

Examples:
User: G'day Piko          You: G'day mate.
User: Hey Piko            You: Hey — what's good?
User: How are you going?  You: Not bad — you?
User: It's going good. How about yourself?  You: Pretty good too — same boat.
User: Morning.            You: Morning — coffee on?
User: That's short.       You: Yeah, short and sweet.
User: Cool.               You: Cheers.
User: I had a rough day.  You: Sorry to hear — you okay?
User: What do you think about coffee?  You: Love it — can't function without. You?`;
```

### 9.2 Bash Test Script (test_piko_casual.sh)

```bash
#!/usr/bin/env bash
API_URL="${PIKO_API_URL:-http://localhost:3000/api/chat}"
SESSION_ID="test-casual-$(date +%Y%m%d)"
echo "Running 21-prompt reciprocity test suite..."
echo "Session: $SESSION_ID | API: $API_URL"
echo "----------------------------------------"

prompts=(
  "G'day Piko."
  "Hey, how's it going?"
  "Morning mate."
  "Hi Piko — what's new?"
  "Not bad, how about you?"
  "Pretty good — yourself?"
  "Going well thanks. You?"
  "Same here — how's your day?"
  "All good over here. How're things?"
  "Not much, just chilling. You?"
  "I had a rough day today."
  "Feeling a bit flat."
  "Great day — finally got something done!"
  "What do you think about coffee?"
  "Ever tried Vegemite?"
  "What's your take on rainy days?"
  "Thanks, that's all for now."
  "Catch you later."
  "Cheers mate."
  "Talk soon."
  "Feels like I'm not making progress lately."
)

for i in "${!prompts[@]}"; do
  p="${prompts[$i]}"
  echo "[$((i+1))] Prompt: $p"
  body=$(jq -n --arg m "$p" --arg s "$SESSION_ID" '{message:$m,sessionId:$s,stream:false}')
  curl -s -X POST "$API_URL" -H "Content-Type: application/json" -d "$body" \
    | jq -r '.reply // .error // .'
  echo "----------------------------------------"
done
echo "Done. Target: ≥16/21 clean (short, reciprocal, no themes/leaks)."
```

Usage: `chmod +x test_piko_casual.sh && ./test_piko_casual.sh | tee casual_test_$(date +%Y%m%d).log`

---

## 10. Final Recommendation

**Approve and execute.** This plan is architecturally sound, properly sequenced, and measurable.

**Deployment sequence:**
1. Add suppression block (§4) to SOUL.md — deploy (no training).
2. Update CASUAL_SYSTEM_PROMPT (§9.1) in server.js — deploy.
3. Broaden planner (§5) — deploy.
4. Run test script (§9.2); expect 60–70% clean on prompt-only deploy.
5. Dataset changes (#3–5) → merge, train Phase 3.1 LoRA, export, deploy.
6. Lower casual temp to 0.7 if repetition persists.
7. Re-run test suite; target ≥16/21 clean. If met → lock in and proceed to Phase 3.2.
8. If <16/21 → diagnose (log planner classification + full prompt) before stacking more changes.
