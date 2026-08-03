const fs = require('fs');
const path = require('path');

const MAX_EVENTS = 5000;

function resolveDataDir(explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const envDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(__dirname, '..', '..', 'data');
}

function filePath(dataDir) {
  return path.join(resolveDataDir(dataDir), 'phase0-observability-events.json');
}

function readEvents(dataDir) {
  const p = filePath(dataDir);
  try {
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeEvents(dataDir, rows) {
  const p = filePath(dataDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
  } catch (_) {}
}

function recordEvent(dataDir, event) {
  const rows = readEvents(dataDir);
  rows.push({
    at: new Date().toISOString(),
    route: String(event && event.route || 'unknown'),
    status: Number(event && event.status || 0),
    latencyMs: Number(event && event.latencyMs || 0),
    outcome: String(event && event.outcome || ''),
    trace_id: String(event && event.trace_id || ''),
    source: String(event && event.source || ''),
    errorCode: String(event && event.errorCode || ''),
  });
  if (rows.length > MAX_EVENTS) rows.splice(0, rows.length - MAX_EVENTS);
  writeEvents(dataDir, rows);
}

function summarize(events) {
  const byRoute = {};
  for (const ev of events) {
    const route = String(ev.route || 'unknown');
    if (!byRoute[route]) {
      byRoute[route] = {
        route,
        total: 0,
        success: 0,
        failure: 0,
        replay: 0,
        circuitOpen: 0,
        avgLatencyMs: 0,
      };
    }
    const item = byRoute[route];
    item.total += 1;
    if (ev.status >= 200 && ev.status < 300) item.success += 1;
    else item.failure += 1;
    if (String(ev.outcome || '').includes('replay')) item.replay += 1;
    if (String(ev.errorCode || '') === 'CIRCUIT_OPEN') item.circuitOpen += 1;
    item.avgLatencyMs += Number(ev.latencyMs || 0);
  }
  Object.values(byRoute).forEach((item) => {
    item.avgLatencyMs = item.total > 0 ? Number((item.avgLatencyMs / item.total).toFixed(1)) : 0;
    item.successRate = item.total > 0 ? Number((item.success / item.total).toFixed(4)) : 0;
  });
  return Object.values(byRoute).sort((a, b) => b.total - a.total);
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function getObservability(dataDir, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const sinceHours = Math.max(1, Math.min(24 * 30, Number(opts.sinceHours || 24)));
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  const all = readEvents(dataDir);
  const recent = all.filter((e) => {
    const t = Date.parse(e.at || '');
    return Number.isFinite(t) && t >= cutoff;
  });
  return {
    ok: true,
    sinceHours,
    totals: {
      events: recent.length,
      success: recent.filter((e) => e.status >= 200 && e.status < 300).length,
      failure: recent.filter((e) => !(e.status >= 200 && e.status < 300)).length,
      replay: recent.filter((e) => String(e.outcome || '').includes('replay')).length,
      circuitOpen: recent.filter((e) => String(e.errorCode || '') === 'CIRCUIT_OPEN').length,
    },
    byRoute: summarize(recent),
    thresholds: {
      warnFailureRate: Number(process.env.LEGATE_OBS_WARN_FAILURE_RATE || 0.05),
      warnCircuitOpenCount: Number(process.env.LEGATE_OBS_WARN_CIRCUIT_OPEN_COUNT || 1),
    },
  };
}

function getSloSnapshot(dataDir, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const sinceHours = Math.max(1, Math.min(24 * 30, Number(opts.sinceHours || 24)));
  const targetAvailability = Math.max(0.9, Math.min(0.9999, Number(opts.targetAvailability || process.env.LEGATE_SLO_TARGET_AVAILABILITY || 0.99)));
  const targetP95Ms = Math.max(50, Math.min(60000, Number(opts.targetP95Ms || process.env.LEGATE_SLO_TARGET_P95_MS || 1500)));
  const alertBurnRate = Math.max(0.5, Math.min(20, Number(opts.alertBurnRate || process.env.LEGATE_SLO_ALERT_BURN_RATE || 2.0)));
  const alertMinSamples = Math.max(1, Math.min(1000, Number(opts.alertMinSamples || process.env.LEGATE_SLO_ALERT_MIN_SAMPLES || 5)));
  const defaultCriticalRoutes = ['/api/legate/events', '/api/legate/decision-request', '/api/piko/commands'];
  const criticalRoutesRaw = opts.criticalRoutes || process.env.LEGATE_SLO_CRITICAL_ROUTES || defaultCriticalRoutes.join(',');
  const criticalRoutes = Array.isArray(criticalRoutesRaw)
    ? criticalRoutesRaw.map((x) => String(x || '').trim()).filter(Boolean)
    : String(criticalRoutesRaw).split(',').map((x) => x.trim()).filter(Boolean);
  const criticalSet = new Set(criticalRoutes);
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  const recent = readEvents(dataDir).filter((e) => {
    const t = Date.parse(e.at || '');
    return Number.isFinite(t) && t >= cutoff;
  });
  const grouped = {};
  for (const e of recent) {
    const route = String(e.route || 'unknown');
    if (!grouped[route]) grouped[route] = [];
    grouped[route].push(e);
  }
  const routes = Object.keys(grouped).map((route) => {
    const arr = grouped[route];
    const total = arr.length;
    const success = arr.filter((x) => x.status >= 200 && x.status < 300).length;
    const availability = total > 0 ? success / total : 1;
    const p95LatencyMs = percentile(arr.map((x) => Number(x.latencyMs || 0)), 95);
    const availabilityErrorBudget = Math.max(0, 1 - targetAvailability);
    const availabilityBurn = availabilityErrorBudget > 0 ? Math.max(0, (1 - availability) / availabilityErrorBudget) : 0;
    const sampled = total >= alertMinSamples;
    const isCritical = criticalSet.has(route);
    const sustainedBurnBreach = isCritical && sampled && availabilityBurn > alertBurnRate;
    const sustainedLatencyBreach = isCritical && sampled && p95LatencyMs > targetP95Ms;
    return {
      route,
      isCritical,
      sampled,
      total,
      success,
      failure: total - success,
      availability: Number(availability.toFixed(4)),
      p95LatencyMs: Number(p95LatencyMs.toFixed(1)),
      targetAvailability,
      targetP95Ms,
      availabilityBreached: availability < targetAvailability,
      latencyBreached: p95LatencyMs > targetP95Ms,
      availabilityBreachedSampled: isCritical && sampled && availability < targetAvailability,
      latencyBreachedSampled: isCritical && sampled && p95LatencyMs > targetP95Ms,
      errorBudgetBurnRate: Number(availabilityBurn.toFixed(2)),
      sustainedBurnBreach,
      sustainedLatencyBreach,
    };
  }).sort((a, b) => b.total - a.total);

  const overallTotal = routes.reduce((s, r) => s + r.total, 0);
  const overallSuccess = routes.reduce((s, r) => s + r.success, 0);
  const overallAvailability = overallTotal > 0 ? overallSuccess / overallTotal : 1;
  const alertHooks = routes
    .filter((r) => r.sustainedBurnBreach || r.sustainedLatencyBreach)
    .map((r) => ({
      code: r.sustainedBurnBreach && r.sustainedLatencyBreach
        ? 'LEGATE_SLO_BURN_AND_LATENCY_BREACH'
        : (r.sustainedBurnBreach ? 'LEGATE_SLO_BURN_BREACH' : 'LEGATE_SLO_LATENCY_BREACH'),
      severity: 'warning',
      route: r.route,
      total: r.total,
      errorBudgetBurnRate: r.errorBudgetBurnRate,
      p95LatencyMs: r.p95LatencyMs,
      targetP95Ms,
      targetAvailability,
      recommendation: 'Consider rollback to shadow/canary and investigate dependency failures.',
    }));

  return {
    ok: true,
    sinceHours,
    targetAvailability,
    targetP95Ms,
    alertConfig: {
      burnRateThreshold: alertBurnRate,
      minSamples: alertMinSamples,
      criticalRoutes,
    },
    overall: {
      total: overallTotal,
      success: overallSuccess,
      failure: overallTotal - overallSuccess,
      availability: Number(overallAvailability.toFixed(4)),
      breachedRoutes: routes.filter((r) => r.availabilityBreachedSampled || r.latencyBreachedSampled).length,
    },
    routes,
    alertHooks: {
      count: alertHooks.length,
      active: alertHooks.length > 0,
      alerts: alertHooks,
    },
  };
}

function getTraceCorrelation(dataDir, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const traceId = String(opts.traceId || '').trim();
  if (!traceId) return { ok: false, error: 'Missing traceId' };
  const sinceHours = Math.max(1, Math.min(24 * 30, Number(opts.sinceHours || 24)));
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  const all = readEvents(dataDir);
  const matches = all
    .filter((e) => {
      const t = Date.parse(e.at || '');
      if (!Number.isFinite(t) || t < cutoff) return false;
      return String(e.trace_id || '') === traceId;
    })
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  const routes = Array.from(new Set(matches.map((e) => String(e.route || 'unknown'))));
  return {
    ok: true,
    traceId,
    sinceHours,
    found: matches.length > 0,
    routes,
    events: matches.slice(-50),
  };
}

module.exports = {
  recordEvent,
  getObservability,
  getTraceCorrelation,
  getSloSnapshot,
};
