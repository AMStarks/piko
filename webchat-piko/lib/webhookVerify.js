/**
 * Webhook signature verification. Use when adding endpoints that receive webhooks (e.g. Blue Bubbles).
 * When the provider supplies a signature header (e.g. X-Signature), verify it with the shared secret.
 */
const crypto = require('crypto');

/**
 * Verify a webhook payload with HMAC signature.
 * @param {string} rawBody - Raw request body (string or Buffer).
 * @param {string} signatureHeader - Value of the signature header (e.g. req.headers['x-webhook-signature']).
 * @param {string} secret - Shared secret (e.g. process.env.PIKO_WEBHOOK_SECRET).
 * @param {string} algorithm - e.g. 'sha256'.
 * @returns {boolean}
 */
function verifyHmac(rawBody, signatureHeader, secret, algorithm = 'sha256') {
  if (!secret || !signatureHeader) return false;
  const body = typeof rawBody === 'string' ? rawBody : (rawBody && rawBody.toString ? rawBody.toString() : '');
  const expected = crypto.createHmac(algorithm, secret).update(body).digest('hex');
  let provided = String(signatureHeader || '').trim();
  const eq = provided.indexOf('=');
  if (eq > 0) {
    const prefix = provided.slice(0, eq);
    let ok = true;
    for (const ch of prefix) {
      const isWord = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_';
      if (!isWord) { ok = false; break; }
    }
    if (ok) provided = provided.slice(eq + 1).trim();
  }
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

module.exports = {
  verifyHmac,
};
