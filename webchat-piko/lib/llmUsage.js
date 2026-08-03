/**
 * LLM token usage ledger — append-only jsonl + aggregation for /api/llm-usage.
 */
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function usagePath(rootDir) {
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim()
    || path.join(rootDir || path.join(__dirname, '..'), 'data');
  return path.join(dataDir, 'llm-usage.jsonl');
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultOn;
}

function rotateIfNeeded(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size <= MAX_FILE_BYTES) return;
    const rotated = filePath.endsWith('.jsonl')
      ? filePath.slice(0, -'.jsonl'.length) + '.1.jsonl'
      : filePath + '.1.jsonl';
    try { fs.unlinkSync(rotated); } catch (_) { /* ok */ }
    fs.renameSync(filePath, rotated);
  } catch (_) { /* no file yet */ }
}

/**
 * Fire-and-forget append. Never throws to callers.
 */
function recordLlmUsage(entry, opts = {}) {
  if (!envFlagOn('PIKO_LLM_USAGE_LOG', true)) return false;
  try {
    const filePath = usagePath(opts.rootDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath);
    const line = JSON.stringify({
      ts: entry.ts || new Date().toISOString(),
      model: String(entry.model || '').slice(0, 80),
      prompt_tokens: Number(entry.prompt_tokens) || 0,
      completion_tokens: Number(entry.completion_tokens) || 0,
      lane: String(entry.lane || '').slice(0, 40),
      tag: String(entry.tag || '').slice(0, 60),
      duration_ms: Number(entry.duration_ms) || 0,
    }) + '\n';
    fs.appendFile(filePath, line, () => {});
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Aggregate usage from jsonl for the last `hours` hours.
 * @param {{ hours?: number, rootDir?: string, filePath?: string, maxLines?: number }} opts
 */
function aggregateLlmUsage(opts = {}) {
  const hours = Math.max(1, Math.min(24 * 30, Number(opts.hours) || 24));
  const cutoff = Date.now() - hours * 3600 * 1000;
  const filePath = opts.filePath || usagePath(opts.rootDir);
  const maxLines = Math.max(100, Math.min(20000, Number(opts.maxLines) || 5000));

  const out = {
    ok: true,
    hours,
    total_prompt: 0,
    total_completion: 0,
    calls: 0,
    by_model: {},
    by_tag: {},
  };

  if (!fs.existsSync(filePath)) return out;

  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return out;
  }
  const lines = text.split('\n').filter(Boolean).slice(-maxLines);
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    const ts = Date.parse(row.ts || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const pt = Number(row.prompt_tokens) || 0;
    const ct = Number(row.completion_tokens) || 0;
    out.total_prompt += pt;
    out.total_completion += ct;
    out.calls += 1;
    const model = String(row.model || 'unknown');
    const tag = String(row.tag || 'untagged');
    if (!out.by_model[model]) out.by_model[model] = { prompt: 0, completion: 0, calls: 0 };
    out.by_model[model].prompt += pt;
    out.by_model[model].completion += ct;
    out.by_model[model].calls += 1;
    if (!out.by_tag[tag]) out.by_tag[tag] = { prompt: 0, completion: 0, calls: 0 };
    out.by_tag[tag].prompt += pt;
    out.by_tag[tag].completion += ct;
    out.by_tag[tag].calls += 1;
  }
  return out;
}

module.exports = {
  recordLlmUsage,
  aggregateLlmUsage,
  usagePath,
  rotateIfNeeded,
  MAX_FILE_BYTES,
};
