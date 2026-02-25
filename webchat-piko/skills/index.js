/**
 * Local skills — auto-load all skills/*.js (except index.js and common.js).
 * No marketplace: only files in this folder; you approve by adding files.
 * Each file exports { name?, pattern, handler } or { skills: [...] }.
 */
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = __dirname;

function loadSkills() {
  const skills = [];
  let files = [];
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (_) {
    return skills;
  }
  for (const f of files) {
    if (!f.endsWith('.js') || f === 'index.js' || f === 'common.js') continue;
    const full = path.join(SKILLS_DIR, f);
    try {
      const mod = require(full);
      if (Array.isArray(mod.skills)) {
        skills.push(...mod.skills);
      } else if (mod.pattern && typeof mod.handler === 'function') {
        skills.push({ name: mod.name, pattern: mod.pattern, handler: mod.handler });
      }
    } catch (e) {
      console.error('[skills] load', f, 'failed:', e.message);
    }
  }
  return skills;
}

const skills = loadSkills();
if (skills.length) console.log('[skills] loaded', skills.length, 'skill(s) from', SKILLS_DIR);

module.exports = { skills };
