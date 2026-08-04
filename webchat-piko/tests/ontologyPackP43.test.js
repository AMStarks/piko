/**
 * P4.3 — Ontology pack completion: agent roster, understand few-shots,
 * opinion preamble, capability card (each override + fallback), plus
 * synthetic second-culture smoke.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WEBCHAT_ROOT = path.join(__dirname, '..');

function clearOntologyModules() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes('ontologyPack')
      || key.includes('eiThreadDossiers')
      || key.includes('tenantBackgroundJobs')
      || key.includes('agentRegistry')
      || key.includes('understand')
      || key.includes('identityCard')
      || key.includes('legateChat')
    ) {
      delete require.cache[key];
    }
  }
}

function withOntologyEnv(tmp, env, fn) {
  const prev = {
    PIKO_DATA_DIR: process.env.PIKO_DATA_DIR,
    PIKO_BACKGROUND_JOBS_PROFILE: process.env.PIKO_BACKGROUND_JOBS_PROFILE,
    PIKO_TENANT_ID: process.env.PIKO_TENANT_ID,
  };
  process.env.PIKO_DATA_DIR = path.join(tmp, 'data');
  fs.mkdirSync(process.env.PIKO_DATA_DIR, { recursive: true });
  if (env.PIKO_BACKGROUND_JOBS_PROFILE !== undefined) {
    process.env.PIKO_BACKGROUND_JOBS_PROFILE = env.PIKO_BACKGROUND_JOBS_PROFILE;
  } else {
    delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
  }
  if (env.PIKO_TENANT_ID !== undefined) {
    process.env.PIKO_TENANT_ID = env.PIKO_TENANT_ID;
  } else {
    delete process.env.PIKO_TENANT_ID;
  }
  clearOntologyModules();
  try {
    return fn();
  } finally {
    if (prev.PIKO_DATA_DIR == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev.PIKO_DATA_DIR;
    if (prev.PIKO_BACKGROUND_JOBS_PROFILE == null) delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
    else process.env.PIKO_BACKGROUND_JOBS_PROFILE = prev.PIKO_BACKGROUND_JOBS_PROFILE;
    if (prev.PIKO_TENANT_ID == null) delete process.env.PIKO_TENANT_ID;
    else process.env.PIKO_TENANT_ID = prev.PIKO_TENANT_ID;
    clearOntologyModules();
  }
}

function writeTenantOntology(pack) {
  fs.writeFileSync(
    path.join(process.env.PIKO_DATA_DIR, 'ontology.json'),
    JSON.stringify(pack),
  );
}

// —— P4.3a area 1: agent roster ——

test('P4.3a agent roster: pack overrides culture agent label', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-agents-'));
  withOntologyEnv(tmp, {
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
    PIKO_TENANT_ID: 'customer-03',
  }, () => {
    writeTenantOntology({
      threads: [{ id: 'giza', label: 'Giza', aliases: ['giza'] }],
      agents: [
        {
          id: 'ei-worker',
          label: 'Pack Override Worker',
          runtime: 'eval',
          profiles: ['culture'],
          tenants: ['customer-03'],
          capabilities: ['worker'],
          description: 'Overridden by ontology pack.',
        },
      ],
    });

    const { resetOntologyCache, getPackAgents } = require('../lib/ontologyPack');
    resetOntologyCache();
    const packAgents = getPackAgents(WEBCHAT_ROOT);
    assert.ok(packAgents);
    assert.equal(packAgents[0].label, 'Pack Override Worker');

    const { getAgent, listAgents } = require('../lib/agentRegistry');
    const worker = getAgent('ei-worker', WEBCHAT_ROOT);
    assert.ok(worker);
    assert.equal(worker.label, 'Pack Override Worker');
    assert.ok(listAgents(WEBCHAT_ROOT).some((a) => a.id === 'ei-worker' && a.label === 'Pack Override Worker'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('P4.3a agent roster: missing pack agents falls back to builtins', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-agents-fb-'));
  withOntologyEnv(tmp, {
    PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker',
    PIKO_TENANT_ID: 'customer-01',
  }, () => {
    const { getPackAgents, getOntologyPack, resetOntologyCache } = require('../lib/ontologyPack');
    resetOntologyCache();
    assert.equal(getOntologyPack(WEBCHAT_ROOT), null);
    assert.equal(getPackAgents(WEBCHAT_ROOT), null);

    const { getAgent, BUILTIN_AGENTS } = require('../lib/agentRegistry');
    const builtin = BUILTIN_AGENTS.find((a) => a.id === 'quant');
    assert.ok(builtin);
    const quant = getAgent('quant', WEBCHAT_ROOT);
    assert.ok(quant);
    assert.equal(quant.label, builtin.label);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// —— P4.3a area 2: understand few-shots ——

test('P4.3a understand few-shots: pack overrides prompt exemplars', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-fs-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    writeTenantOntology({
      threads: [{ id: 'alpha', label: 'Alpha', aliases: ['alpha'] }],
      understandFewShots: [
        {
          id: 'fewshot-pack-alpha',
          user: 'PACK_FEWSHOT_UNIQUE_PHRASE_99',
          assistant: {
            intent: 'musing',
            confidence: 0.9,
            control: null,
            work: null,
            schedule: null,
            constraints: null,
            slots: {},
            is_question: false,
          },
        },
      ],
    });

    const { resetOntologyCache, getPackUnderstandFewShots } = require('../lib/ontologyPack');
    resetOntologyCache();
    const packShots = getPackUnderstandFewShots(WEBCHAT_ROOT);
    assert.ok(packShots);
    assert.equal(packShots[0].id, 'fewshot-pack-alpha');

    const { buildUnderstandPrompt, resolveUnderstandFewShots, DEFAULT_UNDERSTAND_FEW_SHOTS } = require('../lib/understand');
    const resolved = resolveUnderstandFewShots(WEBCHAT_ROOT);
    assert.equal(resolved[0].id, 'fewshot-pack-alpha');
    assert.notEqual(resolved[0].id, DEFAULT_UNDERSTAND_FEW_SHOTS[0].id);

    const prompt = buildUnderstandPrompt({ rootDir: WEBCHAT_ROOT });
    assert.ok(prompt.includes('PACK_FEWSHOT_UNIQUE_PHRASE_99'));
    // Pack replaces Few-shot exemplars only (Critical distinctions stay structural).
    assert.ok(!prompt.includes('Find Petrie\'s Giza survey PDF and add it to the corpus'));
    assert.ok(!prompt.includes('fewshot-opinion-osireion-conclusions'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('P4.3a understand few-shots: missing pack falls back to hardcoded', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-fs-fb-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    const {
      resetOntologyCache,
      getPackUnderstandFewShots,
      getOntologyPack,
    } = require('../lib/ontologyPack');
    resetOntologyCache();
    assert.equal(getOntologyPack(WEBCHAT_ROOT), null);
    assert.equal(getPackUnderstandFewShots(WEBCHAT_ROOT), null);

    const {
      resolveUnderstandFewShots,
      buildUnderstandPrompt,
      DEFAULT_UNDERSTAND_FEW_SHOTS,
      FEW_SHOT_IDS,
    } = require('../lib/understand');
    const resolved = resolveUnderstandFewShots(WEBCHAT_ROOT);
    assert.equal(resolved.length, DEFAULT_UNDERSTAND_FEW_SHOTS.length);
    assert.equal(resolved[0].id, DEFAULT_UNDERSTAND_FEW_SHOTS[0].id);
    assert.ok(FEW_SHOT_IDS.has('fewshot-opinion-osireion-conclusions'));

    const prompt = buildUnderstandPrompt({ rootDir: WEBCHAT_ROOT });
    assert.ok(prompt.includes('Have you come to any conclusions on the Osireion'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// —— P4.3a area 3: opinion preamble ——

test('P4.3a opinion preamble: pack overrides framing line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-op-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    writeTenantOntology({
      threads: [{ id: 'alpha', label: 'Alpha', aliases: ['alpha'] }],
      opinionPreamble: 'PACK_OPINION_PREAMBLE_UNIQUE_77 — judgment lane.',
    });

    const { resetOntologyCache, getPackOpinionPreamble } = require('../lib/ontologyPack');
    resetOntologyCache();
    assert.equal(
      getPackOpinionPreamble(WEBCHAT_ROOT),
      'PACK_OPINION_PREAMBLE_UNIQUE_77 — judgment lane.',
    );

    const {
      buildExpertOpinionPrompt,
      resolveOpinionPreamble,
      DEFAULT_OPINION_PREAMBLE,
    } = require('../lib/legateChat');
    assert.equal(resolveOpinionPreamble(WEBCHAT_ROOT), 'PACK_OPINION_PREAMBLE_UNIQUE_77 — judgment lane.');
    assert.notEqual(resolveOpinionPreamble(WEBCHAT_ROOT), DEFAULT_OPINION_PREAMBLE);

    const prompt = buildExpertOpinionPrompt('thoughts?', 'material', true, null, { rootDir: WEBCHAT_ROOT });
    assert.ok(prompt.startsWith('PACK_OPINION_PREAMBLE_UNIQUE_77'));
    assert.ok(!prompt.includes('Egyptian Insights'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('P4.3a opinion preamble: missing pack falls back to hardcoded', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-op-fb-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    const { resetOntologyCache, getPackOpinionPreamble, getOntologyPack } = require('../lib/ontologyPack');
    resetOntologyCache();
    assert.equal(getOntologyPack(WEBCHAT_ROOT), null);
    assert.equal(getPackOpinionPreamble(WEBCHAT_ROOT), null);

    const {
      resolveOpinionPreamble,
      buildExpertOpinionPrompt,
      DEFAULT_OPINION_PREAMBLE,
    } = require('../lib/legateChat');
    assert.equal(resolveOpinionPreamble(WEBCHAT_ROOT), DEFAULT_OPINION_PREAMBLE);
    const prompt = buildExpertOpinionPrompt('x', null, false, null, { rootDir: WEBCHAT_ROOT });
    assert.ok(prompt.startsWith(DEFAULT_OPINION_PREAMBLE));
    assert.ok(prompt.includes('Egyptian Insights'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// —— P4.3a area 4: capability card ——

test('P4.3a capability card: pack overrides card text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-cap-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    writeTenantOntology({
      threads: [{ id: 'alpha', label: 'Alpha', aliases: ['alpha'] }],
      capabilityCard: {
        lines: [
          'PACK_CAPABILITY_CARD_UNIQUE_55',
          'Tenant: {{tenant}}.',
          'Only synthetic ops here.',
        ],
      },
    });

    const { resetOntologyCache, getPackCapabilityCard } = require('../lib/ontologyPack');
    resetOntologyCache();
    const card = getPackCapabilityCard(WEBCHAT_ROOT);
    assert.ok(card);
    assert.ok(card.text.includes('PACK_CAPABILITY_CARD_UNIQUE_55'));

    const { capabilityCard } = require('../lib/identityCard');
    const text = capabilityCard({ rootDir: WEBCHAT_ROOT });
    assert.ok(text.includes('PACK_CAPABILITY_CARD_UNIQUE_55'));
    assert.ok(text.includes('Only synthetic ops here'));
    assert.ok(!text.includes('Research — seek sources'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('P4.3a capability card: missing pack falls back to hardcoded', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-cap-fb-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    const { resetOntologyCache, getPackCapabilityCard, getOntologyPack } = require('../lib/ontologyPack');
    resetOntologyCache();
    assert.equal(getOntologyPack(WEBCHAT_ROOT), null);
    assert.equal(getPackCapabilityCard(WEBCHAT_ROOT), null);

    const { capabilityCard, DEFAULT_CAPABILITY_CARD_LINES } = require('../lib/identityCard');
    const text = capabilityCard({ rootDir: WEBCHAT_ROOT });
    assert.ok(text.includes('local operator assistant'));
    assert.ok(text.includes('Research — seek sources'));
    assert.ok(DEFAULT_CAPABILITY_CARD_LINES[0].includes('local operator assistant'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// —— P4.3b synthetic second-culture smoke ——

test('P4.3b synthetic-culture pack: threads, aliases, roster, agent selection', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-p43-synth-'));
  withOntologyEnv(tmp, {
    PIKO_BACKGROUND_JOBS_PROFILE: 'synthetic-culture',
    PIKO_TENANT_ID: 'staging-synth',
  }, () => {
    const {
      resetOntologyCache,
      getThreadDefs,
      resolveThreadAlias,
      getPackAgents,
      getPackUnderstandFewShots,
      getPackOpinionPreamble,
      getPackCapabilityCard,
    } = require('../lib/ontologyPack');
    resetOntologyCache();

    const ids = getThreadDefs(WEBCHAT_ROOT).map((t) => t.id);
    assert.deepEqual(ids, ['lunar-base', 'mars-rift', 'europa-ice']);
    assert.equal(resolveThreadAlias('moonbase', WEBCHAT_ROOT), 'lunar-base');
    assert.equal(resolveThreadAlias('valles marineris', WEBCHAT_ROOT), 'mars-rift');
    assert.equal(resolveThreadAlias('osireion', WEBCHAT_ROOT), null);

    const dossiers = require('../lib/eiThreadDossiers');
    assert.equal(dossiers.matchThreadId('explore the moon temple'), 'lunar-base');
    assert.equal(dossiers.matchThreadId('Osireion'), null);

    const packAgents = getPackAgents(WEBCHAT_ROOT);
    assert.ok(packAgents);
    const packIds = packAgents.map((a) => a.id).sort();
    assert.deepEqual(packIds, ['synth-scout', 'synth-worker']);

    const { listAgents, getAgent } = require('../lib/agentRegistry');
    const listed = listAgents(WEBCHAT_ROOT).map((a) => a.id).sort();
    assert.ok(listed.includes('synth-scout'));
    assert.ok(listed.includes('synth-worker'));
    assert.ok(!listed.includes('ei-worker'));
    assert.ok(!listed.includes('ei-harvester'));
    assert.ok(getAgent('synth-scout', WEBCHAT_ROOT));
    assert.equal(getAgent('ei-worker', WEBCHAT_ROOT), null);

    const { assignAgentForPart } = require('../lib/agentMissionPlanner');
    const agents = listAgents(WEBCHAT_ROOT);
    const picked = assignAgentForPart('Scout lunar ruins near the moon temple', agents);
    assert.ok(picked === 'synth-scout' || picked === 'synth-worker');
    assert.ok(picked !== 'ei-worker');

    const few = getPackUnderstandFewShots(WEBCHAT_ROOT);
    assert.ok(few.some((f) => f.id === 'fewshot-synth-musing-luna'));
    const { buildUnderstandPrompt } = require('../lib/understand');
    const up = buildUnderstandPrompt({ rootDir: WEBCHAT_ROOT });
    assert.ok(up.includes('moon temple'));
    assert.ok(up.includes('Valles Marineris flood hypothesis'));
    assert.ok(!up.includes('Find Petrie\'s Giza survey PDF and add it to the corpus'));

    assert.ok(getPackOpinionPreamble(WEBCHAT_ROOT).includes('Synthetic Culture'));
    const { buildExpertOpinionPrompt } = require('../lib/legateChat');
    const op = buildExpertOpinionPrompt('thoughts on mars?', 'm', true, null, { rootDir: WEBCHAT_ROOT });
    assert.ok(op.includes('Synthetic Culture'));
    assert.ok(!op.includes('Egyptian Insights'));

    const cap = getPackCapabilityCard(WEBCHAT_ROOT);
    assert.ok(cap.text.includes('synthetic-culture'));
    const { capabilityCard } = require('../lib/identityCard');
    const card = capabilityCard({ rootDir: WEBCHAT_ROOT });
    assert.ok(card.includes('lunar and Mars'));
    assert.ok(!card.includes('Campaigns — pause/resume'));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('P4.3 validatePack accepts extended schema fields', () => {
  const { validatePack } = require('../lib/ontologyPack');
  const out = validatePack({
    threads: [{ id: 'x', label: 'X', aliases: ['x'] }],
    agents: [{ id: 'a1', label: 'A', profiles: ['culture'], tenants: ['*'] }],
    understandFewShots: [{ id: 'f1', user: 'hi', assistant: { intent: 'conversation' } }],
    opinionPreamble: 'Preamble.',
    capabilityCard: { text: 'Card {{tenant}}' },
  });
  assert.ok(out);
  assert.equal(out.agents.length, 1);
  assert.equal(out.understandFewShots.length, 1);
  assert.equal(out.opinionPreamble, 'Preamble.');
  assert.ok(out.capabilityCard.text.includes('Card'));
});
