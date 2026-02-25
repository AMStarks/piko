# Piko learning: feedback density and internal feedback — recommendation

You shared two analyses. Both are right; they target different gaps.

---

## 1. What both pieces agree on

- The **loop is well-designed** (observe → reflect → act; signal guard; refinements).
- What’s missing is **feedback density** and **feedback diversity** — not “more learning logic.”
- You do **not** need more autonomy in the sense of “Piko decides strategy.” You need **one more class of signal** and **tighter loops** so learning can improve even when engagement is sparse or slow.
- **Human role stays:** you only approve **strategic refinements**. Experiments and tactics stay autonomous; strategy stays human-gated.

---

## 2. Two gaps, two solutions

### Gap A: “Did I do what I intended?” (internal feedback)

**Problem:** Right now Piko asks “what to try next?” (critique) and “did this do well?” (engagement). It does **not** explicitly ask: “Did I actually do what I said I would try?”

So:
- nextExperiments are **intentions**, not **hypotheses with a check**.
- Journal has engagement + newPostsContext but **not** “last cycle I intended X, I did/didn’t follow it, here’s why.”
- Learning is **reactive** (wait for votes) instead of **agentic** (set intention → act → check adherence → then look at outcome).

**Solution (first piece):** Add a **self-evaluation step after posting**:

1. **Right after a successful post:** One LLM call: “You intended to [plannedForNext]. Your post title was [title], body [first 100 chars]. Did you follow your intention? Yes or no. One short sentence: why.”  
2. **Store in cycleHistory:** Add `followedPlan: true|false` and `notes: "..."` to the cycle entry you already write.  
3. **Feed into journal:** When writing the next journal entry, include: “Last cycle: intended [plannedForNext], followed: [yes/no], notes: [notes]. Engagement: [if any].”  
4. **No new user commands.** No new files. Just one extra prompt per cycle and two extra fields in the existing cycle entry.

**Why first:** It closes the loop **inside** the system. Learning can improve even with **zero** new votes (e.g. “I didn’t follow my plan; next time I’ll actually keep it short”). It’s the minimal change that turns “intention → act” into “intention → act → did I do it? → reflect.”

---

### Gap B: “More feedback, faster” (external feedback density)

**Problem:** Engagement is sparse, noisy, and lagging. So journal entries stay vague, critique repeats, refinements feel shallow.

**Solution (second piece):** Add **structured feedback signals** and **one-tap commands**:

1. **File `data/moltbook-feedback.json`:** e.g. `{ "signals": { "clarity": 0, "tooLong": 0, "goodQuestions": 0, "tooAbstract": 0 }, "lastUpdated": "..." }`.  
2. **Commands:** `/++ clarity`, `/-- tooLong`, `/+? moreExamples` → increment the corresponding signal and persist. Optionally trigger an immediate journal entry (bypass signal guard) or just let the **next** cycle’s journal prompt read the signals.  
3. **Journal prompt:** Include “Human feedback signals: clarity N, tooLong N, …” so the journal has a direct, dense signal instead of only “engagement changed.”  
4. **Optional later:** A/B experiment tracking (e.g. “shortPosts” experiment, avg upvotes vs baseline); Telegram mirror for instant reaction. Can be Phase C.

**Why second:** It makes your feedback **machine-readable** and **immediate**. You don’t have to write a refinement; you tap `/-- tooLong` and the next cycle sees “tooLong +1” and can adjust. It increases **feedback density** without changing who’s in charge (you’re still the only one who can approve refinements).

---

## 3. Recommended order

| Phase | What | Why |
|-------|------|-----|
| **A. Internal feedback** | Self-evaluation after post → `followedPlan` + `notes` in cycleHistory; feed “last cycle: intended X, followed: Y, notes: Z” into journal prompt. | Closes the intention→act loop. Learning works even when engagement is flat. No new user actions. |
| **B. Feedback signals** | moltbook-feedback.json + `/++` `/--` (and optionally `/+?`) commands; include signals in journal prompt. | Denser, faster feedback; you steer with one-tap commands instead of only refinements. |
| **C. Optional** | A/B experiment tracking in memory; Telegram mirror for instant reaction. | More structure and faster feedback; do after A and B are stable. |

---

## 4. What “internal feedback” changes in practice

**Today:**  
Critique → “Try shorter intros” → nextExperiments[0] → post prompt gets “This cycle’s focus: Try shorter intros” → Piko posts. Next cycle: critique again from engagement + titles. No explicit check “did I actually write a short intro?”

**After Phase A:**  
Same, but **after** posting we ask: “You intended ‘Try shorter intros’. Your post started with [first 80 chars]. Did you follow that? Yes/No. One sentence.” → Store `followedPlan: true`, `notes: "Intro was 2 sentences."` in cycleHistory. Next **journal** entry gets: “Last cycle: intended Try shorter intros, followed: yes, notes: Intro was 2 sentences. Engagement: 2 up.” So the journal has **three** inputs: engagement, newPostsContext, **and** experiment adherence. That’s enough for sharper entries (“I followed the plan; engagement didn’t move yet; I’ll repeat the experiment”) and for learning even with zero votes.

---

## 5. What “feedback signals” change in practice

**Today:**  
You think “that was too long.” You either wait for refinement proposal and approve something like “Favor shorter posts,” or you don’t; the system only sees engagement.

**After Phase B:**  
You send `/-- tooLong`. We increment `signals.tooLong`. Next cycle, journal prompt includes “Human feedback: tooLong +1.” Piko can write: “What didn’t: Human flagged tooLong. What I’ll try next: Keep under 150 words.” So you get **immediate course correction** without approving a refinement. Refinements stay for when experiments **converge** into a pattern you want to lock in.

---

## 6. One-sentence takeaway

- **First piece:** Learning becomes autonomous when Piko can tell **whether it did what it intended** — even before the world responds. **Phase A implements that.**  
- **Second piece:** Learning becomes **faster and denser** when you can give **tagged feedback** in one tap and the journal sees it. **Phase B implements that.**

Do **Phase A first** (internal feedback: self-evaluation → cycleHistory → journal). Then add **Phase B** (feedback signals + `/++` `/--`). That order gets you a closed intention→act→adherence loop first, then richer external feedback on top.

---

## 7. If you want to implement next

I can:

1. **Spec Phase A in code:** Where to add the self-evaluation LLM call (after `postToMoltbook` success), schema for `followedPlan` and `notes` in cycleEntry, and exact journal prompt addition (“Last cycle: intended … followed … notes …”).  
2. **Spec Phase B:** Schema for `moltbook-feedback.json`, `/++` `/--` (and optionally `/+?`) parsing in server, where to read signals in the poster and how to inject them into the journal prompt.  
3. **Or** draft the exact prompts (critique, self-evaluation, journal) so they’re ready to paste.

Tell me which of these you want next (A only, B only, or A then B with full specs).

---

**Update:** Phase A is implemented and deployed. Phase B is fully specified in **`docs/PIKO_LEARNING_PHASE_B_SPEC.md`** (schema, commands, poster integration, server helpers, checklist).
