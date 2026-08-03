/**
 * Phase 5 — PO write ladder: draft → review → approve submit.
 */
const fs = require('fs');
const path = require('path');

const DRAFT_FILE = 'po-draft-pending.json';

function getDraftPath(dataDir) {
  return path.join(dataDir || path.join(__dirname, '..', 'data'), DRAFT_FILE);
}

function loadLastPoDraft(dataDir) {
  const p = getDraftPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function savePoDraftFromResult(dataDir, result) {
  if (!result || typeof result !== 'object') return null;
  const bySupplier = result.drafts_by_supplier || {};
  const suppliers = Object.keys(bySupplier);
  const payload = {
    updatedAt: new Date().toISOString(),
    summary: result.summary || {},
    suppliers,
    drafts_by_supplier: bySupplier,
    mode: result.mode || 'advisory',
  };
  const p = getDraftPath(dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function normalizeLines(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    sku: String(item.sku || item.SKU || item.shopify_sku || item.cin7_sku || '').trim(),
    quantity: Number(item.quantity || item.recommended_quantity || item.qty || 0),
    supplier: String(item.supplier || item.supplier_name || '').trim() || undefined,
  })).filter((l) => l.sku && l.quantity > 0);
}

/**
 * Build purchase_order.submit payload from saved draft.
 * @param {object} draft - from loadLastPoDraft
 * @param {string} [supplier] - optional supplier filter (case-insensitive)
 */
function buildSubmitPayloadFromDraft(draft, supplier) {
  if (!draft || !draft.drafts_by_supplier) {
    return { ok: false, error: 'NO_DRAFT', message: 'No PO draft on file. Run a purchase order draft first.' };
  }
  const want = String(supplier || '').trim().toLowerCase();
  const entries = Object.entries(draft.drafts_by_supplier);
  let match = entries;
  if (want) {
    match = entries.filter(([name]) => String(name).toLowerCase().includes(want));
    if (match.length === 0) {
      return {
        ok: false,
        error: 'SUPPLIER_NOT_FOUND',
        message: `No draft lines for supplier matching "${supplier}". Available: ${entries.map(([n]) => n).slice(0, 5).join(', ')}`,
      };
    }
  }
  if (match.length > 1 && !want) {
    return {
      ok: false,
      error: 'MULTIPLE_SUPPLIERS',
      message: `Draft has ${match.length} suppliers. Specify one: ${match.map(([n]) => n).slice(0, 5).join(', ')}`,
      suppliers: match.map(([n]) => n),
    };
  }
  const [supplierName, lines] = match[0];
  const normalized = normalizeLines(lines);
  if (normalized.length === 0) {
    return { ok: false, error: 'EMPTY_DRAFT', message: 'Draft has no orderable lines.' };
  }
  return {
    ok: true,
    payload: {
      supplier: supplierName,
      lines: normalized,
      source: 'po-draft-pending',
      drafted_at: draft.updatedAt,
    },
  };
}

function formatPoDraftSummary(draft) {
  if (!draft) return 'No PO draft saved yet.';
  const n = draft.suppliers ? draft.suppliers.length : 0;
  const lines = draft.summary?.draft_line_count ?? '?';
  return `PO draft on file: ${lines} lines across ${n} supplier(s)${draft.suppliers?.length ? ` (${draft.suppliers.slice(0, 3).join(', ')}${draft.suppliers.length > 3 ? '…' : ''})` : ''}.`;
}

function formatPoSubmitReply(out) {
  if (!out || !out.ok) {
    const code = out?.code || out?.error || 'FAILED';
    const detail = out?.message || out?.details || '';
    if (code === 'POLICY_VIOLATION' || detail === 'POLICY_VIOLATION') {
      return 'PO submit blocked by policy — capability not on LEGION_ADAPTER_WRITE_ALLOWLIST.';
    }
    if (code === 'APPROVAL_REQUIRED' || detail === 'APPROVAL_REQUIRED') {
      return 'PO submit requires explicit approval via /legion approve submit.';
    }
    return `PO submit failed: ${detail || code}`;
  }
  const result = out.result || {};
  if (result.dry_run) {
    const supplier = result.purchase_order_payload?.supplier || result.supplier || 'supplier';
    const count = (result.purchase_order_payload?.lines || result.lines || []).length;
    return `Dry-run logged for ${supplier} (${count} lines). No Cin7 write. Use live submit only after supplier pilot sign-off.`;
  }
  if (result.submitted) {
    return `PO submitted to AusMaker/Cin7.${result.response?.id ? ` Ref: ${result.response.id}` : ''}`;
  }
  return `PO submit accepted: run ${out.runId || 'n/a'}.`;
}

module.exports = {
  loadLastPoDraft,
  savePoDraftFromResult,
  buildSubmitPayloadFromDraft,
  formatPoDraftSummary,
  formatPoSubmitReply,
  normalizeLines,
};
