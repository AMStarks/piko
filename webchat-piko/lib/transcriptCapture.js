/**
 * Transcript capture — append chat turns to monthly JSONL files for a future
 * persona fine-tune. Captures the POLISHED operator-facing text (that is the
 * voice we want to teach), one event per line:
 *   {"ts","tenant","session","role","content"}
 *
 * Files: <DATA_DIR>/finetune/transcripts-YYYYMM.jsonl (picked up by the
 * nightly cross-host backup automatically).
 *
 * Opt out: PIKO_TRANSCRIPT_CAPTURE=off
 */
const fs = require('fs');
const path = require('path');

function captureDir() {
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'finetune');
}

function captureTurn(sessionId, role, content) {
  if (process.env.PIKO_TRANSCRIPT_CAPTURE === 'off') return false;
  if (role !== 'user' && role !== 'assistant') return false;
  const text = String(content || '').trim();
  if (!text) return false;
  try {
    const dir = captureDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `transcripts-${new Date().toISOString().slice(0, 7).replace('-', '')}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tenant: process.env.PIKO_TENANT_ID || process.env.PIKO_CUSTOMER_ID || 'default',
      session: String(sessionId || 'unknown'),
      role,
      content: text.slice(0, 20000),
    });
    fs.appendFile(file, line + '\n', () => {});
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { captureTurn, captureDir };
