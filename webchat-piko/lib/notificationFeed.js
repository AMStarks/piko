/**
 * Unified notification feed — append-only JSONL with compaction (P2.1d).
 * Every outbound alert logs here for dashboard parity with Telegram.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicAppendJsonl } = require('./atomicJson');

const MAX_LINES = Number(process.env.PIKO_NOTIFICATION_FEED_MAX || 500);
const DEDUPE_TTL_MS = Math.max(
  60_000,
  Number(process.env.PIKO_NOTIFICATION_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000) || (24 * 60 * 60 * 1000),
);

/** Serialize append/compact so concurrent notify calls don't race. */
let writeChain = Promise.resolve();

const CATEGORIES = {
  proactive_update: { label: 'Proactive Update (Last 30 Days)', icon: '🧠' },
  nightly_quant: { label: 'Nightly Quant Agent', icon: '🌙' },
  tripwire: { label: 'Scheduled check', icon: '🔔' },
  legion: { label: 'Legion', icon: '⚔️' },
  proactive_engine: { label: 'Proactive alert', icon: '📣' },
  reminder: { label: 'Reminder', icon: '⏰' },
  digest: { label: 'Daily digest', icon: '📋' },
  business: { label: 'Business', icon: '📦' },
  system: { label: 'System', icon: 'ℹ️' },
};

function getFeedPath() {
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'notification-feed.jsonl');
}

function getTenantTag() {
  try {
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    const p = getTenantBackgroundProfile(path.join(__dirname, '..'));
    return { tenant_id: p.tenant_id, profile: p.profileId };
  } catch (_) {
    return {
      tenant_id: String(process.env.PIKO_TENANT_ID || '').trim() || null,
      profile: null,
    };
  }
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readAllLines() {
  const logPath = getFeedPath();
  if (!fs.existsSync(logPath)) return [];
  try {
    return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  } catch (_) {
    return [];
  }
}

function notificationDedupeKey(entry) {
  const meta = (entry && entry.meta) || {};
  const subject = meta.task_id || meta.subject || entry.title || '';
  return `${entry.source || ''}::${subject}`;
}

function compactFeedSync() {
  const lines = readAllLines();
  if (lines.length <= MAX_LINES) return lines.length;
  const kept = lines.slice(-MAX_LINES);
  const logPath = getFeedPath();
  // Rewrite via temp+rename of a text blob (not JSON object).
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(logPath)}.tmp.${process.pid}`);
  fs.writeFileSync(tmp, `${kept.join('\n')}\n`, 'utf8');
  fs.renameSync(tmp, logPath);
  return kept.length;
}

/**
 * @param {Object} input
 */
function recordNotification(input = {}) {
  const category = String(input.category || 'system');
  const catMeta = CATEGORIES[category] || CATEGORIES.system;
  const tag = getTenantTag();
  const entry = {
    id: input.id || newId(),
    ts: input.ts || new Date().toISOString(),
    tenant_id: input.tenant_id || tag.tenant_id || null,
    profile: input.profile || tag.profile || null,
    category,
    title: input.title || catMeta.label,
    icon: catMeta.icon,
    text: String(input.text || '').slice(0, 8000),
    severity: input.severity || 'info',
    source: input.source || null,
    channels: {
      telegram: input.channels && input.channels.telegram ? input.channels.telegram : 'pending',
      dashboard: 'logged',
    },
    meta: {
      ...(input.meta && typeof input.meta === 'object' ? input.meta : {}),
      ...(tag.tenant_id ? { tenant_id: tag.tenant_id } : {}),
      ...(tag.profile ? { profile: tag.profile } : {}),
    },
  };

  // Synchronous path for callers that expect an immediate return (legacy).
  // Dedupe scans recent lines; append is single-line (no RMW of whole file).
  try {
    if (input.dedupe !== false) {
      const key = notificationDedupeKey(entry);
      const now = Date.parse(entry.ts) || Date.now();
      if (key && key !== '::') {
        const existing = readAllLines();
        for (let i = existing.length - 1; i >= 0; i -= 1) {
          try {
            const prev = JSON.parse(existing[i]);
            if (notificationDedupeKey(prev) !== key) continue;
            const pts = Date.parse(prev.ts) || 0;
            if (now - pts <= DEDUPE_TTL_MS) {
              return { ...prev, deduped: true };
            }
            break;
          } catch (_) { /* skip */ }
        }
      }
    }
    atomicAppendJsonl(getFeedPath(), entry);
    // Compact asynchronously so hot path stays append-only.
    writeChain = writeChain.then(() => {
      try {
        const n = readAllLines().length;
        if (n > MAX_LINES + 50) compactFeedSync();
      } catch (_) { /* ok */ }
    }).catch(() => {});
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[notificationFeed]', e.message);
  }
  return entry;
}

function readRecentNotifications(limit = 50) {
  try {
    const lines = readAllLines();
    return lines.slice(-Math.max(1, limit)).map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean).reverse();
  } catch (_) {
    return [];
  }
}

/** Map proactive-engine delivery rows into feed shape (for merged API view). */
function mapProactiveDelivery(d) {
  if (!d || typeof d !== 'object') return null;
  const msg = String(d.message || d.text || '').trim();
  if (!msg) return null;
  const status = String(d.status || '');
  return {
    id: d.id ? `proactive_${d.id}` : newId(),
    ts: d.updatedAt || d.createdAt || new Date().toISOString(),
    category: 'proactive_engine',
    title: 'Proactive alert',
    icon: CATEGORIES.proactive_engine.icon,
    text: msg.slice(0, 8000),
    severity: status === 'failed' ? 'error' : status === 'drafted' ? 'info' : 'warn',
    source: 'proactiveEngine',
    channels: {
      telegram: status === 'sent' ? 'sent' : status === 'drafted' ? 'draft' : status === 'failed' ? 'failed' : 'pending',
      dashboard: 'logged',
    },
    meta: { deliveryId: d.id, mode: d.mode, category: d.category },
  };
}

function readMergedNotifications(limit = 50, opts = {}) {
  const feed = readRecentNotifications(limit * 2);
  let profile = opts.profile || null;
  if (!profile) {
    try {
      const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
      profile = getTenantBackgroundProfile(path.join(__dirname, '..'));
    } catch (_) {
      profile = { profileId: 'ausmaker', tenant_id: process.env.PIKO_TENANT_ID || null };
    }
  }
  const { notificationMatchesTenant } = require('./tenantBackgroundJobs');
  const filteredFeed = feed.filter((e) => notificationMatchesTenant(e, profile));
  const seen = new Set(filteredFeed.map((e) => e.id));
  let merged = [...filteredFeed];
  try {
    const dataDir = String(process.env.PIKO_DATA_DIR || '').trim() || path.join(__dirname, '..', 'data');
    const deliveriesPath = path.join(dataDir, 'proactive-deliveries.json');
    if (fs.existsSync(deliveriesPath)) {
      const parsed = JSON.parse(fs.readFileSync(deliveriesPath, 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const d of rows.slice(-limit)) {
        const mapped = mapProactiveDelivery(d);
        if (!mapped || seen.has(mapped.id)) continue;
        if (!notificationMatchesTenant(mapped, profile)) continue;
        merged.push(mapped);
      }
    }
  } catch (_) {}
  merged.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return merged.slice(0, limit);
}

function getCategoryMeta() {
  return CATEGORIES;
}

module.exports = {
  recordNotification,
  readRecentNotifications,
  readMergedNotifications,
  getCategoryMeta,
  getFeedPath,
  mapProactiveDelivery,
  compactFeedSync,
  notificationDedupeKey,
  CATEGORIES,
};
