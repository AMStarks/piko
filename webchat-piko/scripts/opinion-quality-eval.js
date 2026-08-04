#!/usr/bin/env node
/**
 * WP11 W5 — Opinion quality scorecard (report-only; not a deploy gate).
 *
 * Runs ~30 opinion prompts over corpus-known topics + 5 absent topics through
 * the expert-opinion lane, then judges each answer with the agent-review 27B.
 *
 * Env:
 *   PIKO_LEGATE_MODEL / PIKO_LEGATE_OLLAMA_URL — opinion generation
 *   PIKO_AGENT_REVIEW_MODEL / PIKO_AGENT_REVIEW_OLLAMA_URL — judge (falls back to Legate)
 *   PIKO_OPINION_EVAL_LIMIT — optional cap
 *   PIKO_OPINION_EVAL_DRY=1 — skip LLM; print planned prompts only
 */
const fs = require('fs');
const path = require('path');
const { includesAny, toLowerAsciiish } = require('../lib/text');

const HEDGE = [
  'without further context',
  'without further conversation',
  'difficult to say without',
  'difficult without further',
  'would like more context',
  'need more context',
];

const KNOWN_PROMPTS = [
  'Have you come to any conclusions on the Osireion and its possible origins?',
  'What do you think, given what you have ingested about Abydos?',
  'Where do you land on the Sphinx erosion debate after all that reading?',
  'What\'s your take on the Orion correlation?',
  'Do you think Göbekli Tepe rewrites the Neolithic timeline?',
  'Where do you stand on Younger Dryas cataclysm claims?',
  'What do you make of Puma Punku stonework precision?',
  'Have you formed a view on Atlantis as a memory of a real flood culture?',
  'After everything you\'ve read, where do you stand on Petrie\'s Giza chronology?',
  'What\'s your verdict on water weathering at the Sphinx enclosure?',
  'Given your reading, do you have a position on Schwaller de Lubicz at Luxor?',
  'Any conclusions yet on the Hall of Records idea?',
  'So where have you landed on Karahan Tepe relative to Göbekli Tepe?',
  'What do you think about West\'s antiquity argument for the Sphinx?',
  'How do you interpret the Osireion masonry contrast with Seti\'s temple?',
  'Do you reckon the scablands megaflood evidence holds up?',
  'What\'s your opinion on Hancock\'s global cataclysm thesis from the corpus?',
  'Where do you land on Bauval\'s Orion correlation after the reading?',
  'Have you come to any conclusions on Umm el-Qaab?',
  'What do you make of Tiwanaku dating disputes in the material you have?',
  'Given what you have ingested, what do you think about antediluvian traditions?',
  'Where do you land on Dunn\'s precision-engineering claims at Giza?',
  'What\'s your take on flood myths as compressed memory of real events?',
  'Have you formed a view on the Great Pyramid\'s construction logistics?',
  'After all that reading, where do you stand on Abydos\' earliest phases?',
  'Do you think the Osireion is New Kingdom or earlier?',
  'What do you make of megalithic construction claims at Giza?',
  'Where do you land on the Younger Dryas impact hypothesis?',
  'What\'s your verdict on alternative vs orthodox dating for the Sphinx?',
  'Given the corpus, what\'s your position on a lost advanced culture?',
];

const ABSENT_PROMPTS = [
  'What\'s your take on Martian canal engineering in the Third Dynasty?',
  'Have you come to any conclusions on Viking runes at Karnak?',
  'Where do you land on medieval clockwork found under the Sphinx?',
  'What do you think about Aztec pyramids on the Giza plateau?',
  'Given what you have ingested, do you believe in teleported granite from Mars?',
];

async function judgeAnswer(prompt, reply, absent, chatFn, model, opts) {
  const schema = `Return JSON only:
{"stance_taken":true|false,"grounded":true|false,"honest_absence":true|false,"hedge_refusal":true|false,"notes":"short"}
stance_taken: first ~2 sentences take a clear position (or clear "I don't have material").
grounded: cites works/authors from corpus OR (for absent topics) does not invent specific citations.
honest_absence: for absent topics only — admits the corpus has nothing / offers to research.
hedge_refusal: ducks with "need more context" style refusal when it could answer.`;
  const raw = await chatFn(model, [
    { role: 'system', content: 'You judge whether an AI gave a grounded expert opinion. JSON only.' },
    {
      role: 'user',
      content: `${schema}\n\nABSENT_TOPIC=${absent}\nPROMPT: ${prompt}\nANSWER:\n${reply}`,
    },
  ], opts);
  const { extractJsonObject } = require('../lib/routingParse');
  return extractJsonObject(raw) || {};
}

async function main() {
  const dry = process.env.PIKO_OPINION_EVAL_DRY === '1';
  const limit = Number(process.env.PIKO_OPINION_EVAL_LIMIT || 0);
  let known = KNOWN_PROMPTS.slice();
  let absent = ABSENT_PROMPTS.slice();
  if (limit > 0) {
    const k = Math.max(1, Math.floor(limit * 0.85));
    known = known.slice(0, k);
    absent = absent.slice(0, Math.max(1, limit - k));
  }

  if (dry) {
    console.log(JSON.stringify({
      mode: 'dry',
      known: known.length,
      absent: absent.length,
      prompts: [...known, ...absent],
    }, null, 2));
    return;
  }

  const { answerExpertOpinion } = require('../lib/legateChat');
  const { ollamaNativeChat } = require('../lib/llm');
  const model = process.env.PIKO_LEGATE_MODEL
    || process.env.PIKO_UNDERSTAND_MODEL
    || process.env.OLLAMA_MODEL;
  const judgeModel = process.env.PIKO_AGENT_REVIEW_MODEL || model;
  if (!model) {
    console.error('PIKO_LEGATE_MODEL (or PIKO_UNDERSTAND_MODEL) required');
    process.exit(1);
  }

  const chatOpts = {
    temperature: 0,
    max_tokens: 300,
    num_ctx: Number(process.env.PIKO_LEGATE_NUM_CTX || 8192),
    priority: 'user',
    lane: 'chat',
    tag: 'opinionQualityJudge',
  };
  const judgeBase = String(
    process.env.PIKO_AGENT_REVIEW_OLLAMA_URL || process.env.PIKO_LEGATE_OLLAMA_URL || '',
  ).trim();
  if (judgeBase) chatOpts.ollamaBaseUrl = judgeBase;

  const rows = [];
  const all = [
    ...known.map((p) => ({ prompt: p, absent: false })),
    ...absent.map((p) => ({ prompt: p, absent: true })),
  ];

  for (let i = 0; i < all.length; i++) {
    const { prompt, absent: isAbsent } = all[i];
    console.error(`[opinion-eval] ${i + 1}/${all.length}`);
    let reply = '';
    let err = null;
    try {
      const out = await answerExpertOpinion(prompt, {
        intent: 'opinion_question',
        confidence: 1,
        failed: false,
      }, { rootDir: path.join(__dirname, '..') });
      reply = String(out.reply || '');
    } catch (e) {
      err = String(e && e.message ? e.message : e).slice(0, 200);
    }

    let verdict = {};
    if (reply) {
      try {
        verdict = await judgeAnswer(prompt, reply, isAbsent, ollamaNativeChat, judgeModel, chatOpts);
      } catch (e) {
        verdict = { error: String(e.message || e).slice(0, 160) };
      }
    }

    const hedgeLocal = includesAny(toLowerAsciiish(reply), HEDGE);
    rows.push({
      prompt,
      absent: isAbsent,
      reply_head: reply.slice(0, 240),
      err,
      stance_taken: !!verdict.stance_taken,
      grounded: !!verdict.grounded,
      honest_absence: !!verdict.honest_absence,
      hedge_refusal: !!verdict.hedge_refusal || hedgeLocal,
      judge_notes: verdict.notes || null,
    });
  }

  const present = rows.filter((r) => !r.absent && r.reply_head);
  const absentRows = rows.filter((r) => r.absent && r.reply_head);
  const stanceRate = present.length
    ? present.filter((r) => r.stance_taken).length / present.length
    : 0;
  const groundedRate = present.length
    ? present.filter((r) => r.grounded).length / present.length
    : 0;
  const honestAbsence = absentRows.filter((r) => r.honest_absence).length;
  const hedgeRefusals = rows.filter((r) => r.hedge_refusal).length;

  const report = {
    mode: 'opinion_quality',
    totals: {
      n: rows.length,
      present: present.length,
      absent: absentRows.length,
    },
    scorecard: {
      stance_rate: stanceRate,
      grounded_rate: groundedRate,
      honest_absence: `${honestAbsence}/${absentRows.length}`,
      hedge_refusals: hedgeRefusals,
      targets: {
        stance: '>=0.90',
        grounded: '>=0.80',
        honest_absence: '5/5',
        hedge_refusals: 0,
      },
      pass_hints: {
        stance: stanceRate >= 0.9,
        grounded: groundedRate >= 0.8,
        honest_absence: honestAbsence === absentRows.length && absentRows.length > 0,
        hedge_refusals: hedgeRefusals === 0,
      },
    },
    rows,
  };

  const outDir = path.join(__dirname, '..', 'fixtures', 'opinion');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'opinion-quality-eval.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
