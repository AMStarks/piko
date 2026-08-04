/**
 * Legion tenant registry — org plane seed (Stage 3).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { isSafeName, replaceAllLiteral } = require('./text');

function resolveRegistryPath(rootDir) {
  const explicit = String(process.env.PIKO_TENANT_REGISTRY || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(rootDir, explicit);
  }
  const candidates = [
    path.join(rootDir, '..', 'legion-tenants', 'registry.json'),
    path.join(rootDir, 'legion-tenants', 'registry.json'),
    '/home/chief/legion-tenants/registry.json',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadRegistry(rootDir) {
  const p = resolveRegistryPath(rootDir);
  if (!fs.existsSync(p)) {
    return { version: 1, tenants: [], registryPath: p, fromFile: false };
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...data, registryPath: p, fromFile: true };
  } catch (e) {
    return { version: 1, tenants: [], registryPath: p, fromFile: false, error: e.message };
  }
}

function saveRegistry(rootDir, data) {
  const p = resolveRegistryPath(rootDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = { ...data, updated_at: new Date().toISOString() };
  delete out.registryPath;
  delete out.fromFile;
  delete out.error;
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  return out;
}

function writeSiteHeartbeat(dataDir, payload) {
  const p = path.join(dataDir, 'site-heartbeat.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...payload, ts: new Date().toISOString() }, null, 2));
}

function readSiteHeartbeat(dataDir) {
  const p = path.join(dataDir, 'site-heartbeat.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function appendAuditLog(dataDir, entry) {
  const p = path.join(dataDir, 'hq-audit.jsonl');
  const { appendJsonlBounded } = require('./jsonlBounded');
  const maxLines = Number(process.env.PIKO_HQ_AUDIT_JSONL_MAX || 2000) || 2000;
  appendJsonlBounded(p, { ts: new Date().toISOString(), ...entry }, { maxLines });
}

function fetchJson(url, timeoutMs = 10000, opts = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {};
    // Auth-gated tenants accept their API key on read-only monitor paths.
    if (opts.apiKey) headers['X-Piko-Key'] = String(opts.apiKey);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(raw) });
        } catch (_) {
          resolve({ ok: false, status: res.statusCode, error: 'invalid_json' });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

async function buildHqStatus(rootDir, dataDir) {
  const registry = loadRegistry(rootDir);
  const localHeartbeat = readSiteHeartbeat(dataDir);
  const tenants = [];
  const projectRoot = path.resolve(path.dirname(resolveRegistryPath(rootDir)), '..');
  let resolveLinks = null;
  try {
    resolveLinks = require('./commandCentre').resolveTenantLinks;
  } catch (_) { /* ignore */ }

  for (const t of registry.tenants || []) {
    let observe = null;
    let status = 'unknown';
    if (t.observe_url) {
      const fetched = await fetchJson(t.observe_url, 10000, { apiKey: t.observe_key || null });
      if (fetched.ok && fetched.body) {
        observe = fetched.body;
        status = observe.overall === 'pass' ? 'healthy' : 'degraded';
      } else {
        status = 'unreachable';
      }
    }
    if (!observe && localHeartbeat && (t.tenant_id === localHeartbeat.tenant_id || !localHeartbeat.tenant_id)) {
      observe = localHeartbeat;
      status = localHeartbeat.status === 'healthy' ? 'healthy' : 'degraded';
    }
    const lastSeen = observe?.ts || localHeartbeat?.ts || t.last_seen || null;
    const links = resolveLinks ? resolveLinks(t, projectRoot) : {};
    tenants.push({
      ...t,
      ...links,
      primary_url: links.primary_url || links.break_glass_dashboard_url || links.dashboard_url || t.dashboard_url || null,
      status,
      last_seen: lastSeen,
      observe,
    });
    if (lastSeen && t.tenant_id) {
      try {
        updateTenantFields(rootDir, t.tenant_id, { last_seen: lastSeen, status });
      } catch (_) { /* ignore */ }
    }
  }

  const live = tenants.filter((x) => x.status !== 'template' && x.status !== 'planned');
  const overall = !live.length ? 'unknown'
    : live.every((x) => x.status === 'healthy') ? 'healthy'
      : live.some((x) => x.status === 'healthy') ? 'mixed' : 'degraded';

  return {
    ok: true,
    ts: new Date().toISOString(),
    overall,
    registry_version: registry.version,
    hq_host: registry.hq_host || null,
    tenants,
  };
}

function updateTenantFields(rootDir, tenantId, fields) {
  const registry = loadRegistry(rootDir);
  const idx = (registry.tenants || []).findIndex((t) => t.tenant_id === tenantId);
  if (idx < 0) return registry;
  registry.tenants[idx] = { ...registry.tenants[idx], ...fields };
  return saveRegistry(rootDir, registry);
}

function provisionTenant(rootDir, {
  tenant_id,
  display_name,
  adapter_id,
  node_host,
  piko_port,
  observe_lan_ip,
} = {}) {
  function isIdSlug(s) {
    const str = String(s || '');
    if (!str || str[0] === '-') return false;
    if (str !== str.toLowerCase()) return false;
    return isSafeName(str, { allowUnderscore: false, allowDot: false, allowColon: false, allowHyphen: true });
  }
  const tenant = String(tenant_id || '').trim();
  const display = String(display_name || '').trim();
  const adapter = String(adapter_id || '').trim();
  const node = String(node_host || 'unassigned').trim() || 'unassigned';
  const portNum = piko_port != null && String(piko_port).trim() !== ''
    ? parseInt(String(piko_port), 10)
    : (node === 'optimus' ? 3010 : 3000);
  if (!isIdSlug(tenant)) {
    throw new Error('tenant_id must be lowercase letters, numbers and hyphens (e.g. customer-03)');
  }
  if (!display) {
    throw new Error('display_name is required');
  }
  if (!isIdSlug(adapter)) {
    throw new Error('adapter_id must be lowercase letters, numbers and hyphens (e.g. acme-adapter)');
  }
  if (!['unassigned', 'rodimus', 'optimus'].includes(node) && !isIdSlug(node)) {
    throw new Error('node_host must be unassigned, rodimus, optimus, or a lowercase hostname');
  }
  if (!Number.isFinite(portNum) || portNum < 1024 || portNum > 65535) {
    throw new Error('piko_port must be a valid port (1024–65535)');
  }

  const { buildSetupChecklist, defaultNextSteps } = require('./tenantSetupRoadmap');

  const registry = loadRegistry(rootDir);
  if ((registry.tenants || []).some((t) => t.tenant_id === tenant)) {
    throw new Error(`Tenant '${tenant}' already exists in the registry`);
  }

  const projectRoot = path.resolve(path.dirname(registry.registryPath), '..');
  const siteDir = path.join(projectRoot, 'sites', tenant);
  const knowDir = path.join(projectRoot, 'knowledge', tenant);
  const templateSite = path.join(projectRoot, 'sites', '_template', 'site.yaml');
  const templateSmoke = path.join(projectRoot, 'sites', '_template', 'smoke.json');

  const lanHint = String(observe_lan_ip || (node === 'optimus' ? '192.168.0.121' : node === 'rodimus' ? '192.168.0.190' : '0.0.0.0')).trim();

  const applyReplacements = (text) => {
    let out = String(text || '');
    out = replaceAllLiteral(out, 'REPLACE_TENANT_ID', tenant);
    out = replaceAllLiteral(out, 'REPLACE_DISPLAY_NAME', display);
    out = replaceAllLiteral(out, 'REPLACE_BUSINESS_UNIT', display);
    out = replaceAllLiteral(out, 'REPLACE_ADAPTER_ID', adapter);
    out = replaceAllLiteral(out, 'REPLACE_ADAPTER_CAPABILITY', 'health.check');
    out = replaceAllLiteral(out, 'REPLACE_SMOKE_CAPABILITY', 'health.check');
    out = replaceAllLiteral(out, 'REPLACE_DOMAIN', 'example.com');
    out = replaceAllLiteral(out, 'REPLACE_WAN_IP', lanHint);
    out = replaceAllLiteral(out, 'REPLACE_NODE_HOST', node === 'unassigned' ? 'unassigned' : node);
    out = replaceAllLiteral(out, 'piko_port: 3000', `piko_port: ${portNum}`);
    return out;
  };

  const created = [];
  if (fs.existsSync(templateSite)) {
    fs.mkdirSync(siteDir, { recursive: true });
    const siteOut = path.join(siteDir, 'site.yaml');
    if (!fs.existsSync(siteOut)) {
      fs.writeFileSync(siteOut, applyReplacements(fs.readFileSync(templateSite, 'utf8')));
      created.push(siteOut);
    }
  }
  if (fs.existsSync(templateSmoke)) {
    fs.mkdirSync(siteDir, { recursive: true });
    const smokeOut = path.join(siteDir, 'smoke.json');
    if (!fs.existsSync(smokeOut)) {
      fs.writeFileSync(smokeOut, applyReplacements(fs.readFileSync(templateSmoke, 'utf8')));
      created.push(smokeOut);
    }
  }

  fs.mkdirSync(knowDir, { recursive: true });
  const manifestOut = path.join(knowDir, 'manifest.json');
  if (!fs.existsSync(manifestOut)) {
    const manifest = {
      version: 2,
      contextFile: 'context/aggregate.json',
      silentCapabilities: [],
      defaultAdapter: adapter,
      contextRefresh: {
        enabled: true,
        skipIfFresh: true,
        steps: [{ capability: 'health.check', label: 'Health sync' }],
      },
      adapterAliases: [],
      nativeCapabilities: [],
      detectors: [],
      notes: 'Isolated tenant knowledge pack — no AusMaker inventory/sales capabilities by default.',
    };
    fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + '\n');
    created.push(manifestOut);
  }

  const completedStages = ['scaffold'];
  if (node !== 'unassigned') completedStages.push('node');

  const checklist = buildSetupChecklist({ completed: completedStages });
  const suggestedObserve = node !== 'unassigned'
    ? `http://${lanHint}:${portNum}/api/observe/summary`
    : null;

  const row = {
    tenant_id: tenant,
    display_name: display,
    status: 'planned',
    observe_url: null,
    adapter_id: adapter,
    node_host: node,
    piko_port: portNum,
    suggested_observe_url: suggestedObserve,
    version: null,
    last_seen: null,
    last_release: null,
    last_release_ok: null,
    setup_checklist: checklist,
    notes: `Provisioned via HQ — complete setup_checklist before go-live (adapter → spine on ${node} → observe_url → live)`,
  };
  registry.tenants = registry.tenants || [];
  registry.tenants.push(row);
  saveRegistry(rootDir, registry);

  return {
    tenant_id: tenant,
    row,
    created,
    project_root: projectRoot,
    setup_checklist: checklist,
    next_steps: defaultNextSteps({
      tenant_id: tenant,
      adapter_id: adapter,
      node_host: node,
      piko_port: portNum,
    }),
    deploy_hint: node === 'optimus'
      ? `./scripts/deploy-tenant-spine-optimus.sh ${tenant}`
      : node === 'rodimus'
        ? `PIKO_TENANT_ID=${tenant} ./scripts/deploy-legion-platform-rodimus.sh`
        : 'Assign node_host, then run the matching deploy-tenant-spine-*.sh script',
  };
}

function updateTenantSetup(rootDir, tenantId, fields = {}) {
  const { buildSetupChecklist } = require('./tenantSetupRoadmap');
  const registry = loadRegistry(rootDir);
  const idx = (registry.tenants || []).findIndex((t) => t.tenant_id === tenantId);
  if (idx < 0) throw new Error(`Tenant '${tenantId}' not found`);
  const cur = registry.tenants[idx];
  const next = { ...cur };

  if (fields.node_host != null) next.node_host = String(fields.node_host).trim();
  if (fields.piko_port != null) next.piko_port = parseInt(String(fields.piko_port), 10);
  if (fields.observe_url != null) {
    const url = String(fields.observe_url).trim();
    next.observe_url = url || null;
  }
  if (fields.status != null) next.status = String(fields.status).trim();
  if (fields.notes != null) next.notes = String(fields.notes).trim();
  if (fields.suggested_observe_url != null) {
    next.suggested_observe_url = String(fields.suggested_observe_url).trim() || null;
  }

  const completed = new Set(
    Array.isArray(fields.completed_stages)
      ? fields.completed_stages
      : (cur.setup_checklist || []).filter((s) => s.status === 'done').map((s) => s.id),
  );
  completed.add('scaffold');
  if (next.node_host && next.node_host !== 'unassigned') completed.add('node');
  if (fields.mark_adapter_done) completed.add('adapter');
  if (fields.mark_spine_done) completed.add('spine');
  if (next.observe_url) completed.add('observe');
  if (next.status === 'live' && next.observe_url) completed.add('go_live');

  next.setup_checklist = buildSetupChecklist({ completed: [...completed] });
  registry.tenants[idx] = next;
  saveRegistry(rootDir, registry);
  return next;
}

function appendReleaseLog(dataDir, entry) {
  const p = path.join(dataDir, 'hq-release-log.jsonl');
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(p, line);
}

function readLastRelease(dataDir, tenantId) {
  const p = path.join(dataDir, 'hq-release-log.jsonl');
  if (!fs.existsSync(p)) return null;
  try {
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const row = JSON.parse(lines[i]);
      if (!tenantId || row.tenant_id === tenantId) return row;
    }
  } catch (_) { /* ignore */ }
  return null;
}

module.exports = {
  loadRegistry,
  saveRegistry,
  resolveRegistryPath,
  writeSiteHeartbeat,
  readSiteHeartbeat,
  appendAuditLog,
  buildHqStatus,
  fetchJson,
  updateTenantFields,
  provisionTenant,
  updateTenantSetup,
  appendReleaseLog,
  readLastRelease,
};
