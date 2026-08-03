const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  detectForecastScheduleAmbiguity,
  shouldOfferClarify,
  buildClarifyBundle,
  parseClarifySelection,
  formatBundleTemplate,
  executeClarifyOption,
} = require('../lib/clarifyHandler');
const { setPending, clearPending } = require('../lib/clarifyPending');

test('detects forecast + nightly ambiguity', () => {
  const msg =
    'Piko, can you please reforecast each item nightly and place it in the AI forecast bucket for AusMaker.';
  assert.equal(detectForecastScheduleAmbiguity(msg), true);
});

test('bundle has three forecast options', () => {
  const msg =
    'reforecast each item nightly and place it in the AI forecast bucket';
  const bundle = buildClarifyBundle(msg, {});
  assert.equal(bundle.reason, 'forecast_schedule');
  assert.equal(bundle.options.length, 3);
  assert.equal(bundle.options[1].id, 'enable_nightly_quant');
});

test('parseClarifySelection accepts number and natural phrase', () => {
  const bundle = buildClarifyBundle('reforecast nightly', {});
  assert.equal(parseClarifySelection('2', bundle).id, 'enable_nightly_quant');
  assert.equal(parseClarifySelection('the nightly one', bundle).id, 'enable_nightly_quant');
  assert.equal(parseClarifySelection('run it now', bundle).id, 'quant_run_now');
});

test('template fallback reads conversational not brochure-only', () => {
  const bundle = buildClarifyBundle('reforecast nightly', {});
  const text = formatBundleTemplate(bundle);
  assert.match(text, /get this right/i);
  assert.match(text, /1\./);
  assert.match(text, /own words/i);
});

test('enable nightly delegates to config mutate', async () => {
  const bundle = buildClarifyBundle('reforecast nightly', {});
  const opt = bundle.options[1];
  const out = await executeClarifyOption(opt, { originalMessage: 'reforecast nightly' });
  assert.equal(out.route, 'clarify_delegate');
  assert.equal(out.delegate.type, 'config_mutate');
  assert.equal(out.delegate.intent.key, 'nightlyQuantEnabled');
});

test('shouldOfferClarify false when pending exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-clarify-pend-'));
  const prev = process.env.PIKO_DATA_DIR;
  process.env.PIKO_DATA_DIR = tmp;
  try {
    const msg = 'reforecast nightly';
    const bundle = buildClarifyBundle(msg, {});
    setPending('sess-1', { bundle, originalMessage: msg });
    assert.equal(shouldOfferClarify(msg, { sessionKey: 'sess-1' }), false);
    clearPending('sess-1');
  } finally {
    if (prev === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('explicit move task does not clarify', () => {
  assert.equal(shouldOfferClarify('Move Task #6 to 10am', { sessionKey: 'x' }), false);
});
