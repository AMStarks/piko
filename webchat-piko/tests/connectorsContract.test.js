const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { connectors, listConnectors, invokeConnector, getConnectorHealth } = require('../lib/connectors');

function makeCtx() {
  return {
    env: {},
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'piko-connectors-')),
    linkedAccounts: {},
  };
}

test('connector registry includes priority phase3 connectors', () => {
  const ids = listConnectors();
  ['gmail', 'calendar', 'notion', 'slack', 'discord', 'imessage', 'whatsapp'].forEach((id) => {
    assert.equal(ids.includes(id), true, `${id} connector missing`);
    assert.equal(typeof connectors[id].status, 'function');
    assert.equal(typeof connectors[id].list, 'function');
    assert.equal(typeof connectors[id].pull, 'function');
    assert.equal(typeof connectors[id].act, 'function');
    assert.equal(typeof connectors[id].disconnect, 'function');
  });
});

test('connector status/list/pull minimum contract is callable', async () => {
  const ctx = makeCtx();
  for (const id of ['gmail', 'calendar', 'notion', 'slack']) {
    const status = await invokeConnector(id, 'status', ctx, {});
    assert.equal(status.ok, true);
    assert.equal(typeof status.result, 'object');

    const list = await invokeConnector(id, 'list', ctx, { limit: 3 });
    assert.equal(list.ok, true);
    assert.equal(Array.isArray(list.result.items), true);

    const pull = await invokeConnector(id, 'pull', ctx, {});
    assert.equal(pull.ok, true);
    assert.equal(typeof pull.result, 'object');
  }
});

test('connector health endpoint payload is generated for all connectors', async () => {
  const ctx = makeCtx();
  const health = await getConnectorHealth(ctx);
  const ids = listConnectors();
  ids.forEach((id) => {
    assert.equal(typeof health[id], 'object');
    assert.equal(health[id].id, id);
    assert.equal(typeof health[id].connected, 'boolean');
  });
});

test('invokeConnector returns deterministic error for unknown connector', async () => {
  const out = await invokeConnector('unknown_connector', 'status', makeCtx(), {});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNKNOWN_CONNECTOR');
});
