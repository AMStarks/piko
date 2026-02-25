#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'conversation-eval-logs');
const SCENARIOS_PATH = process.env.PIKO_CONTINUITY_SCENARIOS || path.join(__dirname, 'continuity-scenarios.json');
const API_URL = process.env.PIKO_API_URL || 'http://localhost:3000/api/chat';
const RUNS = Math.max(1, Number(process.env.PIKO_CONTINUITY_RUNS || 3));
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.PIKO_CONTINUITY_TIMEOUT_MS || 30000));
const SCENARIO_LIMIT = Math.max(0, Number(process.env.PIKO_CONTINUITY_SCENARIO_LIMIT || 0));

const BLEED_PATTERN = /rainy days?|rainy mornings?|spark(ing)? ideas?|cozy|forging your own path|break free|grand visions|molds|authenticity|truth block|corpus|jot down|regrouping|clear the mind|sort thoughts|how are things shaping up|anything new on that front/i;
const RESET_PATTERN = /hey — what's up|how can i assist you|i'm here to help|ready to help/i;
const STILTED_PATTERN = /morning mate|g'?day\s*[—-]\s*you|that settles it|same old|anything new(?:\s+on that front|\s+brewing)?|how's it rolling/i;
const INVITE_PATTERN = /want to (chat|talk|have a chat)|up for a chat|feel like chatting|chat for a while|shoot the breeze|hang out|what about you|how about you|how about yourself/i;
const GREETING_PATTERN = /^(hi|hey|hello|g'?day|morning|yo)\b/i;
const SIGNOFF_PATTERN = /^(thanks|catch you|talk soon|cheers|bye|see you)\b/i;

function requestJson(urlStr, payload) {
  const u = new URL(urlStr);
  const lib = u.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  const options = {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + (u.search || ''),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: REQUEST_TIMEOUT_MS,
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', (ch) => (raw += ch));
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode, body: parsed, raw });
        } catch (e) {
          reject(new Error(`Invalid JSON response (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean);
}

function scoreReply({ reply, userTurn, previousReply, expectedMode }) {
  const text = String(reply || '').trim();
  const w = words(text);
  const sentenceCount = text.split(/[.!?]+/).filter((x) => x.trim()).length || 1;

  // 0..5 each
  let continuity = 5;
  let naturalness = 5;
  let noBleed = 5;
  let noReset = 5;
  let modeFit = 5;

  if (!text) {
    return { continuity: 0, naturalness: 0, noBleed: 0, noReset: 0, modeFit: 0 };
  }
  if (previousReply && text.toLowerCase() === previousReply.toLowerCase()) continuity = 1;
  if (RESET_PATTERN.test(text)) noReset = 0;
  if (BLEED_PATTERN.test(text)) noBleed = 0;
  if (STILTED_PATTERN.test(text)) naturalness = Math.min(naturalness, 2);
  if (w.length <= 2) naturalness = Math.min(naturalness, 2);
  if (new Set(w.map((x) => x.toLowerCase())).size / Math.max(1, w.length) < 0.55) naturalness = Math.min(naturalness, 2);

  const lowerTurn = String(userTurn || '').toLowerCase();
  if (/want to chat|chat for a while|what about you|how about yourself|how about you/.test(lowerTurn)) {
    if (!/\?|same here|you|what|sure|happy|for sure|yeah/i.test(text)) continuity = Math.min(continuity, 2);
  }

  if (expectedMode === 'SOCIAL_CHAT') {
    if (sentenceCount > 2 || w.length > 35) modeFit = Math.min(modeFit, 2);
    if (BLEED_PATTERN.test(text)) modeFit = 0;
  } else if (expectedMode === 'RECIPROCITY') {
    if (w.length > 18) modeFit = Math.min(modeFit, 2);
    if (!/(you|same here|not bad|pretty good|doing|all good)/i.test(text)) modeFit = Math.min(modeFit, 2);
  } else if (expectedMode === 'SOCIAL_EMPATHY') {
    if (!/(sorry|rough|hear you|sounds|tough|okay|ok|with you)/i.test(text)) modeFit = Math.min(modeFit, 2);
  } else if (expectedMode === 'LIGHT_OPINION') {
    if (w.length > 24) modeFit = Math.min(modeFit, 2);
  } else if (expectedMode === 'SIGN_OFF_REENGAGE') {
    // Last turn should behave like greeting/re-engage, not a stale sign-off.
    if (/catch you|talk soon|later/.test(text.toLowerCase())) modeFit = Math.min(modeFit, 1);
  }

  return { continuity, naturalness, noBleed, noReset, modeFit };
}

function guessRoute(userTurn, expectedMode) {
  const t = String(userTurn || '').trim().toLowerCase();
  if (expectedMode === 'SOCIAL_CHAT') return 'socialChat';
  if (INVITE_PATTERN.test(t)) return 'socialChat';
  if (SIGNOFF_PATTERN.test(t)) return 'casual';
  if (GREETING_PATTERN.test(t)) return 'casual';
  return 'full';
}

function detectDiagnostics(userTurn, reply) {
  const text = String(reply || '').trim();
  return {
    reset_trigger: RESET_PATTERN.test(text),
    bleed_trigger: BLEED_PATTERN.test(text),
    stilted_trigger: STILTED_PATTERN.test(text),
    likely_template_fallback: /good to hear from you|same here|what's on your mind|talk about|no worries — catch you soon|all good — see you/i.test(text),
    guessed_route: guessRoute(userTurn),
  };
}

function normalizeWeightConfig(parsed) {
  const schema = (parsed && parsed.scoring_schema) || {};
  const criteria = Array.isArray(schema.criteria) ? schema.criteria : [];
  const weights = {
    continuity: 1.0,
    naturalness: 1.0,
    noBleed: 1.0,
    noReset: 1.0,
    modeFit: 0.8,
  };
  for (const c of criteria) {
    const name = String(c.name || '').trim();
    const weight = Number(c.weight);
    if (!Number.isFinite(weight)) continue;
    if (name === 'continuity') weights.continuity = weight;
    if (name === 'naturalness') weights.naturalness = weight;
    if (name === 'no_bleed' || name === 'noBleed') weights.noBleed = weight;
    if (name === 'no_reset' || name === 'noReset') weights.noReset = weight;
    if (name === 'mode_fit' || name === 'modeFit') weights.modeFit = weight;
  }
  return {
    weights,
    scenarioPassThreshold: Number.isFinite(Number(schema.scenario_pass_threshold)) ? Number(schema.scenario_pass_threshold) : 4.0,
    overallPassThreshold: Number.isFinite(Number(schema.overall_pass_threshold)) ? Number(schema.overall_pass_threshold) : 0.8,
  };
}

function weightedTotal(runScores, weights) {
  const denom = weights.continuity + weights.naturalness + weights.noBleed + weights.noReset + weights.modeFit;
  if (!denom) return 0;
  return (
    runScores.continuity * weights.continuity +
    runScores.naturalness * weights.naturalness +
    runScores.noBleed * weights.noBleed +
    runScores.noReset * weights.noReset +
    runScores.modeFit * weights.modeFit
  ) / denom;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function run() {
  if (!fs.existsSync(SCENARIOS_PATH)) {
    throw new Error(`Scenario file not found: ${SCENARIOS_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf8'));
  const scoring = normalizeWeightConfig(parsed);
  const scenarios = parsed.scenarios || [];
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('No scenarios found');
  const activeScenarios = SCENARIO_LIMIT > 0 ? scenarios.slice(0, SCENARIO_LIMIT) : scenarios;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const runTs = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    runsPerScenario: RUNS,
    scenarioFile: SCENARIOS_PATH,
    scoring,
    results: [],
  };

  for (const scenario of activeScenarios) {
    const scenarioResult = {
      id: scenario.id,
      name: scenario.name || scenario.id,
      tags: Array.isArray(scenario.tags) ? scenario.tags : [],
      expected_mode: scenario.expected_mode,
      criteria: scenario.criteria || null,
      runs: [],
    };
    for (let r = 0; r < RUNS; r += 1) {
      const sessionId = `continuity-${scenario.id}-${Date.now()}-${r}`;
      const turns = [];
      let previousReply = '';
      for (let t = 0; t < scenario.turns.length; t += 1) {
        const userTurn = scenario.turns[t];
        const payload = { message: userTurn, sessionId, stream: false };
        let res;
        let reply = '';
        let rawResponse = '';
        let statusCode = 0;
        try {
          res = await requestJson(API_URL, payload);
          reply = res.body.reply || res.body.error || '';
          rawResponse = res.raw || '';
          statusCode = res.status || 0;
        } catch (e) {
          reply = `__ERROR__: ${e.message}`;
          rawResponse = String(e.message || '');
          statusCode = 0;
        }
        const scores = scoreReply({
          reply,
          userTurn,
          previousReply,
          expectedMode: scenario.expected_mode,
        });
        turns.push({
          turn: t + 1,
          user: userTurn,
          assistant: reply,
          raw_response: rawResponse,
          status: statusCode,
          scores,
          diagnostics: detectDiagnostics(userTurn, reply, scenario.expected_mode),
        });
        previousReply = reply;
      }
      const allScores = turns.map((x) => x.scores);
      const runScores = {
        continuity: avg(allScores.map((s) => s.continuity)),
        naturalness: avg(allScores.map((s) => s.naturalness)),
        noBleed: avg(allScores.map((s) => s.noBleed)),
        noReset: avg(allScores.map((s) => s.noReset)),
        modeFit: avg(allScores.map((s) => s.modeFit)),
      };
      const total = weightedTotal(runScores, scoring.weights);
      scenarioResult.runs.push({ sessionId, turns, runScores, total });
    }
    const totals = scenarioResult.runs.map((r) => r.total);
    scenarioResult.avgTotal = avg(totals);
    scenarioResult.pass = scenarioResult.avgTotal >= scoring.scenarioPassThreshold;
    summary.results.push(scenarioResult);
  }

  summary.global = {
    scenarioCount: summary.results.length,
    passCount: summary.results.filter((r) => r.pass).length,
    passRate: summary.results.filter((r) => r.pass).length / Math.max(1, summary.results.length),
    avgTotal: avg(summary.results.map((r) => r.avgTotal)),
    overallPassThreshold: scoring.overallPassThreshold,
    releaseGatePass: (summary.results.filter((r) => r.pass).length / Math.max(1, summary.results.length)) >= scoring.overallPassThreshold,
  };

  const outPath = path.join(DATA_DIR, `continuity-eval-${runTs}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Continuity eval complete.`);
  console.log(`Scenarios: ${summary.global.scenarioCount}`);
  console.log(`Pass: ${summary.global.passCount}/${summary.global.scenarioCount} (${(summary.global.passRate * 100).toFixed(1)}%)`);
  console.log(`Average score (0-5): ${summary.global.avgTotal.toFixed(2)}`);
  console.log(`Output: ${outPath}`);
}

run().catch((e) => {
  console.error('continuity-eval failed:', e.message);
  process.exit(1);
});

