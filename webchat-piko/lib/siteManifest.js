/**
 * Customer site manifest — purpose-driven site config (Stage 2 platform).
 * Loads sites/{tenant_id}/site.yaml or PIKO_SITE_MANIFEST path.
 */
const fs = require('fs');
const path = require('path');
const {
  splitLines,
  tabsToSpaces,
  firstNonWhitespaceIndex,
} = require('./text');

const DEFAULT_TENANT = 'customer-01';

/** Minimal YAML for flat 2-level site manifests (no external yaml dep). */
function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  for (const raw of splitLines(text)) {
    const line = tabsToSpaces(raw);
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = firstNonWhitespaceIndex(line);
    const content = line.trim();
    const colon = content.indexOf(':');
    if (colon < 0) continue;
    const key = content.slice(0, colon).trim();
    let val = content.slice(colon + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (val === '') {
      const child = {};
      parent[key] = child;
      stack.push({ obj: child, indent });
    } else {
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parent[key] = val;
    }
  }
  return root;
}

function getRepoRoot(rootDir) {
  return rootDir || path.join(__dirname, '..');
}

function resolveSiteManifestPath(rootDir) {
  const explicit = String(process.env.PIKO_SITE_MANIFEST || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(getRepoRoot(rootDir), explicit);
  }
  const tenant = String(process.env.PIKO_TENANT_ID || DEFAULT_TENANT).trim() || DEFAULT_TENANT;
  const candidate = path.join(getRepoRoot(rootDir), '..', 'sites', tenant, 'site.yaml');
  if (fs.existsSync(candidate)) return candidate;
  const inWebchat = path.join(getRepoRoot(rootDir), 'sites', tenant, 'site.yaml');
  if (fs.existsSync(inWebchat)) return inWebchat;
  return null;
}

function loadSiteManifest(rootDir) {
  const p = resolveSiteManifestPath(rootDir);
  if (!p || !fs.existsSync(p)) {
    return {
      tenant_id: process.env.PIKO_TENANT_ID || DEFAULT_TENANT,
      fromFile: false,
      public: {
        url: process.env.PIKO_PUBLIC_BASE_URL || process.env.PIKO_IOS_PUBLIC_URL || '',
        dashboard_path: '/ios-dashboard',
      },
      ai_subnet: {
        piko_port: Number(process.env.PORT || 3000),
        legion_adapter_port: 8000,
        ausmaker_port: Number(process.env.AUSMAKER_BASE_URL || '').includes('5001') ? 5001 : 5001,
        ollama_port: 11434,
      },
      knowledge: { default_adapter: 'ausmakersupplies' },
    };
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = parseSimpleYaml(raw);
    return { ...parsed, fromFile: true, manifestPath: p };
  } catch (e) {
    return { tenant_id: DEFAULT_TENANT, fromFile: false, error: e.message };
  }
}

module.exports = {
  loadSiteManifest,
  resolveSiteManifestPath,
  parseSimpleYaml,
  DEFAULT_TENANT,
};
