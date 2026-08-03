const fs = require('fs');
const path = require('path');

const BRIEF_FIELDS = [
  { key: 'objective', label: 'Objective', prompt: 'What is the objective?' },
  { key: 'success_criteria', label: 'Success criteria', prompt: 'What are the success criteria?' },
  { key: 'scope', label: 'Scope', prompt: 'What is in scope (and, if useful, out of scope)?' },
  { key: 'constraints', label: 'Constraints', prompt: 'What constraints apply (time, budget, approvals, tools)?' },
  { key: 'risk_level', label: 'Risk level', prompt: 'Risk level? (low|medium|high)' },
  { key: 'priority', label: 'Priority', prompt: 'Priority? (P1|P2|P3)' },
  { key: 'deadline', label: 'Deadline', prompt: 'Deadline? (e.g. YYYY-MM-DD HH:MM TZ)' },
  { key: 'execution_mode', label: 'Execution mode', prompt: 'Execution mode? (auto|needs_approval|advisory)' },
];

const FIELD_ALIASES = {
  objective: 'objective',
  success: 'success_criteria',
  success_criteria: 'success_criteria',
  criteria: 'success_criteria',
  scope: 'scope',
  constraints: 'constraints',
  risk: 'risk_level',
  risk_level: 'risk_level',
  priority: 'priority',
  deadline: 'deadline',
  due: 'deadline',
  execution: 'execution_mode',
  execution_mode: 'execution_mode',
  mode: 'execution_mode',
};

const {
  slugify,
} = require('../text');

function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const envDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(__dirname, '..', '..', 'data');
}

function sessionsFilePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-legion-brief-sessions.json');
}

function logFilePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-legion-brief-log.json');
}

function emptySession(sessionKey) {
  return {
    sessionKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'collecting',
    fields: {},
  };
}

function readJsonArrayOrObject(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function loadSessions(dataDir) {
  return readJsonArrayOrObject(sessionsFilePath(dataDir), {});
}

function saveSessions(dataDir, sessions) {
  writeJson(sessionsFilePath(dataDir), sessions);
}

function startBriefSession(dataDir, sessionKey) {
  const sessions = loadSessions(dataDir);
  const session = emptySession(sessionKey);
  sessions[sessionKey] = session;
  saveSessions(dataDir, sessions);
  return session;
}

function getBriefSession(dataDir, sessionKey) {
  const sessions = loadSessions(dataDir);
  const s = sessions[sessionKey];
  return s && typeof s === 'object' ? s : null;
}

function clearBriefSession(dataDir, sessionKey) {
  const sessions = loadSessions(dataDir);
  if (sessions[sessionKey]) {
    delete sessions[sessionKey];
    saveSessions(dataDir, sessions);
  }
}

function normalizeFieldKey(rawKey) {
  const key = slugify(String(rawKey || '').trim(), { sep: '_' });
  return FIELD_ALIASES[key] || null;
}

function normalizeFieldValue(fieldKey, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { ok: false, error: 'Value cannot be empty.' };
  if (fieldKey === 'risk_level') {
    const v = value.toLowerCase();
    if (!['low', 'medium', 'high'].includes(v)) return { ok: false, error: 'Risk level must be low, medium, or high.' };
    return { ok: true, value: v };
  }
  if (fieldKey === 'priority') {
    const v = value.toUpperCase();
    if (!['P1', 'P2', 'P3'].includes(v)) return { ok: false, error: 'Priority must be P1, P2, or P3.' };
    return { ok: true, value: v };
  }
  if (fieldKey === 'execution_mode') {
    const v = value.toLowerCase();
    if (!['auto', 'needs_approval', 'advisory'].includes(v)) return { ok: false, error: 'Execution mode must be auto, needs_approval, or advisory.' };
    return { ok: true, value: v };
  }
  return { ok: true, value };
}

function nextMissingField(session) {
  const fields = session && session.fields ? session.fields : {};
  return BRIEF_FIELDS.find((f) => !String(fields[f.key] || '').trim()) || null;
}

function isBriefComplete(session) {
  return !nextMissingField(session);
}

function setBriefField(dataDir, sessionKey, fieldKey, rawValue) {
  const key = normalizeFieldKey(fieldKey);
  if (!key) return { ok: false, error: 'Unknown field. Use objective, success_criteria, scope, constraints, risk_level, priority, deadline, execution_mode.' };
  const valid = normalizeFieldValue(key, rawValue);
  if (!valid.ok) return valid;
  const sessions = loadSessions(dataDir);
  const session = sessions[sessionKey] && typeof sessions[sessionKey] === 'object' ? sessions[sessionKey] : emptySession(sessionKey);
  session.fields = session.fields || {};
  session.fields[key] = valid.value;
  session.updatedAt = new Date().toISOString();
  if (isBriefComplete(session)) session.status = 'ready_for_confirmation';
  sessions[sessionKey] = session;
  saveSessions(dataDir, sessions);
  return { ok: true, session };
}

/** Set all brief fields from an object (for legion_scheduled intents). Validates each field. */
function setBriefFromFields(dataDir, sessionKey, fields) {
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'fields must be an object' };
  const sessions = loadSessions(dataDir);
  const session = sessions[sessionKey] && typeof sessions[sessionKey] === 'object' ? sessions[sessionKey] : emptySession(sessionKey);
  session.fields = session.fields || {};
  for (const [key, rawValue] of Object.entries(fields)) {
    const canonKey = normalizeFieldKey(key) || key;
    if (!BRIEF_FIELDS.some((f) => f.key === canonKey)) continue;
    const valid = normalizeFieldValue(canonKey, String(rawValue || ''));
    if (valid.ok) session.fields[canonKey] = valid.value;
  }
  session.updatedAt = new Date().toISOString();
  if (isBriefComplete(session)) session.status = 'ready_for_confirmation';
  sessions[sessionKey] = session;
  saveSessions(dataDir, sessions);
  return { ok: true, session };
}

function parseFieldValueLine(input) {
  const s = String(input || '');
  const colon = s.indexOf(':');
  if (colon < 0) return null;
  const left = s.slice(0, colon);
  const right = s.slice(colon + 1).trim();
  if (!right) return null;
  for (let i = 0; i < left.length; i++) {
    const ch = left[i];
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === ' ')) return null;
  }
  if (!left.trim()) return null;
  return { fieldKey: left.trim(), value: right };
}

function formatRecap(session) {
  const fields = session && session.fields ? session.fields : {};
  const lines = BRIEF_FIELDS.map((f) => `- ${f.label}: ${String(fields[f.key] || '—')}`);
  return ['Legion Brief recap:', ...lines].join('\n');
}

function appendConfirmedBrief(dataDir, session) {
  const filePath = logFilePath(dataDir);
  const rows = readJsonArrayOrObject(filePath, []);
  rows.push({
    id: `lbrief_${Date.now()}`,
    at: new Date().toISOString(),
    sessionKey: String(session && session.sessionKey || ''),
    fields: { ...(session && session.fields ? session.fields : {}) },
  });
  if (rows.length > 200) rows.splice(0, rows.length - 200);
  writeJson(filePath, rows);
}

module.exports = {
  BRIEF_FIELDS,
  startBriefSession,
  getBriefSession,
  clearBriefSession,
  setBriefFromFields,
  nextMissingField,
  isBriefComplete,
  setBriefField,
  parseFieldValueLine,
  formatRecap,
  appendConfirmedBrief,
};
