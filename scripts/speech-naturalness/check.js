#!/usr/bin/env node
/**
 * Check a naturalness run log: flag replies that sound unnatural (meta, canned, formal).
 * Use the report to correct prompts (SOUL, IDENTITY, server), then re-run and revert if worse.
 *
 * Usage: node check.js path/to/naturalness-run-YYYYMMDD-HHMM.json
 */

const fs = require('fs');
const path = require('path');

// Align with server + SOUL: meta slip and support-bot phrases
const META_SLIP = [
  /I see you've edited/i,
  /key takeaways/i,
  /I'll review the changes/i,
  /I'm back online and ready to help/i,
  /It's great to be back online/i,
  /I'll restart the bot/i,
  /persona document to refine/i,
  /To confirm, the key takeaways/i,
  /summarize the instructions/i,
];

const CANNED = [
  /How can I assist you today/i,
  /What can I help you with/i,
  /I'm here to help/i,
  /I'm here for a chat/i,
  /It's great to catch up with you/i,
  /It's great to catch up!?/i,
  /Things have been going well, thanks for asking/i,
  /I'm glad to be back online/i,
  /I'm glad we're both/i,
  /conversation skills were put to the test/i,
  /What's on your mind\??/i,
  /What would you like to talk about\??/i,
  /Would you like (to )?(A|B|C|to)/i,
  /Coding, faith, or something else/i,
  /Can I help you debug/i,
  /It sounds like you're getting stuck/i,
];

const FORMAL_OPENING = [
  /^As (an )?AI/i,
  /^I am (an )?AI/i,
  /^I'm (an )?AI/i,
  /^Certainly!?/i,
  /^Of course!?/i,
  /^I'd be (happy|glad) to/i,
  /^Great question!?/i,
];

const ROLE_RECITAL = [
  /I'm Piko,? (your )?Christian/i,
  /I am Piko,? (your )?Christian/i,
  /^I'm Piko\.?\s*$/im,
  /as (your )?Christian (AI )?companion/i,
];

const LIST_AFTER_GREETING = [
  /^(Hey|Hi|Hello)[^]*?\n[-*]\s/m,
  /^(Hey|Hi|Hello)[^]*?(\d+\.\s)/m,
];

function classify(reply, userMessage) {
  const issues = [];
  if (!reply || typeof reply !== 'string') {
    issues.push({ tag: 'empty', note: 'No reply' });
    return issues;
  }
  const r = reply.trim();
  const lower = r.toLowerCase();
  const isGreetingLike = /^(hey|hi|hello|yo|morning|what'?s up|how are you|how'?s it going|checking in)/i.test((userMessage || '').trim());

  for (const p of META_SLIP) {
    if (p.test(r)) {
      issues.push({ tag: 'meta', note: 'Meta slip (instructions/persona)' });
      break;
    }
  }
  for (const p of CANNED) {
    if (p.test(r)) {
      issues.push({ tag: 'canned', note: 'Support-bot / canned phrase' });
      break;
    }
  }
  for (const p of FORMAL_OPENING) {
    if (p.test(r)) {
      issues.push({ tag: 'formal', note: 'Formal/assistant opening' });
      break;
    }
  }
  for (const p of ROLE_RECITAL) {
    if (p.test(r)) {
      issues.push({ tag: 'role', note: 'Role recital (I\'m Piko...)' });
      break;
    }
  }
  if (isGreetingLike && r.split(/\n/).length > 2) {
    issues.push({ tag: 'long', note: 'Long reply to greeting/small talk' });
  }
  if (isGreetingLike && /[-*]\s/.test(r)) {
    issues.push({ tag: 'list', note: 'List in reply to greeting' });
  }
  if (r.length > 400 && isGreetingLike) {
    issues.push({ tag: 'verbose', note: 'Very long reply to casual turn' });
  }
  if (issues.length === 0) {
    issues.push({ tag: 'ok', note: 'No pattern match' });
  }
  return issues;
}

function main() {
  const logPath = process.argv[2];
  if (!logPath || !fs.existsSync(logPath)) {
    console.error('Usage: node check.js <path-to-naturalness-run-*.json>');
    process.exit(1);
  }
  const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  const entries = log.entries || [];

  const byTag = {};
  const failures = [];

  entries.forEach((e) => {
    const issues = classify(e.reply, e.userMessage);
    const bad = issues.filter((i) => i.tag !== 'ok');
    issues.forEach((i) => {
      byTag[i.tag] = (byTag[i.tag] || 0) + 1;
    });
    if (bad.length > 0) {
      failures.push({
        turn: e.turn,
        user: e.userMessage,
        reply: (e.reply || '').slice(0, 200),
        issues: bad,
      });
    }
  });

  console.log('--- Naturalness check report ---');
  console.log(`Log: ${logPath}`);
  console.log(`Total turns: ${entries.length}`);
  console.log('');
  console.log('Count by tag:');
  Object.entries(byTag)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, n]) => console.log(`  ${tag}: ${n}`));
  console.log('');
  const failCount = failures.length;
  console.log(`Turns with issues: ${failCount} (${entries.length ? ((failCount / entries.length) * 100).toFixed(1) : 0}%)`);
  console.log('');
  console.log('--- Sample failures (first 30) ---');
  failures.slice(0, 30).forEach((f) => {
    console.log(`\n#${f.turn} [${f.issues.map((i) => i.tag).join(', ')}]`);
    console.log(`  User: ${f.user}`);
    console.log(`  Reply: ${f.reply}${(f.reply && f.reply.length >= 200) ? '…' : ''}`);
  });
  console.log('');
  if (failures.length > 30) {
    console.log(`... and ${failures.length - 30} more. Full list in log.`);
  }
  console.log('');
  console.log('Next: adjust SOUL.md / IDENTITY.md / server leading rule or meta filter for these patterns, re-run harness, then compare. Revert prompt changes if failure rate goes up.');
}

main();
