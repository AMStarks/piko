/**
 * Piko Configuration Manager — persistent JSON for operational parameters.
 * Used by proactiveThinker, fridayCloser, system.settings.update tool, and dashboard.
 */
const fs = require('fs');
const path = require('path');

function getDataDir() {
  return process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function getConfigPath() {
  return path.join(getDataDir(), 'piko_config.json');
}

const DEFAULTS = {
  proactiveIntervalHours: 6,
  proactiveUpdatesEnabled: true,
  nightlyQuantEnabled: true,
  poGenerateDay: 'Friday',
  poGenerateHour: 16,
  salesCachePath: '',
};

const BOOLEAN_KEYS = new Set(['proactiveUpdatesEnabled', 'nightlyQuantEnabled']);
const NUMERIC_KEYS = new Set(['proactiveIntervalHours', 'poGenerateHour']);

function getConfig() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(DEFAULTS, null, 2));
      return { ...DEFAULTS };
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (e) {
    console.error('[CONFIG] Error reading config:', e.message);
    return { ...DEFAULTS };
  }
}

function coerceValue(key, value) {
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function updateConfig(key, value) {
  const config = getConfig();
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    return `Error: Configuration key '${key}' does not exist. Valid keys are: ${Object.keys(DEFAULTS).join(', ')}`;
  }
  config[key] = coerceValue(key, value);
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return `Successfully updated ${key} to ${config[key]}.`;
}

function getConfigForDashboard() {
  const config = getConfig();
  const feedPath = require('./notificationFeed').getFeedPath();
  const fsExists = fs.existsSync(feedPath);
  return {
    ...config,
    configKeys: Object.keys(DEFAULTS),
    salesCacheResolved: resolveSalesCachePath(config),
    notificationFeedEntries: fsExists ? fs.readFileSync(feedPath, 'utf8').trim().split('\n').filter(Boolean).length : 0,
  };
}

function resolveSalesCachePath(config) {
  const cfg = config || getConfig();
  const candidate = String(cfg.salesCachePath || process.env.PIKO_SALES_CACHE_PATH || '').trim();
  if (candidate) return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  const candidates = [
    path.join(getDataDir(), 'sales_cache.sqlite'),
    path.join(__dirname, '../../ausmakersupplies-src/data/sales_cache.sqlite'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

module.exports = {
  getConfig,
  updateConfig,
  getConfigForDashboard,
  resolveSalesCachePath,
  DEFAULTS,
};
