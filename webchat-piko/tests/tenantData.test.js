/**
 * P3.6 — tenant-data export + quarantine delete.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { exportData, deleteData } = require('../scripts/tenant-data');

describe('scripts/tenant-data', () => {
  let parent;
  let tenantDir;

  before(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-tenant-parent-'));
    tenantDir = path.join(parent, 'tenant-a');
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'state.json'), '{"ok":true}\n', 'utf8');
  });

  after(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('export creates a tar.gz containing tenant files', () => {
    const out = exportData(tenantDir);
    assert.ok(fs.existsSync(out));
    const list = spawnSync('tar', ['-tzf', out], { encoding: 'utf8' });
    assert.equal(list.status, 0);
    assert.match(list.stdout, /tenant-a\/state\.json/);
  });

  it('delete quarantine-moves data dir (never rm -rf)', () => {
    const victim = path.join(parent, 'tenant-b');
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, 'marker.txt'), 'keep', 'utf8');

    const { quarantineRoot, dest } = deleteData(victim);
    assert.ok(!fs.existsSync(victim), 'original path must be gone');
    assert.ok(fs.existsSync(quarantineRoot));
    assert.ok(fs.existsSync(dest));
    assert.equal(fs.readFileSync(path.join(dest, 'marker.txt'), 'utf8'), 'keep');
    assert.match(quarantineRoot, /\.quarantine-delete-\d+$/);
  });
});
