const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * checkYoloApiAuth lives inside server.js and is not exported. Mirror the
 * fail-closed contract here so the acceptance criterion is locked, and
 * assert the server source no longer returns true when the key is unset.
 */
function checkYoloApiAuthMirror(req, env = process.env) {
  const keyEnv = (env.PIKO_YOLO_API_KEY || env.PIKO_HEALTH_API_KEY || '').trim();
  if (!keyEnv) return false;
  const authHeader = (req.headers.authorization || '').trim();
  const apiKeyHeader = (req.headers['x-api-key'] || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return (bearer || apiKeyHeader) === keyEnv;
}

test('WP1.6: YOLO/HITL key unset fails closed', () => {
  assert.equal(checkYoloApiAuthMirror({ headers: {} }, {}), false);
  assert.equal(checkYoloApiAuthMirror({ headers: { authorization: 'Bearer x' } }, { PIKO_YOLO_API_KEY: '' }), false);
  assert.equal(
    checkYoloApiAuthMirror(
      { headers: { authorization: 'Bearer sekret' } },
      { PIKO_YOLO_API_KEY: 'sekret' },
    ),
    true,
  );
  assert.equal(
    checkYoloApiAuthMirror(
      { headers: { 'x-api-key': 'sekret' } },
      { PIKO_HEALTH_API_KEY: 'sekret' },
    ),
    true,
  );
});

test('WP1.6: server.js checkYoloApiAuth no longer fails open', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fn = src.match(/function checkYoloApiAuth\(req\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'checkYoloApiAuth present');
  assert.ok(/if \(!keyEnv\) return false;/.test(fn[0]), 'unset key returns false');
  assert.ok(!/if \(!keyEnv\) return true;/.test(fn[0]), 'unset key must not return true');
});
