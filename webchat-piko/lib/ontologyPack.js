/**
 * P3.7a — Tenant-configurable ontology pack (thread defs + aliases only).
 *
 * Load order: PIKO_DATA_DIR/ontology.json → config/ontology/<profile>.json → null.
 * Profile from PIKO_BACKGROUND_JOBS_PROFILE or tenant background jobs inference.
 *
 * Deferred Phase 4 (do not half-wire here):
 * - agent roster (agentRegistry culture entries)
 * - understand() EI-specific few-shots
 * - opinion prompt preamble
 * - capability card text
 */
const fs = require('fs');
const path = require('path');

const { normalizeTitle } = require('./eiGoalParse');

let cachedPack = undefined;
let cachedRootDir = null;

function defaultRootDir(rootDir) {
  return rootDir || path.join(__dirname, '..');
}

function dataDirForRoot(rootDir) {
  const env = String(process.env.PIKO_DATA_DIR || '').trim();
  if (env) return env;
  return path.join(defaultRootDir(rootDir), 'data');
}

function profileForRoot(rootDir) {
  const envProfile = String(process.env.PIKO_BACKGROUND_JOBS_PROFILE || '').trim();
  if (envProfile) return envProfile;
  try {
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    return getTenantBackgroundProfile(defaultRootDir(rootDir)).profileId;
  } catch (_) {
    return 'ausmaker';
  }
}

/**
 * Minimal validation: object with threads (array or id→def map) and optional aliases map.
 */
function validatePack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let threads = raw.threads;
  if (threads == null) return null;

  let entries = [];
  if (Array.isArray(threads)) {
    entries = threads;
  } else if (typeof threads === 'object') {
    entries = Object.entries(threads).map(([id, def]) => {
      if (def && typeof def === 'object') return { id, ...def };
      return { id, label: String(def || id) };
    });
  } else {
    return null;
  }

  const normalized = [];
  for (const t of entries) {
    if (!t || typeof t !== 'object') continue;
    const id = String(t.id || '').trim().toLowerCase();
    if (!id) continue;
    normalized.push({
      id,
      label: String(t.label || id).trim() || id,
      aliases: Array.isArray(t.aliases) ? t.aliases.map((a) => String(a).trim()).filter(Boolean) : [],
    });
  }
  if (!normalized.length) return null;

  const aliases = {};
  if (raw.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases)) {
    for (const [key, value] of Object.entries(raw.aliases)) {
      const k = String(key || '').trim().toLowerCase();
      const v = String(value || '').trim().toLowerCase();
      if (k && v) aliases[k] = v;
    }
  }

  return { threads: normalized, aliases };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadPackFromDisk(rootDir) {
  const root = defaultRootDir(rootDir);
  const tenantPath = path.join(dataDirForRoot(root), 'ontology.json');
  if (fs.existsSync(tenantPath)) {
    const validated = validatePack(readJsonFile(tenantPath));
    if (validated) return validated;
  }

  const profile = profileForRoot(root);
  const profilePath = path.join(root, 'config', 'ontology', `${profile}.json`);
  if (fs.existsSync(profilePath)) {
    const validated = validatePack(readJsonFile(profilePath));
    if (validated) return validated;
  }

  return null;
}

function resetOntologyCache() {
  cachedPack = undefined;
  cachedRootDir = null;
}

/**
 * @returns {null | { threads: object[], aliases: object }}
 */
function getOntologyPack(rootDir) {
  const root = defaultRootDir(rootDir);
  if (cachedPack !== undefined && cachedRootDir === root) return cachedPack;
  cachedRootDir = root;
  cachedPack = loadPackFromDisk(root);
  return cachedPack;
}

/**
 * Thread definitions from the loaded pack, or null when no pack is available.
 */
function getThreadDefs(rootDir) {
  const pack = getOntologyPack(rootDir);
  return pack ? pack.threads : null;
}

function threadIdSet(threads) {
  return new Set((threads || []).map((t) => t.id));
}

function resolveThreadAliasFromDefs(input, threads, extraAliases) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;

  const ids = threadIdSet(threads);
  if (ids.has(raw)) return raw;

  if (extraAliases && extraAliases[raw] && ids.has(extraAliases[raw])) {
    return extraAliases[raw];
  }

  const norm = normalizeTitle(raw);
  if (!norm) return null;

  for (const t of threads) {
    if (normalizeTitle(t.id) === norm) return t.id;
    for (const a of t.aliases) {
      if (normalizeTitle(a) === norm) return t.id;
    }
  }
  return null;
}

/**
 * Resolve alias/id using the loaded ontology pack only.
 * Returns null when no pack is loaded or the alias is unknown.
 */
function resolveThreadAlias(alias, rootDir) {
  const pack = getOntologyPack(rootDir);
  if (!pack) return null;
  return resolveThreadAliasFromDefs(alias, pack.threads, pack.aliases);
}

module.exports = {
  getOntologyPack,
  getThreadDefs,
  resolveThreadAlias,
  resolveThreadAliasFromDefs,
  resetOntologyCache,
  validatePack,
};
