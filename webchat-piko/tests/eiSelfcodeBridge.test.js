const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const allowlist = require('../../scripts/ei-selfcode-bridge/allowlist');
const bridge = require('../../scripts/ei-selfcode-bridge/bridge');

test('allowlist accepts lib/tests/scripts/egyptian_insights only', () => {
  const ok = allowlist.checkDiffAllowlist([
    'webchat-piko/lib/eiResearchCampaign.js',
    'webchat-piko/tests/eiUrlDedupe.test.js',
    'egyptian_insights/sources/archive_org.py',
  ]);
  assert.equal(ok.ok, true);

  const bad = allowlist.checkDiffAllowlist([
    'webchat-piko/lib/eiResearchCampaign.js',
    'scripts/webchat-deploy/release.sh',
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.denied.some((p) => p.includes('webchat-deploy')));

  const missionFit = allowlist.checkDiffAllowlist(['webchat-piko/lib/eiMissionFitReview.js']);
  assert.equal(missionFit.ok, false);

  const envFile = allowlist.checkDiffAllowlist(['webchat-piko/.env']);
  assert.equal(envFile.ok, false);
});

test('buildAgentPrompt includes brief, evidence, allowlist rules', () => {
  const prompt = allowlist.buildAgentPrompt({
    id: 'eifix_test',
    fix_brief: 'Dedupe keeps by URL',
    evidence: { metric: 'duplicate_groups', value: 3 },
    files_hint: ['webchat-piko/lib/eiResearchCampaign.js'],
  }, { branch: 'piko/eifix-eifix_test' });
  assert.match(prompt, /Dedupe keeps by URL/);
  assert.match(prompt, /duplicate_groups/);
  assert.match(prompt, /ALLOWLIST/);
  assert.match(prompt, /Do NOT deploy/);
  assert.match(prompt, /piko\/eifix-eifix_test/);
});

test('isBridgeableTask recognizes code_fix_brief and eval fixes', () => {
  assert.equal(bridge.isBridgeableTask({
    kind: 'improvement',
    category: 'code_fix_brief',
    fix_brief: 'x',
  }), true);
  assert.equal(bridge.isBridgeableTask({ kind: 'harvest', site_id: 'giza' }), true);
  assert.equal(bridge.isBridgeableTask({
    kind: 'improvement',
    category: 'seed_pack_entry',
  }), false);
});

test('processOne dry-run stamps ready_for_review without git mutations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-bridge-'));
  const approved = path.join(dir, 'approved');
  fs.mkdirSync(approved, { recursive: true });
  const taskPath = path.join(approved, 'eifix_dry.json');
  const task = {
    id: 'eifix_dry',
    kind: 'improvement',
    category: 'code_fix_brief',
    subject: 'url dedupe',
    fix_brief: 'Add alreadyKeptUrl',
    evidence: { metric: 'duplicate_groups', value: 2 },
    files_hint: ['webchat-piko/lib/eiResearchCampaign.js', 'webchat-piko/tests/eiUrlDedupe.test.js'],
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);

  const result = await bridge.processOne({ path: taskPath, task }, {
    dryRun: true,
    once: true,
    push: false,
    baseBranch: 'main',
  });
  assert.equal(result.ok, true);
  assert.equal(result.bridge_status, 'ready_for_review');
  assert.match(result.branch, /piko\/eifix-eifix_dry/);
  // Task moved to done/ under eng root
  assert.ok(fs.existsSync(path.join(dir, 'done', 'eifix_dry.json')));
});

test('allowlist denies adminAuth and path escape', () => {
  const admin = allowlist.checkDiffAllowlist(['webchat-piko/lib/adminAuth.js']);
  assert.equal(admin.ok, false);
  const api = allowlist.checkDiffAllowlist(['webchat-piko/lib/apiAuth.js']);
  assert.equal(api.ok, false);
  const escape = allowlist.checkDiffAllowlist(['webchat-piko/lib/../../.env']);
  assert.equal(escape.ok, false);
  assert.equal(allowlist.normalizeRel('../../etc/passwd'), null);
  assert.equal(allowlist.normalizeRel('webchat-piko/lib/../secrets'), 'webchat-piko/secrets');
});

test('allowlist rejects symlink targets when present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-al-'));
  const lib = path.join(tmp, 'webchat-piko', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const target = path.join(tmp, 'outside.txt');
  fs.writeFileSync(target, 'x');
  const link = path.join(lib, 'eiResearchCampaign.js');
  fs.symlinkSync(target, link);
  const out = allowlist.checkDiffAllowlist(
    ['webchat-piko/lib/eiResearchCampaign.js'],
    { repoRoot: tmp },
  );
  assert.equal(out.ok, false);
  assert.ok(out.denied.includes('webchat-piko/lib/eiResearchCampaign.js'));
});

test('bridge failure stays in approved with attempts; cap skips', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-bridge-fail-'));
  const approved = path.join(dir, 'approved');
  fs.mkdirSync(approved, { recursive: true });
  const taskPath = path.join(approved, 'eifix_fail.json');
  const task = {
    id: 'eifix_fail',
    kind: 'improvement',
    category: 'code_fix_brief',
    subject: 'fail me',
    fix_brief: 'x',
    files_hint: ['webchat-piko/lib/eiResearchCampaign.js'],
    bridge_attempts: 0,
  };
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);

  // Force agent failure via empty cmd that exits non-zero — use dryRun false path with stub.
  // Stamp failure in place directly for unit coverage of disposition.
  const fail = bridge.stampFailureInPlace(taskPath, task, { bridge_error: 'tests_failed' });
  assert.equal(fail.attempts, 1);
  assert.ok(fs.existsSync(taskPath));
  assert.equal(fs.existsSync(path.join(dir, 'done', 'eifix_fail.json')), false);
  const stamped = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  assert.equal(stamped.bridge_status, 'failed');
  assert.equal(stamped.bridge_attempts, 1);

  fs.writeFileSync(taskPath, `${JSON.stringify({ ...stamped, bridge_attempts: 3 }, null, 2)}\n`);
  const listed = bridge.listBridgeableTasks([approved]);
  assert.equal(listed.length, 0);
  assert.ok(listed.skipped.some((s) => s.reason === 'bridge_attempts_cap'));
});

test('syncRemoteOutcome skips non-ready failures', () => {
  const out = bridge.syncRemoteOutcome(
    { host: 'h', approvedRemote: '/a', doneRemote: '/d', engRoot: '/e' },
    '/tmp/x.json',
    { bridge_status: 'failed', id: 'eifix_x' },
    { dryRun: false },
    {},
  );
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'not_ready_for_review');
});

test('assertCleanTree / ensureBranch honour flags', () => {
  // dry-run always skips dirty check
  assert.doesNotThrow(() => bridge.assertCleanTree({ dryRun: true }));
  assert.doesNotThrow(() => bridge.assertCleanTree({ allowDirty: true }));
});

test('WP7.7 remote failure stamp pushes back to approved with attempts', () => {
  const remoteMod = require('../../scripts/ei-selfcode-bridge/remote');
  const remote = remoteMod.parseRemoteSpec('optimus-wan:/home/chief/data');
  assert.equal(remote.ok, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-bridge-remote-'));
  const approved = path.join(dir, 'approved');
  fs.mkdirSync(approved, { recursive: true });
  const taskPath = path.join(approved, 'eifix_remote.json');
  const task = {
    id: 'eifix_remote',
    kind: 'improvement',
    category: 'code_fix_brief',
    subject: 'remote fail',
    fix_brief: 'x',
    files_hint: ['webchat-piko/lib/../../.env'], // will fail allowlist if processed
    bridge_attempts: 0,
  };
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);

  const pushes = [];
  const runner = {
    ssh: (host, cmd) => {
      pushes.push({ host, cmd });
      return { ok: true };
    },
    mkdirSync: () => {},
    rsync: () => ({ ok: true }),
  };

  const fail = bridge.stampFailureInPlace(
    taskPath,
    task,
    { bridge_error: 'allowlist_violation' },
    { remote, runner, dryRun: false },
  );
  assert.equal(fail.attempts, 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].host, 'optimus-wan');
  assert.match(pushes[0].cmd, /approved/);
  assert.doesNotMatch(pushes[0].cmd, /\/done\//);

  const stamped = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  assert.equal(stamped.bridge_attempts, 1);
  assert.ok(Array.isArray(stamped.bridge_history));
  assert.equal(stamped.bridge_history.length, 1);

  // Cap still skips after 3
  fs.writeFileSync(taskPath, `${JSON.stringify({ ...stamped, bridge_attempts: 3 }, null, 2)}\n`);
  const listed = bridge.listBridgeableTasks([approved]);
  assert.equal(listed.length, 0);
});

test('WP7.7 buildPushApprovedStampCommands writes approved only', () => {
  const remoteMod = require('../../scripts/ei-selfcode-bridge/remote');
  const remote = remoteMod.parseRemoteSpec('host:/data');
  const cmd = remoteMod.buildPushApprovedStampCommands(remote, 'task.json', '{"bridge_attempts":2}\n');
  assert.equal(cmd.host, 'host');
  assert.match(cmd.remoteCmd, /approved\/task\.json/);
  assert.doesNotMatch(cmd.remoteCmd, /rm -f/);
});
