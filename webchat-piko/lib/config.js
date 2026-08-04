/**
 * Config schema and validation at startup. Fails fast with clear message on missing/invalid env.
 */
const path = require('path');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');

function envTruthy(name) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function validate() {
  const errors = [];
  const maybeUrlVars = [
    'PIKO_PROACTIVE_WEBHOOK_URL',
    'PIKO_PROACTIVE_WEBHOOK_WHATSAPP_URL',
    'PIKO_PROACTIVE_WEBHOOK_IMESSAGE_URL',
  ];
  const port = Number(process.env.PORT);
  if (process.env.PORT != null && (isNaN(port) || port < 1 || port > 65535)) {
    errors.push('PORT must be a number 1–65535');
  }
  if (process.env.MODEL_PRIMARY !== undefined && typeof process.env.MODEL_PRIMARY !== 'string') {
    errors.push('MODEL_PRIMARY must be a string');
  }
  for (const key of maybeUrlVars) {
    const v = process.env[key];
    if (!v) continue;
    try {
      const parsed = new URL(v);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`${key} must use http or https`);
      }
    } catch (_) {
      errors.push(`${key} must be a valid URL`);
    }
  }
  // P0.6: authoritative understand/decide must pin 27B models — refuse silent 8B fallback.
  if (envTruthy('PIKO_UNDERSTAND_AUTHORITATIVE')) {
    if (!String(process.env.PIKO_UNDERSTAND_MODEL || '').trim()) {
      errors.push('PIKO_UNDERSTAND_MODEL must be set when PIKO_UNDERSTAND_AUTHORITATIVE=1');
    }
    if (!String(process.env.PIKO_LEGATE_MODEL || '').trim()) {
      errors.push('PIKO_LEGATE_MODEL must be set when PIKO_UNDERSTAND_AUTHORITATIVE=1');
    }
  }
  if (errors.length) {
    const msg = 'Config validation failed:\n' + errors.join('\n');
    throw new Error(msg);
  }
  return true;
}

function getConfig() {
  validate();
  return {
    port: Number(process.env.PORT) || 3000,
    dataDir: DATA_DIR,
    modelPrimary: process.env.MODEL_PRIMARY || process.env.OLLAMA_MODEL || 'ollama/llama3.1:latest',
  };
}

module.exports = {
  validate,
  getConfig,
};
