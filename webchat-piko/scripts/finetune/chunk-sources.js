#!/usr/bin/env node
/**
 * Chunk source texts for fine-tune Q&A conversion.
 * Reads data/finetune/sources/<category>/*.txt, splits into ~1200-token chunks (~4000 chars),
 * writes to data/finetune/chunks/<category>_<basename>_<n>.json
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../..');
const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(ROOT, 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'finetune', 'sources');
const CHUNKS_DIR = path.join(DATA_DIR, 'finetune', 'chunks');

const CHARS_PER_CHUNK = 4000; // ~1200 tokens
const OVERLAP = 500;

function chunkText(text, sourceFile, category) {
  const lines = text.split(/\n/);
  const chunks = [];
  let buf = '';
  let chunkIndex = 0;

  for (const line of lines) {
    buf += (buf ? '\n' : '') + line;
    if (buf.length >= CHARS_PER_CHUNK) {
      chunks.push({
        source: sourceFile,
        category,
        chunkIndex: chunkIndex++,
        text: buf.trim(),
      });
      // Keep overlap
      const lastNewline = buf.slice(-OVERLAP).lastIndexOf('\n');
      buf = lastNewline >= 0 ? buf.slice(-OVERLAP + lastNewline + 1) : buf.slice(-OVERLAP);
    }
  }
  if (buf.trim()) {
    chunks.push({ source: sourceFile, category, chunkIndex: chunkIndex, text: buf.trim() });
  }
  return chunks;
}

function main() {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });

  const categories = fs.readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let totalChunks = 0;
  for (const cat of categories) {
    const catDir = path.join(SOURCES_DIR, cat);
    const files = fs.readdirSync(catDir)
      .filter(f => f.endsWith('.txt') || f.endsWith('.md'));

    for (const file of files) {
      const fp = path.join(catDir, file);
      const raw = fs.readFileSync(fp, 'utf8');
      const text = raw.replace(/\r\n/g, '\n').trim();
      if (!text) continue;

      const chunks = chunkText(text, file, cat);
      const base = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_-]/g, '_');

      for (const c of chunks) {
        const outName = `${cat}_${base}_${c.chunkIndex}.json`;
        const outPath = path.join(CHUNKS_DIR, outName);
        fs.writeFileSync(outPath, JSON.stringify(c, null, 0), 'utf8');
        totalChunks++;
      }
    }
  }

  console.log(`[chunk-sources] Wrote ${totalChunks} chunks to ${CHUNKS_DIR}`);
}

main();
