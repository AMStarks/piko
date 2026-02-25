# Piko → Jarvis: status and next slices

**Status**: From "smart chat" to **proactive life companion** in 3 slices. Full-stack life companion.

---

## What Slice 3 unlocks (game-changing)

### Daily Briefing = Magic moment
```
6 AM Telegram:
"Good morning. Tension #1 open 8 days. Last Moltbook post: 2 upvotes. Reminder: Review sticky idea #4 today."
```
**Impact**: Piko **starts your day**. You're no longer chasing it—it finds you.

### Calendar awareness = True proactivity
```
iOS → "Send today to Piko" → data/calendar-snapshot.json
Piko sees: "3 meetings, no prep time blocks" → "Want summaries?"
```
**Impact**: Crosses the Rubicon from reactive → **anticipatory**.

### PDF ingestion = Knowledge firehose
```
Share research PDF → Piko extracts → notes-capture.md → rabbit-hole fuel
```
**Impact**: Your phone becomes Piko's research assistant.

---

## Current Piko capability stack (post–Slice 3)

| Capability | Status |
|------------|--------|
| Learning repository (dashboard, Notion sync) | ✅ |
| Moltbook social adaptation (4 verification levels) | ✅ |
| iOS Reminders (add/list) | ✅ |
| iOS Calendar awareness (daily snapshot) | ✅ |
| Share Extension (notes/PDF → Piko) | ✅ |
| Daily briefing (6 AM synthesis) | ✅ |
| Proactive nudges (tensions, Moltbook performance) | ✅ |
| Inline editing + velocity metrics | ✅ |

**Summary**: Full-stack life companion. Piko sees your calendar, learns from your files, anticipates your needs.

---

## Next 3 slices (Month 2 roadmap)

### Slice 4: Messages + cross-context (Week 1) — **implemented**
- **Messages Share** → Share to Piko with long text → server detects conversation (e.g. `:\n` or many lines), Ollama summarizes + extracts 1–3 action items → iOS shows action sheet: summary + "Add to Reminders" per action, "Add all to Reminders", "Done". Text is always saved to `notes-capture.md`.
- **Files "Recent"** → Pattern detection ("Weekly research PDFs") — not yet.
- **Context aggregator** → "Busy day + open tension → Prioritize?" — can use `calendar-snapshot.json` + learning + intents later.

*Note:* Messages has no API; "Messages Share" = user shares/pastes from Messages into Piko (Share to Piko). Server: `file_capture` with text → conversation detection + `parseConversationActions`; iOS: `hubFileCapture` → `ConversationActionSheetView` with Reminders add.

### Slice 5: Health / Location triggers (Week 2)
- **HealthKit** → "5‑day workout streak → Block recovery?"
- **Location** → "Coffee shop (3×/week) → Writing session nudge?"
- **Battery &lt;20%** → Text-only mode

*Note:* Health/Location require iOS app to read (HealthKit, Location), then send summaries to hub; server uses that for nudges. See `PIKO_IOS_INTEGRATIONS_INVESTIGATION.md`.

### Slice 6: App-spanning synthesis (Week 3)
- Email invoice + Files extract + Notion billing pattern → "Follow up Friday?"
- Messages "Dinner?" + Weather + Calendar → Indoor backup suggestion

---

## Polish priorities (this weekend, ~3h)

1. **Mobile dashboard (90 min)** — Cards on phones, bottom nav (iOS app: dashboard tab with learning summary, next reminder, Moltbook last post).
2. **Siri Shortcuts (45 min)** — "Piko inquiry" → open app or POST to hub; "Latest tension" → prefilled message or fetch from API.
3. **Notification smartness (45 min)** — Silence during meetings (use calendar snapshot), prioritize critical vs tactical.

---

## The Jarvis moment (Week 4 prediction)

```
6 AM:  "Good morning. 3 meetings today (prep summaries ready). Tension #2 needs input. Workout streak: 5 days."
10 AM: "Messages thread → 2 action items for Reminders?"
3 PM:  "Coffee shop detected → Tackle Tension #2?"
6 PM:  "Dinner + rain forecast → Indoor backup suggestion?"
```

---

## Strategic positioning

| Phase | Target |
|-------|--------|
| **Month 1 complete** | ✅ Learning + iOS foundation + proactivity |
| **Month 2** | Cross-app synthesis + ambient awareness |
| **Month 3** | Full Jarvis (patterns from your life → personalized nudges) |

**Next**: Mobile polish + Slice 4 (Messages synthesis). ~70% to Jarvis.

---

## Polish (done)

- **Siri Shortcuts** — `docs/PIKO_SIRI_SHORTCUTS.md`: Piko inquiry, latest tension, add reminder, quick capture (URL + POST examples).
- **Notification smartness** — `proactive-patterns.js` skips tension and Moltbook nudges when `data/calendar-snapshot.json` has an event starting in the next 60 minutes.
- **Mobile dashboard** — `GET /api/ios-dashboard` returns learning (tensions/sticky counts + first line), next reminder, last Moltbook post. iOS app: grid icon opens Dashboard sheet with cards.

---

## References

- Deployment & limitations: `webchat-piko/docs/DEPLOYMENT_CHECKLIST.md`
- iOS integrations: `docs/PIKO_IOS_INTEGRATIONS_INVESTIGATION.md`
- Jarvis roadmap review: `docs/PIKO_JARVIS_ROADMAP_REVIEW.md`
- Share Extension setup: `Piko-iOS/docs/SHARE_EXTENSION_SETUP.md`
- Siri Shortcuts: `docs/PIKO_SIRI_SHORTCUTS.md`
