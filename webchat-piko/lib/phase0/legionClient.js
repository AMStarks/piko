const http = require('http');
const https = require('https');
const { canSend, recordSuccess, recordFailure } = require('./linkReliability');
const { recordEvent } = require('./observability');
const { PHASE0_CONTRACT_VERSION } = require('./contract');

const {
  stripTrailingSlash,
} = require('../text');

function postJson(urlString, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(e); }
    const body = JSON.stringify(payload || {});
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

async function sendLegionCommand(commandPayload, options = {}) {
  const baseUrl = String(process.env.LEGION_PIKO_URL || '').trim();
  const primaryKey = String(process.env.LEGION_PIKO_API_KEY || '').trim();
  const nextKey = String(process.env.LEGION_PIKO_API_KEY_NEXT || '').trim();
  const activeSelector = String(process.env.LEGION_PIKO_API_KEY_ACTIVE || 'primary').trim().toLowerCase();
  const apiKey = activeSelector === 'next' ? (nextKey || primaryKey) : (primaryKey || nextKey);
  if (!baseUrl || !apiKey) throw new Error('Missing LEGION_PIKO_URL or LEGION_PIKO_API_KEY');
  const dataDir = options && options.dataDir ? options.dataDir : '';
  const gate = canSend(dataDir);
  if (!gate.ok) {
    recordEvent(dataDir, {
      route: '/api/piko/commands',
      status: 503,
      latencyMs: 0,
      outcome: 'circuit_open',
      errorCode: 'CIRCUIT_OPEN',
      trace_id: String(commandPayload && commandPayload.trace_id || ''),
      source: 'legionClient',
    });
    const e = new Error(`CIRCUIT_OPEN: retry in ${Math.ceil(Math.max(0, gate.remainingMs) / 1000)}s`);
    e.code = 'CIRCUIT_OPEN';
    throw e;
  }
  const retries = Math.max(0, Math.min(5, Number(process.env.LEGION_PIKO_RETRY_MAX || 5)));
  const timeoutMs = Math.max(1000, Number(process.env.LEGION_PIKO_TIMEOUT_MS || 5000));
  const endpoint = `${stripTrailingSlash(baseUrl)}/api/piko/commands`;

  const normalizedPayload = {
    contract_version: PHASE0_CONTRACT_VERSION,
    ...(commandPayload || {}),
  };
  const idem = `cmd:${normalizedPayload?.command_id || Date.now()}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'X-Request-Id': `req_${Date.now()}`,
    'Idempotency-Key': idem,
  };
  let lastErr = null;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await postJson(endpoint, headers, normalizedPayload, timeoutMs);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        recordSuccess(dataDir);
        recordEvent(dataDir, {
          route: '/api/piko/commands',
          status: res.statusCode,
          latencyMs: Date.now() - startedAt,
          outcome: 'sent',
          trace_id: String(normalizedPayload && normalizedPayload.trace_id || ''),
          source: 'legionClient',
        });
        return JSON.parse(res.body || '{}');
      }
      lastErr = new Error(`HTTP ${res.statusCode}`);
      lastErr.code = `HTTP_${res.statusCode}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, Math.min(16000, 1000 * (2 ** attempt))));
  }
  recordFailure(dataDir, lastErr && lastErr.message ? lastErr.message : 'Failed to send command');
  recordEvent(dataDir, {
    route: '/api/piko/commands',
    status: 502,
    latencyMs: Date.now() - startedAt,
    outcome: 'failed',
    errorCode: String(lastErr && lastErr.code || ''),
    trace_id: String(normalizedPayload && normalizedPayload.trace_id || ''),
    source: 'legionClient',
  });
  throw lastErr || new Error('Failed to send command');
}

module.exports = {
  sendLegionCommand,
};
