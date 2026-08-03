/**
 * Corpus Flag rules via chat — LLM understands policy (with history + re-ask).
 * Confirm before apply. Regex is NOT used to interpret keep/drop policy.
 */
const fs = require('fs');
const path = require('path');
const { normalizeApostrophes } = require('./queueRead');
const { applyPatch, formatRulesSummary, loadRules, resetRules } = require('./corpusReviewRules');
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');

const PENDING_TTL_MS = 20 * 60 * 1000;
const DIALOG_TTL_MS = 30 * 60 * 1000;

function getRulesModel(opts = {}) {
  return (
    opts.model
    || process.env.PIKO_CORPUS_RULES_MODEL
    || process.env.PIKO_TRIAGE_MODEL
    || process.env.PIKO_ROUTER_MODEL
    || process.env.PIKO_CASUAL_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

function dialogFile() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'corpus-rules-dialog.json');
}

function loadDialogMap() {
  try {
    const p = dialogFile();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function saveDialogMap(map) {
  const p = dialogFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function touchRulesDialog(sessionKey) {
  if (!sessionKey) return;
  const map = loadDialogMap();
  map[String(sessionKey)] = { activeUntil: Date.now() + DIALOG_TTL_MS };
  saveDialogMap(map);
}

function clearRulesDialog(sessionKey) {
  if (!sessionKey) return;
  const map = loadDialogMap();
  delete map[String(sessionKey)];
  saveDialogMap(map);
}

function isRulesDialogActive(sessionKey) {
  if (!sessionKey) return false;
  const map = loadDialogMap();
  const row = map[String(sessionKey)];
  if (!row || !row.activeUntil) return false;
  if (row.activeUntil <= Date.now()) {
    delete map[String(sessionKey)];
    saveDialogMap(map);
    return false;
  }
  return true;
}

function formatHistoryForPrompt(history) {
  if (!Array.isArray(history) || !history.length) return '(no prior turns)';
  return history
    .slice(-10)
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      return `${role}: ${String(m.content || '').slice(0, 500)}`;
    })
    .join('\n');
}

function buildRulesIntentPrompt(currentRulesSummary, opts = {}) {
  const dialogNote = opts.dialogActive
    ? `\nIMPORTANT: A rules dialog is already open. The operator already saw the "ready / examples" coach message. Treat the LATEST user message as policy to encode (action "mutate"), unless they only ask for examples again or ask what the current rules are.\n`
    : '';
  const forceNote = opts.forceMutate
    ? `\nCRITICAL RETRY: Your previous answer incorrectly returned "coach" after the operator already got the ready prompt. If the LATEST message states what to keep/drop, return action "mutate" with a real patch. If the latest message is ONLY asking whether you are ready or asking for examples, return action "coach". Do not invent policy.\n`
    : '';

  return `You help Egyptian Insights set corpus Flag review rules (keep / drop / review for research sources).
${dialogNote}${forceNote}
Current rules:
${currentRulesSummary || '(defaults)'}

You will receive RECENT CONVERSATION plus the latest user message. Understand the operator's intent in plain language. If they stated a policy earlier and later say it sounds right / adjust the rules / confirm, encode that earlier policy.

Return JSON only:
{
  "action": "none" | "coach" | "show" | "mutate",
  "summary": "short plain-English confirmation of what will change (required for mutate)",
  "rerun": true/false,
  "patch": {
    "force_keep_add": ["petrie"],
    "force_drop_add": ["term"],
    "force_review_add": ["term"],
    "force_keep_remove": ["term"],
    "force_drop_remove": ["term"],
    "blocked_extra_add": ["term"],
    "blocked_extra_remove": ["term"],
    "blocked_remove_add": ["term"],
    "notes_add": ["one clear policy sentence"],
    "notes_clear": false,
    "accept_min_score": 70,
    "reject_max_score": 40,
    "require_site_hit_for_accept": true,
    "prefer_local_assets": true,
    "reset": false
  }
}

Meaning of fields:
- prefer_local_assets true = keep real documents/images; drop thin online / link-only stubs
- force_keep_add = always keep titles/authors matching these short phrases (e.g. "petrie")
- force_drop_add = always drop matching phrases
- notes_add = one sentence capturing the operator's policy in their words (not meta like "adjusting rules")

Examples of correct judgments:
1) "Are you ready to define keep rules?" → {"action":"coach"}
2) "Keep actual documents and images, not online stubs." →
   {"action":"mutate","summary":"prefer documents/images over online stubs","rerun":false,"patch":{"prefer_local_assets":true,"notes_add":["Prefer actual documents and images over online-only files."]}}
3) "what are the flag rules?" → {"action":"show"}
4) "drop Magicians of the Gods from the corpus and re-review" →
   {"action":"mutate","summary":"always drop Magicians of the Gods","rerun":true,"patch":{"force_drop_add":["magicians of the gods"]}}
Do NOT invent force_keep for author names (e.g. Petrie) unless the operator explicitly says always keep that keyword — mission-fit already judges authored_by vs about.

Hard rules:
- If the operator asks to research / find / download / harvest / get PDF or bibliography copies, return {"action":"none"} — that is agent work, not Flag-rules.
- Prefer mutate when they state keep/drop policy clearly.
- Prefer show when they ask what the rules are.
- Prefer coach when they ask if you are ready to define rules.
- Prefer none when off-topic.
- If the latest message states what to keep or drop, action MUST be "mutate" with a non-empty patch. Never "coach".
- "coach" only for readiness / asking how to begin / requesting examples with no policy yet.
- action "none" if unrelated to corpus Flag rules.
- Never invent titles the user did not mention.`;
}

function buildTopicPrompt() {
  return `Decide if this message is ONLY about Egyptian Insights corpus Flag keep/drop *policy/rules* (changing or inspecting what to always keep/drop/prefer in Flag review).

Reply JSON only: {"topic": true} or {"topic": false}.

topic=true ONLY for policy, e.g.:
- "are you ready to define what we keep in the corpus?" → {"topic": true}
- "keep documents and images not online files; always keep Petrie in the flag rules" → {"topic": true}
- "what are the flag rules?" → {"topic": true}
- "always drop Magicians of the Gods" → {"topic": true}

topic=false for research / finding / downloading sources (that is WORK for an agent), e.g.:
- "research Flinders Petrie bibliography then find PDF copies of all his works" → {"topic": false}
- "find all Petrie works as PDF" → {"topic": false}
- "harvest Abydos literature" → {"topic": false}
- "schedule a harvest for Abydos" → {"topic": false}
- "what's the weather in Cairo?" → {"topic": false}`;
}

function isMetaNote(note) {
  const n = String(note || '').toLowerCase().trim();
  if (!n) return true;
  if (n.startsWith('adjusting')) return true;
  if (n.length < 12) return true;
  if (n === 'corpus flag review rules' || n === 'flag review rules') return true;
  return false;
}

function sanitizePatch(rawPatch) {
  if (!rawPatch || typeof rawPatch !== 'object') return {};
  const out = {};
  const termKeys = [
    'force_keep_add', 'force_drop_add', 'force_review_add',
    'force_keep_remove', 'force_drop_remove',
    'blocked_extra_add', 'blocked_extra_remove', 'blocked_remove_add',
  ];
  for (const k of termKeys) {
    if (!Array.isArray(rawPatch[k])) continue;
    const terms = rawPatch[k]
      .map((t) => String(t || '').toLowerCase().trim())
      .filter((t) => t.length >= 2 && t.length <= 80)
      .filter((t) => !t.includes('?'))
      .filter((t) => !t.includes('are you') && !t.includes('i want to define') && !t.includes('adjusting'));
    if (terms.length) out[k] = terms.slice(0, 8);
  }
  if (Array.isArray(rawPatch.notes_add)) {
    const notes = rawPatch.notes_add
      .map((n) => String(n || '').trim())
      .filter((n) => n.length >= 12 && !isMetaNote(n))
      .slice(0, 5);
    if (notes.length) out.notes_add = notes;
  }
  if (rawPatch.notes_clear === true) out.notes_clear = true;
  if (rawPatch.reset === true) out.reset = true;
  if (rawPatch.accept_min_score != null) {
    const n = Number(rawPatch.accept_min_score);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.accept_min_score = Math.round(n);
  }
  if (rawPatch.reject_max_score != null) {
    const n = Number(rawPatch.reject_max_score);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.reject_max_score = Math.round(n);
  }
  if (rawPatch.require_site_hit_for_accept != null) {
    out.require_site_hit_for_accept = !!rawPatch.require_site_hit_for_accept;
  }
  if (rawPatch.prefer_local_assets != null) {
    out.prefer_local_assets = !!rawPatch.prefer_local_assets;
  }
  return out;
}

function patchHasEffect(patch) {
  if (!patch || typeof patch !== 'object') return false;
  if (patch.reset || patch.notes_clear) return true;
  if (patch.prefer_local_assets === true || patch.prefer_local_assets === false) return true;
  if (patch.accept_min_score != null || patch.reject_max_score != null) return true;
  if (patch.require_site_hit_for_accept != null) return true;
  return Object.keys(patch).some((k) => Array.isArray(patch[k]) && patch[k].length > 0);
}

function intentFromLlmJson(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const action = String(parsed.action || 'none').toLowerCase().trim();
  if (action === 'none' || !action) return null;
  if (action === 'coach') {
    return { kind: 'coach', read_only: true, summary: 'coach corpus Flag rules', source: 'llm' };
  }
  if (action === 'show') {
    return { kind: 'show', read_only: true, summary: 'show corpus Flag rules', source: 'llm' };
  }
  if (action === 'mutate') {
    const patch = sanitizePatch(parsed.patch);
    if (!patchHasEffect(patch)) return null;
    const summary = String(parsed.summary || '').trim().slice(0, 200) || 'update corpus Flag rules';
    return {
      kind: 'mutate',
      patch,
      summary,
      rerun: !!parsed.rerun,
      source: 'llm',
    };
  }
  return null;
}

async function parseCorpusReviewRulesWithLlm(message, opts = {}) {
  const model = getRulesModel(opts);
  const current = formatRulesSummary(loadRules());
  const historyBlock = formatHistoryForPrompt(opts.history);
  const messages = [
    { role: 'system', content: buildRulesIntentPrompt(current, opts) },
    {
      role: 'user',
      content: [
        'RECENT CONVERSATION:',
        historyBlock,
        '',
        'LATEST USER MESSAGE:',
        String(message || '').trim().slice(0, 800),
      ].join('\n'),
    },
  ];
  const raw = await ollamaNativeChat(model, messages, {
    format: 'json',
    temperature: 0,
    max_tokens: 400,
    num_ctx: Number(process.env.PIKO_CORPUS_RULES_NUM_CTX || 4096),
    timeoutMs: Math.max(2000, Number(process.env.PIKO_CORPUS_RULES_TIMEOUT_MS || 20000)),
  });
  return intentFromLlmJson(extractJsonObject(raw));
}

/**
 * LLM topic gate — not used to extract policy, only whether to enter rules flow.
 */
async function isCorpusRulesTopic(message, opts = {}) {
  if (opts.sessionKey && isRulesDialogActive(opts.sessionKey)) return true;
  const text = String(message || '').trim();
  if (!text) return false;

  const { classifyEiFrontDoor } = require('./eiIntentGate');
  try {
    const door = await classifyEiFrontDoor(text, {
      model: getRulesModel(opts),
      llm: opts.llm,
    });
    if (door.lane === 'work' || door.lane === 'chat') return false;
    if (door.lane === 'flag_policy') return true;
    if (door.lane === 'clarify') return false;
  } catch (_) { /* fall through */ }

  try {
    const raw = await ollamaNativeChat(getRulesModel(opts), [
      { role: 'system', content: buildTopicPrompt() },
      { role: 'user', content: text.slice(0, 500) },
    ], {
      format: 'json',
      temperature: 0,
      max_tokens: 40,
      num_ctx: 1024,
      timeoutMs: Math.max(1500, Number(process.env.PIKO_CORPUS_RULES_TOPIC_TIMEOUT_MS || 8000)),
    });
    const parsed = extractJsonObject(raw);
    return parsed && parsed.topic === true;
  } catch (_) {
    return false;
  }
}

function historyHasRulesCoach(history) {
  if (!Array.isArray(history)) return false;
  return history.some((m) => {
    if (!m || m.role !== 'assistant') return false;
    const c = String(m.content || '').toLowerCase();
    return c.includes('yes — ready') || c.includes('yes - ready') || c.includes('keep/drop policy in plain language');
  });
}

async function resolveCorpusReviewRulesIntent(message, opts = {}) {
  if (!opts.skipTopicCheck) {
    const onTopic = await isCorpusRulesTopic(message, opts);
    if (!onTopic) return null;
  }

  const dialogActive = !!(opts.sessionKey && isRulesDialogActive(opts.sessionKey));
  let llmIntent = null;
  try {
    llmIntent = await parseCorpusReviewRulesWithLlm(message, { ...opts, dialogActive });
  } catch (_) {
    llmIntent = null;
  }

  // Re-ask only after we already coached in this thread and the model coached again
  // instead of encoding the operator's policy.
  const shouldRetryMutate = dialogActive
    && historyHasRulesCoach(opts.history)
    && (!llmIntent || llmIntent.kind === 'coach');

  if (shouldRetryMutate) {
    try {
      const retry = await parseCorpusReviewRulesWithLlm(message, {
        ...opts,
        dialogActive: true,
        forceMutate: true,
      });
      if (retry && retry.kind === 'mutate') {
        return { ...retry, source: 'llm_retry' };
      }
      if (retry) llmIntent = retry;
    } catch (_) { /* keep first */ }
  }

  if (llmIntent) return llmIntent;

  return {
    kind: 'clarify',
    read_only: true,
    summary: 'clarify corpus Flag rules',
    source: 'llm_unavailable',
  };
}

function isCorpusReviewRulesMutateIntent() {
  // Prefer async isCorpusRulesTopic from the server.
  return false;
}

/** @deprecated sync helper for tests — prefer resolveCorpusReviewRulesIntent */
function parseCorpusReviewRulesMutateIntent() {
  return null;
}

function formatCorpusReviewRulesMutateConfirm(intent) {
  if (!intent || intent.read_only) return null;
  const extra = intent.rerun ? ' Then re-run Flag review on every source.' : '';
  return `I'll ${intent.summary}.${extra} Reply YES to confirm, or NO to cancel. (Confirmations expire after 20 minutes.)`;
}

function formatCorpusReviewRulesShow() {
  return `${formatRulesSummary(loadRules())}\n\nTell me the policy in plain language — I’ll confirm before saving.`;
}

function formatCorpusReviewRulesCoach() {
  return [
    'Yes — ready. Tell me the keep/drop policy in plain language; I’ll confirm before saving.',
    '',
    'Examples:',
    '• Keep actual documents and images, not thin online/link-only stubs; always keep Petrie excavation reports; then re-review',
    '• Drop Magicians of the Gods from the corpus',
    '• Set the keep score threshold to 80',
    '',
    'Or ask “what are the flag rules?” to see what’s already set.',
  ].join('\n');
}

function formatCorpusReviewRulesClarify() {
  return [
    'I couldn’t turn that into a Flag-rules change yet (model glitch or unclear policy).',
    'Please restate once in plain language, e.g. keep documents/images not online stubs, and always keep Petrie — then I’ll confirm before saving.',
  ].join('\n');
}

function formatCorpusReviewRulesMutateSuccess(intent, detail) {
  const base = `Done — ${intent.summary}.`;
  const tip = intent.rerun
    ? ''
    : ' Ask me to re-review the corpus when you want Flags refreshed.';
  return `${base}${detail ? ` ${detail}` : ''}${tip}`.trim();
}

function executeCorpusReviewRulesMutation(intent) {
  if (!intent || intent.read_only) {
    return { ok: false, error: 'Not a mutation' };
  }
  if (intent.patch && intent.patch.reset) {
    const saved = resetRules({ updated_by: 'chat' });
    return { ok: true, rules: saved, detail: 'defaults restored', rerun: !!intent.rerun };
  }
  if (!intent.patch || !patchHasEffect(intent.patch)) {
    return { ok: false, error: 'Missing or empty patch' };
  }
  const saved = applyPatch(intent.patch, { updated_by: 'chat' });
  return {
    ok: true,
    rules: saved,
    detail: `rules saved (keep=${saved.force_keep.length}, drop=${saved.force_drop.length}, prefer_local=${saved.prefer_local_assets ? 'yes' : 'no'})`,
    rerun: !!intent.rerun,
  };
}

module.exports = {
  PENDING_TTL_MS,
  DIALOG_TTL_MS,
  isCorpusRulesTopic,
  isCorpusReviewRulesMutateIntent,
  parseCorpusReviewRulesMutateIntent,
  parseCorpusReviewRulesWithLlm,
  resolveCorpusReviewRulesIntent,
  intentFromLlmJson,
  sanitizePatch,
  patchHasEffect,
  formatCorpusReviewRulesMutateConfirm,
  formatCorpusReviewRulesMutateSuccess,
  formatCorpusReviewRulesShow,
  formatCorpusReviewRulesCoach,
  formatCorpusReviewRulesClarify,
  executeCorpusReviewRulesMutation,
  buildRulesIntentPrompt,
  touchRulesDialog,
  clearRulesDialog,
  isRulesDialogActive,
};
