const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const slash = require('../lib/slashCommands');

describe('lib/slashCommands', () => {
  it('parses /learning', () => {
    const p = slash.parseSlashCommand('/learning');
    assert.equal(p.kind, 'learning');
  });

  it('parses feedback ops', () => {
    assert.equal(slash.parseSlashCommand('/++ giza').op, 'plus');
    assert.equal(slash.parseSlashCommand('/-- orion').op, 'minus');
  });

  it('parses agent stop', () => {
    const p = slash.parseSlashCommand('/agent stop job_abcdef12-3456-7890');
    assert.equal(p.kind, 'agent_stop');
    assert.equal(p.validJobId, true);
  });

  it('parses agent run', () => {
    const p = slash.parseSlashCommand('/agent run scholar dig into Abydos');
    assert.equal(p.kind, 'agent_run');
    assert.equal(p.agent, 'scholar');
    assert.match(p.brief, /Abydos/);
  });

  it('parses legion approve cancel', () => {
    const p = slash.parseSlashCommand('/legion approve cancel');
    assert.equal(p.kind, 'legion_approve_cancel');
  });

  it('returns null for natural language', () => {
    assert.equal(slash.parseSlashCommand('pause the campaign'), null);
  });

  it('parses option numbers without regex', () => {
    assert.equal(slash.parseOptionNumber('2'), 2);
    assert.equal(slash.parseOptionNumber('option 3'), 3);
    assert.equal(slash.parseOptionNumber('the second'), 2);
    assert.equal(slash.parseOptionNumber('maybe later'), null);
  });
});
