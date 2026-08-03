/**
 * Operations loader — Piko's infrastructure self-awareness.
 * Loads cron jobs and scripts from knowledge/piko-operations.json.
 * Portable: same Docker mount as manifest; edit once, redeploy.
 */
const path = require('path');
const fs = require('fs');
const { getKnowledgePath } = require('./knowledgeManifest');

const OPS_FILENAME = 'piko-operations.json';

/**
 * Load operations from knowledge/piko-operations.json.
 * Falls back to empty when file missing (graceful for platforms without it).
 * @param {string} [rootDir] - Project root (default: webchat-piko dir)
 * @returns {{ cronJobs: Array<{name:string,schedule:string,purpose?:string}>, scripts: Array<{name:string,schedule:string,purpose?:string}> }}
 */
function loadOperations(rootDir) {
  const knowledgePath = getKnowledgePath(rootDir);
  const opsPath = path.join(knowledgePath, OPS_FILENAME);
  if (!fs.existsSync(opsPath)) {
    return { cronJobs: [], scripts: [] };
  }
  try {
    const raw = fs.readFileSync(opsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { cronJobs: [], scripts: [] };
    // Richer format: { cronJobs: [...], scripts: [...] }
    if (Array.isArray(parsed.cronJobs) && Array.isArray(parsed.scripts)) {
      return {
        cronJobs: parsed.cronJobs.filter((j) => j && (j.name || j.schedule)),
        scripts: parsed.scripts.filter((s) => s && (s.name || s.schedule)),
      };
    }
    // Simpler format: { "intent-poller": "Every 5 min", ... }
    const entries = Object.entries(parsed).filter(([k, v]) => typeof v === 'string' && !['cronJobs', 'scripts'].includes(k));
    if (entries.length > 0) {
      return {
        cronJobs: entries.map(([name, schedule]) => ({ name, schedule })),
        scripts: [],
      };
    }
    return { cronJobs: [], scripts: [] };
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[operations] load error:', e.message);
    return { cronJobs: [], scripts: [] };
  }
}

/**
 * Format operations for prompt injection.
 * @param {ReturnType<typeof loadOperations>} ops
 * @returns {string}
 */
function formatOperationsForPrompt(ops) {
  const lines = [];
  for (const j of ops.cronJobs) {
    const purpose = j.purpose ? ` — ${j.purpose}` : '';
    lines.push(`• ${j.name} (${j.schedule})${purpose}`);
  }
  for (const s of ops.scripts) {
    const purpose = s.purpose ? ` — ${s.purpose}` : '';
    lines.push(`• ${s.name} (${s.schedule})${purpose}`);
  }
  return lines.length ? lines.join('\n') : '';
}

module.exports = {
  loadOperations,
  formatOperationsForPrompt,
};
