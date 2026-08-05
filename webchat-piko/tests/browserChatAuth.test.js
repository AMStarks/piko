const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('P6.3 browser chat under strict', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  it('sends credentials so admin session cookie is included', () => {
    assert.ok(html.includes("credentials: 'include'"));
    assert.ok(html.includes('async function apiFetch'));
  });

  it('prompts login on 401 with admin/login next= path', () => {
    assert.ok(html.includes('/admin/login?next='));
    assert.ok(html.includes('Sign in to chat'));
    assert.ok(html.includes('res.status === 401'));
  });
});
