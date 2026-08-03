const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('persona pack shadows repo prompts and overlays identity header', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-persona-'));
  const packDir = path.join(tmp, 'persona');
  fs.mkdirSync(packDir, { recursive: true });
  process.env.PIKO_PERSONA_DIR = packDir;

  delete require.cache[require.resolve('../lib/personaPack')];
  const { readPersonaFile, getPersonaOverlay, personaDir } = require('../lib/personaPack');
  assert.equal(personaDir(), packDir);

  // Fallback to repo prompts when the pack has no file.
  const repoPrompts = path.join(tmp, 'prompts');
  fs.mkdirSync(repoPrompts);
  fs.writeFileSync(path.join(repoPrompts, 'IDENTITY.md'), 'repo identity');
  assert.equal(readPersonaFile('IDENTITY.md', repoPrompts), 'repo identity');

  // Pack file shadows the repo version.
  fs.writeFileSync(path.join(packDir, 'IDENTITY.md'), 'tenant identity');
  assert.equal(readPersonaFile('IDENTITY.md', repoPrompts), 'tenant identity');

  // Overlay is pack-only.
  assert.equal(getPersonaOverlay(), '');
  fs.writeFileSync(path.join(packDir, 'PERSONA.md'), 'You research Ancient Egypt.');
  assert.equal(getPersonaOverlay(), 'You research Ancient Egypt.');

  // Universal identity header picks up the overlay and stays tenant-neutral.
  delete require.cache[require.resolve('../lib/pikoIdentity')];
  const { getUniversalIdentityHeader } = require('../lib/pikoIdentity');
  const header = getUniversalIdentityHeader();
  assert.ok(header.includes('TENANT PERSONA: You research Ancient Egypt.'));
  assert.ok(!header.includes('Cin7'), 'no hardcoded tenant tools in base identity');
  assert.ok(!header.includes('Shopify'));

  delete process.env.PIKO_PERSONA_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});
