/**
 * Legion adapter runtime for registered agents (Phase D).
 * Culture capabilities always resolve to egyptian-insights — never AusMaker.
 */
const { dispatchLegionCapabilityRun, resolveAdapterForCapability } = require('./legionDispatch');
const { pollLegionRun, buildSummaryFromResult } = require('./legionRunPoller');
const path = require('path');
const { extractFocus, loadResearchGoal } = require('./eiResearchGoal');

const {
  stripTrailingSlash,
} = require('./text');

function getLegionBase() {
  return stripTrailingSlash(String(
    process.env.PIKO_LEGION_ADAPTER_API_BASE
    || process.env.LEGION_ADAPTER_API_BASE
    || 'http://127.0.0.1:8000',
  ).trim());
}

function dataDir() {
  return String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
}

/**
 * Build adapter input from agent defaults + free-text brief.
 * Brief may be plain text (query) or JSON object.
 * Explicit focus in JSON / opts always wins over NLP inference.
 */
function buildAdapterInput(agent, brief, overrides = {}) {
  const base = (agent.default_input && typeof agent.default_input === 'object')
    ? { ...agent.default_input }
    : {};
  const raw = String(brief || '').trim();
  let fromBrief = {};

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fromBrief = parsed;
      }
    } catch (_) { /* fall through */ }
  }

  const merged = { ...base, ...fromBrief, ...overrides };
  const cap = String(agent.legion_capability || '').trim();

  if (cap === 'culture.corpus.search') {
    return { ...merged, query: merged.query || raw.slice(0, 500) };
  }
  if (cap === 'health.check') {
    return { ...merged };
  }
  if (cap === 'research.scrape.run' || cap === 'culture.pipeline.run') {
    const goal = loadResearchGoal();
    const focus = merged.focus || merged.site || extractFocus(raw) || null;
    const site = focus
      ? (goal.sites || []).find((s) => s.id === focus)
      : null;
    const query = merged.query
      || (site && site.query)
      || (raw.startsWith('{') ? '' : raw.slice(0, 200))
      || (goal.sites && goal.sites[0] && goal.sites[0].query)
      || 'Egyptian hieroglyph';
    return {
      ...merged,
      note: merged.note || (raw.startsWith('{') ? '' : raw.slice(0, 1000)),
      query,
      focus: focus || undefined,
      limit: merged.limit != null ? merged.limit : (goal.default_harvest_limit || 15),
      allow_stubs: merged.allow_stubs === true,
      require_image: (() => {
        if (merged.require_image === false || merged.require_image === true) return !!merged.require_image;
        const srcs = merged.sources;
        if (Array.isArray(srcs) && srcs.length
          && srcs.every((s) => ['archive_org', 'web_pdf', 'topbib', 'tla', 'source_scout'].includes(s))) {
          return false;
        }
        if (merged.literature_only === true) return false;
        return true;
      })(),
      sources: merged.sources || ['met', 'commons', 'artic', 'digital_giza', 'archive_org', 'topbib', 'tla'],
      skip_thin: merged.skip_thin === true,
      min_text_chars: merged.min_text_chars != null ? merged.min_text_chars : undefined,
      require_document: merged.require_document === true,
      revision: merged.revision != null ? merged.revision : undefined,
    };
  }
  if (cap === 'scribe.transcribe.image' || cap === 'translation.critique') {
    if (merged.harvest_id) return merged;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) {
      return { ...merged, harvest_id: Math.floor(asNum) };
    }
    return { ...merged, note: merged.note || raw.slice(0, 1000) };
  }
  return { ...merged, note: merged.note || raw.slice(0, 1000) };
}

/**
 * @returns {Promise<{ status: 'ok'|'failed', artifact_text: string, legion_run_id?: string, result?: object }>}
 */
async function executeLegionAgent(agent, brief, opts = {}) {
  const capability = String(agent.legion_capability || '').trim();
  if (!capability) {
    return { status: 'failed', artifact_text: `Error: Agent '${agent.id}' missing legion_capability.` };
  }

  const adapterId = agent.adapter_id
    || resolveAdapterForCapability(capability)
    || 'egyptian-insights';

  if (String(adapterId).includes('ausmaker') || adapterId === 'ausmakersupplies') {
    return {
      status: 'failed',
      artifact_text: `Error: Refusing to dispatch culture agent '${agent.id}' to AusMaker adapter.`,
    };
  }

  const input = buildAdapterInput(agent, brief, opts.adapterInput || {});

  // Raw URLs in a keyword-harvest query produce museum-connector junk
  // ("pyramid" → Gaius Cestius). Direct URL ingests must go through ingest_url,
  // which builds a proper SEED_URL: query.
  if (capability === 'research.scrape.run') {
    const q = String(input.query || '');
    if (/https?:\/\//i.test(q) && !/SEED_URL:/i.test(q)) {
      return {
        status: 'failed',
        artifact_text: 'Error: research.scrape.run received a raw URL as a search query. '
          + 'Direct URL ingests must use the ingest_url tool (handles PDFs and word-for-word HTML text sites).',
      };
    }
  }

  const baseUrl = opts.baseUrl || getLegionBase();

  const dispatch = await dispatchLegionCapabilityRun({
    capability,
    adapterId,
    input,
    baseUrl,
    piko_user_id: opts.pikoUserId || `agent:${agent.id}`,
    source: opts.source || 'agent_orchestrator',
    execution_mode: 'auto',
    risk_level: 'low',
    timeoutMs: opts.timeoutMs,
  });

  if (!dispatch.ok || !dispatch.runId) {
    return {
      status: 'failed',
      artifact_text: `Error: Legion dispatch failed — ${dispatch.message || dispatch.code || 'unknown'}`,
    };
  }

  const polled = await pollLegionRun(dispatch.runId, baseUrl, {
    timeoutMs: opts.pollTimeoutMs || opts.timeoutMs,
    shouldAbort: opts.shouldAbort,
  });
  if (polled.cancelled) {
    return {
      status: 'failed',
      cancelled: true,
      legion_run_id: dispatch.runId,
      artifact_text: `Cancelled while waiting on Legion run ${dispatch.runId}.`,
    };
  }
  if (!polled.ok || !polled.result) {
    return {
      status: 'failed',
      legion_run_id: dispatch.runId,
      artifact_text: `Error: Legion run ${dispatch.runId} did not complete — ${polled.error || polled.status || 'timeout'}`,
    };
  }

  let summary = '';
  try {
    summary = buildSummaryFromResult(polled.result, capability, dataDir()) || '';
  } catch (_) {
    summary = '';
  }
  if (!summary) {
    try {
      summary = JSON.stringify(polled.result).slice(0, 4000);
    } catch (_) {
      summary = String(polled.result || 'completed');
    }
  }

  const resultOk = polled.result && polled.result.ok !== false;
  const liveCount = Number(polled.result && polled.result.live_count) || 0;
  const isScrape = capability === 'research.scrape.run' || capability === 'culture.pipeline.run';
  const scrapeFailed = isScrape && (!resultOk || (polled.result.allow_stubs !== true && liveCount === 0 && polled.result.stub_count != null));

  return {
    status: scrapeFailed ? 'failed' : 'ok',
    legion_run_id: dispatch.runId,
    artifact_text: `[${agent.id} / ${capability}]\n${summary}`,
    result: polled.result,
  };
}

module.exports = {
  executeLegionAgent,
  buildAdapterInput,
  getLegionBase,
};
