/**
 * Persona packs — per-tenant identity that SURVIVES code releases.
 *
 * Release deploys rsync the code tree (including repo prompts/), so tenant
 * personality must live outside it: <DATA_DIR>/persona/ (override with
 * PIKO_PERSONA_DIR). Files there shadow the same-named repo prompts:
 *   IDENTITY.md, SOUL.md, MEMORY.md, INTERESTS.md
 * plus PERSONA.md — a short tenant overlay appended to the universal
 * identity header so every chat lane (casual/social/legate) speaks with the
 * tenant's voice and only claims the tenant's actual tools.
 *
 * The persona dir sits inside the data dir, so nightly cross-host backups
 * cover it automatically.
 */
const fs = require('fs');
const path = require('path');

function personaDir() {
  if (process.env.PIKO_PERSONA_DIR) return process.env.PIKO_PERSONA_DIR;
  const dataDir = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'persona');
}

/**
 * Read a persona file, preferring the tenant pack over the repo prompts dir.
 * Returns '' when neither exists.
 */
function readPersonaFile(name, promptsDir) {
  const tenantFile = path.join(personaDir(), name);
  try {
    return fs.readFileSync(tenantFile, 'utf8').trim();
  } catch (_) {}
  if (promptsDir) {
    try {
      return fs.readFileSync(path.join(promptsDir, name), 'utf8').trim();
    } catch (_) {}
  }
  return '';
}

/**
 * Tenant overlay for the universal identity header (PERSONA.md, pack-only —
 * no repo fallback, because the repo cannot know the tenant).
 */
function getPersonaOverlay() {
  try {
    return fs.readFileSync(path.join(personaDir(), 'PERSONA.md'), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

module.exports = { personaDir, readPersonaFile, getPersonaOverlay };
