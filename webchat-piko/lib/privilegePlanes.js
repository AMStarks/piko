/**
 * Privilege planes (P3.4a/c): chat | work | config | money.
 * Sessions/keys carry allowed planes; money also needs dual-control confirm.
 */
const PLANES = Object.freeze(['chat', 'work', 'config', 'money']);

const ROLE_PLANES = Object.freeze({
  client: Object.freeze(['chat']),
  operator: Object.freeze(['chat', 'work', 'config']),
  // money is never granted by role alone — requires confirm.
  admin: Object.freeze(['chat', 'work', 'config']),
});

function normalizePlane(plane) {
  const p = String(plane || '').trim().toLowerCase();
  return PLANES.includes(p) ? p : null;
}

function planesForRole(role) {
  const r = String(role || 'client').trim().toLowerCase();
  return ROLE_PLANES[r] || ROLE_PLANES.client;
}

/**
 * Map HTTP path → plane. Mutating ERP/PO paths → money; agents enqueue → work;
 * control/config → config; everything else under /api → chat (read) or work.
 */
function mapRouteToPlane(pathname, method) {
  const p = String(pathname || '');
  const m = String(method || 'GET').toUpperCase();
  if (p.startsWith('/api/control') || p.startsWith('/api/mgmt') || p.startsWith('/api/admin')) {
    if (p.includes('proactive-policy') || p.includes('webhook-rules') || p.includes('legate-rollout')
      || p.includes('operations') || p.includes('model') || p.includes('prompt')) {
      return 'config';
    }
    return m === 'GET' ? 'chat' : 'config';
  }
  if (p.startsWith('/api/agents')) {
    if (m === 'GET') return 'chat';
    return 'work';
  }
  if (p.includes('/purchase') || p.includes('/po') || p.includes('weekly-po')
    || p.includes('yolo-tool') || p.includes('/hitl/approve')) {
    return 'money';
  }
  if (p.startsWith('/api/ei/') || p.startsWith('/api/cultures')) {
    if (m === 'GET') return 'chat';
    return 'work';
  }
  if (p.startsWith('/api/chat')) return 'chat';
  return 'chat';
}

function mapChatLaneToPlane(lane) {
  const l = String(lane || '').trim().toLowerCase();
  if (l.includes('dispatch') || l.includes('work') || l.includes('mission')) return 'work';
  if (l.includes('config') || l.includes('flag') || l.includes('mutate')) return 'config';
  if (l.includes('po') || l.includes('money') || l.includes('purchase')) return 'money';
  return 'chat';
}

function resolveRole(opts = {}) {
  if (opts.role) return String(opts.role).trim().toLowerCase();
  if (opts.principal && opts.principal.kind === 'admin') return 'admin';
  if (opts.principal && opts.principal.kind === 'api_key') return 'operator';
  // sessionOwner uses kind=operator for the shared operator principal
  if (opts.principal && opts.principal.kind === 'operator') return 'operator';
  if (opts.principal && opts.principal.kind === 'channel') return 'operator';
  if (opts.isOperator) return 'operator';
  return 'client';
}

function logPlaneDenied(meta) {
  try {
    require('./logger').log('warn', 'plane_denied', {
      tag: 'plane_denied',
      ...meta,
    });
  } catch (_) {
    console.warn('[plane_denied]', JSON.stringify(meta || {}));
  }
}

/**
 * @returns {{ ok: true, plane: string, role: string } | { ok: false, status: number, error: string, plane: string }}
 */
function assertPlaneAllowed(plane, opts = {}) {
  const p = normalizePlane(plane) || 'chat';
  const role = resolveRole(opts);
  const allowed = new Set(planesForRole(role));
  if (opts.extraPlanes) {
    for (const x of opts.extraPlanes) {
      const n = normalizePlane(x);
      if (n) allowed.add(n);
    }
  }

  if (p === 'money') {
    if (!allowed.has('config') && !allowed.has('work') && role === 'client') {
      logPlaneDenied({ plane: p, role, reason: 'role' });
      return { ok: false, status: 403, error: 'plane_denied', plane: p, role };
    }
    if (!opts.moneyConfirmed) {
      logPlaneDenied({ plane: p, role, reason: 'money_confirm_required' });
      return {
        ok: false,
        status: 403,
        error: 'money_confirm_required',
        plane: p,
        role,
        needs_confirm: true,
      };
    }
    return { ok: true, plane: p, role };
  }

  if (!allowed.has(p)) {
    logPlaneDenied({ plane: p, role, reason: 'role' });
    return { ok: false, status: 403, error: 'plane_denied', plane: p, role };
  }
  return { ok: true, plane: p, role };
}

module.exports = {
  PLANES,
  ROLE_PLANES,
  normalizePlane,
  planesForRole,
  mapRouteToPlane,
  mapChatLaneToPlane,
  assertPlaneAllowed,
  resolveRole,
  logPlaneDenied,
};
