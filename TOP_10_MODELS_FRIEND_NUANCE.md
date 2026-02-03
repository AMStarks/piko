# Top 10 Free Models for "Friend" + General Nuance + Coding
## Excluding Chinese/Beijing Tech Companies

**Your Requirements:**
- Become "a friend" (conversational, personality, rapport)
- General nuance across many knowledge areas
- Coding ability (for OpenClaw/Cursor integration)
- RAM constraint: 31GB total, 25GB available
- Exclude Chinese companies

**Server Specs:**
- RAM: 31GB total, 25GB available
- CPU: AMD Ryzen 5 5600 (6 cores, 12 threads)
- No GPU (CPU-only inference)

---

## 🏆 Top 10 Rankings

### #1: **llama3.1:70b** (Meta - US) ⭐ BEST OVERALL
**Why #1:**
- ✅ **Excellent conversation** - Best personality/rapport among open models
- ✅ **Superior general knowledge** - Trained on diverse, high-quality data
- ✅ **Strong coding** - Good tool calling, function support
- ✅ **Nuance & reasoning** - Best at understanding context, subtlety
- ✅ **OpenClaw ready** - Full tool/function calling support
- ✅ **Meta (US company)** - Trusted, open source

**Specs:**
- Size: ~40GB (Q4_K_M quantization)
- RAM needed: ~45GB (⚠️ **TIGHT** - may need swap or close other services)
- Speed: Slow on CPU-only, but worth it for quality
- Versions: `llama3.1:70b` (latest), `llama3.1:70b-q4_K_M` (smaller, recommended)

**Previous versions applicable?**
- `llama3.0:70b` - Slightly older, similar quality, may be slightly smaller
- `llama2:70b` - Older generation, less nuanced conversation, but still good

**Recommendation:** Try `llama3.1:70b-q4_K_M` first. If RAM is too tight, fall back to #2.

---

### #2: **mistral-large:latest** (Mistral AI - France) ⭐ BEST BALANCE
**Why #2:**
- ✅ **Great conversation** - Excellent personality, natural dialogue
- ✅ **Strong general knowledge** - Well-rounded across domains
- ✅ **Good coding** - Solid tool calling
- ✅ **Fits your RAM** - ~18GB needed (✅ **FITS EASILY**)
- ✅ **Fast** - Good speed on CPU
- ✅ **European company** - Privacy-focused, trusted

**Specs:**
- Size: ~13GB
- RAM needed: ~18GB (✅ Perfect fit!)
- Speed: Fast
- Versions: `mistral-large:latest` (current), `mistral:7b` (smaller, less capable)

**Previous versions applicable?**
- `mistral:7b` - Much smaller (7GB), less nuanced, but faster
- `mistral:8x7b` - MoE model, ~26GB, very good but larger

**Recommendation:** **Best choice if llama3.1:70b doesn't fit.** Excellent balance of quality and practicality.

---

### #3: **llama3.1:8b** (Meta - US) ⭐ CURRENT, BUT UPGRADE RECOMMENDED
**Why #3:**
- ✅ **Good conversation** - Decent personality, but limited nuance
- ⚠️ **Limited general knowledge** - Smaller context, less depth
- ✅ **Good coding** - Solid for basic tasks
- ✅ **Fits easily** - ~8GB RAM (✅ **PLENTY OF ROOM**)
- ✅ **Fast** - Very fast on CPU
- ✅ **You already have it!**

**Specs:**
- Size: ~4.9GB
- RAM needed: ~8GB
- Speed: Very fast
- Versions: `llama3.1:8b` (current), `llama3.0:8b` (older, similar)

**Previous versions applicable?**
- `llama3.0:8b` - Slightly older, similar quality
- `llama2:7b` - Much older, less nuanced, not recommended

**Recommendation:** Good starting point, but **definitely upgrade** to mistral-large or llama3.1:70b for "friend" quality.

---

### #4: **mixtral:8x7b** (Mistral AI - France) ⭐ EXCELLENT QUALITY
**Why #4:**
- ✅ **Very good conversation** - Strong personality, natural
- ✅ **Excellent general knowledge** - MoE architecture = diverse expertise
- ✅ **Good coding** - Solid tool calling
- ⚠️ **RAM constraint** - ~30GB needed (⚠️ **TIGHT**)
- ⚠️ **Slower** - MoE models slower on CPU
- ✅ **European company**

**Specs:**
- Size: ~26GB
- RAM needed: ~30GB (⚠️ Tight, but should fit)
- Speed: Moderate (MoE overhead)
- Versions: `mixtral:8x7b` (current), `mixtral:8x22b` (larger, won't fit)

**Previous versions applicable?**
- No smaller versions - this is the base model

**Recommendation:** Excellent if it fits. Better than mistral-large for nuance, but larger.

---

### #5: **codellama:34b** (Meta - US) ⭐ BEST FOR CODING
**Why #5:**
- ⚠️ **Limited conversation** - Optimized for code, less personality
- ⚠️ **Narrow knowledge** - Focused on coding/tech
- ✅ **Excellent coding** - Best coding model on this list
- ✅ **Fits your RAM** - ~25GB needed (✅ **PERFECT FIT**)
- ✅ **Fast** - Good speed
- ✅ **Meta (US company)**

**Specs:**
- Size: ~20GB
- RAM needed: ~25GB
- Speed: Good
- Versions: `codellama:34b` (current), `codellama:13b` (smaller, less capable)

**Previous versions applicable?**
- `codellama:13b` - Smaller (~7GB), less capable
- `codellama:7b` - Too small, not recommended

**Recommendation:** **Best for coding tasks**, but **NOT ideal for "friend"** - too technical/focused. Use if coding is primary.

---

### #6: **llama3.2:3b** (Meta - US) ⭐ FASTEST, BUT LIMITED
**Why #6:**
- ⚠️ **Basic conversation** - Limited personality, less nuance
- ⚠️ **Limited knowledge** - Small model = less depth
- ⚠️ **Basic coding** - Can do simple tasks
- ✅ **Tiny** - ~2GB (✅ **PLENTY OF ROOM**)
- ✅ **Very fast** - Fastest on this list
- ✅ **You already have it!**

**Specs:**
- Size: ~2GB
- RAM needed: ~4GB
- Speed: Very fast
- Versions: `llama3.2:3b` (current), `llama3.2:1b` (even smaller, not recommended)

**Previous versions applicable?**
- No previous versions - this is the first 3.2 release

**Recommendation:** **Too small for "friend" quality.** Good for speed, but lacks nuance you need.

---

### #7: **neural-chat:7b** (Intel - US) ⭐ CONVERSATION-FOCUSED
**Why #7:**
- ✅ **Good conversation** - Trained for chat, decent personality
- ⚠️ **Limited general knowledge** - Smaller model
- ⚠️ **Basic coding** - Not optimized for code
- ✅ **Fits easily** - ~8GB RAM (✅ **PLENTY OF ROOM**)
- ✅ **Fast** - Good speed
- ✅ **Intel (US company)**

**Specs:**
- Size: ~4.5GB
- RAM needed: ~8GB
- Speed: Fast
- Versions: `neural-chat:7b` (current), older versions available

**Previous versions applicable?**
- Older versions exist but not recommended

**Recommendation:** Good for conversation, but **limited for coding/OpenClaw**. Better options above.

---

### #8: **orca-mini:13b** (Microsoft Research - US) ⭐ EDUCATIONAL FOCUS
**Why #8:**
- ✅ **Good conversation** - Trained for instruction/chat
- ⚠️ **Limited general knowledge** - Educational focus
- ⚠️ **Basic coding** - Not optimized
- ✅ **Fits easily** - ~15GB RAM (✅ **FITS**)
- ✅ **Fast** - Good speed
- ✅ **Microsoft Research (US)**

**Specs:**
- Size: ~7.5GB
- RAM needed: ~15GB
- Speed: Fast
- Versions: `orca-mini:13b` (current), `orca-mini:7b` (smaller)

**Previous versions applicable?**
- `orca-mini:7b` - Smaller, less capable

**Recommendation:** Good for learning/instruction, but **not ideal for "friend"** or coding tasks.

---

### #9: **llama2:70b** (Meta - US) ⭐ OLDER BUT STILL GOOD
**Why #9:**
- ✅ **Good conversation** - Decent personality, but less nuanced than 3.1
- ✅ **Good general knowledge** - Solid across domains
- ⚠️ **Older generation** - Less refined than 3.1
- ⚠️ **RAM constraint** - ~45GB needed (⚠️ **TIGHT**)
- ⚠️ **Slower** - Older architecture
- ✅ **Meta (US company)**

**Specs:**
- Size: ~40GB
- RAM needed: ~45GB
- Speed: Slow
- Versions: `llama2:70b` (current), `llama2:13b` (smaller, less capable)

**Previous versions applicable?**
- `llama2:13b` - Much smaller (~7GB), less capable
- `llama2:7b` - Too small, not recommended

**Recommendation:** **Skip this** - llama3.1:70b is better in every way. Only use if 3.1 doesn't work.

---

### #10: **phi-3:14b** (Microsoft - US) ⭐ SMALL BUT SMART
**Why #10:**
- ✅ **Good conversation** - Well-trained for chat
- ⚠️ **Limited general knowledge** - Smaller model
- ⚠️ **Basic coding** - Not optimized
- ✅ **Fits easily** - ~18GB RAM (✅ **FITS**)
- ✅ **Fast** - Good speed
- ✅ **Microsoft (US company)**

**Specs:**
- Size: ~8GB
- RAM needed: ~18GB
- Speed: Fast
- Versions: `phi-3:14b` (current), `phi-3:3.8b` (smaller)

**Previous versions applicable?**
- `phi-3:3.8b` - Smaller, less capable

**Recommendation:** Good small model, but **not ideal for "friend"** - lacks nuance of larger models.

---

## 🎯 Final Recommendations for Your Use Case

### For "Friend" + Nuance + Coding:

**Best Choice: `mistral-large:latest`** (#2)
- ✅ Fits your RAM perfectly (18GB)
- ✅ Excellent conversation/personality
- ✅ Good general knowledge
- ✅ Solid coding ability
- ✅ Fast enough for interactive use
- ✅ European company (privacy-focused)

**If RAM allows: `llama3.1:70b-q4_K_M`** (#1)
- ✅ Best overall quality
- ⚠️ Tight RAM fit (45GB needed)
- ⚠️ Slower on CPU
- ✅ Best for long-term "friend" development

**Current: `llama3.1:8b`** (#3)
- ✅ You already have it
- ⚠️ Too small for "friend" quality
- ✅ Good starting point, but upgrade recommended

### Installation Priority:

1. **Try `mistral-large:latest` first** (best balance)
2. **If you want best quality and can free up RAM, try `llama3.1:70b-q4_K_M`**
3. **Keep `llama3.1:8b` as backup** (fast, but limited)

---

## 📊 Quick Comparison Table

| Rank | Model | RAM | Friend | Nuance | Coding | Speed | Origin |
|------|-------|-----|--------|--------|--------|-------|--------|
| #1 | llama3.1:70b | 45GB ⚠️ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Slow | Meta (US) |
| #2 | mistral-large | 18GB ✅ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Fast | Mistral (FR) |
| #3 | llama3.1:8b | 8GB ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | Very Fast | Meta (US) |
| #4 | mixtral:8x7b | 30GB ⚠️ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Moderate | Mistral (FR) |
| #5 | codellama:34b | 25GB ✅ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | Good | Meta (US) |
| #6 | llama3.2:3b | 4GB ✅ | ⭐⭐ | ⭐⭐ | ⭐⭐ | Very Fast | Meta (US) |
| #7 | neural-chat:7b | 8GB ✅ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | Fast | Intel (US) |
| #8 | orca-mini:13b | 15GB ✅ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | Fast | Microsoft (US) |
| #9 | llama2:70b | 45GB ⚠️ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Slow | Meta (US) |
| #10 | phi-3:14b | 18GB ✅ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | Fast | Microsoft (US) |

---

## 🚀 Next Steps

1. **Install mistral-large:latest** (recommended starting point)
   ```bash
   docker exec legion-ollama ollama pull mistral-large:latest
   ```

2. **Test conversation quality**
   ```bash
   docker exec legion-ollama ollama run mistral-large:latest "Tell me about yourself and what makes you a good friend"
   ```

3. **If you want best quality, try llama3.1:70b** (may need to close other services)
   ```bash
   docker exec legion-ollama ollama pull llama3.1:70b-q4_K_M
   ```

4. **Update OpenClaw config** to use your chosen model

---

**Remember:** For "friend" quality, you need **larger models** (13B+). The 8B models are too small for nuanced conversation and personality development over time.
