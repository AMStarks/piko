/**
 * WP7.1 — reflection rejection memory + prompt variation + llm seed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function withTempData(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-wp71-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  const campaignPath = require.resolve('../lib/eiResearchCampaign');
  const corpusApiPath = require.resolve('../lib/culturesCorpusApi');
  delete require.cache[campaignPath];
  delete require.cache[corpusApiPath];
  try {
    return fn(dir, require('../lib/eiResearchCampaign'));
  } finally {
    if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
    delete require.cache[campaignPath];
    delete require.cache[corpusApiPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('WP7.1 rejected proposal lands in reflection_rejected_recent and caps at 30', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    for (let i = 0; i < 35; i += 1) {
      campaign.recordReflectionRejection(state, `Title ${i}`, `Author ${i}`, 'cooldown_all_variants');
    }
    assert.equal(state.reflection_rejected_recent.length, 30);
    assert.equal(state.reflection_rejected_recent[0].title, 'Title 5');
    assert.equal(state.reflection_rejected_recent[29].title, 'Title 34');
  });
});

test('WP7.1 repeat_rejected short-circuits before addLead', () => {
  withTempData((_dir, campaign) => {
    const state = campaign.loadState();
    state.idle_streak = 0;
    campaign.recordReflectionRejection(
      state,
      'The Lost Civilization of Atlantis',
      'Ignatius Donnelly',
      'cooldown_all_variants',
    );
    const out = campaign.applyReflectionProposedLeads(state, [{
      title: 'The Lost Civilization of Atlantis',
      author: 'Ignatius Donnelly',
      thread: 'atlantis',
      why: 'repeat',
    }]);
    assert.ok(out.rejected_details.some((d) => d.reason === 'repeat_rejected'));
    // The recycled title itself must not be re-queued (curated gap-fill may add others).
    assert.ok(!(state.leads || []).some((l) => /Atlantis/i.test(String(l.title || ''))));
  });
});

test('WP7.1 reflect prompt contains cooldown + recently rejected blocks', async () => {
  await withTempData(async (_dir, campaign) => {
    const state = campaign.loadState();
    state.idle_streak = 5; // starvation recovery when no eligible pending
    state.cycle_count = 42;
    campaign.stampAttempted(state, '"Some Book" Author PDF', {
      title: 'Some Book',
      author: 'Author',
      days: 7,
    });
    campaign.recordReflectionRejection(state, 'Rejected Title', 'Rejected Author', 'cooldown_all_variants');
    const parts = campaign.buildReflectPromptParts(state, { noteLines: '(none)' });
    assert.match(parts.user, /ON COOLDOWN/);
    assert.match(parts.user, /RECENTLY REJECTED/);
    assert.match(parts.user, /Rejected Title/);
    assert.equal(parts.llmOpts.temperature, 0.8);
    assert.equal(parts.llmOpts.seed, 42);
  });
});

test('WP7.1 llm.js payload includes options.seed when passed', async () => {
  delete require.cache[require.resolve('../lib/llm')];
  const { ollamaNativeChatRaw } = require('../lib/llm');
  let seenBody = null;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      seenBody = JSON.parse(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '{}' }, prompt_eval_count: 1, eval_count: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await ollamaNativeChatRaw('llama3.1:8b', [{ role: 'user', content: 'hi' }], {
      ollamaBaseUrl: `http://127.0.0.1:${port}`,
      temperature: 0.8,
      seed: 99,
      timeoutMs: 5000,
    });
    assert.ok(seenBody);
    assert.equal(seenBody.options.seed, 99);
    assert.equal(seenBody.options.temperature, 0.8);
  } finally {
    server.close();
  }
});
