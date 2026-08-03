/**
 * Human-in-the-loop security for Legion PO approval.
 * Used by server.js for /legion approve submit.
 */

/** Only primary sources can approve POs. Env: PIKO_LEGION_APPROVE_PRIMARY_SOURCES=webchat,app */
function isLegionApproveAllowed(reqSource) {
  const list = (process.env.PIKO_LEGION_APPROVE_PRIMARY_SOURCES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.includes(String(reqSource || '').toLowerCase());
}

/** Optional PIN for PO approval. Env: PIKO_LEGION_APPROVE_PIN. Payload may include _pin; we strip it before dispatch. */
function verifyAndStripApprovalPin(poPayload) {
  const pin = (process.env.PIKO_LEGION_APPROVE_PIN || '').trim();
  if (!pin) return { ok: true, payload: poPayload };
  const provided = poPayload && poPayload._pin != null ? String(poPayload._pin) : '';
  if (provided !== pin) {
    return { ok: false, error: 'Invalid or missing approval PIN. Include "_pin": "your-pin" in the payload.' };
  }
  const { _pin, ...rest } = poPayload;
  return { ok: true, payload: rest };
}

module.exports = {
  isLegionApproveAllowed,
  verifyAndStripApprovalPin,
};
