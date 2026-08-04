/**
 * P3.7 / P4.3 — Tenant-configurable ontology pack.
 *
 * Load order: PIKO_DATA_DIR/ontology.json → config/ontology/<profile>.json → null.
 * Profile from PIKO_BACKGROUND_JOBS_PROFILE or tenant background jobs inference.
 *
 * Areas (each: pack override when present, hardcoded fallback in consumers):
 * - threads + aliases
 * - agent roster (culture / pack agents)
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
  } catch (err) {
    return 'ausmaker';
  }
}

function normalizeAgentEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const out = { ...raw, id };
  if (out.label != null) out.label = String(out.label);
  if (out.runtime != null) out.runtime = String(out.runtime);
  if (out.description != null) out.description = String(out.description);
  if (out.brief_prefix != null) out.brief_prefix = String(out.brief_prefix);
  if (out.adapter_id != null) out.adapter_id = String(out.adapter_id);
  if (out.legion_capability != null) out.legion_capability = String(out.legion_capability);
  if (out.swarm_role != null) out.swarm_role = String(out.swarm_role);
  if (Array.isArray(out.profiles)) {
    out.profiles = out.profiles.map((p) => String(p || '').trim()).filter(Boolean);
  }
  if (Array.isArray(out.tenants)) {
    out.tenants = out.tenants.map((t) => String(t || '').trim()).filter(Boolean);
  }
  if (Array.isArray(out.capabilities)) {
    out.capabilities = out.capabilities.map((c) => String(c || '').trim()).filter(Boolean);
  }
  return out;
}

function normalizeFewShot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || '').trim();
  const user = String(raw.user || '').trim();
  if (!id || !user) return null;
  let assistant = raw.assistant;
  if (assistant == null && raw.output != null) assistant = raw.output;
  if (typeof assistant === 'string') {
    const trimmed = assistant.trim();
    if (!trimmed) return null;
    return { id, user, assistantJson: trimmed };
  }
  if (assistant && typeof assistant === 'object') {
    try {
      return { id, user, assistantJson: JSON.stringify(assistant) };
    } catch (err) {
      return null;
    }
  }
  return null;
}

function normalizeCapabilityCard(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? { text } : null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.text === 'string' && raw.text.trim()) {
    return { text: raw.text.trim() };
  }
  if (Array.isArray(raw.lines)) {
    const lines = raw.lines.map((l) => String(l ?? '')).filter((l) => l !== undefined);
    if (!lines.length) return null;
    return { text: lines.join('\n') };
  }
  return null;
}

/**
 * Validate pack. Threads are required (array or id→def map).
 * Optional: aliases, agents, understandFewShots, opinionPreamble, capabilityCard.
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

  let agents = null;
  if (Array.isArray(raw.agents)) {
    const list = [];
    for (const a of raw.agents) {
      const n = normalizeAgentEntry(a);
      if (n) list.push(n);
    }
    if (list.length) agents = list;
  }

  let understandFewShots = null;
  if (Array.isArray(raw.understandFewShots)) {
    const list = [];
    for (const fsEntry of raw.understandFewShots) {
      const n = normalizeFewShot(fsEntry);
      if (n) list.push(n);
    }
    if (list.length) understandFewShots = list;
  }

  let opinionPreamble = null;
  if (typeof raw.opinionPreamble === 'string' && raw.opinionPreamble.trim()) {
    opinionPreamble = raw.opinionPreamble.trim();
  }

  const capabilityCard = normalizeCapabilityCard(raw.capabilityCard);

  return {
    threads: normalized,
    aliases,
    agents,
    understandFewShots,
    opinionPreamble,
    capabilityCard,
    profile: raw.profile != null ? String(raw.profile) : null,
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
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
 * @returns {null | object}
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

/** Pack agent roster, or null when absent (consumers use hardcoded builtins). */
function getPackAgents(rootDir) {
  const pack = getOntologyPack(rootDir);
  if (!pack || !Array.isArray(pack.agents) || !pack.agents.length) return null;
  return pack.agents;
}

/** Pack understand few-shots, or null when absent. */
function getPackUnderstandFewShots(rootDir) {
  const pack = getOntologyPack(rootDir);
  if (!pack || !Array.isArray(pack.understandFewShots) || !pack.understandFewShots.length) {
    return null;
  }
  return pack.understandFewShots;
}

/** Pack opinion preamble string, or null when absent. */
function getPackOpinionPreamble(rootDir) {
  const pack = getOntologyPack(rootDir);
  if (!pack || !pack.opinionPreamble) return null;
  return pack.opinionPreamble;
}

/** Pack capability card `{ text }`, or null when absent. */
function getPackCapabilityCard(rootDir) {
  const pack = getOntologyPack(rootDir);
  if (!pack || !pack.capabilityCard || !pack.capabilityCard.text) return null;
  return pack.capabilityCard;
}

/** Replace `{{tenant}}` placeholders without regex. */
function applyTenantPlaceholder(text, tenantName) {
  const name = String(tenantName || 'this workspace');
  return String(text || '').split('{{tenant}}').join(name);
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
  getPackAgents,
  getPackUnderstandFewShots,
  getPackOpinionPreamble,
  getPackCapabilityCard,
  applyTenantPlaceholder,
  resolveThreadAlias,
  resolveThreadAliasFromDefs,
  resetOntologyCache,
  validatePack,
};
