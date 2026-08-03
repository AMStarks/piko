const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  startBriefSession,
  getBriefSession,
  clearBriefSession,
  setBriefField,
  setBriefFromFields,
  nextMissingField,
  isBriefComplete,
  formatRecap,
  appendConfirmedBrief,
  parseFieldValueLine,
} = require('../lib/phase0/legionBrief');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-lbrief-'));
}

test('legion brief session captures fields and completes', () => {
  const dataDir = mkTmpDataDir();
  const sid = 'session-main';
  startBriefSession(dataDir, sid);
  assert.equal(getBriefSession(dataDir, sid).status, 'collecting');

  setBriefField(dataDir, sid, 'objective', 'Ship integration');
  setBriefField(dataDir, sid, 'success_criteria', 'No critical regressions');
  setBriefField(dataDir, sid, 'scope', 'Piko-Legion path only');
  setBriefField(dataDir, sid, 'constraints', 'No downtime');
  setBriefField(dataDir, sid, 'risk_level', 'low');
  setBriefField(dataDir, sid, 'priority', 'P1');
  setBriefField(dataDir, sid, 'deadline', '2026-03-03 17:00 AEDT');
  const out = setBriefField(dataDir, sid, 'execution_mode', 'needs_approval');
  assert.equal(out.ok, true);
  assert.equal(isBriefComplete(out.session), true);
  assert.equal(nextMissingField(out.session), null);
  assert.match(formatRecap(out.session), /Legion Brief recap:/);
});

test('legion brief enum validation rejects invalid values', () => {
  const dataDir = mkTmpDataDir();
  const sid = 'session-main';
  startBriefSession(dataDir, sid);
  const riskBad = setBriefField(dataDir, sid, 'risk_level', 'urgent');
  assert.equal(riskBad.ok, false);
  const prioBad = setBriefField(dataDir, sid, 'priority', 'P9');
  assert.equal(prioBad.ok, false);
  const modeBad = setBriefField(dataDir, sid, 'execution_mode', 'live');
  assert.equal(modeBad.ok, false);
});

test('legion brief parse field line and clear session', () => {
  const dataDir = mkTmpDataDir();
  const sid = 'session-main';
  startBriefSession(dataDir, sid);
  const parsed = parseFieldValueLine('risk_level: high');
  assert.equal(parsed.fieldKey, 'risk_level');
  assert.equal(parsed.value, 'high');
  clearBriefSession(dataDir, sid);
  assert.equal(getBriefSession(dataDir, sid), null);
});

test('setBriefFromFields sets all fields from object (legion_scheduled)', () => {
  const dataDir = mkTmpDataDir();
  const sid = 'intent-poller';
  const out = setBriefFromFields(dataDir, sid, {
    objective: 'Run low stock scan',
    success_criteria: 'Scan complete',
    scope: 'Inventory',
    constraints: 'None',
    risk_level: 'low',
    priority: 'P2',
    deadline: '2026-03-01',
    execution_mode: 'auto',
  });
  assert.equal(out.ok, true);
  assert.equal(isBriefComplete(out.session), true);
  const s = getBriefSession(dataDir, sid);
  assert.equal(s.fields.objective, 'Run low stock scan');
  assert.equal(s.fields.execution_mode, 'auto');
});

test('append confirmed brief writes log entry', () => {
  const dataDir = mkTmpDataDir();
  const sid = 'session-main';
  const session = startBriefSession(dataDir, sid);
  session.fields = {
    objective: 'x',
    success_criteria: 'y',
    scope: 'z',
    constraints: 'c',
    risk_level: 'low',
    priority: 'P2',
    deadline: 'soon',
    execution_mode: 'advisory',
  };
  appendConfirmedBrief(dataDir, session);
  const p = path.join(dataDir, 'phase0-legion-brief-log.json');
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionKey, sid);
});
