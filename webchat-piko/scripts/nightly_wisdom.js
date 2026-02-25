#!/usr/bin/env node
/**
 * Nightly wisdom distillation: corpus + today's truth state → 1–3 new wisdom statements.
 * Run at 2AM via cron or POST /api/wisdom/run-nightly. Appends to data/truth/wisdom_cache.json.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadCorpus } = require('../lib/corpus');
const { getRecentClaims, getRecentCorrections, getWisdomCache, setWisdomCache, nextWisdomId } = require('../lib/truth');
const { ai } = require('../lib/llm');

async function runNightlyWisdom() {
  const corpus = loadCorpus();
  const summary = corpus.index.summary || corpus.index.core_truths?.join('. ') || '';
  const claims = getRecentClaims(10);
  const corrections = getRecentCorrections(10);
  const cache = getWisdomCache();

  const observations = [
    claims.length ? `Recent claims: ${claims.map((c) => c.text).join(' | ').slice(0, 800)}` : '',
    corrections.length ? `Recent corrections: ${corrections.map((r) => r.correction).join(' | ').slice(0, 800)}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `PIKO NIGHTLY WISDOM DISTILLATION

Fixed corpus (bedrock truth):
${summary.slice(0, 2000)}

Today's observations (claims and primary-human corrections):
${observations || '(none)'}

TASK: Extract 1–3 new wisdom statements that:
1. Build on the corpus (do not contradict it)
2. Help the primary human navigate life better
3. Reflect reality and compounding

Output exactly one statement per line, each line starting with "WISDOM: " (e.g. "WISDOM: Clarity precedes agency."). No other text. Max 3 lines.`;

  try {
    const reply = (await ai(prompt, { max_tokens: 300, temperature: 0.4 })).trim();
    const lines = reply.split('\n').filter((l) => /^\s*WISDOM:\s*/i.test(l));
    const newWisdom = lines.slice(0, 3).map((l) => l.replace(/^\s*WISDOM:\s*/i, '').trim()).filter(Boolean);

    const cache = getWisdomCache();
    const base = [...(cache.wisdom || [])];
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const newEntries = [];
    for (const text of newWisdom) {
      const id = nextWisdomId({ wisdom: [...base, ...newEntries] });
      newEntries.push({ id, text, distilled: today, confirmed: 0, status: 'active', created_at: now });
    }
    setWisdomCache([...base, ...newEntries], today);
    const updated = getWisdomCache();
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && newWisdom.length) {
      const https = require('https');
      const body = JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `Nightly wisdom distillation complete.\nNew wisdom (${newWisdom.length}): ${newWisdom.slice(0, 2).join('; ')}${newWisdom.length > 2 ? '; …' : ''}\nReady to serve you today.`,
      });
      const u = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`);
      await new Promise((resolve, reject) => {
        const req = https.request(
          { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }
    return { ok: true, newWisdom, last_distilled: updated.last_distilled };
  } catch (e) {
    if (process.env.LITELLM_LOG) console.error('[nightly_wisdom]', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) {
  runNightlyWisdom()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = r.ok ? 0 : 1;
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}

module.exports = { runNightlyWisdom };
