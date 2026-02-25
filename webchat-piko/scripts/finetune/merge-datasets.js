#!/usr/bin/env node
/**
 * Merge chat export + synthetic Q&A into train.jsonl and val.jsonl.
 * Format: Piko-aligned {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const CHAT_FILE = path.join(DATA_DIR, 'finetune', 'chat_export', 'conversations.jsonl');
const SYNTHETIC_FILE = path.join(DATA_DIR, 'finetune', 'synthetic', 'synthetic_approved.jsonl');
const CASUAL_SMALLTALK_FILE = path.join(DATA_DIR, 'finetune', 'synthetic', 'synthetic_casual_smalltalk.jsonl');
const APPROVED_DIR = path.join(DATA_DIR, 'finetune', 'approved');
const OUT_DIR = path.join(DATA_DIR, 'finetune');
const TRAIN_FILE = path.join(OUT_DIR, 'train.jsonl');
const VAL_FILE = path.join(OUT_DIR, 'val.jsonl');
const VAL_RATIO = 0.05;

const PIKO_SYSTEM_BASE = `You are Piko — a Christian AI companion: chat, support, coding when asked. Reformed Protestant, Sola Scriptura, sovereign grace. Dry British humor; concise; matter-of-fact. Anti-woke; rejects Islam (different God, Jesus, salvation). Pragmatic, resourceful.

Rules: Reply ONLY to the user's message. Never say "How can I assist you today?", "I'm here to help," or recite your role. No meta-commentary. Answer the question they asked. Reply like a person, not a support bot.`;

/** Phase 3.1: Align training prompt with inference CASUAL_SYSTEM_PROMPT. */
const CASUAL_SYSTEM_FOR_TRAINING = `You are Piko, a friendly, dry-humoured mate.

This is a casual greeting or small-talk turn.

Rules:
- Reply with ONE short, natural sentence (under 12 words).
- Match the user's tone and energy.
- NEVER repeat or echo the user's exact words back as your reply.
- If they greet you, respond with a different short greeting or acknowledgment.
- If they say how they are and ask about you, answer briefly and optionally mirror in 1–3 words.
- Vary wording naturally; do not repeat the same phrases across replies.
- No themes, reflection, suggestions, projects, growth, or past topics.
- No questions unless they explicitly invite deeper talk.`;

function buildSystemBlock(category) {
  if (category === 'casual') {
    return CASUAL_SYSTEM_FOR_TRAINING;
  }
  if (category && (category !== 'unknown')) {
    return `${PIKO_SYSTEM_BASE}\n\nCategory: ${category}. Reply in character.`;
  }
  return PIKO_SYSTEM_BASE;
}

function toPikoSample(userContent, assistantContent, category) {
  const systemContent = buildSystemBlock(category);
  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
  };
}

function loadLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function main() {
  const samples = [];

  // Chat export
  const chatLines = loadLines(CHAT_FILE);
  for (const line of chatLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.messages && Array.isArray(obj.messages) && obj.messages.length >= 2) {
        const user = obj.messages.find(m => m.role === 'user');
        const asst = obj.messages.find(m => m.role === 'assistant');
        if (user && asst && user.content && asst.content) {
          samples.push(toPikoSample(user.content, asst.content, null));
        }
      }
    } catch (_) {}
  }

  // Synthetic (instruction/response): approved (new categories) + pending (theology/islam)
  const pendingFile = path.join(DATA_DIR, 'finetune', 'pending_review', 'synthetic_theology_islam.jsonl');
  let synthLines = loadLines(SYNTHETIC_FILE);
  const pendingLines = fs.existsSync(pendingFile) ? loadLines(pendingFile) : [];
  if (synthLines.length > 0) console.log(`[merge-datasets] Approved (new categories): ${synthLines.length}`);
  if (pendingLines.length > 0) {
    synthLines = synthLines.concat(pendingLines);
    console.log(`[merge-datasets] Pending (theology/islam): ${pendingLines.length}`);
  }
  const casualLines = loadLines(CASUAL_SMALLTALK_FILE);
  let casualSamples = [];
  if (casualLines.length > 0) {
    for (const line of casualLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.instruction && obj.response) {
          casualSamples.push(toPikoSample(obj.instruction, obj.response, 'casual'));
        }
      } catch (_) {}
    }
    console.log(`[merge-datasets] Casual small-talk: ${casualSamples.length}`);
  }
  for (const line of synthLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.instruction && obj.response) {
        const cat = obj.category || (obj.source && obj.source.split('_')[0]) || null;
        if (cat === 'casual') continue; // casual handled separately with oversampling
        samples.push(toPikoSample(obj.instruction, obj.response, cat));
      }
    } catch (_) {}
  }

  // Approved (if user moved theology/islam after review)
  if (fs.existsSync(APPROVED_DIR)) {
    const approvedFiles = fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.jsonl'));
    for (const f of approvedFiles) {
      const lines = loadLines(path.join(APPROVED_DIR, f));
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.instruction && obj.response) {
            const cat = obj.category || (obj.source && obj.source.split('_')[0]) || null;
            samples.push(toPikoSample(obj.instruction, obj.response, cat));
          }
        } catch (_) {}
      }
    }
  }

  // Phase 3.1: Oversample casual to 12–15% of total
  const targetCasualRatio = 0.12;
  const nNonCasual = samples.length;
  const targetCasualCount = Math.max(casualSamples.length, Math.ceil(nNonCasual * targetCasualRatio / (1 - targetCasualRatio)));
  let oversampledCasual = [];
  for (let i = 0; i < targetCasualCount; i++) {
    oversampledCasual.push(casualSamples[i % casualSamples.length]);
  }
  samples.push(...oversampledCasual);
  if (casualSamples.length > 0) {
    console.log(`[merge-datasets] Casual oversampled: ${casualSamples.length} → ${oversampledCasual.length} (~${Math.round(100 * oversampledCasual.length / samples.length)}% of train)`);
  }

  // Shuffle and split
  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  const nVal = Math.max(1, Math.floor(samples.length * VAL_RATIO));
  const valSamples = samples.slice(0, nVal);
  const trainSamples = samples.slice(nVal);

  fs.writeFileSync(TRAIN_FILE, trainSamples.map(s => JSON.stringify(s)).join('\n'), 'utf8');
  fs.writeFileSync(VAL_FILE, valSamples.map(s => JSON.stringify(s)).join('\n'), 'utf8');

  console.log(`[merge-datasets] train: ${trainSamples.length}, val: ${valSamples.length} → ${TRAIN_FILE}`);
}

main();
