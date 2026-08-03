/**
 * Lightweight per-session execution state (front-desk state machine).
 * Tracks phase for compound / multi-step work without a full LangGraph runtime.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

function statePath(dataDir) {
  return path.join(dataDir || DEFAULT_DATA_DIR, 'session-state.json');
}

function loadAll(dataDir) {
  const file = statePath(dataDir);
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function saveAll(dataDir, all) {
  const file = statePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8');
}

function getSessionState(sessionId, dataDir) {
  const all = loadAll(dataDir);
  const base = { phase: 'idle', plan: [], currentStep: 0, updatedAt: null, lastDiscussed: null };
  return { ...base, ...(all[sessionId] || {}) };
}

function setSessionState(sessionId, patch, dataDir) {
  const all = loadAll(dataDir);
  const prev = all[sessionId] || { phase: 'idle', plan: [], currentStep: 0 };
  all[sessionId] = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveAll(dataDir, all);
  return all[sessionId];
}

function clearSessionState(sessionId, dataDir) {
  const all = loadAll(dataDir);
  delete all[sessionId];
  saveAll(dataDir, all);
}

function beginPlan(sessionId, steps, dataDir) {
  return setSessionState(sessionId, {
    phase: 'executing',
    plan: (steps || []).map((s, i) => ({ id: i + 1, text: String(s), status: 'pending' })),
    currentStep: 1,
  }, dataDir);
}

function markStep(sessionId, stepId, status, dataDir) {
  const st = getSessionState(sessionId, dataDir);
  const plan = (st.plan || []).map((s) => (s.id === stepId ? { ...s, status } : s));
  const next = plan.find((s) => s.status === 'pending');
  return setSessionState(sessionId, {
    phase: next ? 'executing' : 'done',
    plan,
    currentStep: next ? next.id : (plan.length || 0),
  }, dataDir);
}

module.exports = {
  getSessionState,
  setSessionState,
  clearSessionState,
  beginPlan,
  markStep,
};
