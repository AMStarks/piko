/**
 * WP11 — expert-opinion lane, stance files, de-hedge, gate.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetTenantBackgroundProfileCache } = require('../lib/tenantBackgroundJobs');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  resetTenantBackgroundProfileCache();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetTenantBackgroundProfileCache();
    });
}

function opinionUnderstanding() {
  return {
    id: 'test',
    intent: 'opinion_question',
    confidence: 0.95,
    failed: false,
    control: null,
    work: null,
    needs_operator: false,
  };
}

test('W1: opinion_question uses expert lane (no decide, grounded reply)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp11-w1-'));
  const dataRoot = path.join(tmp, 'egyptian-insights');
  fs.mkdirSync(path.join(dataRoot, 'corpus_notes'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'corpus_notes', 'item_101.json'), JSON.stringify({
    harvest_id: 101,
    title: 'Abydos and the Osireion',
    author: 'Petrie',
    summary: 'The Osireion at Abydos shows megalithic construction unlike Seti I temple masonry.',
    claims: ['Osireion predates Seti temple style'],
    people: ['Seti I'],
    sites: ['Abydos', 'Osireion'],
    disagreements: [],
    open_questions: ['Absolute dating of the Osireion'],
    updated_at: new Date().toISOString(),
  }));

  await withEnv({
    PIKO_DATA_DIR: tmp,
    EGYPTIAN_INSIGHTS_DATA_DIR: dataRoot,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
    PIKO_EXPERT_OPINION: '1',
    PIKO_LEGATE_MODEL: 'qwen3.6:27b',
  }, async () => {
    const understandPath = require.resolve('../lib/understand');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[understandPath];
    delete require.cache[legatePath];
    const understand = require('../lib/understand');
    const origUnderstand = understand.understand;
    const origAuth = understand.isAuthoritative;
    understand.understand = async () => opinionUnderstanding();
    understand.isAuthoritative = () => true;
    delete require.cache[legatePath];
    const legate = require('../lib/legateChat');
    let decideCalls = 0;
    const origDecide = legate.decideLegateTurn;
    legate.decideLegateTurn = async (...args) => {
      decideCalls += 1;
      return origDecide(...args);
    };
    try {
      const out = await legate.handleLegateChatTurn(
        'Have you come to any conclusions on the Osireion and its possible origins?',
        {
          rootDir: path.join(__dirname, '..'),
          isOperator: true,
          chatFn: async () => (
            'I land on an earlier megalithic phase for the Osireion. '
            + 'Petrie\'s Abydos and the Osireion notes the masonry contrast with Seti I\'s temple. '
            + 'Absolute dating remains open in the corpus.'
          ),
        },
      );
      assert.equal(decideCalls, 0, 'decide must not run for opinion');
      assert.equal(out.fallthrough, false);
      assert.ok(out.reply && out.reply.includes('Osireion'));
      assert.equal(out.decision.source, 'expert_opinion');
      assert.equal(out.mode, 'answer');
    } finally {
      understand.understand = origUnderstand;
      understand.isAuthoritative = origAuth;
      legate.decideLegateTurn = origDecide;
      delete require.cache[legatePath];
      delete require.cache[understandPath];
    }
  });
});

test('W1: PIKO_EXPERT_OPINION=0 restores WP10 fallthrough', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp11-off-'));
  await withEnv({
    PIKO_DATA_DIR: tmp,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_LEGATE_CHAT: '1',
    PIKO_AGENT_ORCH: '1',
    PIKO_UNDERSTAND_AUTHORITATIVE: '1',
    PIKO_EXPERT_OPINION: '0',
  }, async () => {
    const understandPath = require.resolve('../lib/understand');
    const legatePath = require.resolve('../lib/legateChat');
    delete require.cache[understandPath];
    delete require.cache[legatePath];
    const understand = require('../lib/understand');
    const origUnderstand = understand.understand;
    const origAuth = understand.isAuthoritative;
    understand.understand = async () => opinionUnderstanding();
    understand.isAuthoritative = () => true;
    delete require.cache[legatePath];
    const legate = require('../lib/legateChat');
    try {
      const out = await legate.handleLegateChatTurn(
        'What do you think about the Osireion?',
        { rootDir: path.join(__dirname, '..'), isOperator: true },
      );
      assert.equal(out.fallthrough, true);
      assert.equal(out.reply, null);
      assert.equal(out.decision.source, 'understand_skip_decide');
    } finally {
      understand.understand = origUnderstand;
      understand.isAuthoritative = origAuth;
      delete require.cache[legatePath];
      delete require.cache[understandPath];
    }
  });
});

test('W3: stance file load/save + gatherOpinionMaterial prefers stance', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp11-w3-'));
  const dataRoot = path.join(tmp, 'egyptian-insights');
  await withEnv({
    EGYPTIAN_INSIGHTS_DATA_DIR: dataRoot,
    PIKO_DATA_DIR: tmp,
  }, async () => {
    delete require.cache[require.resolve('../lib/eiStancePositions')];
    const {
      savePosition,
      loadPosition,
      gatherOpinionMaterial,
      topicSlug,
      synthesizePositionForThread,
    } = require('../lib/eiStancePositions');

    fs.mkdirSync(path.join(dataRoot, 'corpus_notes'), { recursive: true });
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(path.join(dataRoot, 'corpus_notes', `item_${i}.json`), JSON.stringify({
        harvest_id: i,
        title: `Osireion study ${i}`,
        author: 'Petrie',
        summary: 'Osireion megalithic construction at Abydos differs from New Kingdom temple work.',
        claims: ['Earlier phase at Osireion'],
        people: [],
        sites: ['Abydos', 'Osireion'],
        disagreements: [],
        open_questions: [],
        updated_at: new Date().toISOString(),
      }));
    }

    const saved = savePosition({
      topic: 'Abydos / Oserion',
      slug: 'abydos',
      stance: 'The Osireion looks like an earlier megalithic phase.',
      confidence: 'medium',
      reasons: [{ point: 'Masonry contrast', sources: ['Osireion study 1 — Petrie'] }],
      open_questions: ['Dating'],
      sources_count: 3,
      updated_at: new Date().toISOString(),
    });
    assert.equal(saved.slug, 'abydos');
    assert.equal(loadPosition('abydos').stance.includes('megalithic'), true);
    // THREAD_DEFS: "osireion" is aliased on both giza and abydos; score ties prefer giza.
    assert.equal(topicSlug('Osireion origins'), 'giza');
    assert.equal(topicSlug('Abydos temple and Seti'), 'abydos');

    const mat = gatherOpinionMaterial('conclusions on Abydos and the Osireion');
    assert.equal(mat.has_material, true);
    assert.ok(mat.position);
    assert.ok(mat.block.includes('STANCE'));

    const synth = await synthesizePositionForThread('abydos', {
      chatFn: async () => JSON.stringify({
        stance: 'I land on an earlier phase for the Osireion.',
        confidence: 'medium',
        reasons: [{ point: 'Masonry', sources: ['Osireion study 1 — Petrie'] }],
        open_questions: ['Dating'],
      }),
    });
    assert.equal(synth.ok, true);
    assert.ok(synth.position.stance.includes('earlier'));
  });
});

test('W4: hedge refusal triggers one retry then commits', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-wp11-w4-'));
  const dataRoot = path.join(tmp, 'egyptian-insights');
  fs.mkdirSync(path.join(dataRoot, 'corpus_notes'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'corpus_notes', 'item_55.json'), JSON.stringify({
    harvest_id: 55,
    title: 'Serpent in the Sky',
    author: 'John Anthony West',
    summary: 'Sphinx water erosion implies greater antiquity.',
    claims: ['Water erosion on Sphinx enclosure'],
    sites: ['Sphinx', 'Giza'],
    people: [],
    disagreements: ['Orthodox Old Kingdom dating'],
    open_questions: [],
    updated_at: new Date().toISOString(),
  }));

  await withEnv({
    PIKO_DATA_DIR: tmp,
    EGYPTIAN_INSIGHTS_DATA_DIR: dataRoot,
    PIKO_TENANT_ID: 'customer-03',
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_EXPERT_OPINION: '1',
    PIKO_LEGATE_MODEL: 'qwen3.6:27b',
  }, async () => {
    delete require.cache[require.resolve('../lib/legateChat')];
    delete require.cache[require.resolve('../lib/eiStancePositions')];
    const { answerExpertOpinion } = require('../lib/legateChat');
    let calls = 0;
    const out = await answerExpertOpinion(
      'Where do you land on the Sphinx erosion debate after all that reading?',
      opinionUnderstanding(),
      {
        rootDir: path.join(__dirname, '..'),
        chatFn: async () => {
          calls += 1;
          if (calls === 1) {
            return 'It is difficult without further context to form a view.';
          }
          return 'I land with West: the Sphinx enclosure shows water erosion implying greater antiquity. '
            + 'Serpent in the Sky argues this against Old Kingdom dating. Contested dating remains open.';
        },
      },
    );
    assert.equal(calls, 2, 'must retry once on hedge');
    assert.ok(out.reply.includes('West') || out.reply.includes('water'));
    assert.equal(out.decision.source, 'expert_opinion');
  });
});

test('W2: conclusions few-shot ids registered in FEW_SHOT_IDS', () => {
  const { FEW_SHOT_IDS, buildUnderstandPrompt } = require('../lib/understand');
  assert.ok(FEW_SHOT_IDS.has('fewshot-opinion-osireion-conclusions'));
  assert.ok(FEW_SHOT_IDS.has('fewshot-opinion-ingested'));
  assert.ok(FEW_SHOT_IDS.has('fewshot-opinion-sphinx-land'));
  const prompt = buildUnderstandPrompt({});
  assert.ok(prompt.includes('Have you come to any conclusions on the Osireion'));
  assert.ok(prompt.includes('given what you have ingested'));
});
