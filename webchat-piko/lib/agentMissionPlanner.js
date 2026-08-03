/**
 * Mission planner — Phase C: goal → child briefs assigned to registry agents.
 * Default mode is deterministic (rules) for reliable EI smoke; optional llm.
 */
const { listAgents } = require('./agentRegistry');
const { ollamaNativeChat } = require('./llm');
const {
  isCollationGoal,
  planSiteHarvestChildren,
  sitesMentioned,
  harvestAdapterPayload,
  mandateBlock,
  parseHarvestConstraints,
  loadResearchGoal,
} = require('./eiResearchGoal');
const {
  includesAny,
  hasAnyWord,
  hasWord,
  splitLines,
  isAsciiDigit,
  extractBalancedJsonObject,
  toLowerAsciiish,
} = require('./text');

function hasStem(haystack, stem) {
  // Match stem or stem+suffix (collat/collect, compil/compile, digitiz/digitize)
  const h = String(haystack || '');
  const s = String(stem || '');
  if (!s) return false;
  let from = 0;
  while (from < h.length) {
    const idx = h.indexOf(s, from);
    if (idx < 0) return false;
    const before = idx === 0 ? ' ' : h[idx - 1];
    const afterIdx = idx + s.length;
    const after = afterIdx < h.length ? h[afterIdx] : ' ';
    const beforeOk = before === ' ' || before === '-' || before === '/' || before === '(';
    const afterOk = after === ' ' || after === '-' || after === '/' || after === ')'
      || after === 's' || after === 'e' || after === 'd' || after === 'i' || after === 'a'
      || after === 'o' || after === 'u' || after === 'y' || after === 'n' || after === 'r'
      || after === 't' || after === 'g';
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

function pickDefaultAgent(agents) {
  // Culture spines: prefer generalist worker (shared tool belt).
  const prefer = ['ei-worker', 'ei-harvester', 'culture-researcher', 'ei-corpus', 'researcher', 'quant'];
  for (const id of prefer) {
    const hit = agents.find((a) => a.id === id);
    if (hit) return hit.id;
  }
  return agents[0] ? agents[0].id : null;
}

function assignAgentForPart(part, agents) {
  const lower = toLowerAsciiish(part);
  const has = (id) => agents.some((a) => a.id === id);
  const harvestish = () => ['harvest', 'scrape', 'download', 'museum', 'archive', 'collat', 'collect',
    'gather', 'compil', 'ingest', 'digitiz', 'discover', 'scout'].some((s) => hasStem(lower, s));

  if (has('ei-worker')) {
    if (has('ei-health') && (hasWord(lower, 'health') || includesAny(lower, ['spine status', 'adapter health']))
      && !hasAnyWord(lower, ['harvest', 'find', 'search', 'review', 'flag', 'collect'])) {
      return 'ei-health';
    }
    return 'ei-worker';
  }

  if (has('ei-health') && (hasWord(lower, 'health') || includesAny(lower, ['spine status', 'adapter health']))) {
    return 'ei-health';
  }
  if (has('ei-pipeline') && (hasWord(lower, 'pipeline') || includesAny(lower, ['full scrape', 'scribe-scholar', 'scribe scholar', 'handshake']))) {
    return 'ei-pipeline';
  }
  if (has('ei-harvester') && harvestish()) {
    return 'ei-harvester';
  }
  if (has('ei-scribe') && hasAnyWord(lower, ['scribe', 'transcribe', 'gardiner'])
    && !['collat', 'collect', 'gather', 'harvest', 'scrape'].some((s) => hasStem(lower, s))) {
    return 'ei-scribe';
  }
  if (has('ei-scholar') && (hasAnyWord(lower, ['scholar', 'critique'])
    || includesAny(lower, ['museum translation', 'critique translation']))) {
    return 'ei-scholar';
  }
  if (
    has('ei-corpus')
    && (hasWord(lower, 'corpus')
      || includesAny(lower, ['search the cache', 'search cache', 'cultures_cache',
        'find in the corpus', 'find in corpus', "what's in the corpus", 'whats in the corpus',
        'what is in the corpus']))
  ) {
    return 'ei-corpus';
  }
  if (has('ei-corpus') && hasWord(lower, 'search')
    && !['harvest', 'collat', 'collect', 'discover'].some((s) => hasStem(lower, s))) {
    return 'ei-corpus';
  }
  if (has('culture-researcher')
    && includesAny(lower, ['egypt', 'anubis', 'hieroglyph', 'tomb', 'pharaoh', 'osiris',
      'gardiner', 'culture', 'funerary', 'abydos', 'heliopolis', 'giza'])
    && !['harvest', 'scrape', 'collat', 'collect', 'gather', 'compil', 'discover'].some((s) => hasStem(lower, s))) {
    return 'culture-researcher';
  }
  if (has('quant') && includesAny(lower, ['forecast', 'sku', 'reorder', 'sales'])) {
    return 'quant';
  }
  return pickDefaultAgent(agents);
}

function stripListPrefix(line) {
  let l = String(line || '').trim();
  if (l.startsWith('-') || l.startsWith('*') || l.startsWith('•')) {
    l = l.slice(1).trim();
  }
  // "1. " / "2) "
  let i = 0;
  while (i < l.length && isAsciiDigit(l[i])) i += 1;
  if (i > 0 && (l[i] === '.' || l[i] === ')')) {
    l = l.slice(i + 1).trim();
  }
  return l;
}

function splitOnDelims(g) {
  const delims = ['; ', ', and ', ' and then '];
  const low = toLowerAsciiish(g);
  for (const d of delims) {
    if (low.includes(d)) {
      const parts = [];
      let rest = g;
      let restLow = toLowerAsciiish(rest);
      while (restLow.includes(d)) {
        const idx = restLow.indexOf(d);
        parts.push(rest.slice(0, idx).trim());
        rest = rest.slice(idx + d.length);
        restLow = toLowerAsciiish(rest);
      }
      parts.push(rest.trim());
      return parts.filter(Boolean);
    }
  }
  return [g];
}

function splitGoalParts(goal) {
  const g = String(goal || '').trim();
  if (!g) return [];

  const lines = splitLines(g).map((l) => l.trim()).filter(Boolean);
  const listish = lines.map(stripListPrefix).filter((l) => l.length > 8);
  if (listish.length >= 2) return listish.slice(0, 3);

  const clauses = splitOnDelims(g).map((c) => c.trim()).filter((c) => c.length > 12);
  if (clauses.length >= 2) return clauses.slice(0, 3);

  return [g];
}

/**
 * Deterministic plan: 1–3 children, assign best available agent.
 * Early-period three-site collation expands to one harvest child per site.
 * Goal/clarification text can override sources (literature-only, TopBib, scout, …).
 */
function planMissionRules(goal, rootDir) {
  const agents = listAgents(rootDir);
  const defaultId = pickDefaultAgent(agents);
  if (!defaultId) {
    return { ok: false, error: 'No agents available for this tenant', children: [] };
  }

  const constraints = parseHarvestConstraints(goal);

  if (isCollationGoal(goal) && agents.some((a) => a.id === 'ei-harvester')) {
    let sites = sitesMentioned(goal);
    const all = loadResearchGoal().sites || [];
    if (!sites.length) sites = all;
    if (constraints.only_sites && constraints.only_sites.length) {
      sites = sites.filter((s) => constraints.only_sites.includes(s.id));
    }
    if (constraints.skip_sites && constraints.skip_sites.length) {
      sites = sites.filter((s) => !constraints.skip_sites.includes(s.id));
    }
    if (!sites.length) sites = all;

    const children = sites.slice(0, 3).map((site, i) => ({
      id: `c${i + 1}`,
      title: `Harvest ${site.label}`.slice(0, 80),
      brief: JSON.stringify(harvestAdapterPayload(site, constraints)),
      agent_id: 'ei-harvester',
      status: 'planned',
      run_id: null,
      review: null,
      focus: site.id,
    }));

    if (constraints.discover_sources) {
      const scoutFocus = (sites[0] && sites[0].id) || 'abydos';
      children.unshift({
        id: 'c0',
        title: 'Scout digital archives (TopBib/TLA-like)',
        brief: JSON.stringify({
          focus: scoutFocus,
          query: 'Egyptian egyptology digital archive bibliography corpus TopBib TLA Archive.org',
          limit: constraints.limit != null ? constraints.limit : 12,
          allow_stubs: false,
          require_image: false,
          sources: ['source_scout'],
          note: 'Scout for digital archives / bibliographies similar to TopBib, TLA, and Archive.org; store as source_candidate.',
        }),
        agent_id: 'ei-harvester',
        status: 'planned',
        run_id: null,
        review: null,
        focus: scoutFocus,
      });
      children.forEach((c, i) => { c.id = `c${i + 1}`; });
    }

    return {
      ok: true,
      mode: 'rules_early_period',
      constraints,
      children: children.length ? children : planSiteHarvestChildren(constraints),
    };
  }

  const parts = splitGoalParts(goal);
  const children = parts.map((part, i) => {
    const agentId = assignAgentForPart(part, agents) || defaultId;
    let brief = part.slice(0, 2000);
    if (agentId === 'culture-researcher') {
      brief = `${mandateBlock()}\n\nTask: ${brief}`.slice(0, 4000);
    } else if (agentId === 'ei-harvester') {
      const hits = sitesMentioned(part);
      const partConstraints = parseHarvestConstraints(`${goal}\n${part}`);
      if (hits.length === 1) {
        brief = JSON.stringify(harvestAdapterPayload(hits[0], partConstraints));
      } else {
        const g = loadResearchGoal();
        const payload = harvestAdapterPayload(
          { id: null, label: 'unscoped', query: part.slice(0, 300) },
          partConstraints,
        );
        brief = JSON.stringify({
          ...payload,
          focus: undefined,
          query: part.slice(0, 300),
          limit: partConstraints.limit != null ? partConstraints.limit : (g.default_harvest_limit || 15),
          note: part.slice(0, 1000),
        });
      }
    } else if (agentId === 'ei-pipeline') {
      brief = part.slice(0, 2000);
    }
    return {
      id: `c${i + 1}`,
      title: part.slice(0, 80),
      brief,
      agent_id: agentId,
      status: 'planned',
      run_id: null,
      review: null,
      focus: agentId === 'ei-harvester' && sitesMentioned(part).length === 1
        ? sitesMentioned(part)[0].id
        : null,
    };
  });

  return {
    ok: true,
    mode: 'rules',
    constraints,
    children,
  };
}

function parseJsonObject(raw) {
  const fence = extractBalancedJsonObject(String(raw || '').trim());
  if (!fence) return null;
  try {
    return JSON.parse(fence);
  } catch (_) {
    return null;
  }
}

async function planMissionLlm(goal, rootDir) {
  const agents = listAgents(rootDir);
  if (!agents.length) {
    return { ok: false, error: 'No agents available for this tenant', children: [] };
  }
  if (isCollationGoal(goal) && agents.some((a) => a.id === 'ei-harvester')) {
    return planMissionRules(goal, rootDir);
  }
  const catalog = agents.map((a) => `${a.id}: ${a.description || a.label}`).join('\n');
  const model = process.env.PIKO_AGENT_PLAN_MODEL
    || process.env.PIKO_ROUTER_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';
  const prompt = `You are Piko planning work for specialist agents on Egyptian Insights.
Research mandate:
${mandateBlock()}
Return ONLY JSON:
{"children":[{"title":"...","brief":"...","agent_id":"..."}]}
Rules: 1-3 children; agent_id MUST be one of: ${agents.map((a) => a.id).join(', ')}
Prefer ei-harvester for collation/collection into cultures_cache before scribe/scholar.
Goal: ${String(goal).slice(0, 1500)}
Agents:
${catalog}
`;
  const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    max_tokens: 600,
    temperature: 0.2,
    timeoutMs: Number(process.env.PIKO_AGENT_PLAN_TIMEOUT_MS || 45000),
    priority: 'background',
    lane: 'worker',
  });
  const parsed = parseJsonObject(raw);
  const rows = parsed && Array.isArray(parsed.children) ? parsed.children : null;
  if (!rows || !rows.length) throw new Error('plan_json_parse_failed');

  const allowed = new Set(agents.map((a) => a.id));
  const fallback = pickDefaultAgent(agents);
  const children = rows.slice(0, 3).map((row, i) => {
    const agentId = allowed.has(row.agent_id) ? row.agent_id : fallback;
    const brief = String(row.brief || row.title || goal).trim().slice(0, 2000);
    return {
      id: `c${i + 1}`,
      title: String(row.title || brief).slice(0, 80),
      brief,
      agent_id: agentId,
      status: 'planned',
      run_id: null,
      review: null,
    };
  }).filter((c) => c.brief);

  if (!children.length) throw new Error('plan_empty');
  return { ok: true, mode: 'llm', children };
}

/**
 * @returns {Promise<{ok:boolean, mode?:string, children:object[], error?:string}>}
 */
async function planMission(goal, rootDir) {
  const g = String(goal || '').trim();
  if (!g) return { ok: false, error: 'goal required', children: [] };

  const mode = String(process.env.PIKO_AGENT_PLAN_MODE || 'rules').trim().toLowerCase();
  if (mode === 'llm') {
    try {
      return await planMissionLlm(g, rootDir);
    } catch (e) {
      const fallback = planMissionRules(g, rootDir);
      return {
        ...fallback,
        mode: 'rules_fallback',
        note: `LLM plan failed (${e.message}); used rules.`,
      };
    }
  }
  return planMissionRules(g, rootDir);
}

module.exports = {
  planMission,
  planMissionRules,
  splitGoalParts,
  pickDefaultAgent,
  assignAgentForPart,
};
