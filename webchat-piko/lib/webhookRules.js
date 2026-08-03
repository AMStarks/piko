/**
 * Webhook rules — load/save event-type → actions mapping.
 * Rules are persisted in data/webhook-rules.json.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'webhook-rules.json');

function loadRules() {
  try {
    if (!fs.existsSync(RULES_FILE)) return [];
    const raw = fs.readFileSync(RULES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveRules(rules) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf8');
  return rules;
}

function generateRuleId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function createRule(rule) {
  const rules = loadRules();
  const id = rule.id || generateRuleId();
  const now = new Date().toISOString();
  const entry = {
    id,
    eventType: String(rule.eventType || '').trim() || 'unknown',
    sourceFilter: Array.isArray(rule.sourceFilter) ? rule.sourceFilter : [],
    actions: Array.isArray(rule.actions) ? rule.actions : [],
    enabled: rule.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  rules.push(entry);
  saveRules(rules);
  return entry;
}

function updateRule(id, updates) {
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const current = rules[idx];
  const next = {
    ...current,
    ...updates,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };
  if (updates.eventType !== undefined) next.eventType = String(updates.eventType).trim() || current.eventType;
  if (updates.sourceFilter !== undefined) next.sourceFilter = Array.isArray(updates.sourceFilter) ? updates.sourceFilter : current.sourceFilter;
  if (updates.actions !== undefined) next.actions = Array.isArray(updates.actions) ? updates.actions : current.actions;
  if (updates.enabled !== undefined) next.enabled = !!updates.enabled;
  rules[idx] = next;
  saveRules(rules);
  return next;
}

function deleteRule(id) {
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  rules.splice(idx, 1);
  saveRules(rules);
  return true;
}

function toggleRule(id) {
  const rules = loadRules();
  const r = rules.find((x) => x.id === id);
  if (!r) return null;
  r.enabled = !r.enabled;
  r.updatedAt = new Date().toISOString();
  saveRules(rules);
  return r;
}

function findRulesForEvent(eventType, source) {
  const rules = loadRules();
  return rules.filter((r) => {
    if (!r.enabled) return false;
    if (r.eventType !== eventType) return false;
    if (r.sourceFilter && r.sourceFilter.length > 0 && !r.sourceFilter.includes(source)) return false;
    return true;
  });
}

module.exports = {
  loadRules,
  saveRules,
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  findRulesForEvent,
  RULES_FILE,
};
