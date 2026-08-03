const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-rules-'));
process.env.EGYPTIAN_INSIGHTS_DATA_DIR = tmp;
process.env.PIKO_DATA_DIR = tmp;

const {
  applyPatch,
  loadRules,
  resetRules,
  formatRulesSummary,
} = require('../lib/corpusReviewRules');
const {
  intentFromLlmJson,
  sanitizePatch,
  patchHasEffect,
  executeCorpusReviewRulesMutation,
} = require('../lib/corpusReviewRulesMutate');
const { assessPrimaryText } = require('../lib/eiTextScout');

test('sanitize rejects meta adjusting-notes', () => {
  const patch = sanitizePatch({
    notes_add: ['Adjusting corpus Flag review rules'],
  });
  assert.equal(patchHasEffect(patch), false);
});

test('LLM JSON mutate with prefer_local + petrie', () => {
  const i = intentFromLlmJson({
    action: 'mutate',
    summary: 'prefer documents/images and keep Petrie',
    rerun: true,
    patch: {
      prefer_local_assets: true,
      force_keep_add: ['petrie'],
      notes_add: ['Prefer real documents and images over thin online stubs'],
    },
  });
  assert.equal(i.kind, 'mutate');
  assert.equal(i.patch.prefer_local_assets, true);
  assert.deepEqual(i.patch.force_keep_add, ['petrie']);
});

test('LLM empty mutate returns null (no fake coach)', () => {
  const i = intentFromLlmJson({
    action: 'mutate',
    summary: 'Adjusting corpus Flag review rules',
    patch: { notes_add: ['Adjusting corpus Flag review rules'] },
  });
  assert.equal(i, null);
});

test('prefer_local_assets drops thin link-only item', () => {
  resetRules({ updated_by: 'test' });
  applyPatch({ prefer_local_assets: true }, { updated_by: 'test' });
  const item = {
    id: 9,
    title: 'Random online catalogue stub Heliopolis',
    source: 'tla',
    kind: 'literature',
    site: 'heliopolis',
    has_document: false,
    has_image: false,
    official_text: 'short note only',
  };
  const heli = { id: 'heliopolis', aliases: ['heliopolis'] };
  const a = assessPrimaryText(item, heli);
  assert.equal(a.verdict, 'reject');
  assert.ok(
    a.reasons.includes('thin_link_only_stub') || a.reasons.includes('no_local_document_or_image'),
  );
});

test('execute mutation persists prefer_local and petrie', () => {
  resetRules({ updated_by: 'test' });
  const intent = intentFromLlmJson({
    action: 'mutate',
    summary: 'prefer local assets and keep Petrie',
    patch: { prefer_local_assets: true, force_keep_add: ['petrie'] },
  });
  const out = executeCorpusReviewRulesMutation(intent);
  assert.equal(out.ok, true);
  const rules = loadRules();
  assert.equal(rules.prefer_local_assets, true);
  assert.ok(rules.force_keep.includes('petrie'));
  assert.ok(formatRulesSummary(rules).includes('prefer local assets'));
});
