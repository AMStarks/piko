const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = {
  maxEvents: 500,
  maxHistory: 500,
  maxDeliveries: 1000,
  maxDeadLetters: 1000,
};

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createProactiveStore(dataDir, limits) {
  const cfg = { ...DEFAULT_LIMITS, ...(limits || {}) };
  const files = {
    events: path.join(dataDir, 'proactive-events.json'),
    runtime: path.join(dataDir, 'proactive-runtime.json'),
    deliveries: path.join(dataDir, 'proactive-deliveries.json'),
    deadLetters: path.join(dataDir, 'proactive-dead-letters.json'),
  };

  function loadRuntime() {
    const fallback = {
      deliveries: [],
      keyHistory: [],
      ackHistory: [],
      escalation: {},
      lastRunAt: null,
      lastSummary: null,
    };
    const parsed = readJson(files.runtime, fallback);
    return {
      deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
      keyHistory: Array.isArray(parsed.keyHistory) ? parsed.keyHistory : [],
      ackHistory: Array.isArray(parsed.ackHistory) ? parsed.ackHistory : [],
      escalation: parsed.escalation && typeof parsed.escalation === 'object' ? parsed.escalation : {},
      lastRunAt: parsed.lastRunAt || null,
      lastSummary: parsed.lastSummary || null,
    };
  }

  function trimRuntime(runtime) {
    runtime.deliveries = (runtime.deliveries || []).slice(-cfg.maxHistory);
    runtime.keyHistory = (runtime.keyHistory || []).slice(-cfg.maxHistory);
    runtime.ackHistory = (runtime.ackHistory || []).slice(-cfg.maxHistory);
    const entries = Object.entries(runtime.escalation || {}).slice(-cfg.maxHistory);
    runtime.escalation = Object.fromEntries(entries);
  }

  function saveRuntime(runtime) {
    trimRuntime(runtime);
    writeJson(files.runtime, runtime);
  }

  function loadEvents() {
    const parsed = readJson(files.events, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function saveEvents(events) {
    writeJson(files.events, (events || []).slice(-cfg.maxEvents));
  }

  function loadDeliveries() {
    const parsed = readJson(files.deliveries, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function saveDeliveries(deliveries) {
    writeJson(files.deliveries, (deliveries || []).slice(-cfg.maxDeliveries));
  }

  function loadDeadLetters() {
    const parsed = readJson(files.deadLetters, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function saveDeadLetters(deadLetters) {
    writeJson(files.deadLetters, (deadLetters || []).slice(-cfg.maxDeadLetters));
  }

  return {
    loadRuntime,
    saveRuntime,
    trimRuntime,
    loadEvents,
    saveEvents,
    loadDeliveries,
    saveDeliveries,
    loadDeadLetters,
    saveDeadLetters,
  };
}

module.exports = {
  createProactiveStore,
};
