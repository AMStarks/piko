const test = require('node:test');
const assert = require('node:assert/strict');

function freshActionRouter() {
  delete require.cache[require.resolve('../lib/actionRouter')];
  delete require.cache[require.resolve('../lib/tenantBackgroundJobs')];
  return require('../lib/actionRouter');
}

test('culture capabilities blocked on business profile, allowed on culture', () => {
  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'ausmaker';
  let ar = freshActionRouter();
  assert.equal(ar.capabilityAllowedForProfile('scribe.transcribe.image'), false);
  assert.equal(ar.capabilityAllowedForProfile('translation.critique'), false);
  assert.equal(ar.capabilityAllowedForProfile('culture.pipeline.run'), false);
  assert.equal(ar.capabilityAllowedForProfile('research.scrape.run'), false);
  assert.equal(ar.capabilityAllowedForProfile('inventory.low_stock.scan'), true);
  const prompt = ar.buildRouterSystemPrompt('- inventory.low_stock.scan: scan');
  assert.ok(prompt.includes('OUT-OF-SCOPE RULE'), 'business router gets out-of-scope rule');
  assert.ok(!prompt.includes('scribe.transcribe.image'), 'no culture routing rules on business tenant');

  process.env.PIKO_BACKGROUND_JOBS_PROFILE = 'culture';
  ar = freshActionRouter();
  assert.equal(ar.capabilityAllowedForProfile('scribe.transcribe.image'), true);
  const cprompt = ar.buildRouterSystemPrompt('- culture.corpus.search: search');
  assert.ok(cprompt.includes('CRITICAL ROUTING RULES FOR ANCIENT CULTURES'));

  delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
});
