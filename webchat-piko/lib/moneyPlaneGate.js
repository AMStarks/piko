/**
 * Money privilege-plane gate (P4.4a): assertPlaneAllowed('money') + dual-confirm.
 */
const { assertPlaneAllowed } = require('./privilegePlanes');
const moneyPending = require('./moneyMutatePending');

const MONEY_CAPABILITIES = new Set([
  'purchase_order.draft.create',
  'purchase_order.submit',
]);

function isMoneyCapability(capability) {
  const c = String(capability || '').trim();
  if (MONEY_CAPABILITIES.has(c)) return true;
  return c.startsWith('purchase_order.');
}

function headerMoneyConfirm(req) {
  const h = (req && req.headers) || {};
  const raw = h['x-piko-money-confirm'] != null
    ? h['x-piko-money-confirm']
    : h['x-money-confirm'];
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function bodyMoneyConfirm(body) {
  if (!body || typeof body !== 'object') return false;
  const c = body.money_confirm;
  if (c === true || c === 1) return true;
  const s = String(c == null ? '' : c).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

function pendingKeyForHttp(principal, action) {
  const kind = principal && principal.kind ? String(principal.kind) : 'operator';
  const id = principal && principal.id ? String(principal.id) : 'operator';
  return `http:${kind}:${id}:${action || 'money'}`;
}

function resolveMoneyConfirmed(req, body, pendingKey) {
  if (headerMoneyConfirm(req) || bodyMoneyConfirm(body)) return true;
  const token = body && body.confirm_token != null ? String(body.confirm_token).trim() : '';
  if (token && pendingKey) {
    return !!moneyPending.consumeToken(pendingKey, token);
  }
  return false;
}

function formatMoneyConfirm(intent) {
  const summary = (intent && intent.summary)
    || (intent && intent.capability)
    || (intent && intent.action)
    || 'money / ERP action';
  return `This will run a money-plane action (${summary}). Reply YES to confirm, or NO to cancel.`;
}

/**
 * Start chat dual-confirm for a money action (configMutatePending pattern).
 */
function beginChatMoneyConfirm(sessionKey, intent) {
  const check = assertPlaneAllowed('money', {
    principal: intent && intent.principal,
    role: intent && intent.role,
    moneyConfirmed: false,
  });
  if (!check.ok && check.error === 'plane_denied') {
    return {
      ok: false,
      status: check.status || 403,
      error: 'plane_denied',
      plane: 'money',
      reply: 'That money-plane action is not allowed for this role.',
      route: 'plane_denied',
    };
  }
  moneyPending.setPending(sessionKey, intent || {});
  return {
    ok: false,
    status: 403,
    error: 'money_confirm_required',
    plane: 'money',
    needs_confirm: true,
    reply: formatMoneyConfirm(intent),
    route: 'money_confirm_required',
  };
}

/**
 * HTTP gate: without confirm → 403 money_confirm_required (+ confirm_token).
 * @returns {boolean} true if allowed to proceed
 */
function gateMoneyHttp(req, res, send, opts = {}) {
  let principal = opts.principal;
  if (!principal) {
    try {
      const { resolvePrincipal } = require('./sessionOwner');
      principal = resolvePrincipal(req, {
        dataDir: opts.dataDir || process.env.PIKO_DATA_DIR,
        query: opts.query,
      });
    } catch (err) {
      void err;
      principal = { kind: 'operator', id: 'operator' };
    }
  }

  const body = opts.body || {};
  const action = opts.action || 'money';
  const pKey = opts.pendingKey || pendingKeyForHttp(principal, action);
  const moneyConfirmed = resolveMoneyConfirmed(req, body, pKey);

  const check = assertPlaneAllowed('money', {
    principal,
    role: opts.role,
    moneyConfirmed,
    extraPlanes: opts.extraPlanes,
  });

  if (check.ok) return true;

  const payload = {
    ok: false,
    error: check.error || 'plane_denied',
    plane: check.plane || 'money',
    needs_confirm: !!check.needs_confirm,
  };

  if (check.error === 'money_confirm_required') {
    const row = moneyPending.setPending(pKey, {
      kind: 'http',
      action,
      path: opts.pathname || '',
    });
    payload.confirm_token = row.token;
    payload.message = 'Money-plane action requires dual confirm. Retry with money_confirm=true or confirm_token.';
  }

  send(res, check.status || 403, JSON.stringify(payload));
  return false;
}

/**
 * Chat YES path: consume pending and return intent when confirmed.
 * Caller must execute and assert moneyConfirmed when running the action.
 */
function tryChatMoneyConfirm(sessionKey, message) {
  return moneyPending.tryConfirm(sessionKey, message);
}

module.exports = {
  MONEY_CAPABILITIES,
  isMoneyCapability,
  headerMoneyConfirm,
  bodyMoneyConfirm,
  pendingKeyForHttp,
  resolveMoneyConfirmed,
  formatMoneyConfirm,
  beginChatMoneyConfirm,
  gateMoneyHttp,
  tryChatMoneyConfirm,
  assertPlaneAllowed,
};
