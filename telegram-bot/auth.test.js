#!/usr/bin/env node
/**
 * Unit tests for the auth module.
 * Run: node telegram-bot/auth.test.js
 * Or:  node --test telegram-bot/auth.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const auth = require('./auth.js');

function withEnv(overrides, fn) {
  const before = {};
  for (const key of Object.keys(overrides)) {
    if (key in process.env) before[key] = process.env[key];
    if (overrides[key] !== undefined) process.env[key] = String(overrides[key]);
    else delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (before[key] !== undefined) process.env[key] = before[key];
      else delete process.env[key];
    }
  }
}

describe('isBotConfigured', () => {
  it('returns false when no token is set', () => {
    withEnv(
      { TELEGRAM_TOKEN: undefined, TELEGRAM_BOT_TOKEN: undefined },
      () => assert.strictEqual(auth.isBotConfigured(), false)
    );
  });

  it('returns false when token is placeholder YOUR_BOT_TOKEN', () => {
    withEnv({ TELEGRAM_TOKEN: 'YOUR_BOT_TOKEN', TELEGRAM_BOT_TOKEN: undefined }, () =>
      assert.strictEqual(auth.isBotConfigured(), false)
    );
  });

  it('returns true when TELEGRAM_TOKEN is a real value', () => {
    withEnv({ TELEGRAM_TOKEN: '123:abc', TELEGRAM_BOT_TOKEN: undefined }, () =>
      assert.strictEqual(auth.isBotConfigured(), true)
    );
  });

  it('returns true when TELEGRAM_BOT_TOKEN is set and TELEGRAM_TOKEN is not', () => {
    withEnv({ TELEGRAM_TOKEN: undefined, TELEGRAM_BOT_TOKEN: '456:xyz' }, () =>
      assert.strictEqual(auth.isBotConfigured(), true)
    );
  });

  it('accepts trimmed non-empty token', () => {
    withEnv({ TELEGRAM_TOKEN: '  789:def  ', TELEGRAM_BOT_TOKEN: undefined }, () =>
      assert.strictEqual(auth.isBotConfigured(), true)
    );
  });
});

describe('isTaskAllowed', () => {
  it('returns false when no Cursor API key is set', () => {
    withEnv(
      { CURSOR_API_KEY: undefined, CURSOR_API_KEY_BOT: undefined },
      () => assert.strictEqual(auth.isTaskAllowed(), false)
    );
  });

  it('returns true when CURSOR_API_KEY is set', () => {
    withEnv({ CURSOR_API_KEY: 'key_abc', CURSOR_API_KEY_BOT: undefined }, () =>
      assert.strictEqual(auth.isTaskAllowed(), true)
    );
  });

  it('returns true when CURSOR_API_KEY_BOT is set', () => {
    withEnv({ CURSOR_API_KEY: undefined, CURSOR_API_KEY_BOT: 'key_xyz' }, () =>
      assert.strictEqual(auth.isTaskAllowed(), true)
    );
  });

  it('returns false when key is only whitespace', () => {
    withEnv({ CURSOR_API_KEY: '   ', CURSOR_API_KEY_BOT: undefined }, () =>
      assert.strictEqual(auth.isTaskAllowed(), false)
    );
  });
});
