const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'provision-tenant.sh');

describe('P4.5 provision-tenant.sh', () => {
  it('dry-run prints plan without writing', () => {
    const out = spawnSync('bash', [SCRIPT, 'customer-dryrun-zz', 'culture', '3099', '--dry-run'], {
      encoding: 'utf8',
    });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    assert.ok(out.stdout.includes('dry_run=1'));
    assert.ok(out.stdout.includes('tenants.conf entry'));
    assert.ok(out.stdout.includes('dry-run complete'));
    assert.ok(!require('fs').existsSync(path.join(__dirname, '..', '..', 'sites', 'customer-dryrun-zz')));
  });
});
