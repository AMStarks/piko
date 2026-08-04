const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WEBCHAT_ROOT = path.join(__dirname, '..');

function clearOntologyModules() {
  for (const key of Object.keys(require.cache)) {
    if (/ontologyPack|eiThreadDossiers|tenantBackgroundJobs/.test(key)) {
      delete require.cache[key];
    }
  }
}

function withOntologyEnv(tmp, env, fn) {
  const prev = {
    PIKO_DATA_DIR: process.env.PIKO_DATA_DIR,
    PIKO_BACKGROUND_JOBS_PROFILE: process.env.PIKO_BACKGROUND_JOBS_PROFILE,
  };
  process.env.PIKO_DATA_DIR = path.join(tmp, 'data');
  fs.mkdirSync(process.env.PIKO_DATA_DIR, { recursive: true });
  if (env.PIKO_BACKGROUND_JOBS_PROFILE !== undefined) {
    process.env.PIKO_BACKGROUND_JOBS_PROFILE = env.PIKO_BACKGROUND_JOBS_PROFILE;
  } else {
    delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
  }
  clearOntologyModules();
  try {
    return fn();
  } finally {
    if (prev.PIKO_DATA_DIR == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prev.PIKO_DATA_DIR;
    if (prev.PIKO_BACKGROUND_JOBS_PROFILE == null) delete process.env.PIKO_BACKGROUND_JOBS_PROFILE;
    else process.env.PIKO_BACKGROUND_JOBS_PROFILE = prev.PIKO_BACKGROUND_JOBS_PROFILE;
    clearOntologyModules();
  }
}

test('ontology pack loads from PIKO_DATA_DIR/ontology.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ontology-'));
  withOntologyEnv(tmp, {}, () => {
    const pack = {
      threads: [
        { id: 'alpha', label: 'Alpha thread', aliases: ['alpha-site'] },
        { id: 'beta', label: 'Beta thread', aliases: ['beta-site'] },
      ],
      aliases: { 'alpha-alias': 'alpha' },
    };
    fs.writeFileSync(path.join(process.env.PIKO_DATA_DIR, 'ontology.json'), JSON.stringify(pack));

    const {
      getOntologyPack,
      getThreadDefs,
      resolveThreadAlias,
    } = require('../lib/ontologyPack');

    const loaded = getOntologyPack(WEBCHAT_ROOT);
    assert.ok(loaded);
    assert.equal(loaded.threads.length, 2);
    assert.deepEqual(getThreadDefs(WEBCHAT_ROOT).map((t) => t.id), ['alpha', 'beta']);
    assert.equal(resolveThreadAlias('alpha-alias', WEBCHAT_ROOT), 'alpha');
    assert.equal(resolveThreadAlias('alpha-site', WEBCHAT_ROOT), 'alpha');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('culture profile pack resolves osireion → abydos', () => {
  withOntologyEnv(fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ontology-')), {
    PIKO_BACKGROUND_JOBS_PROFILE: 'culture',
  }, () => {
    const { resolveThreadAlias, getThreadDefs } = require('../lib/ontologyPack');
    const ids = getThreadDefs(WEBCHAT_ROOT).map((t) => t.id);
    assert.ok(ids.includes('abydos'));
    assert.equal(resolveThreadAlias('osireion', WEBCHAT_ROOT), 'abydos');
    assert.equal(resolveThreadAlias('oserion', WEBCHAT_ROOT), 'abydos');
  });
});

test('missing pack falls back to hardcoded thread defs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ontology-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'ausmaker' }, () => {
    const ontology = require('../lib/ontologyPack');
    const dossiers = require('../lib/eiThreadDossiers');

    assert.equal(ontology.getOntologyPack(WEBCHAT_ROOT), null);
    assert.equal(ontology.getThreadDefs(WEBCHAT_ROOT), null);
    assert.equal(ontology.resolveThreadAlias('osireion', WEBCHAT_ROOT), null);

    assert.equal(dossiers.resolveThreadAlias('osireion'), 'abydos');
    assert.equal(dossiers.matchThreadId('Osireion'), 'abydos');
    assert.deepEqual(
      dossiers.activeThreadDefs().map((t) => t.id),
      dossiers.DEFAULT_THREAD_DEFS.map((t) => t.id),
    );
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('synthetic-culture profile pack routes different threads and aliases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ontology-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'synthetic-culture' }, () => {
    const { getThreadDefs, resolveThreadAlias, resetOntologyCache } = require('../lib/ontologyPack');
    resetOntologyCache();
    const dossiers = require('../lib/eiThreadDossiers');

    const ids = getThreadDefs(WEBCHAT_ROOT).map((t) => t.id);
    assert.deepEqual(ids, ['lunar-base', 'mars-rift', 'europa-ice']);
    assert.equal(resolveThreadAlias('moonbase', WEBCHAT_ROOT), 'lunar-base');
    assert.equal(resolveThreadAlias('moon temple', WEBCHAT_ROOT), 'lunar-base');
    assert.equal(resolveThreadAlias('osireion', WEBCHAT_ROOT), null);

    assert.equal(dossiers.matchThreadId('explore the moon temple'), 'lunar-base');
    assert.equal(dossiers.matchThreadId('Osireion'), null);
    assert.equal(dossiers.resolveThreadAlias('valles marineris'), 'mars-rift');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('validatePack accepts threads object map', () => {
  const { validatePack } = require('../lib/ontologyPack');
  const out = validatePack({
    threads: {
      foo: { label: 'Foo site', aliases: ['foo-bar'] },
    },
  });
  assert.ok(out);
  assert.equal(out.threads.length, 1);
  assert.equal(out.threads[0].id, 'foo');
});

test('resetOntologyCache clears cached pack', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ontology-'));
  withOntologyEnv(tmp, { PIKO_BACKGROUND_JOBS_PROFILE: 'culture' }, () => {
    const ontology = require('../lib/ontologyPack');
    assert.ok(ontology.getOntologyPack(WEBCHAT_ROOT));
    ontology.resetOntologyCache();
    assert.ok(ontology.getOntologyPack(WEBCHAT_ROOT));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});
