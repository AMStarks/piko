/**
 * Declarative config schema + boot validation (P2.2).
 * Fail closed on invalid values; strict mode also warns on unknown PIKO_* keys.
 */
const path = require('path');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');

/** @typedef {'string'|'bool'|'int'|'url'|'enum'} SchemaType */

/**
 * Production-critical env keys. Undeclared PIKO_* keys still work in non-strict mode.
 * `requiredWhenStrict` — must be set when PIKO_ENV_STRICT=1.
 */
const SCHEMA = [
  { key: 'PORT', type: 'int', default: '3000', description: 'HTTP listen port' },
  { key: 'PIKO_DATA_DIR', type: 'string', default: '', description: 'Tenant data root' },
  { key: 'PIKO_TENANT_ID', type: 'string', default: '', description: 'Tenant identifier' },
  { key: 'PIKO_BACKGROUND_JOBS_PROFILE', type: 'enum', values: ['culture', 'ausmaker', 'shared', ''], default: '', description: 'Background job profile' },
  { key: 'PIKO_ENV_STRICT', type: 'bool', default: '0', description: 'Fail/warn on missing/unknown env' },

  { key: 'PIKO_OLLAMA_ONLY', type: 'bool', default: '0', description: 'Disable cloud LLM fallbacks', requiredWhenStrict: true },
  { key: 'PIKO_OLLAMA_QUEUE', type: 'bool', default: '0', description: 'Serialize Ollama calls' },
  { key: 'OLLAMA_URL', type: 'url', default: '', description: 'Chat-lane Ollama base URL' },
  { key: 'PIKO_WORKER_OLLAMA_URL', type: 'url', default: '', description: 'Worker-lane Ollama base URL' },
  { key: 'PIKO_LEGATE_OLLAMA_URL', type: 'url', default: '', description: 'Legate decide Ollama URL' },
  { key: 'PIKO_UNDERSTAND_OLLAMA_URL', type: 'url', default: '', description: 'Understand Ollama URL' },
  { key: 'OLLAMA_MODEL', type: 'string', default: 'llama3.1:8b', description: 'Default/persona model' },
  { key: 'PIKO_LEGATE_MODEL', type: 'string', default: '', description: 'Decide/opinion model (27B)', requiredWhenStrict: true },
  { key: 'PIKO_UNDERSTAND_MODEL', type: 'string', default: '', description: 'Understand model (27B)', requiredWhenStrict: true },
  { key: 'PIKO_UNDERSTAND_AUTHORITATIVE', type: 'bool', default: '0', description: 'Authoritative understand gateway' },
  { key: 'PIKO_EXPERT_OPINION', type: 'bool', default: '', description: 'Expert-opinion lane (default on for culture)' },
  { key: 'MODEL_PRIMARY', type: 'string', default: '', description: 'Legacy primary model tag' },

  { key: 'PIKO_WEBHOOK_SECRET', type: 'string', default: '', description: 'Shared webhook bearer/key (fallback; prefer PIKO_DATA_DIR/secrets/webhook.json)', requiredWhenStrict: true },
  { key: 'PIKO_ADMIN_PASSWORD', type: 'string', default: '', description: 'Admin gate password' },
  { key: 'PIKO_API_KEY', type: 'string', default: '', description: 'API key for adapters/monitors (fallback; prefer PIKO_DATA_DIR/secrets/api-key.json)' },
  { key: 'PIKO_API_AUTH', type: 'enum', values: ['lan', 'strict', 'off', ''], default: 'strict', description: 'API auth mode (strict default; set lan explicitly for private-IP trust)' },
  { key: 'PIKO_CHANNEL_ALLOWLIST_OPEN', type: 'bool', default: '0', description: 'Opt into open non-webchat channels' },
  { key: 'PIKO_TASK_ENDPOINT', type: 'bool', default: '0', description: 'Enable /task shell surface' },

  { key: 'PIKO_LEGATE_CHAT', type: 'bool', default: '1', description: 'Enable Legate chat path' },
  { key: 'PIKO_AGENT_ORCH', type: 'bool', default: '1', description: 'Enable agent orchestration' },
  { key: 'PIKO_AGENT_WORKER', type: 'bool', default: '1', description: 'Enable in-process agent worker' },
  { key: 'PIKO_WORKER_STANDALONE', type: 'bool', default: '0', description: 'Chat process: reaper only; claim loop in standalone worker' },
  { key: 'PIKO_WORKER_CLEAR_DRAIN_ON_BOOT', type: 'bool', default: '1', description: 'Standalone worker clears drain file at boot' },
  { key: 'PIKO_AGENT_JOB_TIMEOUT_MS', type: 'int', default: String(20 * 60 * 1000), description: 'Job wall-clock timeout ms' },
  { key: 'PIKO_AGENT_PENDING_CAP', type: 'int', default: '25', description: 'Pending jobs cap per type' },
  { key: 'PIKO_JSONL_MAX_LINES', type: 'int', default: '2000', description: 'Default max lines for bounded JSONL logs' },
  { key: 'PIKO_ACTIVITY_JSONL_MAX', type: 'int', default: '2000', description: 'Max lines for piko-activity.jsonl' },
  { key: 'PIKO_CAMPAIGN_CYCLES_JSONL_MAX', type: 'int', default: '2000', description: 'Max lines for campaign_cycles.jsonl' },
  { key: 'PIKO_SCORECARD_JSONL_MAX', type: 'int', default: '500', description: 'Max lines for learning_scorecard.jsonl' },
  { key: 'PIKO_HQ_AUDIT_JSONL_MAX', type: 'int', default: '2000', description: 'Max lines for hq-audit.jsonl' },
  { key: 'PIKO_SESSION_OWNER_OVERRIDE', type: 'bool', default: '0', description: 'Allow operators to access any sessionId (logged)' },
  { key: 'PIKO_ALARM_QUEUE_STUCK_SEC', type: 'int', default: String(30 * 60), description: 'P4.6 alarm: pending job age seconds' },
  { key: 'PIKO_ALARM_JOB_FAIL_STREAK', type: 'int', default: '5', description: 'P4.6 alarm: job failures in last hour' },
  { key: 'PIKO_ALARM_CHAT_P95_MS', type: 'int', default: '120000', description: 'P4.6 alarm: chat p95 threshold ms' },
  { key: 'PIKO_ALARM_COOLDOWN_MS', type: 'int', default: String(30 * 60 * 1000), description: 'P4.6 alarm cooldown between identical fires' },

  { key: 'EGYPTIAN_INSIGHTS_DATA_DIR', type: 'string', default: '', description: 'EI corpus data root' },
  { key: 'PIKO_EGYPTIAN_DATA_DIR', type: 'string', default: '', description: 'Alias for EI data root' },
  { key: 'PIKO_EI_MISSION_FIT', type: 'bool', default: '1', description: 'Mission-fit review enabled' },
  { key: 'PIKO_EI_MISSION_FIT_PURGE', type: 'bool', default: '1', description: 'Quarantine drops after mission-fit' },
  { key: 'PIKO_QUARANTINE_DAYS', type: 'int', default: '14', description: 'Quarantine retention days' },
  { key: 'PIKO_EI_CORPUS_RAG', type: 'string', default: '', description: 'Set off to disable corpus RAG' },
  { key: 'PIKO_EI_REPLAN', type: 'bool', default: '1', description: 'Allow one bounded replan' },

  { key: 'PIKO_LOG_LEVEL', type: 'enum', values: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent', ''], default: 'info', description: 'Pino log level' },
  { key: 'PIKO_LOG_PATH', type: 'string', default: '', description: 'Optional pino destination file' },
  { key: 'PIKO_PROACTIVE_WEBHOOK_URL', type: 'url', default: '', description: 'Proactive webhook URL' },
  { key: 'PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL', type: 'url', default: '', description: 'WhatsApp proactive webhook' },
  { key: 'PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL', type: 'url', default: '', description: 'iMessage proactive webhook' },

  // Common production keys (declared so strict typo-WARN stays useful, not noisy).
  { key: 'PIKO_ADMIN_USER', type: 'string', default: 'admin', description: 'Admin login username' },
  { key: 'PIKO_HEALTH_API_KEY', type: 'string', default: '', description: 'Health/monitor API key' },
  { key: 'PIKO_YOLO_API_KEY', type: 'string', default: '', description: 'YOLO/HITL API key' },
  { key: 'PIKO_WEBCHAT_URL', type: 'url', default: '', description: 'Public webchat URL' },
  { key: 'PIKO_PUBLIC_BASE_URL', type: 'url', default: '', description: 'Public base URL' },
  { key: 'PIKO_IOS_PUBLIC_URL', type: 'url', default: '', description: 'iOS client public URL' },
  { key: 'PIKO_REPO_ROOT', type: 'string', default: '', description: 'Repo root for tools' },
  { key: 'PIKO_KNOWLEDGE_PATH', type: 'string', default: '', description: 'Knowledge base path' },
  { key: 'PIKO_SITE_MANIFEST', type: 'string', default: '', description: 'Site manifest path' },
  { key: 'PIKO_TENANT_REGISTRY', type: 'string', default: '', description: 'Tenant registry path' },
  { key: 'PIKO_LEGION_ADAPTER_API_BASE', type: 'url', default: '', description: 'Legion adapter API base' },
  { key: 'PIKO_LEGION_BRIEF_DEFAULT_ADAPTER', type: 'string', default: '', description: 'Default Legion adapter' },
  { key: 'PIKO_LEGION_POLL_TIMEOUT_MS', type: 'int', default: '', description: 'Legion poll timeout ms' },
  { key: 'PIKO_OLLAMA_NUM_CTX', type: 'int', default: '', description: 'Default Ollama num_ctx' },
  { key: 'PIKO_OLLAMA_TIMEOUT_MS', type: 'int', default: '', description: 'Ollama request timeout ms' },
  { key: 'PIKO_OLLAMA_ROUTER_TIMEOUT_MS', type: 'int', default: '', description: 'Router Ollama timeout ms' },
  { key: 'PIKO_LEGATE_NUM_CTX', type: 'int', default: '', description: 'Legate num_ctx' },
  { key: 'PIKO_UNDERSTAND_NUM_CTX', type: 'int', default: '', description: 'Understand num_ctx' },
  { key: 'PIKO_HEAVY_MODEL', type: 'string', default: '', description: 'Heavy/worker model tag' },
  { key: 'PIKO_AGENT_REVIEW', type: 'bool', default: '', description: 'Enable agent review' },
  { key: 'PIKO_AGENT_REVIEW_MODE', type: 'string', default: '', description: 'Agent review mode' },
  { key: 'PIKO_AGENT_REVIEW_MODEL', type: 'string', default: '', description: 'Agent review model' },
  { key: 'PIKO_AGENT_REVIEW_OLLAMA_URL', type: 'url', default: '', description: 'Agent review Ollama URL' },
  { key: 'PIKO_AGENT_PLAN_MODE', type: 'string', default: '', description: 'Agent plan mode' },
  { key: 'PIKO_EI_WORK_PLANNER_MODEL', type: 'string', default: '', description: 'Work planner model' },
  { key: 'PIKO_EI_WORK_PLANNER_NUM_CTX', type: 'int', default: '', description: 'Work planner num_ctx' },
  { key: 'PIKO_EI_MISSION_FIT_MODEL', type: 'string', default: '', description: 'Mission-fit model' },
  { key: 'PIKO_EI_MISSION_FIT_NUM_CTX', type: 'int', default: '', description: 'Mission-fit num_ctx' },
  { key: 'PIKO_EI_CONTENT_REVIEW', type: 'bool', default: '', description: 'Content review enabled' },
  { key: 'PIKO_EI_CONTENT_REVIEW_MODEL', type: 'string', default: '', description: 'Content review model' },
  { key: 'PIKO_EI_SEEK_FILES_TIMEOUT_MS', type: 'int', default: '', description: 'seek_files timeout ms' },
  { key: 'PIKO_EI_SEEK_FILES_LIMIT', type: 'int', default: '', description: 'seek_files result limit' },
  { key: 'PIKO_EI_ARTICLE_AUTO', type: 'bool', default: '', description: 'Auto article writer' },
  { key: 'PIKO_EI_ENG_QUEUE_DIR', type: 'string', default: '', description: 'EI engineering queue dir' },
  { key: 'PIKO_EI_EVAL_SKIP_TELEGRAM', type: 'bool', default: '', description: 'Skip telegram on EI eval' },
  { key: 'PIKO_DISABLE_AUSMAKER_WATCHMAN', type: 'bool', default: '', description: 'Disable AusMaker watchman' },
];

const SCHEMA_BY_KEY = Object.fromEntries(SCHEMA.map((s) => [s.key, s]));

function envTruthy(name) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function isStrict() {
  return envTruthy('PIKO_ENV_STRICT');
}

function parseBool(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return null;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return undefined;
}

function validateValue(def, raw) {
  const present = raw != null && String(raw).trim() !== '';
  if (!present) return null;
  const s = String(raw).trim();
  if (def.type === 'bool') {
    const b = parseBool(s);
    if (b === undefined) return `${def.key} must be a boolean (1/0/true/false)`;
    return null;
  }
  if (def.type === 'int') {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return `${def.key} must be an integer`;
    if (def.key === 'PORT' && (n < 1 || n > 65535)) return 'PORT must be a number 1–65535';
    return null;
  }
  if (def.type === 'url') {
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return `${def.key} must use http or https`;
      }
    } catch (_) {
      return `${def.key} must be a valid URL`;
    }
    return null;
  }
  if (def.type === 'enum') {
    const allowed = def.values || [];
    if (!allowed.includes(s)) {
      return `${def.key} must be one of: ${allowed.filter(Boolean).join(', ') || '(empty)'}`;
    }
    return null;
  }
  return null;
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateDetailed() {
  const errors = [];
  const warnings = [];
  const strict = isStrict();

  for (const def of SCHEMA) {
    const raw = process.env[def.key];
    const err = validateValue(def, raw);
    if (err) errors.push(err);
    if (strict && def.requiredWhenStrict && (raw == null || String(raw).trim() === '')) {
      // Authoritative-understand already requires models; keep that too.
      if (def.key === 'PIKO_LEGATE_MODEL' || def.key === 'PIKO_UNDERSTAND_MODEL') {
        if (!envTruthy('PIKO_UNDERSTAND_AUTHORITATIVE') && !strict) continue;
      }
      errors.push(`${def.key} is required when PIKO_ENV_STRICT=1`);
    }
  }

  // P0.6 retained: authoritative understand pins models even without strict.
  if (envTruthy('PIKO_UNDERSTAND_AUTHORITATIVE')) {
    if (!String(process.env.PIKO_UNDERSTAND_MODEL || '').trim()) {
      errors.push('PIKO_UNDERSTAND_MODEL must be set when PIKO_UNDERSTAND_AUTHORITATIVE=1');
    }
    if (!String(process.env.PIKO_LEGATE_MODEL || '').trim()) {
      errors.push('PIKO_LEGATE_MODEL must be set when PIKO_UNDERSTAND_AUTHORITATIVE=1');
    }
  }

  if (strict) {
    for (const key of Object.keys(process.env)) {
      if (!key.startsWith('PIKO_')) continue;
      if (!SCHEMA_BY_KEY[key]) {
        warnings.push(`unknown PIKO_* env (possible typo): ${key}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validate() {
  const { ok, errors, warnings } = validateDetailed();
  for (const w of warnings) {
    console.warn(`[config] ${w}`);
  }
  if (!ok) {
    throw new Error('Config validation failed:\n' + errors.join('\n'));
  }
  return true;
}

function getConfig() {
  validate();
  return {
    port: Number(process.env.PORT) || 3000,
    dataDir: DATA_DIR,
    modelPrimary: process.env.MODEL_PRIMARY || process.env.OLLAMA_MODEL || 'ollama/llama3.1:latest',
    strict: isStrict(),
  };
}

function schemaForExample() {
  return SCHEMA.map((s) => ({
    key: s.key,
    type: s.type,
    default: s.default,
    description: s.description,
    values: s.values || null,
    requiredWhenStrict: !!s.requiredWhenStrict,
  }));
}

module.exports = {
  SCHEMA,
  SCHEMA_BY_KEY,
  validate,
  validateDetailed,
  getConfig,
  schemaForExample,
  envTruthy,
  isStrict,
};
