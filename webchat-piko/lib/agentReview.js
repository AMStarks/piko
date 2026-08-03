/**
 * Piko review of specialist agent output — Phase B.
 * Modes: rules (deterministic) | llm (Ollama JSON + rules fallback).
 *
 * Harvest reviews are goal-aware: counts alone are not enough; thin literature
 * and scout-pointer fills get revise so the mission loop can re-brief.
 */
const { ollamaNativeChat } = require('./llm');
const { parseHarvestConstraints, LITERATURE_SOURCES } = require('./eiResearchGoal');
const {
  toLowerAsciiish,
  includesAny,
  hasAnyWord,
  hasWord,
  startsWithIgnoreCase,
  extractDigitRuns,
  extractAlnumTokens,
  extractBalancedJsonObject,
  isAsciiDigit,
} = require('./text');

function hasKeyedZero(lower, key) {
  // live=0 or live_count: 0 / live_count"=0 etc.
  const idx = lower.indexOf(key);
  if (idx < 0) return false;
  let i = idx + key.length;
  while (i < lower.length && (lower[i] === '"' || lower[i] === "'" || lower[i] === ' ' || lower[i] === '\t')) i += 1;
  if (lower[i] === '=' || lower[i] === ':') i += 1;
  while (i < lower.length && (lower[i] === ' ' || lower[i] === '\t')) i += 1;
  return lower[i] === '0' && (i + 1 >= lower.length || !isAsciiDigit(lower[i + 1]));
}

function hasKeyedTrue(lower, key) {
  const idx = lower.indexOf(key);
  if (idx < 0) return false;
  let i = idx + key.length;
  while (i < lower.length && (lower[i] === '"' || lower[i] === "'" || lower[i] === ' ' || lower[i] === '\t')) i += 1;
  if (lower[i] === '=' || lower[i] === ':') i += 1;
  while (i < lower.length && (lower[i] === ' ' || lower[i] === '\t')) i += 1;
  return lower.startsWith('true', i);
}

function hasStubsCount(lower) {
  const idx = lower.indexOf('stubs=');
  if (idx < 0) return false;
  return idx + 6 < lower.length && isAsciiDigit(lower[idx + 6]);
}

function scrapeFailureFromArtifact(artifactText) {
  const text = String(artifactText || '');
  const lower = toLowerAsciiish(text);
  if (includesAny(lower, ['harvest failed', 'harvest  failed'])) return true;
  if (lower.includes('harvest') && lower.includes('failed') && lower.indexOf('harvest') < lower.indexOf('failed')) {
    // loose: "harvest ... failed"
    const h = lower.indexOf('harvest');
    const f = lower.indexOf('failed', h);
    if (f > h && f - h < 20) return true;
  }
  if (hasKeyedZero(lower, 'live') && hasStubsCount(lower)) return true;
  if (hasKeyedZero(lower, 'live_count') && !hasKeyedTrue(lower, 'allow_stubs')) return true;
  if (lower.includes('seed_stubs_used') && hasKeyedZero(lower, 'live')) return true;
  return false;
}

function parseBriefPayload(brief) {
  const raw = String(brief || '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractQuality(artifactText, result) {
  const q = (result && result.quality) || {};
  if (q && q.substantive_count != null) {
    return {
      substantive: Number(q.substantive_count) || 0,
      thin: Number(q.thin_count) || 0,
      literature: Number(q.literature_count) || 0,
      candidates: Number(q.candidate_count) || 0,
      objects: Number(q.object_count) || 0,
      docs: Number(q.with_document) || 0,
      maxChars: Number(q.max_text_chars) || 0,
      live: Number(result.live_count) || 0,
    };
  }
  const text = String(artifactText || '');
  const lower = toLowerAsciiish(text);
  function numAfter(key) {
    const idx = lower.indexOf(key);
    if (idx < 0) return null;
    const runs = extractDigitRuns(lower.slice(idx + key.length));
    if (!runs.length || runs[0].index > 2) return null;
    return runs[0].value;
  }
  const live = numAfter('live=');
  const qIdx = lower.indexOf('quality:');
  if (qIdx < 0) {
    return {
      substantive: null, thin: null, literature: null, candidates: null,
      objects: null, docs: null, maxChars: null, live,
    };
  }
  const slice = lower.slice(qIdx);
  function numIn(key) {
    const idx = slice.indexOf(key);
    if (idx < 0) return null;
    const runs = extractDigitRuns(slice.slice(idx + key.length));
    if (!runs.length || runs[0].index > 2) return null;
    return runs[0].value;
  }
  if (numIn('substantive=') == null) {
    return {
      substantive: null, thin: null, literature: null, candidates: null,
      objects: null, docs: null, maxChars: null, live,
    };
  }
  return {
    substantive: numIn('substantive='),
    thin: numIn('thin='),
    literature: numIn('literature='),
    candidates: numIn('candidates='),
    objects: null,
    docs: numIn('docs='),
    maxChars: numIn('max_chars='),
    live,
  };
}

function isLiteratureOrientedBrief(brief, payload) {
  const constraints = parseHarvestConstraints(String(brief || ''));
  if (constraints.literature_only || constraints.literature_first) return true;
  const sources = (payload && payload.sources) || constraints.sources || [];
  if (!sources.length) return false;
  const set = new Set(sources);
  if (set.has('source_scout') && set.size === 1) return false;
  const litish = [...LITERATURE_SOURCES, 'source_scout'];
  return [...set].every((s) => litish.includes(s));
}

function isScoutOnlyBrief(payload) {
  const sources = (payload && payload.sources) || [];
  return sources.length === 1 && sources[0] === 'source_scout';
}

function briefGoalFitReview({ brief, artifactText, result, agentId }) {
  const g = String(brief || '').toLowerCase();
  if (!g || g.trim().startsWith('{')) return null;

  const wantTexts = hasAnyWord(g, ['text', 'texts', 'book', 'books', 'literature', 'report', 'reports', 'volume', 'volumes', 'pdf', 'pdfs']);
  const art = String(artifactText || '');
  const isHarvestish = agentId === 'ei-harvester'
    || agentId === 'ei-worker'
    || art.toLowerCase().includes('research.scrape.run')
    || art.toLowerCase().includes('[ei-worker');
  if (!isHarvestish || !wantTexts) return null;

  // Prefer structured goal_fit from ei-worker (evidence-based, not title fossils).
  if (result && result.goal_fit && result.goal_fit.pass === false) {
    return {
      verdict: 'revise',
      summary: result.goal_fit.summary || 'Worker goal fit failed for literature brief.',
      reasons: ['goal_fit_poor', ...(result.goal_fit.fit ? [`fit:${result.goal_fit.fit}`] : [])],
      mode: 'rules',
    };
  }
  const artLow = toLowerAsciiish(art);
  if (result && result.pass === false && artLow.includes('goal fit:') && includesAny(artLow, ['poor', 'mixed'])) {
    return {
      verdict: 'revise',
      summary: 'Worker reported poor/mixed goal fit for the brief.',
      reasons: ['goal_fit_from_artifact'],
      mode: 'rules',
    };
  }
  return null;
}

function harvestQualityReview({ brief, artifactText, result, agentId }) {
  const artStr = String(artifactText || '');
  const isHarvester = agentId === 'ei-harvester'
    || agentId === 'ei-worker'
    || artStr.toLowerCase().includes('research.scrape.run')
    || hasWord(artStr, 'Harvest') || hasWord(toLowerAsciiish(artStr), 'harvest');
  if (!isHarvester) return null;

  const goalFit = briefGoalFitReview({ brief, artifactText, result, agentId });
  if (goalFit) return goalFit;

  const payload = parseBriefPayload(brief);
  const quality = extractQuality(artifactText, result);
  const literatureOriented = isLiteratureOrientedBrief(brief, payload);
  const scoutOnly = isScoutOnlyBrief(payload);

  if (scoutOnly) {
    if ((quality.live != null && quality.live === 0) || scrapeFailureFromArtifact(artifactText)) {
      return {
        verdict: 'revise',
        summary: 'Source scout found no archive candidates.',
        reasons: ['scout_empty'],
        mode: 'rules',
      };
    }
    return {
      verdict: 'accept',
      summary: 'Source scout returned archive/bibliography candidates.',
      reasons: ['scout_candidates_present'],
      mode: 'rules',
    };
  }

  if (scrapeFailureFromArtifact(artifactText)) {
    return {
      verdict: 'revise',
      summary: 'Harvest produced no live items (stub-only or connector failure).',
      reasons: ['harvest_no_live_items'],
      mode: 'rules',
    };
  }

  if (quality.substantive == null) return null;

  const reasons = [];
  if (literatureOriented) {
    if (quality.substantive === 0) {
      reasons.push('no_substantive_literature');
    }
    if (quality.candidates > 0 && quality.substantive === 0) {
      reasons.push('scout_only_fill');
    }
    if (quality.literature === 0 && quality.objects === 0 && quality.candidates > 0) {
      reasons.push('candidates_without_literature');
    }
    if (quality.thin > quality.substantive && quality.substantive < 2) {
      reasons.push('mostly_thin_rows');
    }
    if (quality.docs === 0 && quality.maxChars < 2000 && quality.substantive < 2) {
      reasons.push('no_digitized_volume');
    }
  } else if (quality.live > 0 && quality.substantive === 0) {
    reasons.push('no_substantive_items');
  }

  if (reasons.length) {
    return {
      verdict: 'revise',
      summary: literatureOriented
        ? `Literature harvest too thin for the research goal (substantive=${quality.substantive}, thin=${quality.thin}, docs=${quality.docs}).`
        : `Harvest items are not substantive enough (substantive=${quality.substantive}, thin=${quality.thin}).`,
      reasons,
      mode: 'rules',
      quality,
    };
  }

  return {
    verdict: 'accept',
    summary: literatureOriented
      ? `Substantive literature present (substantive=${quality.substantive}, docs=${quality.docs}, max_chars=${quality.maxChars}).`
      : `Harvest quality acceptable (substantive=${quality.substantive}, live=${quality.live}).`,
    reasons: ['quality_ok', quality.substantive > 0 ? 'has_substantive' : 'counts_ok'],
    mode: 'rules',
    quality,
  };
}

function buildRevisedHarvestBrief(brief, review, goal = '') {
  const payload = parseBriefPayload(brief) || {
    query: String(brief || '').slice(0, 300),
    limit: 15,
    allow_stubs: false,
    require_image: false,
    sources: [...LITERATURE_SOURCES],
  };
  const reasons = (review && review.reasons) || [];
  const constraints = parseHarvestConstraints(`${goal}\n${brief}\n${(review && review.summary) || ''}`);
  const scoutOnly = isScoutOnlyBrief(payload);

  let sources = Array.isArray(payload.sources) ? [...payload.sources] : [...LITERATURE_SOURCES];
  if (!scoutOnly) {
    sources = sources.filter((s) => s !== 'source_scout');
    for (const s of LITERATURE_SOURCES) {
      if (!sources.includes(s)) sources.push(s);
    }
    if (constraints.literature_only || reasons.some((r) => includesAny(toLowerAsciiish(r), ['literature', 'thin', 'scout', 'digitized']))) {
      sources = sources.filter((s) => LITERATURE_SOURCES.includes(s));
      if (!sources.length) sources = [...LITERATURE_SOURCES];
    }
  }

  const limit = Math.min(40, Math.max(Number(payload.limit) || 15, 20));
  const noteExtra = [
    'REVISION PASS: prior harvest was too thin for the research goal.',
    `Review: ${(review && review.summary) || 'quality revise'}.`,
    reasons.length ? `Reasons: ${reasons.join(', ')}.` : '',
    'Require substantive digitized literature (OCR text ≥500 chars and/or PDF).',
    'Do not fill the batch with source_scout pointers.',
    'Prefer Archive.org volumes with OCR, TopBib bibliographic records, and TLA object catalogue text.',
  ].filter(Boolean).join(' ');

  return JSON.stringify({
    ...payload,
    sources,
    limit,
    allow_stubs: false,
    require_image: false,
    skip_thin: true,
    min_text_chars: 500,
    revision: Number(payload.revision || 0) + 1,
    note: `${payload.note || ''}\n${noteExtra}`.trim().slice(0, 2000),
  });
}

function rulesReview({ brief, artifactText, status, agentId, result }) {
  const text = String(artifactText || '').trim();
  const textLow = toLowerAsciiish(text);
  const failedAfterAttempts = (() => {
    const idx = textLow.indexOf('failed after ');
    if (idx < 0) return false;
    const runs = extractDigitRuns(textLow.slice(idx + 'failed after '.length));
    return runs.length > 0 && runs[0].index <= 1 && textLow.slice(idx).includes('attempt');
  })();
  const failed = status === 'failed'
    || startsWithIgnoreCase(text, 'Error:')
    || failedAfterAttempts
    || text.length < 8;

  if (agentId === 'ei-qa' || text.includes('[ei-qa / ei.platform.eval]')) {
    const pass = (result && result.pass === true) || text.includes('Platform eval PASS');
    if (failed && !pass) {
      return {
        verdict: 'escalate',
        summary: 'Platform eval runner failed.',
        reasons: ['eval_runner_error'],
        mode: 'rules',
      };
    }
    return pass
      ? {
        verdict: 'accept',
        summary: 'Platform eval passed all rubric checks.',
        reasons: ['eval_pass'],
        mode: 'rules',
      }
      : {
        verdict: 'revise',
        summary: 'Platform eval failed one or more rubric checks.',
        reasons: ['eval_fail'],
        mode: 'rules',
      };
  }

  if (agentId === 'ei-text-scout' || text.includes('[ei-text-scout / find+assess]')) {
    const pass = (result && result.pass === true) || text.includes('USEFUL_PRIMARY_SET');
    if (failed && !pass) {
      return {
        verdict: 'escalate',
        summary: 'Text scout runner failed.',
        reasons: ['scout_runner_error'],
        mode: 'rules',
      };
    }
    return pass
      ? {
        verdict: 'accept',
        summary: 'Text scout found assessable primary texts that fit the goal.',
        reasons: ['scout_pass'],
        mode: 'rules',
      }
      : {
        verdict: 'revise',
        summary: 'Text scout did not find enough right primary texts for the goal.',
        reasons: ['scout_needs_better_texts'],
        mode: 'rules',
      };
  }

  if (agentId === 'ei-worker' || text.includes('[ei-worker / shared tool belt]')) {
    if (failed) {
      // Say what actually happened: an empty-handed search is not a crash.
      const mfCounts = (result && result.mission_fit && result.mission_fit.counts) || null;
      const cov = (result && result.seek_coverage) || null;
      let summary = 'The worker could not complete this one — nothing was added.';
      try {
        const { coverageVoiceSummary } = require('./eiAgentTools');
        summary = coverageVoiceSummary(cov, result && result.mission_fit) || summary;
      } catch (_) {
        if (mfCounts && Number(mfCounts.keep) === 0 && Number(mfCounts.drop) > 0) {
          summary = `The search turned up ${mfCounts.drop} candidate file(s), but none were the actual work requested (summaries, secondary material, or unrelated titles), so nothing was added.`;
        }
      }
      if (toLowerAsciiish(summary).includes('shelf empty')) {
        summary += ' Paste a direct PDF or Archive.org link and ask me to ingest it.';
      }
      return {
        verdict: 'escalate',
        summary,
        reasons: ['worker_failed'],
        mode: 'rules',
      };
    }
    // Author contract scan: even when the LLM review is unavailable, a keep
    // attributed to a different named author than the mission asked for is a
    // hard revise — this is exactly the misjudgment the fallback must catch.
    try {
      const { parseNamedWork, authorMatch } = require('./eiGoalParse');
      const mission = String((result && result.goal) || brief || '');
      const named = parseNamedWork(mission);
      if (named.author) {
        const keeps = ((result && result.mission_fit && result.mission_fit.judgments) || [])
          .filter((j) => j && j.verdict === 'keep' && !j.purged);
        const wrong = keeps.filter((j) => {
          const a = String(j.author || '').trim();
          if (!a || toLowerAsciiish(a) === 'unknown') return false;
          return !authorMatch(named.author, a)
            && !authorMatch(named.author, `${j.work_title || ''} ${j.title || ''}`);
        });
        if (wrong.length) {
          return {
            verdict: 'revise',
            summary: `Kept ${wrong.length} item(s) attributed to a different author than ${named.author} (e.g. "${(wrong[0].work_title || wrong[0].title || '').slice(0, 60)}" by ${wrong[0].author}).`,
            reasons: ['author_contract_violation'],
            mode: 'rules',
          };
        }
      }
    } catch (_) { /* scan is best-effort */ }
    const fit = result && result.goal_fit;
    if (fit && fit.pass === false) {
      return {
        verdict: 'revise',
        summary: fit.summary || 'Worker goal fit failed.',
        reasons: ['worker_goal_fit'],
        mode: 'rules',
      };
    }
    if (result && result.pass === false) {
      return {
        verdict: 'revise',
        summary: 'Worker completed steps but did not pass goal fit.',
        reasons: ['worker_needs_revision'],
        mode: 'rules',
      };
    }
    // WP5.7: bare completion without pass/overlap is not a deliverable.
    const structuredPass = !!(result && (
      result.pass === true
      || (fit && fit.pass === true)
    ));
    if (!structuredPass && !briefArtifactOverlap(brief, text)) {
      return {
        verdict: 'revise',
        summary: 'Artifact does not clearly address the brief (no pass signal / weak overlap).',
        reasons: ['brief_artifact_mismatch'],
        mode: 'rules',
      };
    }
    return {
      verdict: 'accept',
      summary: (fit && fit.summary) || 'Worker completed tool plan for the goal.',
      reasons: ['worker_ok'],
      mode: 'rules',
    };
  }

  if (agentId === 'ei-corpus-reviewer' || text.includes('[ei-corpus-reviewer / flag sources]')) {
    const keepIdx = textLow.indexOf('keep=');
    const pass = (result && result.pass === true)
      || (keepIdx >= 0 && isAsciiDigit(textLow[keepIdx + 5]));
    return pass
      ? {
        verdict: 'accept',
        summary: 'Corpus flags updated (keep / drop / review).',
        reasons: ['corpus_review_done'],
        mode: 'rules',
      }
      : {
        verdict: 'revise',
        summary: 'Corpus review produced no keep flags.',
        reasons: ['corpus_review_empty'],
        mode: 'rules',
      };
  }

  if (failed) {
    return {
      verdict: 'escalate',
      summary: 'Specialist output looks empty or failed.',
      reasons: ['empty_or_error_artifact'],
      mode: 'rules',
    };
  }

  const qualityGate = harvestQualityReview({ brief, artifactText, result, agentId });
  if (qualityGate) return qualityGate;

  const isHarvester = agentId === 'ei-harvester'
    || textLow.includes('research.scrape.run')
    || hasWord(text, 'Harvest') || hasWord(textLow, 'harvest');
  if (isHarvester && scrapeFailureFromArtifact(text)) {
    return {
      verdict: 'revise',
      summary: 'Harvest produced no live items (stub-only or connector failure).',
      reasons: ['harvest_no_live_items'],
      mode: 'rules',
    };
  }

  // WP5.7: non-harvest / non-health agents need structured pass or term overlap.
  // Bare result.ok is not enough — that lets status boilerplate slip through.
  const harvestLike = isHarvester
    || agentId === 'ei-harvester'
    || agentId === 'ei-pipeline';
  const healthLike = agentId === 'ei-health'
    || textLow.includes('[ei-health')
    || textLow.includes('health.check');
  if (!harvestLike && !healthLike) {
    const structuredPass = !!(result && (
      result.pass === true
      || (result.goal_fit && result.goal_fit.pass === true)
    ));
    if (!structuredPass && !briefArtifactOverlap(brief, text)) {
      return {
        verdict: 'revise',
        summary: 'Artifact does not clearly address the brief (no pass signal / weak overlap).',
        reasons: ['brief_artifact_mismatch'],
        mode: 'rules',
      };
    }
  }
  return {
    verdict: 'accept',
    summary: 'Output present and plausible for the brief.',
    reasons: ['non_empty'],
    mode: 'rules',
  };
}

/** Minimal term overlap: enough shared tokens that the artifact is about the brief. */
function briefArtifactOverlap(brief, artifact) {
  const stop = new Set([
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'been', 'your', 'about',
    'please', 'find', 'into', 'them', 'then', 'than', 'when', 'what', 'which',
    'would', 'could', 'should', 'there', 'their', 'been', 'been', 'just',
  ]);
  const terms = extractAlnumTokens(brief, 4);
  const meaningful = [...new Set(terms.filter((t) => !stop.has(t)))];
  if (!meaningful.length) return true;
  const art = toLowerAsciiish(artifact);
  if (!art.trim()) return false;
  const hits = meaningful.filter((t) => art.includes(t));
  const need = Math.min(3, Math.max(1, Math.ceil(meaningful.length * 0.12)));
  return hits.length >= need;
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

async function llmReview({
  brief, artifactText, agentId, result, operatorMessage, understood, missionFit,
}) {
  const model = process.env.PIKO_AGENT_REVIEW_MODEL
    || process.env.PIKO_ROUTER_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b';
  const quality = extractQuality(artifactText, result);

  let missionFitBlock = '';
  if (missionFit && missionFit.counts) {
    try {
      const { formatMissionFitReport } = require('./eiMissionFitReview');
      missionFitBlock = formatMissionFitReport(missionFit);
    } catch (_) {
      missionFitBlock = `Mission-fit counts: ${JSON.stringify(missionFit.counts)}`;
    }
  }

  const prompt = `You are Piko (Legate) reviewing a worker's finished job for Egyptian Insights.
Deterministic contract gates already PASSED. Your job is a final judgment call:
did the worker deliver exactly what the operator asked — the named work(s), in the asked-for quantity, nothing off-brief?

OPERATOR ASK (verbatim):
${String(operatorMessage || brief || '').slice(0, 1200)}
${understood ? `\nLegate understood the ask as: ${String(understood).slice(0, 300)}` : ''}
${missionFitBlock ? `\nMISSION-FIT REPORT (per-item keep/drop, contracts applied):\n${missionFitBlock.slice(0, 2000)}` : ''}

Return ONLY JSON: {"verdict":"accept"|"revise"|"escalate","summary":"...","reasons":["..."]}
Rules:
- accept ONLY if the deliverable matches the ask: right work/title/author, right scope (singular stays singular), no off-brief extras kept.
- revise if incomplete, off-title, wrong scope, junk kept alongside the deliverable, or thin stubs instead of the actual document.
- escalate if failed, unsafe, or needs a human decision.
- You may be stricter than the gates; you may NOT be more lenient than the evidence supports.

Agent: ${agentId}
Quality metrics: ${JSON.stringify(quality)}
Artifact:
${String(artifactText || '').slice(0, 3500)}
`;
  // Structured output: the model cannot emit prose or an unknown verdict.
  const raw = await ollamaNativeChat(model, [{ role: 'user', content: prompt }], {
    format: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['accept', 'revise', 'escalate'] },
        summary: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
      required: ['verdict', 'summary'],
    },
    max_tokens: 400,
    temperature: 0.1,
    num_ctx: Number(process.env.PIKO_AGENT_REVIEW_NUM_CTX || 8192),
    timeoutMs: Number(process.env.PIKO_AGENT_REVIEW_TIMEOUT_MS || 45000),
    priority: 'background',
    lane: 'worker',
    // Final review is the Mind's judgment — allow pinning it to the chat host.
    ollamaBaseUrl: process.env.PIKO_AGENT_REVIEW_OLLAMA_URL || undefined,
  });
  const parsed = parseJsonObject(raw);
  if (!parsed || !parsed.verdict) {
    throw new Error('review_json_parse_failed');
  }
  const verdict = String(parsed.verdict).toLowerCase();
  if (!['accept', 'revise', 'escalate'].includes(verdict)) {
    throw new Error('review_bad_verdict');
  }
  return {
    verdict,
    summary: String(parsed.summary || '').slice(0, 500),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [],
    mode: 'llm',
  };
}

async function reviewAgentOutput(input = {}) {
  const mode = String(process.env.PIKO_AGENT_REVIEW_MODE || 'rules').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') {
    return {
      verdict: 'accept',
      summary: 'Review disabled.',
      reasons: ['review_off'],
      mode: 'off',
    };
  }
  if (mode === 'llm') {
    // Deterministic floor: gates can fail a job outright; the LLM only reviews
    // gate-passed work and may demote accept → revise, never the reverse.
    const floor = rulesReview(input);
    if (floor.verdict !== 'accept') {
      return {
        ...floor,
        reasons: [...(floor.reasons || []), 'deterministic_floor'],
        mode: 'rules_floor',
      };
    }
    let lastErr = null;
    const attempts = Math.max(1, Number(process.env.PIKO_AGENT_REVIEW_ATTEMPTS || 2));
    for (let i = 0; i < attempts; i += 1) {
      try {
        const llm = await llmReview(input);
        return {
          ...llm,
          reasons: [...(llm.reasons || []), 'floor_passed', ...(i > 0 ? ['llm_retry'] : [])],
        };
      } catch (e) {
        lastErr = e;
        // Aborts/timeouts are usually a model reload or lane contention —
        // worth one more try before surrendering to the rules verdict.
        const transient = includesAny(toLowerAsciiish(e && e.message), [
          'abort', 'timeout', 'timed out', 'econnrefused', 'econnreset', 'socket', 'fetch failed',
        ]);
        if (!transient && i === 0) break;
      }
    }
    return {
      ...floor,
      summary: `LLM review failed (${lastErr && lastErr.message}); deterministic gates passed. ${floor.summary}`,
      reasons: [...(floor.reasons || []), 'llm_fallback'],
      mode: 'rules_fallback',
    };
  }
  return rulesReview(input);
}

module.exports = {
  reviewAgentOutput,
  rulesReview,
  scrapeFailureFromArtifact,
  harvestQualityReview,
  buildRevisedHarvestBrief,
  extractQuality,
  briefArtifactOverlap,
};
