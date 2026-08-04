const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isMoneyCapability,
  gateMoneyHttp,
  beginChatMoneyConfirm,
  tryChatMoneyConfirm,
  resolveMoneyConfirmed,
  formatMoneyConfirm,
  pendingKeyForHttp,
} = require('../lib/moneyPlaneGate');
const {
  setPending,
  clearPending,
  getPending,
  consumeToken,
  tryConfirm,
} = require('../lib/moneyMutatePending');
const { mapRouteToPlane, assertPlaneAllowed } = require('../lib/privilegePlanes');

describe('P4.4 money plane dual-confirm', () => {
  let tmp;
  let prevDataDir;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-money-plane-'));
    prevDataDir = process.env.PIKO_DATA_DIR;
    process.env.PIKO_DATA_DIR = tmp;
  });

  after(() => {
    if (prevDataDir === undefined) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevDataDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('maps money routes; GET/read stays chat', () => {
    assert.equal(mapRouteToPlane('/api/yolo-tool', 'POST'), 'money');
    assert.equal(mapRouteToPlane('/api/hitl/approve', 'POST'), 'money');
    assert.equal(mapRouteToPlane('/api/yolo-tools/registry', 'GET'), 'chat');
    assert.equal(mapRouteToPlane('/api/hitl/pending', 'GET'), 'chat');
    assert.equal(mapRouteToPlane('/api/exports/reorder-csv', 'GET'), 'chat');
    assert.equal(mapRouteToPlane('/api/po/submit', 'POST'), 'money');
  });

  it('isMoneyCapability covers PO draft/submit', () => {
    assert.equal(isMoneyCapability('purchase_order.draft.create'), true);
    assert.equal(isMoneyCapability('purchase_order.submit'), true);
    assert.equal(isMoneyCapability('inventory.low_stock.scan'), false);
  });

  it('HTTP without confirm → 403 money_confirm_required + token', () => {
    let status = 0;
    let body = '';
    const send = (_res, code, b) => { status = code; body = b; };
    const ok = gateMoneyHttp(
      { headers: {} },
      {},
      send,
      { body: { name: 'cin7_create_purchase_order' }, action: 'yolo_tool', pathname: '/api/yolo-tool' },
    );
    assert.equal(ok, false);
    assert.equal(status, 403);
    const parsed = JSON.parse(body);
    assert.equal(parsed.error, 'money_confirm_required');
    assert.equal(parsed.needs_confirm, true);
    assert.ok(parsed.confirm_token);
  });

  it('HTTP with money_confirm=true proceeds', () => {
    let status = 0;
    const send = (_res, code) => { status = code; };
    const ok = gateMoneyHttp(
      { headers: {} },
      {},
      send,
      {
        body: { name: 'cin7_create_purchase_order', money_confirm: true },
        action: 'yolo_tool',
        role: 'operator',
      },
    );
    assert.equal(ok, true);
    assert.equal(status, 0);
  });

  it('HTTP dual-confirm via confirm_token', () => {
    const principal = { kind: 'api_key', id: 'shared' };
    const pKey = pendingKeyForHttp(principal, 'hitl_approve');
    clearPending(pKey);

    let status = 0;
    let body = '';
    const send = (_res, code, b) => { status = code; body = b; };
    assert.equal(gateMoneyHttp(
      { headers: {} },
      {},
      send,
      { body: {}, action: 'hitl_approve', principal, pendingKey: pKey },
    ), false);
    assert.equal(status, 403);
    const token = JSON.parse(body).confirm_token;
    assert.ok(token);

    status = 0;
    assert.equal(gateMoneyHttp(
      { headers: {} },
      {},
      send,
      { body: { confirm_token: token }, action: 'hitl_approve', principal, pendingKey: pKey },
    ), true);
  });

  it('header X-Piko-Money-Confirm satisfies confirm', () => {
    assert.equal(
      resolveMoneyConfirmed({ headers: { 'x-piko-money-confirm': 'yes' } }, {}, null),
      true,
    );
  });

  it('chat begin + YES confirm wiring', () => {
    const sessionKey = 'money-chat-sess-1';
    clearPending(sessionKey);
    const started = beginChatMoneyConfirm(sessionKey, {
      kind: 'po_submit',
      summary: 'purchase order submit',
      payload: { supplier: 'Acme', lines: [] },
      role: 'operator',
    });
    assert.equal(started.error, 'money_confirm_required');
    assert.match(started.reply, /Reply YES/i);
    assert.ok(getPending(sessionKey));

    const confirmed = tryChatMoneyConfirm(sessionKey, 'yes');
    assert.ok(confirmed);
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.intent.kind, 'po_submit');
    assert.equal(getPending(sessionKey), null);

    const plane = assertPlaneAllowed('money', { role: 'operator', moneyConfirmed: true });
    assert.equal(plane.ok, true);
  });

  it('chat cancel clears pending', () => {
    const sessionKey = 'money-chat-sess-2';
    clearPending(sessionKey);
    const started = beginChatMoneyConfirm(sessionKey, {
      kind: 'capability',
      summary: 'purchase_order.draft.create',
      role: 'operator',
    });
    assert.equal(started.error, 'money_confirm_required');
    const cancelled = tryConfirm(sessionKey, 'no');
    assert.ok(cancelled);
    assert.equal(cancelled.route, 'money_mutate_cancelled');
    assert.equal(getPending(sessionKey), null);
  });

  it('consumeToken rejects wrong token', () => {
    const key = 'http:operator:operator:yolo_tool';
    clearPending(key);
    const row = setPending(key, { kind: 'http', action: 'yolo_tool' });
    assert.equal(consumeToken(key, 'not-the-token'), null);
    assert.ok(getPending(key));
    assert.ok(consumeToken(key, row.token));
    assert.equal(getPending(key), null);
  });

  it('formatMoneyConfirm names the action', () => {
    assert.match(formatMoneyConfirm({ summary: 'purchase order submit' }), /purchase order submit/);
  });
});
