const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const clientPath = path.join(__dirname, '..', '..', 'adapters', 'shared', 'pikoClient.js');

test('WP6.3 per-session in-flight drops rapid repeats', async () => {
  delete require.cache[require.resolve(clientPath)];
  const { postToPiko, clearFloodState, _inflight } = require(clientPath);
  clearFloodState();

  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    // Hold the first request open briefly
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: 'ok' }));
    }, 80);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const a = postToPiko(base, 'first', 'chat-1', { retries: 1, timeoutMs: 5000 });
    // Immediately fire a second — should drop while in-flight
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(_inflight.get('chat-1'), true);
    const dropped = await postToPiko(base, 'second', 'chat-1', { retries: 1, timeoutMs: 5000 });
    assert.equal(dropped.dropped, true);
    assert.equal(dropped.error, 'in_flight');
    const first = await a;
    assert.equal(first.reply, 'ok');
    assert.equal(hits, 1);
  } finally {
    clearFloodState();
    server.close();
  }
});

test('WP6.3 error replies rate-limited to one per chat per minute', () => {
  delete require.cache[require.resolve(clientPath)];
  const { shouldSendErrorReply, clearFloodState } = require(clientPath);
  clearFloodState();
  const t0 = 1_000_000;
  assert.equal(shouldSendErrorReply('wa-1', t0), true);
  assert.equal(shouldSendErrorReply('wa-1', t0 + 1000), false);
  assert.equal(shouldSendErrorReply('wa-2', t0 + 1000), true);
  assert.equal(shouldSendErrorReply('wa-1', t0 + 60_000), true);
});
