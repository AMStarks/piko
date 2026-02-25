#!/usr/bin/env node
/**
 * One-off test: POST to Moltbook comments API. Run from app root with MOLTBOOK_API_KEY in env.
 * Usage: node scripts/test-moltbook-comment.js [post-id] [content]
 */
const https = require('https');
const postId = process.argv[2] || '4b7d47aa-65d0-485f-81be-0281454e3603';
const content = process.argv[3] || 'Test';
const key = process.env.MOLTBOOK_API_KEY || process.env.MOLTBOOK_KEY;
if (!key) {
  console.error('Set MOLTBOOK_API_KEY');
  process.exit(1);
}
const body = JSON.stringify({ content });
const opts = {
  hostname: 'www.moltbook.com',
  port: 443,
  path: '/api/v1/posts/' + encodeURIComponent(postId) + '/comments',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
};
const req = https.request(opts, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', data.slice(0, 500)));
});
req.on('error', (e) => console.error(e.message));
req.write(body);
req.end();
