/**
 * EI literature connector wiring (JS side).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

test('literature sources include ORAEC/papyri/open_context/trismegistos', () => {
  const { LITERATURE_SOURCES, CONNECTOR_ALIASES } = require('../lib/eiResearchGoal');
  for (const name of ['oraec', 'papyri', 'open_context', 'trismegistos', 'tla']) {
    assert.ok(LITERATURE_SOURCES.includes(name), name);
    assert.ok(CONNECTOR_ALIASES[name], `alias ${name}`);
  }
});

test('tool belt exposes seek_* and chase_tla', () => {
  const { listTools } = require('../lib/eiAgentTools');
  const names = listTools().map((t) => t.name);
  for (const name of [
    'seek_oraec',
    'seek_papyri',
    'seek_open_context',
    'seek_trismegistos',
    'chase_tla',
    'chase_topbib',
  ]) {
    assert.ok(names.includes(name), name);
  }
});
