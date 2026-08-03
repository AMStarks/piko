/**
 * Command Centre — tenant/client list with resolved dashboard URLs from registry + site packs.
 */
const fs = require('fs');
const path = require('path');
const { loadRegistry, resolveRegistryPath } = require('./tenantRegistry');
const { parseSimpleYaml } = require('./siteManifest');

const NODE_LAN = {
  rodimus: '192.168.0.190',
  optimus: '192.168.0.121',
};

const {
  stripTrailingSlash,
} = require('./text');

function loadTenantSiteYaml(projectRoot, tenantId) {
  const p = path.join(projectRoot, 'sites', tenantId, 'site.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    return parseSimpleYaml(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function joinUrl(base, suffix) {
  const b = stripTrailingSlash(String(base || '').trim());
  const s = String(suffix || '').trim();
  if (!b) return null;
  if (!s) return b;
  return s.startsWith('/') ? `${b}${s}` : `${b}/${s}`;
}

/**
 * Resolve best dashboard + public URLs for a registry row (registry wins, then site.yaml).
 */
function resolveTenantLinks(tenant, projectRoot) {
  const site = projectRoot ? loadTenantSiteYaml(projectRoot, tenant.tenant_id) : null;
  const publicUrl = String(
    tenant.public_url
    || (site && site.public && site.public.url)
    || '',
  ).trim() || null;

  const dashboardPath = (site && site.public && site.public.dashboard_path) || '/ios-dashboard';

  let dashboardUrl = String(tenant.dashboard_url || '').trim() || null;
  if (!dashboardUrl && publicUrl) {
    dashboardUrl = joinUrl(publicUrl, dashboardPath);
  }

  let breakGlass = String(tenant.break_glass_dashboard_url || '').trim() || null;
  if (!breakGlass) {
    const bg = site && site.public && site.public.break_glass_url;
    if (bg) {
      breakGlass = joinUrl(bg, dashboardPath);
    } else {
      const node = String(tenant.node_host || site?.ai_subnet?.host || '').trim().toLowerCase();
      const port = tenant.piko_port || site?.ai_subnet?.piko_port;
      const lan = NODE_LAN[node];
      if (lan && port) {
        breakGlass = `http://${lan}:${port}${dashboardPath}`;
      }
    }
  }

  const chatUrl = publicUrl || (breakGlass ? ((breakGlass.endsWith('/ios-dashboard/') ? breakGlass.slice(0, -'/ios-dashboard/'.length) : (breakGlass.endsWith('/ios-dashboard') ? breakGlass.slice(0, -'/ios-dashboard'.length) : breakGlass))) : null);

  return {
    public_url: publicUrl,
    dashboard_url: dashboardUrl,
    break_glass_dashboard_url: breakGlass,
    chat_url: chatUrl,
    observe_url: tenant.observe_url || null,
  /** Prefer break-glass / WAN IP links until public DNS paths are preferred explicitly. */
  primary_url: breakGlass || dashboardUrl || null,
  };
}

function inferClientProfile(tenant) {
  const adapter = String(tenant.adapter_id || '').trim();
  if (adapter === 'ausmakersupplies' || tenant.tenant_id === 'customer-01') {
    return { id: 'ausmaker', label: 'Business & inventory' };
  }
  if (adapter === 'egyptian-insights' || tenant.tenant_id === 'customer-03') {
    return { id: 'culture', label: 'Culture research' };
  }
  return { id: 'generic', label: 'Assistant' };
}

/**
 * Build client cards for Command Centre picker.
 */
function buildCommandCentreClients(rootDir, opts = {}) {
  const registry = loadRegistry(rootDir);
  const projectRoot = path.resolve(path.dirname(resolveRegistryPath(rootDir)), '..');
  const currentTenantId = String(opts.currentTenantId || process.env.PIKO_TENANT_ID || '').trim() || null;

  const clients = (registry.tenants || [])
    .filter((t) => t && t.tenant_id)
    .map((t) => {
      const links = resolveTenantLinks(t, projectRoot);
      const profile = inferClientProfile(t);
      const status = String(t.status || 'unknown').trim();
      const selectable = status === 'live' || status === 'healthy' || status === 'degraded';
      return {
        tenant_id: t.tenant_id,
        display_name: t.display_name || t.tenant_id,
        status,
        node_host: t.node_host || null,
        adapter_id: t.adapter_id || null,
        profile: profile.id,
        profile_label: profile.label,
        is_current: !!(currentTenantId && currentTenantId === t.tenant_id),
        selectable,
        ...links,
        primary_url: links.primary_url || links.break_glass_dashboard_url || links.dashboard_url,
      };
    })
    .sort((a, b) => {
      if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
      if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
      return String(a.display_name).localeCompare(String(b.display_name));
    });

  const live = clients.filter((c) => c.selectable);

  return {
    ok: true,
    contractVersion: '2026-07-20.command-centre.v1',
    ts: new Date().toISOString(),
    current_tenant_id: currentTenantId,
    hq_host: registry.hq_host || null,
    clients,
    live_count: live.length,
  };
}

module.exports = {
  buildCommandCentreClients,
  resolveTenantLinks,
  loadTenantSiteYaml,
  NODE_LAN,
};
