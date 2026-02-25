#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'data', 'conversation-eval-logs');
const INPUT = process.env.PIKO_CONTINUITY_REPORT_FILE || '';

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function latestLog() {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return null;
  return path.join(LOG_DIR, files[files.length - 1]);
}

function run() {
  const file = INPUT || latestLog();
  if (!file || !fs.existsSync(file)) {
    console.error('No eval log found. Set PIKO_CONTINUITY_REPORT_FILE or run continuity-eval first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scenarios = data.results || [];
  if (!scenarios.length) {
    console.error('No scenario results in log:', file);
    process.exit(1);
  }

  const criterion = {
    continuity: [],
    naturalness: [],
    noBleed: [],
    noReset: [],
    modeFit: [],
  };
  let resetHits = 0;
  let bleedHits = 0;
  let stiltedHits = 0;
  const routeCounts = { casual: 0, socialChat: 0, full: 0, unknown: 0 };

  for (const s of scenarios) {
    for (const run of s.runs || []) {
      criterion.continuity.push(run.runScores?.continuity || 0);
      criterion.naturalness.push(run.runScores?.naturalness || 0);
      criterion.noBleed.push(run.runScores?.noBleed || 0);
      criterion.noReset.push(run.runScores?.noReset || 0);
      criterion.modeFit.push(run.runScores?.modeFit || 0);
      for (const t of run.turns || []) {
        const d = t.diagnostics || {};
        if (d.reset_trigger) resetHits += 1;
        if (d.bleed_trigger) bleedHits += 1;
        if (d.stilted_trigger) stiltedHits += 1;
        const route = d.guessed_route || 'unknown';
        routeCounts[route] = (routeCounts[route] || 0) + 1;
      }
    }
  }

  const ranked = [...scenarios]
    .map((s) => ({ id: s.id, avgTotal: s.avgTotal || 0, pass: !!s.pass }))
    .sort((a, b) => a.avgTotal - b.avgTotal);

  console.log('Continuity Eval Report');
  console.log('Log:', file);
  console.log('Scenarios:', scenarios.length);
  console.log(`Pass rate: ${(100 * (data.global?.passRate || 0)).toFixed(1)}% (${data.global?.passCount || 0}/${data.global?.scenarioCount || scenarios.length})`);
  console.log(`Average total (0-5): ${(data.global?.avgTotal || 0).toFixed(2)}`);
  if (data.global?.overallPassThreshold != null) {
    console.log(`Release gate (${(Number(data.global.overallPassThreshold) * 100).toFixed(0)}%): ${data.global.releaseGatePass ? 'PASS' : 'FAIL'}`);
  }
  console.log('');
  console.log('Criterion averages (0-5):');
  console.log(`- continuity: ${avg(criterion.continuity).toFixed(2)}`);
  console.log(`- naturalness: ${avg(criterion.naturalness).toFixed(2)}`);
  console.log(`- noBleed: ${avg(criterion.noBleed).toFixed(2)}`);
  console.log(`- noReset: ${avg(criterion.noReset).toFixed(2)}`);
  console.log(`- modeFit: ${avg(criterion.modeFit).toFixed(2)}`);
  console.log('');
  console.log('Diagnostics counts:');
  console.log(`- reset_trigger hits: ${resetHits}`);
  console.log(`- bleed_trigger hits: ${bleedHits}`);
  console.log(`- stilted_trigger hits: ${stiltedHits}`);
  console.log(`- guessed routes: casual=${routeCounts.casual || 0}, socialChat=${routeCounts.socialChat || 0}, full=${routeCounts.full || 0}, unknown=${routeCounts.unknown || 0}`);
  console.log('');
  console.log('Lowest scenarios:');
  for (const item of ranked.slice(0, 5)) {
    console.log(`- ${item.id}: ${item.avgTotal.toFixed(2)} ${item.pass ? '(pass)' : '(fail)'}`);
  }
}

run();

