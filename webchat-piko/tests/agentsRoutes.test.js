/**
 * P3.1b — agents route extraction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tryHandleAgents, registerAgentRoutes, isAgentsPath } = require('../routes/agents');
const { createRouteRegistry } = require('../lib/routeRegistry');

describe('routes/agents', () => {
  it('isAgentsPath recognises agent prefixes', () => {
    assert.equal(isAgentsPath('/api/agents'), true);
    assert.equal(isAgentsPath('/api/agents/jobs'), true);
    assert.equal(isAgentsPath('/api/cultures/items'), false);
  });

  it('non-agent path returns false', async () => {
    const handled = await tryHandleAgents(
      { method: 'GET', url: '/api/health' },
      {},
      { pathname: '/api/health', send: () => {}, readBody: async () => '', rootDir: __dirname },
    );
    assert.equal(handled, false);
  });

  it('registerAgentRoutes mounts catalog agent paths', () => {
    const reg = createRouteRegistry();
    registerAgentRoutes(reg, {});
    const keys = reg.list().map((r) => `${r.method}|${r.match}|${r.path}`).sort();
    assert.ok(keys.includes('GET|exact|/api/agents'));
    assert.ok(keys.includes('GET|exact|/api/agents/jobs'));
    assert.ok(keys.includes('GET|prefix|/api/agents/jobs/'));
    assert.ok(keys.includes('POST|exact|/api/agents/jobs'));
  });
});
