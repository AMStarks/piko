const {
  replaceAllLiteral,
} = require('./text');

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeHm(value) {
  if (value === null || value === '') return null;
  const s = String(value || '').trim();
  // Lenient HH:MM — match digits then clamp (legacy: 25:99 → 23:59).
  const parts = s.split(':');
  if (parts.length !== 2 || parts[0].length < 1 || parts[0].length > 2 || parts[1].length !== 2) return null;
  for (const ch of parts[0] + parts[1]) {
    if (ch < '0' || ch > '9') return null;
  }
  const hh = clampInt(parts[0], 0, 23, 0);
  const mm = clampInt(parts[1], 0, 59, 0);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function makeWeakEtag(version) {
  const v = String(version || '').trim();
  if (!v) return '';
  return `W/"${replaceAllLiteral(v, '"', '')}"`;
}

function parseIfMatchVersion(headerValue) {
  const raw = String(headerValue || '').trim();
  if (!raw) return '';
  let cleaned = raw;
  if (cleaned.startsWith('W/"')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('"')) cleaned = cleaned.slice(1);
  if (cleaned.endsWith('"')) cleaned = cleaned.slice(0, -1);
  return cleaned.trim();
}

function buildMobilePolicyPatch(currentPolicy, patch) {
  const current = currentPolicy && typeof currentPolicy === 'object' ? currentPolicy : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = JSON.parse(JSON.stringify(current));

  if (p.mode != null) {
    const mode = String(p.mode).trim();
    if (['off', 'draft_only', 'hybrid'].includes(mode)) next.mode = mode;
  }

  const q = p.quietHours && typeof p.quietHours === 'object' ? p.quietHours : {};
  if (!next.quietHours || typeof next.quietHours !== 'object') next.quietHours = {};
  if (q.start !== undefined) next.quietHours.start = normalizeHm(q.start) || next.quietHours.start || '23:00';
  if (q.end !== undefined) next.quietHours.end = normalizeHm(q.end) || next.quietHours.end || '06:00';
  if (q.onlyHighUrgency !== undefined) next.quietHours.onlyHighUrgency = !!q.onlyHighUrgency;
  if (q.draftOnly !== undefined) next.quietHours.draftOnly = !!q.draftOnly;
  if (q.maxUrgentPerNight !== undefined) {
    next.quietHours.maxUrgentPerNight = clampInt(q.maxUrgentPerNight, 0, 10, next.quietHours.maxUrgentPerNight || 2);
  }

  if (p.categories && typeof p.categories === 'object') {
    if (!next.categories || typeof next.categories !== 'object') next.categories = {};
    Object.keys(next.categories).forEach((key) => {
      if (p.categories[key] !== undefined) next.categories[key] = !!p.categories[key];
    });
  }

  return next;
}

function mergeMobilePreferences(currentPrefs, patch) {
  const current = currentPrefs && typeof currentPrefs === 'object' ? currentPrefs : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const nowIso = new Date().toISOString();
  const out = {
    quietStart: current.quietStart || null,
    quietEnd: current.quietEnd || null,
    mobilePushEnabled: current.mobilePushEnabled !== false,
    backgroundSyncEnabled: current.backgroundSyncEnabled !== false,
    updatedAt: current.updatedAt || null,
  };
  if (p.quietStart !== undefined) out.quietStart = normalizeHm(p.quietStart);
  if (p.quietEnd !== undefined) out.quietEnd = normalizeHm(p.quietEnd);
  if (p.mobilePushEnabled !== undefined) out.mobilePushEnabled = !!p.mobilePushEnabled;
  if (p.backgroundSyncEnabled !== undefined) out.backgroundSyncEnabled = !!p.backgroundSyncEnabled;
  out.updatedAt = nowIso;
  return out;
}

module.exports = {
  normalizeHm,
  makeWeakEtag,
  parseIfMatchVersion,
  buildMobilePolicyPatch,
  mergeMobilePreferences,
};
