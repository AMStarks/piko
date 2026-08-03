const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getLegionAdapterBaseUrl,
  formatLegionAdapterUnavailable,
} = require('../lib/legionAdapterHealth');

test('getLegionAdapterBaseUrl defaults to 8000', () => {
  const prev = process.env.LEGION_ADAPTER_API_BASE;
  delete process.env.PIKO_LEGION_ADAPTER_API_BASE;
  delete process.env.LEGION_ADAPTER_API_BASE;
  try {
    assert.equal(getLegionAdapterBaseUrl(), 'http://127.0.0.1:8000');
  } finally {
    if (prev !== undefined) process.env.LEGION_ADAPTER_API_BASE = prev;
  }
});

test('formatLegionAdapterUnavailable includes capability and hint', () => {
  const msg = formatLegionAdapterUnavailable({ error: 'ECONNREFUSED' }, 'inventory.low_stock.scan');
  assert.match(msg, /inventory\.low_stock\.scan/);
  assert.match(msg, /ECONNREFUSED/);
  assert.match(msg, /legion-adapter/);
});
