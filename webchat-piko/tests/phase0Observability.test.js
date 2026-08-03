const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { recordEvent, getObservability, getTraceCorrelation, getSloSnapshot } = require('../lib/phase0/observability');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piko-phase0-obs-'));
}

test('observability aggregates route stats over time window', () => {
  const dataDir = mkTmpDataDir();
  recordEvent(dataDir, { route: '/api/legate/events', status: 200, latencyMs: 10, outcome: 'accepted' });
  recordEvent(dataDir, { route: '/api/legate/events', status: 200, latencyMs: 30, outcome: 'idempotent_replay' });
  recordEvent(dataDir, { route: '/api/piko/commands', status: 503, latencyMs: 1, outcome: 'circuit_open', errorCode: 'CIRCUIT_OPEN' });

  const out = getObservability(dataDir, { sinceHours: 24 });
  assert.equal(out.ok, true);
  assert.equal(out.totals.events, 3);
  assert.equal(out.totals.success, 2);
  assert.equal(out.totals.failure, 1);
  assert.equal(out.totals.replay, 1);
  assert.equal(out.totals.circuitOpen, 1);
  const eventsRow = out.byRoute.find((r) => r.route === '/api/legate/events');
  assert.ok(eventsRow);
  assert.equal(eventsRow.total, 2);
  assert.equal(eventsRow.successRate, 1);
});

test('trace correlation returns matched route events for trace_id', () => {
  const dataDir = mkTmpDataDir();
  recordEvent(dataDir, { route: '/api/legate/events', status: 200, latencyMs: 10, outcome: 'accepted', trace_id: 'trc_1' });
  recordEvent(dataDir, { route: '/api/legate/decision-request', status: 200, latencyMs: 15, outcome: 'decision_returned', trace_id: 'trc_1' });
  recordEvent(dataDir, { route: '/api/piko/commands', status: 200, latencyMs: 22, outcome: 'sent', trace_id: 'trc_2' });

  const hit = getTraceCorrelation(dataDir, { traceId: 'trc_1', sinceHours: 24 });
  assert.equal(hit.ok, true);
  assert.equal(hit.found, true);
  assert.equal(hit.events.length, 2);
  assert.equal(hit.routes.includes('/api/legate/events'), true);
  assert.equal(hit.routes.includes('/api/legate/decision-request'), true);

  const miss = getTraceCorrelation(dataDir, { traceId: 'trc_none', sinceHours: 24 });
  assert.equal(miss.ok, true);
  assert.equal(miss.found, false);
  assert.equal(miss.events.length, 0);
});

test('slo snapshot computes availability and p95 latency per route', () => {
  const dataDir = mkTmpDataDir();
  recordEvent(dataDir, { route: '/api/legate/events', status: 200, latencyMs: 100, outcome: 'accepted' });
  recordEvent(dataDir, { route: '/api/legate/events', status: 200, latencyMs: 1200, outcome: 'accepted' });
  recordEvent(dataDir, { route: '/api/legate/events', status: 500, latencyMs: 2000, outcome: 'failed' });

  const out = getSloSnapshot(dataDir, { sinceHours: 24, targetAvailability: 0.99, targetP95Ms: 1500 });
  assert.equal(out.ok, true);
  assert.equal(out.overall.total, 3);
  assert.equal(out.overall.availability, 0.6667);
  const row = out.routes.find((r) => r.route === '/api/legate/events');
  assert.ok(row);
  assert.equal(row.failure, 1);
  assert.equal(row.availabilityBreached, true);
  assert.equal(row.latencyBreached, true);
  assert.equal(row.p95LatencyMs, 2000);
  assert.equal(row.sustainedBurnBreach, false);
  assert.equal(row.sustainedLatencyBreach, false);
});

test('slo snapshot emits alert hooks for sustained breaches', () => {
  const dataDir = mkTmpDataDir();
  for (let i = 0; i < 6; i += 1) {
    recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 2200, outcome: 'failed' });
  }
  const out = getSloSnapshot(dataDir, {
    sinceHours: 24,
    targetAvailability: 0.99,
    targetP95Ms: 1500,
    alertBurnRate: 2.0,
    alertMinSamples: 5,
    criticalRoutes: ['/api/control/legate-decisions/execute'],
  });
  assert.equal(out.ok, true);
  assert.equal(out.alertHooks && out.alertHooks.active, true);
  assert.ok(Array.isArray(out.alertHooks.alerts));
  assert.equal(out.alertHooks.alerts.length > 0, true);
  assert.equal(String(out.alertHooks.alerts[0].route || ''), '/api/control/legate-decisions/execute');
});

test('slo snapshot breach rollup uses critical routes + sample threshold', () => {
  const dataDir = mkTmpDataDir();
  recordEvent(dataDir, { route: '/api/piko/commands', status: 500, latencyMs: 2300, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/piko/commands', status: 500, latencyMs: 2400, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/piko/commands', status: 500, latencyMs: 2500, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 50000, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 51000, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 52000, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 53000, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 54000, outcome: 'failed' });
  recordEvent(dataDir, { route: '/api/control/legate-decisions/execute', status: 500, latencyMs: 55000, outcome: 'failed' });

  const out = getSloSnapshot(dataDir, {
    sinceHours: 24,
    targetAvailability: 0.99,
    targetP95Ms: 1500,
    alertMinSamples: 5,
  });
  assert.equal(out.ok, true);
  assert.equal(out.overall.breachedRoutes, 0);
  assert.equal(out.alertHooks.active, false);
});
