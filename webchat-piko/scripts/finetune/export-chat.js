#!/usr/bin/env node
/**
 * Export Piko conversation history to JSONL for fine-tuning.
 * Reads data/conversations.db, outputs data/finetune/chat_export/conversations.jsonl
 * Format: {"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]} per turn-pair.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'conversations.db');
const OUT_DIR = path.join(DATA_DIR, 'finetune', 'chat_export');
const OUT_FILE = path.join(OUT_DIR, 'conversations.jsonl');

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[export-chat] No conversations.db, skipping');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, '', 'utf8');
    return;
  }

  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT session_id, role, content, created_at
    FROM conversation
    ORDER BY session_id, created_at
  `).all();
  db.close();

  const bySession = {};
  for (const r of rows) {
    if (!bySession[r.session_id]) bySession[r.session_id] = [];
    bySession[r.session_id].push({ role: r.role, content: (r.content || '').trim() });
  }

  const turns = [];
  for (const sessionId of Object.keys(bySession)) {
    const msgs = bySession[sessionId];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        const user = msgs[i];
        const asst = msgs[i + 1];
        if (user.content && asst.content) {
          turns.push({ messages: [{ role: 'user', content: user.content }, { role: 'assistant', content: asst.content }] });
        }
        i++;
      }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE,
    turns.map(t => JSON.stringify(t)).join('\n'),
    'utf8');

  console.log(`[export-chat] Exported ${turns.length} turns to ${OUT_FILE}`);
}

main();
