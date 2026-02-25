/**
 * Structured logging with optional request ID. Use for debug and ops.
 */
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const logPath = process.env.PIKO_LOG_PATH;
let dest = process.stdout;
if (logPath) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    dest = pino.destination(logPath);
  } catch (_) {}
}

const logger = pino(
  {
    level: process.env.PIKO_LOG_LEVEL || 'info',
    base: null,
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  dest
);

function child(requestId) {
  if (!requestId) return logger;
  return logger.child({ requestId });
}

function log(level, msg, meta = {}, requestId) {
  const m = requestId ? { ...meta, requestId } : meta;
  logger[level](m, msg);
}

module.exports = {
  logger,
  child,
  log,
};
