# Piko — Critical review and making speech natural

Deploy is done; then a straight critical pass on where things stand and how to make speech central and natural.

---

## 1. Deploy status

- **Optimus:** webchat-piko synced and **piko-webchat.service** restarted; **/api/health** returns 200.
- **Included:** leading anti-meta rule, SOUL anti-summary/anti–“back online”, meta-slip post-filter, casual small-talk path, corpus “From corpus” only when relevant, session-reset, per-channel sessions, 403 + allowlist behaviour.

---

## 2. Critical review of where we are

### What’s solid

- **Architecture:** One brain, typed memory, belief → planner → constraints (no belief-to-text), corpus/truth, manual identity. That’s the right base for a companion.
- **Channels:** App, WebChat, Telegram (and adapters) share the same backend; per-channel sessions avoid cross-talk and meta from mixed history.
- **Guardrails:** Anti-meta (leading rule + SOUL + post-filter), anti-canned phrase list, “From corpus” scoped to factual answers only, casual path for greetings/small talk so the plan doesn’t over-structure.
- **Operational:** SQLite history, rate limit, control panel, session-reset, doctor, tests, Docker option.

### What’s still weak (honest)

- **Model behaviour is inconsistent.** Same prompt sometimes gives a mate-style reply, sometimes a summary of the instructions or “I’m back online and ready to help.” The 8B model plus long system prompt makes the model “reply to” the prompt as much as to the user. We’ve added a leading rule and a post-filter; that reduces damage but doesn’t fix the root cause (prompt length and model limits).
- **Naturalness is prompt- and sampling-dependent.** We’ve pushed hard on SOUL/IDENTITY, casual plan line, and style reminder. If the model still defaults to assistant tone, the next levers are: shorter or reordered system prompt, stronger “last word” instruction, or a larger/better model. We haven’t added a real “conversation phase” layer (greeting vs casual vs technical) beyond the casual flag.
- **Speech is not first-class.** Text chat is the main path; voice is either input-only (WebChat Voice button) or spec-only (iOS tap-to-talk). So “speech” is not yet a primary interaction mode.

### What we should not do

- Don’t loosen belief safety or identity authority to chase naturalness.
- Don’t add many more planner knobs; we’re already at the edge of over-constraining.
- Don’t promise “fully natural” until we have voice in the loop and have tuned for it.

---

## 3. Why speech is seriously important

Companions are used in the pocket, in the car, while cooking, walking. Text is fine for focus; **speech is for presence**. If Piko is going to feel like a companion, it has to be good at:

- **Listening** (STT) and **talking back** (TTS), not just reading/writing text.
- **Short, speakable replies** — paragraphs that work on a screen feel wrong in the ear.
- **Turn-taking and latency** — quick start of reply (e.g. streaming TTS), and not talking over the user.
- **Recovering from errors** — mishears, cut-off speech, “say that again” without breaking the flow.

So “making it natural” splits in two:

1. **Text naturalness** (what we’ve been improving): tone, no meta, no canned phrases, casual path, one-line style for small talk.
2. **Speech naturalness**: voice in/out, brevity and prosody for speech, latency and turn-taking, and eventually wake word or tap-to-talk as the main entry point.

---

## 4. Current speech state

| Piece | Status | Gap |
|-------|--------|-----|
| **WebChat** | Voice button: browser STT → transcript → POST /api/chat. Reply is **text only**. | No TTS; user must read. Not “speech” as a full loop. |
| **iOS** | Tap-to-talk is **spec only** (TAP_TO_TALK_SPEC.md): Mic → STT → /api/chat → TTS. Not implemented. | No native voice in/out on the app. |
| **Server** | /api/chat is text in, text out. No voice-specific endpoint, no “speech-optimized” reply length. | Same reply for text and voice; no hint that reply will be spoken. |
| **Telegram / adapters** | Text only. | Voice would require Telegram voice messages + STT/TTS or a separate voice surface. |

So today, **speech is not a first-class path**. To make it central we need: an end-to-end voice loop (STT → chat → TTS) and design for **speakable** replies.

---

## 5. How to make speech natural (concrete)

### 5.1 Implement tap-to-talk (iOS)

- Follow **TAP_TO_TALK_SPEC.md**: Mic → on-device or cloud STT → POST /api/chat (e.g. sessionId `ios-voice` or same as main) → get `reply` → **TTS** (e.g. AVSpeechSynthesizer) → play.
- Use a **stable session** so voice and text share context (or one session per “voice session” if you want separation).
- **Permissions:** mic + speech recognition (and optionally “speak reply” in accessibility).

This gives “tap, speak, hear Piko” as the primary voice experience. No wake word in v1.

### 5.2 Speech-optimized replies (server)

- **Option A (minimal):** Client sends a flag, e.g. `POST /api/chat` with `{ message, sessionId, voice: true }`. Server appends one line to the system prompt when `voice === true`: “The reply will be read aloud. Keep it to one or two short sentences; avoid long lists or markdown.”
- **Option B:** Same plus planner: when `voice: true`, force `verbosity: low` and a “speakable” nudge so the model tends toward brevity and simple sentences.

That keeps one brain but makes the **output** suitable for TTS: short, few bullets, no “see below” or long paragraphs.

### 5.3 Latency and turn-taking

- **Streaming:** For text we already have `stream: true`. For voice, you can either (1) wait for full reply then TTS (simpler), or (2) stream reply and start TTS on first sentence (lower perceived latency; needs sentence boundary or chunking).
- **Feedback:** While the user is speaking, show “Listening…”; when they stop, show “Thinking…” then “Speaking…” when TTS plays. Reduces the “did it hear me?” doubt.
- **Interruption:** v1 can be “tap, speak once, get one reply.” Later: support “stop” to cut TTS and re-tap to speak again.

### 5.4 TTS quality and “personality”

- **On-device (e.g. AVSpeechSynthesizer):** Fast, private, good for a first version. Tune rate/pitch if the default feels robotic.
- **Neural TTS (e.g. ElevenLabs, Azure, Apple Neural):** More natural prosody and tone; adds API cost and possibly latency. Use when you want “Piko’s voice” to feel distinct and natural.
- **Brevity:** The biggest win for “natural” speech is **short replies**. A single short sentence feels natural; a paragraph feels like a lecture. So speech-optimized prompts (5.2) matter more than TTS choice at first.

### 5.5 Text naturalness (already in progress)

- Keep **leading rule + SOUL + style reminder + casual path + meta-slip filter** so that when the user speaks, the **content** of the reply is already mate-like and not meta/canned.
- Consider a **conversation phase** later: infer “greeting / casual / technical / reflective” from last turn(s) and adjust plan or final instruction so voice and text both benefit from “right now we’re in small talk” vs “right now we’re debugging code.”

---

## 6. Prioritized order (speech-first)

| Priority | What | Why |
|----------|------|-----|
| **1** | **iOS tap-to-talk** (Mic → STT → /api/chat → TTS) | Makes speech a real interaction; use spec and one session with main chat so context is shared. |
| **2** | **Voice flag in /api/chat** + “reply will be read aloud; one or two short sentences” | Ensures replies are speakable without changing the rest of the brain. |
| **3** | **TTS tuning** (rate, voice, optional neural) | Improves “how Piko sounds”; secondary to having a voice path at all. |
| **4** | **Streaming TTS** (start speaking first sentence while rest generates) | Improves perceived latency; can follow after basic tap-to-talk works. |
| **5** | **Conversation phase / mode** (optional) | Refines both text and voice; can come after voice loop exists. |

---

## 7. Summary

- **Deploy:** Done on Optimus; all recent fixes (anti-meta, casual path, meta-slip filter, etc.) are live.
- **Critical take:** Architecture and guardrails are in good shape; **naturalness is still limited by model + prompt length** and by **speech not being a first-class path**. We’ve made text less canned and less meta; the next big step is **voice in and voice out** with **speech-optimized replies**.
- **Making speech natural:** Implement tap-to-talk on iOS (per spec), add a `voice: true` path so replies are short and speakable, then tune TTS and latency. That’s how speech becomes central and natural for the companion.
