/**
 * Business-data grounding guard.
 *
 * Decides whether an actionRouter result is a factual business-data action
 * that must never be answered by socialChat / generative invent.
 * Classification is by actionType / capability id — not message regex.
 */

const BUSINESS_ACTION_TYPES = new Set([
  'stock_on_hand_get',
  'forecast_get',
  'forecast_review',
  'forecast_recompute',
  'forecast_override_set',
  'sales_summary_get',
  'create_tripwire',
]);

const BUSINESS_CAPABILITY_PREFIXES = [
  'inventory.',
  'sales.',
  'purchase_order.',
  'ausmaker.',
  'business.metrics.',
];

function capabilityLooksBusiness(capability) {
  const id = String(capability || '');
  return BUSINESS_CAPABILITY_PREFIXES.some((p) => id.startsWith(p));
}

/** True when the routed action must fetch real business data before answering. */
function isBusinessDataAction(route) {
  if (!route || typeof route !== 'object') return false;
  const actionType = String(route.actionType || '').toLowerCase();
  if (BUSINESS_ACTION_TYPES.has(actionType)) return true;
  if (actionType === 'run_capability' && capabilityLooksBusiness(route.capability)) return true;
  return false;
}

/**
 * If triage put us in a chat lane but the router found a business-data action,
 * force WORK_NOW so the tool path runs.
 */
function shouldForceWorkFromChat(triage, route) {
  if (!isBusinessDataAction(route)) return false;
  const lane = String((triage && triage.route) || '').toUpperCase();
  return lane === 'CHAT_FAST' || lane === 'CHAT_LIGHT' || lane === '';
}

function groundingRefusalReply() {
  return "I need to check the live inventory data for that, and I could not select a tool safely. Please ask again with the SKU, or try: \"stock on hand for <SKU>\".";
}

module.exports = {
  BUSINESS_ACTION_TYPES,
  isBusinessDataAction,
  shouldForceWorkFromChat,
  groundingRefusalReply,
};
