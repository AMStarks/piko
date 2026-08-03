const fs = require('fs');
const path = require('path');

const {
  parseHhMm,
} = require('./text');

function getDataDir() {
  return process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function getPolicyFile() {
  return path.join(getDataDir(), 'proactive-policy.json');
}

const DEFAULT_POLICY = {
  mode: 'draft_only',
  thresholds: {
    draft: 0.65,
    auto: 0.85,
  },
  quietHours: {
    start: '23:00',
    end: '06:00',
    onlyHighUrgency: true,
    draftOnly: true,
    maxUrgentPerNight: 2,
  },
  limits: {
    perDay: 4,
    perHour: 1,
    perCategoryCooldownHours: 6,
    perThreadCooldownHours: 12,
    duplicateSuppressionHours: 24,
    ackCategorySuppressionHours: 2,
    backoffRule: '1h->6h->24h',
  },
  categoryModes: {},
  categories: {
    deadlineRisk: true,
    calendarConflicts: true,
    importantComms: true,
    healthNudges: false,
    projectGap: true,
    securityAlerts: true,
    businessHealth: true,
  },
  controls: {
    allowGlobalDisable: true,
    allowCategoryDisable: true,
    stopCommand: 'Discontinue',
    explainWhyTriggered: true,
  },
  dispatch: {
    defaultChannels: ['telegram', 'pending_file'],
    channelPriority: ['telegram', 'webhook', 'whatsapp_bridge', 'imessage_bridge', 'pending_file'],
    replayCooldownSec: 15,
    channelConfig: {
      telegram: { enabled: true, retryMax: 2, timeoutMs: 8000 },
      pending_file: { enabled: true, retryMax: 0, timeoutMs: 1000 },
      webhook: { enabled: true, retryMax: 1, timeoutMs: 8000 },
      whatsapp_bridge: { enabled: false, retryMax: 1, timeoutMs: 8000 },
      imessage_bridge: { enabled: false, retryMax: 1, timeoutMs: 8000 },
    },
  },
  escalation: {
    repeatThreshold: 3,
    criticalThreshold: 6,
    ladder: {
      low: ['pending_file'],
      normal: ['telegram', 'pending_file'],
      high: ['telegram', 'webhook', 'pending_file'],
    },
  },
  retention: {
    triggerDays: 180,
    outcomeDays: 180,
    storeConfidenceTrace: true,
  },
  updatedAt: null,
};

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function normalizeTime(v, fallback) {
  const s = String(v || fallback || '').trim();
  const __hh = parseHhMm(s);
  const m = __hh ? [null, String(__hh.h), String(__hh.m).padStart(2, '0')] : null;
  if (!m) return fallback;
  const hh = clamp(parseInt(m[1], 10), 0, 23);
  const mm = clamp(parseInt(m[2], 10), 0, 59);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizePolicy(input, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const src = input && typeof input === 'object' ? input : {};
  const out = JSON.parse(JSON.stringify(DEFAULT_POLICY));

  const mode = String(src.mode || out.mode);
  out.mode = ['off', 'draft_only', 'hybrid', 'full_auto'].includes(mode) ? mode : out.mode;

  const t = src.thresholds || {};
  out.thresholds.draft = clamp(Number(t.draft != null ? t.draft : out.thresholds.draft), 0, 1);
  out.thresholds.auto = clamp(Number(t.auto != null ? t.auto : out.thresholds.auto), 0, 1);
  if (out.thresholds.auto < out.thresholds.draft) out.thresholds.auto = out.thresholds.draft;

  const q = src.quietHours || {};
  out.quietHours.start = normalizeTime(q.start, out.quietHours.start);
  out.quietHours.end = normalizeTime(q.end, out.quietHours.end);
  out.quietHours.onlyHighUrgency = q.onlyHighUrgency != null ? !!q.onlyHighUrgency : out.quietHours.onlyHighUrgency;
  out.quietHours.draftOnly = q.draftOnly != null ? !!q.draftOnly : out.quietHours.draftOnly;
  out.quietHours.maxUrgentPerNight = clamp(parseInt(q.maxUrgentPerNight != null ? q.maxUrgentPerNight : out.quietHours.maxUrgentPerNight, 10) || 0, 0, 10);

  const l = src.limits || {};
  out.limits.perDay = clamp(parseInt(l.perDay != null ? l.perDay : out.limits.perDay, 10) || 0, 0, 100);
  out.limits.perHour = clamp(parseInt(l.perHour != null ? l.perHour : out.limits.perHour, 10) || 0, 0, 20);
  out.limits.perCategoryCooldownHours = clamp(parseInt(l.perCategoryCooldownHours != null ? l.perCategoryCooldownHours : out.limits.perCategoryCooldownHours, 10) || 0, 0, 720);
  out.limits.perThreadCooldownHours = clamp(parseInt(l.perThreadCooldownHours != null ? l.perThreadCooldownHours : out.limits.perThreadCooldownHours, 10) || 0, 0, 720);
  out.limits.duplicateSuppressionHours = clamp(parseInt(l.duplicateSuppressionHours != null ? l.duplicateSuppressionHours : out.limits.duplicateSuppressionHours, 10) || 0, 0, 720);
  out.limits.ackCategorySuppressionHours = clamp(parseInt(l.ackCategorySuppressionHours != null ? l.ackCategorySuppressionHours : out.limits.ackCategorySuppressionHours, 10) || 0, 0, 720);
  out.limits.backoffRule = String(l.backoffRule != null ? l.backoffRule : out.limits.backoffRule).slice(0, 80);

  const cm = src.categoryModes && typeof src.categoryModes === 'object' ? src.categoryModes : {};
  const allowedModes = ['off', 'draft_only', 'hybrid', 'full_auto'];
  out.categoryModes = {};
  Object.keys(cm).forEach((k) => {
    const m = String(cm[k] || '').trim();
    if (allowedModes.includes(m)) out.categoryModes[k] = m;
  });

  const c = src.categories || {};
  Object.keys(out.categories).forEach((k) => {
    if (c[k] != null) out.categories[k] = !!c[k];
  });
  if (c.businessHealth != null) out.categories.businessHealth = !!c.businessHealth;
  else if (out.categories.businessHealth == null) out.categories.businessHealth = true;

  const controls = src.controls || {};
  out.controls.allowGlobalDisable = controls.allowGlobalDisable != null ? !!controls.allowGlobalDisable : out.controls.allowGlobalDisable;
  out.controls.allowCategoryDisable = controls.allowCategoryDisable != null ? !!controls.allowCategoryDisable : out.controls.allowCategoryDisable;
  out.controls.stopCommand = String(controls.stopCommand != null ? controls.stopCommand : out.controls.stopCommand).trim().slice(0, 80);
  out.controls.explainWhyTriggered = controls.explainWhyTriggered != null ? !!controls.explainWhyTriggered : out.controls.explainWhyTriggered;

  const dispatch = src.dispatch || {};
  const defaultChannels = Array.isArray(dispatch.defaultChannels) ? dispatch.defaultChannels : out.dispatch.defaultChannels;
  out.dispatch.defaultChannels = defaultChannels
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .slice(0, 10);
  if (out.dispatch.defaultChannels.length === 0) out.dispatch.defaultChannels = ['pending_file'];
  const channelPriority = Array.isArray(dispatch.channelPriority) ? dispatch.channelPriority : out.dispatch.channelPriority;
  out.dispatch.channelPriority = channelPriority
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (out.dispatch.channelPriority.length === 0) out.dispatch.channelPriority = [...out.dispatch.defaultChannels];
  out.dispatch.replayCooldownSec = clamp(parseInt(dispatch.replayCooldownSec != null ? dispatch.replayCooldownSec : out.dispatch.replayCooldownSec, 10) || 0, 0, 3600);
  const srcCfg = dispatch.channelConfig && typeof dispatch.channelConfig === 'object' ? dispatch.channelConfig : {};
  Object.keys(out.dispatch.channelConfig).forEach((channel) => {
    const base = out.dispatch.channelConfig[channel];
    const cfg = srcCfg[channel] && typeof srcCfg[channel] === 'object' ? srcCfg[channel] : {};
    out.dispatch.channelConfig[channel] = {
      enabled: cfg.enabled != null ? !!cfg.enabled : base.enabled,
      retryMax: clamp(parseInt(cfg.retryMax != null ? cfg.retryMax : base.retryMax, 10) || 0, 0, 10),
      timeoutMs: clamp(parseInt(cfg.timeoutMs != null ? cfg.timeoutMs : base.timeoutMs, 10) || 1000, 500, 120000),
    };
  });

  const escalation = src.escalation || {};
  out.escalation.repeatThreshold = clamp(parseInt(escalation.repeatThreshold != null ? escalation.repeatThreshold : out.escalation.repeatThreshold, 10) || 1, 1, 100);
  out.escalation.criticalThreshold = clamp(parseInt(escalation.criticalThreshold != null ? escalation.criticalThreshold : out.escalation.criticalThreshold, 10) || 1, 1, 200);
  if (out.escalation.criticalThreshold < out.escalation.repeatThreshold) {
    out.escalation.criticalThreshold = out.escalation.repeatThreshold;
  }
  const srcLadder = escalation.ladder && typeof escalation.ladder === 'object' ? escalation.ladder : {};
  Object.keys(out.escalation.ladder).forEach((urgency) => {
    const srcChannels = Array.isArray(srcLadder[urgency]) ? srcLadder[urgency] : out.escalation.ladder[urgency];
    const normalized = srcChannels.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 10);
    out.escalation.ladder[urgency] = normalized.length ? normalized : out.escalation.ladder[urgency];
  });

  const retention = src.retention || {};
  out.retention.triggerDays = clamp(parseInt(retention.triggerDays != null ? retention.triggerDays : out.retention.triggerDays, 10) || 1, 1, 3650);
  out.retention.outcomeDays = clamp(parseInt(retention.outcomeDays != null ? retention.outcomeDays : out.retention.outcomeDays, 10) || 1, 1, 3650);
  out.retention.storeConfidenceTrace = retention.storeConfidenceTrace != null ? !!retention.storeConfidenceTrace : out.retention.storeConfidenceTrace;

  if (opts.stampNow === false) {
    out.updatedAt = src.updatedAt ? String(src.updatedAt) : null;
  } else {
    out.updatedAt = new Date().toISOString();
  }
  return out;
}

function loadPolicy() {
  try {
    const policyFile = getPolicyFile();
    if (!fs.existsSync(policyFile)) return JSON.parse(JSON.stringify(DEFAULT_POLICY));
    const raw = fs.readFileSync(policyFile, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizePolicy(parsed, { stampNow: false });
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_POLICY));
  }
}

function savePolicy(next, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const expectedUpdatedAt = opts.expectedUpdatedAt ? String(opts.expectedUpdatedAt) : '';
  const current = loadPolicy();
  if (expectedUpdatedAt && current.updatedAt && expectedUpdatedAt !== current.updatedAt) {
    const err = new Error('Policy version conflict');
    err.code = 'POLICY_CONFLICT';
    err.current = current;
    throw err;
  }
  const normalized = normalizePolicy(next, { stampNow: true });
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getPolicyFile(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

module.exports = {
  DEFAULT_POLICY,
  getPolicyFile,
  POLICY_FILE: getPolicyFile(),
  loadPolicy,
  savePolicy,
  normalizePolicy,
};
