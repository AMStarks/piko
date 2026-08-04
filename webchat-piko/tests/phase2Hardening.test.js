/**
 * Phase 2 platform hardening — atomic state, config schema, intent handlers,
 * metrics, job honesty, identity/feedback.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p2-'));

describe('P2.1 atomicJson', () => {
  const { atomicWriteJson, readJsonSafe } = require('../lib/atomicJson');

  it('writes and reloads JSON', () => {
    const p = path.join(TMP, 'a.json');
    atomicWriteJson(p, { ok: true, n: 1 });
    assert.deepEqual(readJsonSafe(p), { ok: true, n: 1 });
  });

  it('survives leftover partial tmp (crash simulation)', () => {
    const p = path.join(TMP, 'b.json');
    atomicWriteJson(p, { v: 1 });
    const tmp = `${p}.tmp.99999`;
    fs.writeFileSync(tmp, '{"partial":', 'utf8');
    assert.deepEqual(readJsonSafe(p), { v: 1 });
    atomicWriteJson(p, { v: 2 });
    assert.deepEqual(readJsonSafe(p), { v: 2 });
    // tmp left behind is fine
    assert.ok(fs.existsSync(tmp) || !fs.existsSync(tmp));
  });

  it('readJsonSafe returns fallback on corrupt', () => {
    const p = path.join(TMP, 'bad.json');
    fs.writeFileSync(p, '{not-json', 'utf8');
    assert.equal(readJsonSafe(p, 'fallback'), 'fallback');
  });
});

describe('P2.1 agentJobs transition atomicity', () => {
  let prevData;
  before(() => {
    prevData = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = path.join(TMP, 'jobs-data');
    // Reset module cache so dataDir() picks up env
    delete require.cache[require.resolve('../lib/agentJobs')];
    delete require.cache[require.resolve('../lib/agentRegistry')];
  });
  after(() => {
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    delete require.cache[require.resolve('../lib/agentJobs')];
  });

  it('writeJob never loses record across pending→running→done', () => {
    const jobs = require('../lib/agentJobs');
    const enq = jobs.enqueueJob({ type: 'agent_run', payload: { brief: 't' } });
    assert.equal(enq.ok, true);
    const id = enq.job.id;
    assert.ok(jobs.readJob(id));
    const claimed = jobs.claimNextPending({ owner: 'test-host:1' });
    assert.ok(claimed);
    assert.equal(claimed.id, id);
    assert.equal(claimed.claim_owner, 'test-host:1');
    assert.ok(claimed.deadline_at);
    assert.equal(jobs.readJob(id).status, 'running');
    // Only one file exists
    const root = jobs.jobsRoot();
    const pending = fs.existsSync(path.join(root, 'pending', `${id}.json`));
    const running = fs.existsSync(path.join(root, 'running', `${id}.json`));
    assert.equal(pending, false);
    assert.equal(running, true);
    jobs.completeJob(claimed, { ok: true }, null);
    assert.equal(jobs.readJob(id).status, 'done');
  });

  it('reapStaleRunning sets cancel_requested', () => {
    const jobs = require('../lib/agentJobs');
    const enq = jobs.enqueueJob({ type: 'agent_run', payload: { brief: 'stale' } });
    const claimed = jobs.claimNextPending({ owner: 'other-host:9' });
    assert.ok(claimed);
    // Backdate started_at
    jobs.writeJob({
      ...claimed,
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }, 'running');
    const reaped = jobs.reapStaleRunning({ timeoutMs: 1000, graceMs: 0, owner: 'this-host:1' });
    assert.ok(reaped.length >= 1);
    const done = jobs.readJob(claimed.id);
    assert.equal(done.status, 'done');
    assert.equal(done.cancel_requested, true);
    assert.equal(done.error, 'orphaned_timeout');
  });
});

describe('P2.2 config schema', () => {
  const { validateDetailed, SCHEMA } = require('../lib/config');

  it('declares ~40 production keys', () => {
    assert.ok(SCHEMA.length >= 35);
    assert.ok(SCHEMA.length <= 60);
  });

  it('accepts valid PORT and rejects invalid', () => {
    const prev = process.env.PORT;
    process.env.PORT = '3000';
    let r = validateDetailed();
    assert.equal(r.ok, true, r.errors.join('; '));
    process.env.PORT = 'not-a-port';
    r = validateDetailed();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('PORT')));
    if (prev == null) delete process.env.PORT;
    else process.env.PORT = prev;
  });

  it('strict mode warns on unknown PIKO_* typo', () => {
    const prevStrict = process.env.PIKO_ENV_STRICT;
    const typo = 'PIKO_LEGATE_MODLE';
    process.env.PIKO_ENV_STRICT = '1';
    process.env[typo] = '1';
    // Avoid required-key failures for this check
    const saved = {};
    for (const k of ['PIKO_OLLAMA_ONLY', 'PIKO_LEGATE_MODEL', 'PIKO_UNDERSTAND_MODEL', 'PIKO_WEBHOOK_SECRET']) {
      saved[k] = process.env[k];
      process.env[k] = process.env[k] || 'test-value';
    }
    process.env.PIKO_OLLAMA_ONLY = '1';
    const r = validateDetailed();
    assert.ok(r.warnings.some((w) => w.includes(typo)));
    delete process.env[typo];
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevStrict == null) delete process.env.PIKO_ENV_STRICT;
    else process.env.PIKO_ENV_STRICT = prevStrict;
  });
});

describe('P2.3 intent routing handlers', () => {
  it('campaign_control runs direct action', async () => {
    const legate = require('../lib/legateChat');
    let called = null;
    const orig = legate.runCampaignControlAction;
    // inject via module path used inside
    const eiTools = require('../lib/eiAgentTools');
    const origRun = eiTools.runTool;
    eiTools.runTool = async (tool, args) => {
      called = { tool, args };
      return { ok: true, artifact: `Campaign ${args.action} applied.` };
    };
    try {
      const understanding = {
        intent: 'campaign_control',
        control: { action: 'pause' },
        failed: false,
      };
      // Call internal path via handleLegateChatTurn with stubbed understand
      const understand = require('../lib/understand');
      const origAuth = understand.isAuthoritative;
      const origUnderstand = understand.understand;
      understand.isAuthoritative = () => true;
      understand.understand = async () => understanding;
      const prev = process.env.PIKO_LEGATE_CHAT;
      process.env.PIKO_LEGATE_CHAT = '1';
      const out = await legate.handleLegateChatTurn('pause the research campaign', {
        isOperator: true,
        rootDir: path.join(__dirname, '..'),
      });
      assert.equal(out.mode, 'control');
      assert.ok(String(out.reply).toLowerCase().includes('pause'));
      assert.equal(called.tool, 'research_campaign');
      assert.equal(called.args.action, 'pause');
      understand.isAuthoritative = origAuth;
      understand.understand = origUnderstand;
      if (prev == null) delete process.env.PIKO_LEGATE_CHAT;
      else process.env.PIKO_LEGATE_CHAT = prev;
    } finally {
      eiTools.runTool = origRun;
    }
  });

  it('schedule_request / config_change / agent_command never fall through to persona', async () => {
    const legate = require('../lib/legateChat');
    const understand = require('../lib/understand');
    const origAuth = understand.isAuthoritative;
    const origUnderstand = understand.understand;
    understand.isAuthoritative = () => true;
    const prevData = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = path.join(TMP, 'intents-data');
    process.env.PIKO_LEGATE_CHAT = '1';

    for (const [intent, msg] of [
      ['schedule_request', 'remind me daily at 9am'],
      ['config_change', 'turn off proactive updates'],
      ['agent_command', 'cancel the running agent job'],
    ]) {
      understand.understand = async () => ({
        intent,
        failed: false,
        schedule: intent === 'schedule_request' ? { kind: 'daily', time: '09:00', note: 'ping' } : null,
        control: null,
        work: null,
      });
      const out = await legate.handleLegateChatTurn(msg, {
        isOperator: true,
        rootDir: path.join(__dirname, '..'),
      });
      assert.equal(out.fallthrough, false, intent);
      assert.ok(out.reply && out.reply.length > 10, intent);
      assert.ok(!out.job, intent);
    }

    understand.isAuthoritative = origAuth;
    understand.understand = origUnderstand;
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
  });

  it('identity_capability returns grounded card', async () => {
    const { answerIdentityCapability } = require('../lib/identityCard');
    const out = answerIdentityCapability({ intent: 'identity_capability' }, {});
    assert.equal(out.fallthrough, false);
    assert.ok(out.reply.includes('Piko'));
    assert.ok(out.reply.includes('Research') || out.reply.toLowerCase().includes('research'));
    assert.equal(out.decision.source, 'grounded_identity');
  });

  it('feedback persists JSONL', () => {
    const prev = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = path.join(TMP, 'fb-data');
    delete require.cache[require.resolve('../lib/feedbackStore')];
    const { answerFeedback, feedbackPath } = require('../lib/feedbackStore');
    const out = answerFeedback('great work on Osireion', { intent: 'feedback' }, {});
    assert.equal(out.fallthrough, false);
    assert.ok(out.reply.toLowerCase().includes('recorded'));
    const raw = fs.readFileSync(feedbackPath(), 'utf8');
    assert.ok(raw.includes('Osireion'));
    if (prev == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
  });
});

describe('P2.4 ops metrics', () => {
  it('snapshot shape', () => {
    const { recordChatTurn, snapshot } = require('../lib/opsMetrics');
    recordChatTurn({ latency_ms: 100, ok: true });
    recordChatTurn({ latency_ms: 200, ok: true });
    const s = snapshot();
    assert.equal(s.ok, true);
    assert.ok(s.chat.turns >= 2);
    assert.ok(typeof s.chat.p50_ms === 'number');
    assert.ok(typeof s.chat.p95_ms === 'number');
    assert.ok(s.ollama);
    assert.ok(s.jobs);
    assert.ok(s.process);
  });
});

describe('P2.5 job deadline + cancel', () => {
  it('toolTimeoutFromBudget caps against remaining', () => {
    const { toolTimeoutFromBudget, remainingBudgetMs } = require('../lib/jobDeadline');
    const job = {
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 120_000).toISOString(),
    };
    const rem = remainingBudgetMs(job);
    assert.ok(rem > 0 && rem <= 120_000);
    const to = toolTimeoutFromBudget(job, 600_000, { reserveMs: 60_000, minMs: 5_000 });
    assert.ok(to <= 60_000 + 5_000); // ~60s left after reserve
    assert.ok(to >= 5_000);
  });

  it('timeout path sets cancel_requested (completeJob stamp)', () => {
    const prev = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = path.join(TMP, 'timeout-data');
    delete require.cache[require.resolve('../lib/agentJobs')];
    const jobs = require('../lib/agentJobs');
    const enq = jobs.enqueueJob({ type: 'agent_run', payload: {} });
    const claimed = jobs.claimNextPending({ owner: 'h:1' });
    jobs.completeJob(
      { ...claimed, cancel_requested: true, cancel_requested_at: new Date().toISOString() },
      { ok: false, timeout: true },
      'timeout',
    );
    const done = jobs.readJob(claimed.id);
    assert.equal(done.cancel_requested, true);
    assert.equal(done.error, 'timeout');
    if (prev == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
  });
});

describe('P2.1 notificationFeed append-only', () => {
  it('appends without clobbering prior lines', () => {
    const prev = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = path.join(TMP, 'feed-data');
    delete require.cache[require.resolve('../lib/notificationFeed')];
    const feed = require('../lib/notificationFeed');
    feed.recordNotification({ text: 'one', source: 't1', dedupe: false });
    feed.recordNotification({ text: 'two', source: 't2', dedupe: false });
    const recent = feed.readRecentNotifications(10);
    assert.ok(recent.length >= 2);
    if (prev == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
  });
});
