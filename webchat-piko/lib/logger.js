/**
 * Structured logging via pino (P2.4a). JSON lines to logs/ by default.
 */
const path = require('path');
const fs = require('fs');
const pino = require('pino');

function defaultLogPath() {
  if (process.env.PIKO_LOG_PATH) return process.env.PIKO_LOG_PATH;
  const dataDir = String(process.env.PIKO_DATA_DIR || '').trim();
  if (dataDir) return path.join(dataDir, 'logs', 'piko.jsonl');
  return path.join(__dirname, '..', 'logs', 'piko.jsonl');
}

const logPath = defaultLogPath();
let dest = process.stdout;
// Under node --test / npm test, keep stdout to avoid sonic-boom exit flush races.
const underTest = process.env.NODE_TEST === '1'
  || process.env.npm_lifecycle_event === 'test'
  || process.env.PIKO_LOG_STDOUT === '1';
if (!underTest) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    dest = pino.destination({ dest: logPath, sync: true, mkdir: true });
  } catch (_) {
    dest = process.stdout;
  }
}

const logger = pino(
  {
    level: process.env.PIKO_LOG_LEVEL || 'info',
    base: null,
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  dest,
);

function child(requestId) {
  if (!requestId) return logger;
  return logger.child({ requestId });
}

function log(level, msg, meta = {}, requestId) {
  const m = requestId ? { ...meta, requestId } : meta;
  const fn = logger[level] || logger.info;
  fn.call(logger, m, msg);
}

module.exports = {
  logger,
  child,
  log,
  defaultLogPath,
};
