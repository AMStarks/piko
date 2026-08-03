const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseConfigMutateIntent,
  isConfigMutateIntent,
  executeConfigMutation,
  formatConfigMutateConfirm,
} = require('../lib/configMutate');
const { tryConfirm, setPending, clearPending } = require('../lib/configMutatePending');

test('permission questions are not config mutate intents', () => {
  assert.equal(isConfigMutateIntent('Am I able to adjust the background tasks?'), false);
  assert.equal(isConfigMutateIntent('How do I change the proactive update time?'), false);
});

test('explicit proactive update mutations parse', () => {
  const off = parseConfigMutateIntent('Turn off proactive updates');
  assert.ok(off);
  assert.equal(off.type, 'piko_config');
  assert.equal(off.key, 'proactiveUpdatesEnabled');
  assert.equal(off.value, false);

  const interval = parseConfigMutateIntent('Set proactive interval to 8 hours');
  assert.equal(interval.key, 'proactiveIntervalHours');
  assert.equal(interval.value, 8);
});

test('policy mutations parse', () => {
  const bh = parseConfigMutateIntent('Disable business health alerts');
  assert.equal(bh.type, 'proactive_policy');
  assert.equal(bh.patch.categories.businessHealth, false);

  const mode = parseConfigMutateIntent('Set proactive mode to draft only');
  assert.equal(mode.patch.mode, 'draft_only');
});

test('confirm prompt is explicit', () => {
  const intent = parseConfigMutateIntent('Enable proactive updates');
  assert.match(formatConfigMutateConfirm(intent), /Reply YES to confirm/i);
});

test('executeConfigMutation updates piko_config in temp dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-config-mutate-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  try {
    const intent = { type: 'piko_config', key: 'proactiveIntervalHours', value: 12, summary: 'test' };
    const result = executeConfigMutation(intent);
    assert.equal(result.ok, true);
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'piko_config.json'), 'utf8'));
    assert.equal(raw.proactiveIntervalHours, 12);
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('tryConfirm applies pending mutation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-pending-mutate-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  const sessionKey = 'test-session-config-mutate';
  try {
    const intent = parseConfigMutateIntent('Turn off proactive updates');
    setPending(sessionKey, intent);
    const applied = tryConfirm(sessionKey, 'yes');
    assert.ok(applied);
    assert.equal(applied.route, 'config_mutate_applied');
    assert.match(applied.reply, /Done/i);
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'piko_config.json'), 'utf8'));
    assert.equal(raw.proactiveUpdatesEnabled, false);
    clearPending(sessionKey);
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAnswerLocal returns null for mutate (server handles)', () => {
  const { resolveAnswerLocal } = require('../lib/answerLocal');
  const out = resolveAnswerLocal('Turn off proactive updates', {
    rootDir: path.join(__dirname, '..'),
    intents: [],
  });
  assert.equal(out, null);
});
