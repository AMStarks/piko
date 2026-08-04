/**
 * Intent → tool plan for EI worker.
 * LLM plans from understanding the goal. No keyword intent guards / rewrites.
 * If the planner LLM is down: one seek_files step with a focused query.
 */
const { ollamaNativeChat } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { loadResearchGoal } = require('./eiResearchGoal');
const { listTools } = require('./eiAgentTools');
const { parseNamedWork } = require('./eiGoalParse');
const {
  toLowerAsciiish,
  includesAny,
  extractDigitRuns,
  stripTrailingPunct,
} = require('./text');

function extractHttpUrls(s) {
  const str = String(s || '');
  const lower = toLowerAsciiish(str);
  const urls = [];
  let from = 0;
  while (from < str.length) {
    let idx = lower.indexOf('https://', from);
    let schemeLen = 8;
    if (idx < 0) {
      idx = lower.indexOf('http://', from);
      schemeLen = 7;
    }
    if (idx < 0) break;
    let end = idx + schemeLen;
    while (end < str.length) {
      const ch = str[end];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
        || ch === '<' || ch === '>' || ch === '"' || ch === "'") break;
      end += 1;
    }
    urls.push(stripTrailingPunct(str.slice(idx, end)));
    from = idx + schemeLen;
  }
  return urls;
}

function nearPhrase(haystack, leftWords, rightWords, maxGap = 40) {
  const h = toLowerAsciiish(haystack);
  for (const left of leftWords) {
    let from = 0;
    while (from < h.length) {
      const idx = h.indexOf(left, from);
      if (idx < 0) break;
      const window = h.slice(idx, idx + left.length + maxGap + 20);
      if (includesAny(window, rightWords)) return true;
      from = idx + left.length;
    }
  }
  return false;
}

const MAX_STEPS = 5;

function formatPlanSummary(plan) {
  if (!plan || !plan.steps || !plan.steps.length) return 'No steps planned.';
  const lines = [
    plan.summary || 'Interpreted work plan:',
    ...plan.steps.map((s, i) => {
      const args = s.args && typeof s.args === 'object' ? s.args : {};
      const bits = [];
      if (args.query) {
        const q = String(args.query);
        // Mark display truncation, or the review LLM reads it as a real defect.
        bits.push(`query=${q.length > 120 ? `${q.slice(0, 120)}…` : q}`);
      }
      if (args.focus) bits.push(`focus=${args.focus}`);
      if (args.literature_only) bits.push('literature-only');
      if (Array.isArray(args.sources)) bits.push(`sources=${args.sources.join(',')}`);
      if (args.require_image === false) bits.push('no-image-required');
      if (args.limit != null) bits.push(`limit=${args.limit}`);
      if (args.max_keeps != null) bits.push(`max_keeps=${args.max_keeps}`);
      if (args.harvest_id) bits.push(`harvest_id=${args.harvest_id}`);
      const why = s.why ? ` — ${s.why}` : '';
      return `  ${i + 1}. ${s.tool}${bits.length ? ` (${bits.join('; ')})` : ''}${why}`;
    }),
  ];
  return lines.join('\n');
}

function applyNamedWorkSeekHints(plan, goal) {
  const named = parseNamedWork(goal);
  if (!plan || !Array.isArray(plan.steps)) return plan;
  const steps = plan.steps.map((s) => {
    if (!s || s.tool !== 'seek_files') return s;
    const args = { ...(s.args && typeof s.args === 'object' ? s.args : {}) };
    const q = String(args.query || '').trim();
    // Replace instruction-padded queries with focused title/author search.
    const qLow = toLowerAsciiish(q);
    if (!q || q.length > 80 || includesAny(qLow, ['please find', 'add to corpus']) || q === String(goal || '').trim()) {
      args.query = named.seekQuery;
    }
    if (named.isSingularTitle) {
      if (args.limit == null && named.seekLimit != null) args.limit = named.seekLimit;
      if (args.max_keeps == null) args.max_keeps = named.maxKeeps || 1;
    }
    return { ...s, args };
  });
  return { ...plan, steps };
}

function hasScopedArgs(step) {
  const args = (step && step.args && typeof step.args === 'object') ? step.args : {};
  return Object.keys(args).some((k) => args[k] != null && args[k] !== '');
}

/**
 * Contract lint: an argument-less step riding along a scoped step is planner
 * padding — it can only blind-echo defaults (e.g. empty harvest dumping museum
 * sources after a scoped seek). Drop those. A plan whose ONLY step is
 * argument-less (e.g. "review the corpus" → review_corpus) is left alone.
 * Not keyword routing; this mirrors the mission-fit contract, applied before
 * we spend a Legion run.
 */
function lintPlan(plan, goal) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length < 2) return plan;
  if (!plan.steps.some((s) => hasScopedArgs(s))) return plan;
  const steps = plan.steps.filter((s) => hasScopedArgs(s));
  if (steps.length === plan.steps.length) return plan;
  return { ...plan, steps, linted: true };
}

const HARVEST_ID_TOOLS = new Set(['expand_from_item', 'digest_item', 'deep_digest_item']);

function harvestItemExists(hid) {
  try {
    const { getItem } = require('./culturesCorpusApi');
    const got = getItem(hid);
    if (!got || got.ok === false || got.error) return false;
    const row = got.item || got;
    return !!(row && (row.id != null || row.title || row.path));
  } catch (_) {
    return false;
  }
}

function normalizePlan(raw, goal) {
  const steps = Array.isArray(raw && raw.steps) ? raw.steps : [];
  const cleaned = [];
  const dropped = [];
  const known = new Set(listTools().map((t) => t.name));
  let threadDefs = null;
  try {
    threadDefs = require('./eiThreadDossiers').THREAD_DEFS || [];
  } catch (_) {
    threadDefs = [];
  }
  const knownThreads = new Set(threadDefs.map((t) => t.id));

  for (const s of steps.slice(0, MAX_STEPS)) {
    if (!s || !s.tool || !known.has(String(s.tool))) continue;
    const tool = String(s.tool);
    const args = s.args && typeof s.args === 'object' ? { ...s.args } : {};
    if (tool === 'thread_dossier') {
      const rawTid = String(args.thread || '').trim().toLowerCase();
      // P1.2: exact alias resolve ("osireion" → abydos). Never fuzzy-match
      // invented ids like "atlantis-moonbase" into a real thread.
      let tid = rawTid;
      if (tid && !knownThreads.has(tid)) {
        try {
          const d = require('./eiThreadDossiers');
          tid = d.resolveThreadAlias(rawTid) || rawTid;
        } catch (_) { /* keep raw */ }
      }
      if (!tid || !knownThreads.has(tid)) {
        dropped.push(`${tool}: unknown_thread ${JSON.stringify(args.thread)}`);
        continue;
      }
      args.thread = tid;
    }
    if (HARVEST_ID_TOOLS.has(tool)) {
      const hid = Number(args.harvest_id);
      if (!Number.isFinite(hid) || hid <= 0 || !Number.isInteger(hid)) {
        dropped.push(`${tool}: invalid harvest_id ${JSON.stringify(args.harvest_id)}`);
        continue;
      }
      if (!harvestItemExists(hid)) {
        dropped.push(`${tool}: not_found harvest_id=${hid}`);
        continue;
      }
      args.harvest_id = hid;
    }
    cleaned.push({
      tool,
      args,
      why: String(s.why || '').slice(0, 200),
    });
  }
  let summary = String((raw && raw.summary) || '').slice(0, 400)
    || `Plan for: ${String(goal || '').slice(0, 120)}`;
  if (dropped.length) {
    summary = `${summary} (dropped: ${dropped.join('; ')})`.slice(0, 400);
  }
  if (!cleaned.length) {
    return {
      ok: false,
      summary: dropped.length
        ? `Plan empty after validation (dropped: ${dropped.join('; ')})`.slice(0, 400)
        : summary,
      steps: [],
      mode: (raw && raw.mode) || 'unknown',
      dropped_steps: dropped,
      error: 'empty_plan',
    };
  }
  const base = {
    ok: true,
    summary,
    steps: cleaned,
    mode: (raw && raw.mode) || 'unknown',
    dropped_steps: dropped,
  };
  return lintPlan(applyNamedWorkSeekHints(base, goal), goal);
}

/**
 * Offline / LLM-down fallback: open-web seek for the focused work query.
 */
function planWorkRules(goal, clarification = '') {
  const combined = [goal, clarification].filter(Boolean).join('\n').trim();
  const low = toLowerAsciiish(combined);
  const keepGoing = includesAny(low, [
    'keep researching', 'keep ingesting', 'keep seeking', 'keep gathering',
  ]);
  const hasCampaign = low.includes('campaign') || low.includes('research campaign');
  const campaignControl = keepGoing || (
    hasCampaign && includesAny(low, ['start', 'pause', 'resume', 'stop', 'halt', 'status of', 'check'])
  );
  if (campaignControl) {
    const action = includesAny(low, ['pause', 'halt']) ? 'pause'
      : low.includes('resume') ? 'resume'
        : low.includes('stop') ? 'stop'
          : includesAny(low, ['status', 'check']) ? 'status'
            : 'start';
    const args = { action };
    if (action === 'start') {
      args.topic = combined.slice(0, 400);
      if (includesAny(low, ['focus only on'])) args.focus_only = true;
    }
    return normalizePlan({
      summary: `Research campaign: ${action} (planner LLM unavailable).`,
      steps: [{ tool: 'research_campaign', args, why: 'Operator campaign control' }],
      mode: 'fallback',
    }, goal);
  }
  if (nearPhrase(combined, ['write', 'draft', 'produce'], ['article', 'essay', 'piece', 'write-up', 'writeup'], 40)) {
    let topic = combined;
    for (const verb of ['write', 'draft', 'produce']) {
      const idx = low.indexOf(verb);
      if (idx < 0) continue;
      const after = combined.slice(idx);
      const afterLow = toLowerAsciiish(after);
      for (const noun of ['article', 'essay', 'piece', 'write-up', 'writeup']) {
        const nIdx = afterLow.indexOf(noun);
        if (nIdx < 0 || nIdx > 40) continue;
        let rest = after.slice(nIdx + noun.length).trim();
        const restLow = toLowerAsciiish(rest);
        for (const prep of ['on ', 'about ', 'regarding ']) {
          if (restLow.startsWith(prep)) {
            rest = rest.slice(prep.length).trim();
            break;
          }
        }
        topic = rest || topic;
        break;
      }
      break;
    }
    topic = topic.trim().slice(0, 200) || combined.slice(0, 200);
    return normalizePlan({
      summary: 'Write research article draft (planner LLM unavailable).',
      steps: [{ tool: 'write_article', args: { topic }, why: 'Operator article request' }],
      mode: 'fallback',
    }, goal);
  }
  if (
    includesAny(low, [
      'self-diagnos', 'self diagnos', 'selfdiagnos',
      'diagnose yourself', 'diagnose learning', 'diagnose duplicates',
      'find duplicate keeps',
    ])
  ) {
    const { resolveKind } = require('./eiSelfDiagnosis');
    const kind = resolveKind('', combined);
    return normalizePlan({
      summary: `Self-diagnosis: ${kind}`,
      steps: [{ tool: 'self_diagnosis', args: { kind, focus: combined.slice(0, 200) }, why: 'Operator self-diagnosis' }],
      mode: 'fallback',
    }, goal);
  }
  // A single pasted URL with an ingest verb is a direct ingest, not a snowball —
  // "Please ingest the Pyramid Texts, found here: <url>" must hit ingest_url
  // (web_pdf + web_text), even though the title+URL pair looks like two seeds.
  const allUrls = extractHttpUrls(combined);
  if (
    allUrls.length === 1
    && includesAny(low, ['ingest', 'add', 'download', 'get', 'scrape'])
    && !includesAny(low, ['snowball', 'iterate', 'then expand', 'expand bibliograph'])
  ) {
    return normalizePlan({
      summary: 'Ingest operator-provided URL (planner LLM unavailable).',
      steps: [{
        tool: 'ingest_url',
        args: { url: allUrls[0], note: combined.slice(0, 500) },
        why: 'Single operator URL → direct ingest',
      }],
      mode: 'fallback',
    }, goal);
  }
  try {
    const { looksLikeSeedSnowball } = require('./eiSeedSnowball');
    if (looksLikeSeedSnowball(combined)) {
      return normalizePlan({
        summary: 'Seeded ingest + bibliography snowball (planner LLM unavailable).',
        steps: [{
          tool: 'seed_snowball',
          args: { list: combined.slice(0, 4000), rounds: 2, expand_limit: 3 },
          why: 'Operator seed list with iterative bibliography expand',
        }],
        mode: 'fallback',
      }, goal);
    }
  } catch (_) { /* optional */ }
  const urlMatch = allUrls[0] || null;
  if (urlMatch && includesAny(low, ['ingest', 'add', 'download', 'get'])) {
    return normalizePlan({
      summary: 'Ingest operator-provided URL (planner LLM unavailable).',
      steps: [{
        tool: 'ingest_url',
        args: { url: urlMatch, note: combined.slice(0, 500) },
        why: 'Direct URL ingest when planner LLM is unavailable',
      }],
      mode: 'fallback',
    }, goal);
  }
  if (
    nearPhrase(combined, ['expand'], ['bibliograph'], 80)
    || nearPhrase(combined, ['citation', 'citations'], ['from', 'of'], 40)
  ) {
    const runs = extractDigitRuns(combined).filter((r) => r.text.length >= 1 && r.text.length <= 7);
    const hid = runs.length ? runs[0] : null;
    if (hid) {
      return normalizePlan({
        summary: 'Expand bibliography from kept item (planner LLM unavailable).',
        steps: [{
          tool: 'expand_from_item',
          args: { harvest_id: Number(hid.value), limit: 5 },
          why: 'Hybrid bibliography expand',
        }],
        mode: 'fallback',
      }, goal);
    }
  }
  const named = parseNamedWork(combined || goal);
  const args = {
    query: named.seekQuery || String(goal || '').slice(0, 500),
    require_document: true,
    require_image: false,
  };
  if (named.isSingularTitle) {
    args.limit = named.seekLimit || 12;
    args.max_keeps = named.maxKeeps || 1;
  }
  return normalizePlan({
    summary: named.isSingularTitle
      ? `Open-web seek for named work «${named.title}» (planner LLM unavailable).`
      : 'Open-web seek for the operator goal (planner LLM unavailable).',
    steps: [{
      tool: 'seek_files',
      args,
      why: 'Default seek when planner LLM is unavailable',
    }],
    mode: 'fallback',
  }, goal);
}

/**
 * Ollama structured-output schema: the model cannot emit an unknown tool name.
 */
function buildPlanSchema(toolNames) {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      steps: {
        type: 'array',
        maxItems: MAX_STEPS,
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: toolNames },
            args: { type: 'object' },
            why: { type: 'string' },
          },
          required: ['tool'],
        },
      },
    },
    required: ['summary', 'steps'],
  };
}

async function planWorkLlm(goal, clarification = '') {
  const combined = [goal, clarification].filter(Boolean).join('\n');
  const tools = listTools();
  const toolLines = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const research = loadResearchGoal();
  const model = process.env.PIKO_EI_WORK_PLANNER_MODEL
    || process.env.PIKO_HEAVY_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';

  const prompt = `You plan work for Egyptian Insights. Understand the operator goal; choose the fewest tools that achieve it.

Never ask the operator to pick an agent.

Guidance (use judgment, not keywords):
- Finding / adding ONE named book/PDF/volume → seek_files alone with that exact title/author. One step. Do NOT add a second harvest. Do NOT broaden to "all PDFs/articles/books" unless the goal says all/every/works.
- Author corpus asks ("all works by X", "PDFs and articles by X") → seek_files with that scope; still no museum harvest unless they asked for objects/images.
- Museum objects / images only when clearly requested → harvest with image sources.
- Bibliography pointers (TopBib/TLA) only when they ask for bibliography/catalog, not the volume file.
- Flag/review the corpus only when they explicitly ask to review or set flags.
- Preserve singular vs plural from the goal. Never expand a single title into a multi-work harvest.

Research goal context: ${research.title || ''} — sites Abydos, Heliopolis, Giza; earliest writing.

TOOLS:
${toolLines}

GOAL:
${combined}

Return JSON only:
{"summary":"one line","steps":[{"tool":"seek_files|ingest_url|seed_snowball|research_campaign|write_article|thread_dossier|chase_topbib|harvest|find_literature|search_corpus|review_corpus|extract_bibliography|expand_from_item|digest_item|deep_digest_item|index_corpus|transcribe|critique|self_diagnosis|health","args":{},"why":"short"}]}
Max ${MAX_STEPS} steps. Prefer 1 step when one tool can do the job.
If the operator pastes a LIST of URLs and/or named works and wants ingest + bibliography iteration / snowball, use seed_snowball with args.list set to their FULL message verbatim (preserve newlines; do not collapse to one semicolon line; one step).
If they ask for CONTINUOUS / automatic / ongoing research ("keep researching", "start the campaign", "pause the campaign", campaign status), use research_campaign with args.action start|pause|resume|stop|status|run_now (one step).
If the operator asks to diagnose learning / find duplicate keeps / self-diagnosis, use self_diagnosis (one step; kind duplicate_keeps|notes_by_thread|reflection_rejections|scorecard).
If the operator asks for an article/essay/write-up on a topic, use write_article (one step).
If the operator pastes a single http(s) URL to ingest, use ingest_url.
If they ask to expand bibliography / citations from a kept work, use expand_from_item (needs harvest_id).
expand_from_item / digest_item / deep_digest_item args.harvest_id MUST be a numeric corpus id from the goal or notes; if you don't have one, do not emit the step.
If TopBib pointers then PDFs are needed, use chase_topbib.`;

  const toolNames = tools.map((t) => t.name);
  const schema = buildPlanSchema(toolNames);
    const chatOpts = {
      format: schema,
      temperature: 0,
      num_ctx: Number(process.env.PIKO_EI_WORK_PLANNER_NUM_CTX || 4096),
      max_tokens: 600,
    timeoutMs: Math.max(8000, Number(process.env.PIKO_EI_WORK_PLANNER_TIMEOUT_MS || 45000)),
    priority: 'background',
    lane: 'worker',
    tag: 'eiWorkPlanner',
  };
  const messages = [
    { role: 'system', content: 'You output JSON work plans for an Egyptian Insights worker agent. Understand the goal; do not pad with unrelated tools.' },
    { role: 'user', content: prompt },
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw = '';
    try {
      raw = await ollamaNativeChat(model, messages, chatOpts);
    } catch (e) {
      lastErr = e;
      continue;
    }
    const parsed = extractJsonObject(raw) || {};
    const plan = normalizePlan({ ...parsed, mode: attempt === 0 ? 'llm' : 'llm_retry' }, goal);
    if (plan.ok) return plan;
    lastErr = new Error('LLM plan empty or invalid tools');
    messages.push({ role: 'assistant', content: String(raw).slice(0, 800) });
    messages.push({
      role: 'user',
      content: `That plan was invalid (no usable steps). Valid tools: ${toolNames.join(', ')}. `
        + 'Return JSON only, matching the schema, with at least one step that achieves the goal.',
    });
  }
  throw lastErr || new Error('LLM plan failed');
}

/**
 * Plan work for a goal. LLM first; deterministic seek fallback carries the
 * failure reason so jobs can surface planner_mode/planner_error.
 */
async function planWork(goal, opts = {}) {
  const clarification = opts.clarification || '';
  const preferLlm = opts.llm !== false
    && String(process.env.PIKO_EI_WORK_PLANNER_LLM || '1').trim() !== '0';

  if (preferLlm) {
    try {
      return await planWorkLlm(goal, clarification);
    } catch (e) {
      const fb = planWorkRules(goal, clarification);
      fb.llm_error = String(e && e.message ? e.message : e).slice(0, 200);
      return fb;
    }
  }
  return planWorkRules(goal, clarification);
}

module.exports = {
  planWork,
  planWorkRules,
  planWorkLlm,
  formatPlanSummary,
  normalizePlan,
  lintPlan,
  buildPlanSchema,
  MAX_STEPS,
};
