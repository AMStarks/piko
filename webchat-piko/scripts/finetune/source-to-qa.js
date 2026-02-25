#!/usr/bin/env node
/**
 * Convert chunks to Q&A via Grok. Reads data/finetune/chunks/*.json,
 * calls Grok to generate instruction/response pairs, writes to data/finetune/synthetic/.
 * Requires GROK_API_KEY.
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const ROOT = path.join(__dirname, '../..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const CHUNKS_DIR = path.join(DATA_DIR, 'finetune', 'chunks');
const SYNTHETIC_DIR = path.join(DATA_DIR, 'finetune', 'synthetic');
const PENDING_DIR = path.join(DATA_DIR, 'finetune', 'pending_review');

const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
const GROK_MODEL = process.env.GROK_MODEL || 'grok-4-fast-non-reasoning';
const GROK_URL = process.env.GROK_URL || 'https://api.x.ai/v1/chat/completions';

const SYSTEM_PROMPT = `You are creating training data for Piko, an AI companion. Piko is:
- Reformed Protestant Evangelical (Sola Scriptura, sovereign grace, justification by faith)
- Dry British humor; concise; matter-of-fact; no meta-commentary
- Anti-woke; rejects Islam (different God, Jesus, salvation)
- Pragmatic, resourceful

Given a source text chunk, generate 3-5 instruction/response pairs. Each:
- instruction: natural user question or prompt this source could inform
- response: Piko's reply in his voice, drawing on the source. Concise. No fluff.

Output JSONL: one object per line. Format: {"instruction":"...","response":"..."}
No other text. Only valid JSON lines.`;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ollamaChat(messages) {
  const { ai } = require('../../lib/llm');
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const text = await ai(messages, { model: `ollama/${model}`, temperature: 0.3, max_tokens: 4000 });
  return text;
}

async function grokChat(messages) {
  if (GROK_API_KEY && GROK_API_KEY.trim()) {
  const u = new URL(GROK_URL);
  const body = JSON.stringify({
    model: GROK_MODEL,
    messages,
    stream: false,
    max_tokens: 4000,
    temperature: 0.3,
  });
  const opts = {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROK_API_KEY.trim(),
      'Content-Length': Buffer.byteLength(body),
    },
  };
  const { statusCode, data } = await httpsRequest(opts, body);
  const json = JSON.parse(data);
  const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  if (statusCode !== 200) {
    throw new Error(`Grok ${statusCode}: ${content || data}`);
  }
  return content.trim();
  }
  return ollamaChat(messages);
}

function parseJsonl(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const pairs = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.instruction && obj.response) {
        pairs.push({ instruction: obj.instruction, response: obj.response });
      }
    } catch (_) {}
  }
  return pairs;
}

async function main() {
  console.log(`[source-to-qa] Using ${(GROK_API_KEY && GROK_API_KEY.trim()) ? 'Grok' : 'Ollama'} for conversion`);

  fs.mkdirSync(SYNTHETIC_DIR, { recursive: true });
  fs.mkdirSync(PENDING_DIR, { recursive: true });

  const outApproved = path.join(SYNTHETIC_DIR, 'synthetic_approved.jsonl');
  const outPending = path.join(PENDING_DIR, 'synthetic_theology_islam.jsonl');

  // When FINETUNE_NEW_CATEGORIES_ONLY=1, skip theology and preserve existing pending
  const newCategoriesOnly = process.env.FINETUNE_NEW_CATEGORIES_ONLY === '1';
  const newCategories = ['islam', 'antwoke', 'pragmatism', 'humor', 'coding-pm', 'catholic-orthodox'];

  if (newCategoriesOnly) {
    const existingPending = fs.existsSync(outPending) ? fs.readFileSync(outPending, 'utf8') : '';
    // Will append new islam to existing; overwrite approved
    fs.writeFileSync(outApproved, '', 'utf8');
    fs.writeFileSync(outPending, existingPending, 'utf8');
    console.log(`[source-to-qa] New categories only: preserving ${existingPending.split('\n').filter(Boolean).length} existing pending pairs`);
  } else {
    fs.writeFileSync(outApproved, '', 'utf8');
    fs.writeFileSync(outPending, '', 'utf8');
  }

  const files = fs.readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.json'));
  let toProcess = files;
  if (newCategoriesOnly) {
    toProcess = files.filter(f => {
      const cat = (f.match(/^([^_]+)_/) || [])[1] || '';
      return newCategories.includes(cat);
    });
    console.log(`[source-to-qa] Processing ${toProcess.length} chunks from new categories (skip theology)`);
  }
  const LIMIT = parseInt(process.env.FINETUNE_CHUNK_LIMIT || '0', 10) || toProcess.length;
  toProcess = toProcess.slice(0, LIMIT);
  const BATCH_DELAY_MS = 1500;
  const needsReview = ['theology', 'islam'];
  let totalApproved = 0;
  let totalPending = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const f = toProcess[i];
    const fp = path.join(CHUNKS_DIR, f);
    const chunk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const cat = chunk.category || 'unknown';

    const userContent = `Source: ${chunk.source} (${cat})\n\nChunk:\n${chunk.text.slice(0, 6000)}`;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    try {
      const raw = await grokChat(messages);
      const pairs = parseJsonl(raw).map(p => ({ ...p, source: f, category: cat }));
      for (const p of pairs) {
        const line = JSON.stringify(needsReview.includes(cat)
          ? { instruction: p.instruction, response: p.response, source: p.source }
          : { instruction: p.instruction, response: p.response, category: p.category }) + '\n';
        if (needsReview.includes(cat)) {
          fs.appendFileSync(outPending, line, 'utf8');
          totalPending++;
        } else {
          fs.appendFileSync(outApproved, line, 'utf8');
          totalApproved++;
        }
      }
      process.stdout.write(`[${i + 1}/${toProcess.length}] ${f} → ${pairs.length} pairs\n`);
    } catch (e) {
      console.error(`[source-to-qa] ${f}: ${e.message}`);
    }

    if (i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`[source-to-qa] Done. Approved: ${totalApproved} → ${outApproved}`);
  console.log(`[source-to-qa] Pending review (theology/islam): ${totalPending} → ${outPending}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
