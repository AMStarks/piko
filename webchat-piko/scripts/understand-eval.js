#!/usr/bin/env node
/**
 * Run understand() against the WP8 battery and print per-category accuracy.
 *
 * Env:
 *   PIKO_UNDERSTAND_MODEL / PIKO_LEGATE_MODEL — required (27B)
 *   OLLAMA_URL — Rodimus chat lane
 *   PIKO_UNDERSTAND_EVAL_LIMIT — optional cap for smoke
 *   PIKO_UNDERSTAND_EVAL_OFFLINE=1 — score only floor-labeler agreement (no LLM)
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'understand');

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function loadBattery() {
  const synth = loadJsonl(path.join(OUT_DIR, 'battery-synthetic.jsonl'));
  const real = loadJsonl(path.join(OUT_DIR, 'battery-real.jsonl'));
  return [...synth, ...real].filter((r) => !r.exclude_from_scoring);
}

/** Stratified sample so a LIMIT does not take only the first intent block. */
function stratifiedSample(rows, limit) {
  if (!limit || limit <= 0 || rows.length <= limit) return rows;
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.intent)) by.set(r.intent, []);
    by.get(r.intent).push(r);
  }
  const intents = [...by.keys()];
  const out = [];
  const idx = Object.fromEntries(intents.map((k) => [k, 0]));
  // Round-robin across intents
  while (out.length < limit) {
    let progressed = false;
    for (const intent of intents) {
      if (out.length >= limit) break;
      const bucket = by.get(intent);
      const i = idx[intent];
      if (i < bucket.length) {
        out.push(bucket[i]);
        idx[intent] = i + 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

async function main() {
  const offline = process.env.PIKO_UNDERSTAND_EVAL_OFFLINE === '1';
  const limit = Number(process.env.PIKO_UNDERSTAND_EVAL_LIMIT || 0);
  let rows = loadBattery();
  if (!rows.length) {
    console.error('No battery fixtures — run: node scripts/generate-understand-battery.js');
    process.exit(1);
  }
  if (limit > 0) rows = stratifiedSample(rows, limit);

  const { labelWithFloors } = require('./generate-understand-battery');
  const stats = {
    total: 0,
    correct: 0,
    failed: 0,
    false_work_on_musing_status: 0,
    by_intent: {},
    misses: [],
  };

  let understand;
  if (!offline) {
    ({ understand } = require('../lib/understand'));
  }

  for (const row of rows) {
    stats.total += 1;
    if (stats.total % 5 === 1) console.error(`[eval] ${stats.total}/${rows.length}`);
    if (!stats.by_intent[row.intent]) {
      stats.by_intent[row.intent] = { n: 0, correct: 0, failed: 0 };
    }
    stats.by_intent[row.intent].n += 1;

    let predicted;
    if (offline) {
      predicted = labelWithFloors(row.text);
    } else {
      const result = await understand(row.text, {
        is_operator: true,
        campaign_summary: 'research campaign active; idle_streak=0',
      });
      predicted = result.failed ? '__failed__' : result.intent;
      if (result.failed) {
        stats.failed += 1;
        stats.by_intent[row.intent].failed += 1;
      }
    }

    const ok = predicted === row.intent;
    if (ok) {
      stats.correct += 1;
      stats.by_intent[row.intent].correct += 1;
    } else {
      stats.misses.push({
        id: row.id,
        text: row.text,
        expected: row.intent,
        predicted,
        tags: row.tags,
      });
    }

    if (
      (row.intent === 'musing' || row.intent === 'status_question')
      && predicted === 'work_order'
    ) {
      stats.false_work_on_musing_status += 1;
    }
  }

  const accuracy = stats.total ? stats.correct / stats.total : 0;
  const report = {
    mode: offline ? 'offline_floor' : 'understand_llm',
    total: stats.total,
    correct: stats.correct,
    accuracy,
    failed_calls: stats.failed,
    false_work_on_musing_status: stats.false_work_on_musing_status,
    by_intent: Object.fromEntries(
      Object.entries(stats.by_intent).map(([k, v]) => [k, {
        n: v.n,
        correct: v.correct,
        accuracy: v.n ? v.correct / v.n : 0,
        failed: v.failed,
      }]),
    ),
    miss_count: stats.misses.length,
    misses_sample: stats.misses.slice(0, 40),
  };

  const reportPath = path.join(OUT_DIR, offline ? 'eval-offline.json' : 'eval-llm.json');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  // Gate hints (enforced for LLM mode when not limited)
  if (!offline && !limit) {
    if (stats.false_work_on_musing_status > 0) {
      console.error('GATE FAIL: false work_order on musing/status > 0');
      process.exit(2);
    }
    for (const [intent, v] of Object.entries(stats.by_intent)) {
      if (v.n >= 20 && v.correct / v.n < 0.85) {
        console.error(`GATE WARN: ${intent} accuracy ${(v.correct / v.n).toFixed(3)} < 0.85`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
