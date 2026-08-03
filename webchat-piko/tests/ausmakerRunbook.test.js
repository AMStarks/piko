const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRunbookFromMessage,
  buildRunbookCapabilityRoute,
  buildCapabilityInput,
  formatRunbookReply,
} = require('../lib/ausmakerRunbook');

test('parseRunbookFromMessage maps load recent data', () => {
  const parsed = parseRunbookFromMessage('Please load recent data');
  assert.equal(parsed.runbook_id, 'load_recent_data');
});

test('parseRunbookFromMessage maps sync status', () => {
  const parsed = parseRunbookFromMessage('What is the sales sync status?');
  assert.equal(parsed.runbook_id, 'monitor_sync_progress');
});

test('parseRunbookFromMessage maps reforecast SKU', () => {
  const parsed = parseRunbookFromMessage('Reforecast G10B1 please');
  assert.equal(parsed.runbook_id, 'reforecast_sku');
  assert.equal(parsed.sku, 'G10B1');
});

test('buildRunbookCapabilityRoute includes opts', () => {
  const route = buildRunbookCapabilityRoute({ runbook_id: 'list_runbooks', label: 'List runbooks' });
  assert.equal(route.capability, 'ausmaker.runbook.execute');
  assert.equal(route.opts.runbook_id, 'list_runbooks');
});

test('buildCapabilityInput passes runbook_id to adapter', () => {
  const input = buildCapabilityInput({
    capability: 'ausmaker.runbook.execute',
    opts: { runbook_id: 'refresh_forecast' },
  });
  assert.deepEqual(input, { runbook_id: 'refresh_forecast' });
});

test('formatRunbookReply handles list_runbooks', () => {
  const text = formatRunbookReply(
    { runbooks: [{ id: 'load_recent_data' }, { id: 'refresh_forecast' }] },
    { runbook_id: 'list_runbooks' },
  );
  assert.match(text, /load_recent_data/);
});
