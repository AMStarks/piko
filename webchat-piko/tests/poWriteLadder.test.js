const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  savePoDraftFromResult,
  loadLastPoDraft,
  buildSubmitPayloadFromDraft,
  formatPoSubmitReply,
} = require('../lib/poWriteLadder');

test('save and build submit payload from draft', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-po-'));
  savePoDraftFromResult(dataDir, {
    summary: { draft_line_count: 2, supplier_count: 1 },
    drafts_by_supplier: {
      'Acme Co': [
        { sku: 'SKU-1', quantity: 5 },
        { sku: 'SKU-2', recommended_quantity: 3 },
      ],
    },
  });
  const draft = loadLastPoDraft(dataDir);
  assert.ok(draft);
  const built = buildSubmitPayloadFromDraft(draft);
  assert.equal(built.ok, true);
  assert.equal(built.payload.supplier, 'Acme Co');
  assert.equal(built.payload.lines.length, 2);
});

test('formatPoSubmitReply surfaces policy violation', () => {
  const msg = formatPoSubmitReply({ ok: false, details: 'POLICY_VIOLATION' });
  assert.match(msg, /policy|allowlist/i);
});

test('formatPoSubmitReply dry-run message', () => {
  const msg = formatPoSubmitReply({
    ok: true,
    result: { dry_run: true, purchase_order_payload: { supplier: 'Acme', lines: [{ sku: 'A', quantity: 1 }] } },
  });
  assert.match(msg, /dry-run/i);
});
