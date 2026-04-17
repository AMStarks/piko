/**
 * Debounces many rapid /webhook/inventory-alert POSTs (e.g. full catalog sync)
 * into a single Telegram with a compact SKU list.
 */
const MAX_TELEGRAM_CHARS = 3900;

let queue = [];
let flushTimer = null;

function batchMs() {
  const n = parseInt(process.env.PIKO_INVENTORY_ALERT_BATCH_MS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 4000;
}

function lineForRow(row) {
  const { sku, name, old_status, new_status, soh, forecast, active_method } = row;
  const display = (name && String(name).trim()) || sku || 'Unknown';
  const m = active_method || 'median';
  return `• ${sku} (${display}) — SOH ${soh ?? '-'} | target ${forecast ?? '-'} (${m}) → ${new_status} (was ${old_status || '?'})`;
}

function buildMessage(rows) {
  const n = rows.length;
  const review = rows.filter((r) => r.new_status === 'Review').length;
  const reorder = rows.filter((r) => r.new_status === 'Reorder').length;
  const header =
    `🚨 Inventory alerts (${n} SKUs)\n` +
    `Bulk sync: ${reorder} reorder, ${review} review. Flagged for PO follow-up.\n`;

  const sorted = [...rows].sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || '')));
  const lines = [];
  let used = header.length + 80;
  let omitted = 0;
  for (const row of sorted) {
    const line = lineForRow(row) + '\n';
    if (used + line.length > MAX_TELEGRAM_CHARS) {
      omitted += sorted.length - lines.length;
      break;
    }
    lines.push(line);
    used += line.length;
  }
  let body = lines.join('');
  if (omitted > 0) {
    body += `\n… and ${omitted} more (truncated for Telegram). Open AusMaker inventory for the full list.`;
  }
  return header + '\n' + body;
}

/**
 * @param {object} payload - fields from inventory webhook
 * @param {(text: string, opts?: object) => Promise<unknown>} sendToAdmin
 */
function enqueueInventoryAlert(payload, sendToAdmin) {
  const ms = batchMs();
  queue.push({
    sku: payload.sku,
    name: payload.name,
    old_status: payload.old_status,
    new_status: payload.new_status,
    soh: payload.soh,
    forecast: payload.forecast,
    active_method: payload.active_method,
  });

  if (ms === 0) {
    const row = {
      sku: payload.sku,
      name: payload.name,
      old_status: payload.old_status,
      new_status: payload.new_status,
      soh: payload.soh,
      forecast: payload.forecast,
      active_method: payload.active_method,
    };
    const displayName = row.name || row.sku || 'Unknown';
    const msg =
      `🚨 Inventory Alert: A recent sale just pushed ${row.sku} (${displayName}) into the red.\n\n` +
      `Status flipped from ${row.old_status || 'unknown'} to ${row.new_status}.\n` +
      `Current SOH: ${row.soh ?? '-'} | Target/Forecast: ${row.forecast ?? '-'} (Using ${row.active_method || 'median'})\n\n` +
      `I've flagged this for your next PO review.`;
    return sendToAdmin(msg, { parseMode: 'none' });
  }

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return;
    if (batch.length === 1) {
      const row = batch[0];
      const displayName = row.name || row.sku || 'Unknown';
      const msg =
        `🚨 Inventory Alert: A recent sale just pushed ${row.sku} (${displayName}) into the red.\n\n` +
        `Status flipped from ${row.old_status || 'unknown'} to ${row.new_status}.\n` +
        `Current SOH: ${row.soh ?? '-'} | Target/Forecast: ${row.forecast ?? '-'} (Using ${row.active_method || 'median'})\n\n` +
        `I've flagged this for your next PO review.`;
      sendToAdmin(msg, { parseMode: 'none' }).catch((e) => console.error('[inventoryAlertBatcher]', e.message));
      return;
    }
    const text = buildMessage(batch);
    sendToAdmin(text, { parseMode: 'none' }).catch((e) => console.error('[inventoryAlertBatcher]', e.message));
  }, ms);

  return Promise.resolve();
}

module.exports = { enqueueInventoryAlert, batchMs };
