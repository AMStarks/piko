const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildAuthHeaders } = require(path.join(
  __dirname,
  '..',
  '..',
  'adapters',
  'shared',
  'pikoClient.js',
));

test('WP1.7: pikoClient attaches X-Piko-Key when PIKO_API_KEY set', () => {
  assert.deepEqual(buildAuthHeaders({}), { 'Content-Type': 'application/json' });
  assert.deepEqual(buildAuthHeaders({ PIKO_API_KEY: '  adapter-key  ' }), {
    'Content-Type': 'application/json',
    'X-Piko-Key': 'adapter-key',
  });
});
