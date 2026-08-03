#!/usr/bin/env node
/**
 * WP8.9 — 200-run live smoke against understand() (chat-lane / Rodimus).
 * Weighted toward control / work_order / musing.
 *
 * Env: PIKO_UNDERSTAND_MODEL / PIKO_LEGATE_MODEL, OLLAMA_URL
 *      PIKO_UNDERSTAND_SMOKE_N (default 200)
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'understand');

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function pickWeighted(rows, n) {
  const weight = (r) => {
    if (r.intent === 'campaign_control') return 5;
    if (r.intent === 'work_order') return 4;
    if (r.intent === 'musing') return 4;
    if (r.intent === 'status_question') return 3;
    if (r.intent === 'opinion_question') return 2;
    return 1;
  };
  const pool = [];
  for (const r of rows) {
    if (r.exclude_from_scoring) continue;
    const w = weight(r);
    for (let i = 0; i < w; i++) pool.push(r);
  }
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard += 1;
    const r = pool[Math.floor(Math.random() * pool.length)];
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

async function main() {
  const n = Number(process.env.PIKO_UNDERSTAND_SMOKE_N || 200);
  const rows = [
    ...loadJsonl(path.join(OUT_DIR, 'battery-synthetic.jsonl')),
    ...loadJsonl(path.join(OUT_DIR, 'battery-real.jsonl')),
  ];
  if (!rows.length) {
    console.error('No battery — run npm run understand:battery');
    process.exit(1);
  }
  const sample = pickWeighted(rows, n);
  const { understand } = require('../lib/understand');

  const stats = {
    n: sample.length,
    correct: 0,
    failed: 0,
    false_work: 0,
    latencies: [],
    misses: [],
  };

  for (const row of sample) {
    const t0 = Date.now();
    const result = await understand(row.text, {
      is_operator: true,
      campaign_summary: 'research campaign active',
    });
    const ms = Date.now() - t0;
    stats.latencies.push(ms);
    if (result.failed) stats.failed += 1;
    if (result.intent === row.intent) stats.correct += 1;
    else {
      stats.misses.push({
        expected: row.intent,
        predicted: result.intent,
        text: row.text,
        failed: result.failed,
      });
    }
    if (
      (row.intent === 'musing' || row.intent === 'status_question')
      && result.intent === 'work_order'
    ) {
      stats.false_work += 1;
    }
  }

  stats.latencies.sort((a, b) => a - b);
  const mid = stats.latencies[Math.floor(stats.latencies.length / 2)] || 0;
  const report = {
    n: stats.n,
    accuracy: stats.n ? stats.correct / stats.n : 0,
    failed: stats.failed,
    false_work_on_musing_status: stats.false_work,
    median_latency_ms: mid,
    misses_sample: stats.misses.slice(0, 30),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (stats.false_work > 0) process.exit(2);
  if (stats.n && stats.correct / stats.n < 0.85) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
