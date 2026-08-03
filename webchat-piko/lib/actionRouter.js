/**
 * Semantic Action Router — maps natural language to Legion capabilities or Piko actions.
 * LLM-only routing with description-based capabilities. No regex intent fast-paths.
 * Platform-agnostic: native capabilities + registry from manifest and Legion discovery.
 */
const path = require('path');
const fs = require('fs');
const { ollamaNativeChat } = require('./llm');
const { loadManifest } = require('./knowledgeManifest');
const { getDiscoveredCapabilitiesSync } = require('./legionAdapterDiscovery');
const { extractJsonObject, isYearMonth } = require('./routingParse');
const { isValidSku } = require('./inventoryStockOnHand');

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'legion-capability-registry.json');
const DEFAULT_REGISTRY = [
  { id: 'inventory.low_stock.scan', description: 'Low stock scan, reorder check (summary)' },
  { id: 'inventory.report.export', description: 'Full list or CSV export of reorder items' },
  { id: 'sales.analysis.run', description: 'Sales analysis and forecast report' },
  { id: 'ausmaker.runbook.execute', description: 'AusMaker ops runbook (sync, forecast refresh, integration survey)' },
  { id: 'purchase_order.draft.create', description: 'Draft purchase order' },
];

function loadFromFile() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_REGISTRY;
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[actionRouter] load registry:', e.message);
  }
  return DEFAULT_REGISTRY;
}

/** Merge file registry with discovered (Legion API + adapters folder). File takes precedence for duplicates. */
// Culture-domain capabilities must never surface on business tenants (and
// vice-versa there is no overlap today). Gate by tenant profile.
const CULTURE_CAPABILITY_PREFIXES = ['scribe.', 'translation.', 'culture.', 'research.scrape'];

function isCultureCapability(capId) {
  const id = String(capId || '');
  for (const p of CULTURE_CAPABILITY_PREFIXES) {
    if (id.startsWith(p)) return true;
  }
  return false;
}

function capabilityAllowedForProfile(capId) {
  if (!isCultureCapability(capId)) return true;
  try {
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    return getTenantBackgroundProfile().isCulture === true;
  } catch (_) {
    return false;
  }
}

function loadCapabilityRegistry() {
  const fromFile = loadFromFile();
  const discovered = getDiscoveredCapabilitiesSync();
  const byId = new Map(fromFile.map((c) => [c.id, c]));
  for (const c of discovered) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return Array.from(byId.values()).filter((c) => capabilityAllowedForProfile(c.id));
}

function getNativeCapabilities() {
  const manifest = loadManifest();
  return manifest.nativeCapabilities || [{ id: 'ausmaker.business.health.review', description: 'Business health review' }];
}

/** Build capability list for router: registry + native (description-based). Native overrides registry for same id. */
function getCapabilitiesForRouter() {
  const registry = loadCapabilityRegistry();
  const native = getNativeCapabilities();
  const byId = new Map(registry.map((c) => [c.id, { id: c.id, description: c.description || c.id }]));
  for (const nc of native) {
    if (!nc.id) continue;
    const desc = nc.description || nc.id;
    byId.set(nc.id, { id: nc.id, description: desc });
  }
  return Array.from(byId.values());
}

function getPikoNativeCapabilityIds() {
  return getNativeCapabilities().map((nc) => nc.id).filter(Boolean);
}

/** Culture routing guidance only exists on culture tenants; elsewhere the
 * router must say those requests are unavailable rather than guess. */
function cultureRoutingRules() {
  let isCulture = false;
  try {
    isCulture = require('./tenantBackgroundJobs').getTenantBackgroundProfile().isCulture === true;
  } catch (_) {}
  if (!isCulture) {
    return `OUT-OF-SCOPE RULE:
Egyptology / hieroglyph / papyrus / Gardiner / culture-corpus requests are NOT available on this deployment. Route them to none (chat will explain politely). NEVER map them to any capability or data action.`;
  }
  return `CRITICAL ROUTING RULES FOR ANCIENT CULTURES / EGYPTIAN INSIGHTS:
1. Hieroglyph transcription / Gardiner signs / "scribe this image" -> run_capability scribe.transcribe.image
2. Review/critique papyrus or museum translation -> run_capability translation.critique (or culture.pipeline.run when they want the full handshake)
3. Scrape/harvest Egyptian / British Museum / Louvre primary sources -> run_capability research.scrape.run
4. Search the local culture corpus -> run_capability culture.corpus.search
5. NEVER route Egyptology / hieroglyph / papyrus / Gardiner / Rosetta research to inventory.*, sales.*, forecast_*, stock_on_hand_get, or Cin7/Shopify actions.`;
}

/** Static router system prompt — 100% KV cache hit. No conversation history. */
function buildRouterSystemPrompt(capabilityText) {
  return `You are a strict intent classification engine. Map the user's message to the correct action.

AVAILABLE CAPABILITIES (run now, return result in chat):
${capabilityText}

OTHER ACTIONS:
- stock_on_hand_get: User asks for stock on hand / SOH / units in store / how many we have for a specific SKU. Return sku. NEVER invent a quantity — this action fetches live data.
- web_research_run: Fetches live data from the internet. MUST be used for: news, external prices, market drivers, suppliers; AND whenever the user asks to "dig deeper", "find more info", "expand", or "find additional drivers" about a topic you just researched. Formulate a NEW, more specific search query. Return query (search terms).
- create_intent: User wants to schedule a recurring task. Return schedule and objective.
- create_reminder: User wants a one-off reminder at a specific time (e.g. "remind me to X at 5pm"). Return dueAt (ISO) and objective.
- create_tripwire: User wants a proactive inventory alert (e.g. "alert me if SKU drops below X"). Return sku, field (stock/quantity), operator (<, >, <=, >=, ==), value (number).
- create_digest_schedule: User wants to set when the daily Product Change Summary runs (e.g. "run summary at 4pm", "at 9am"). Return time in HH:MM 24-hour format.
- forecast_get: User wants to see the forecast for a SKU. Return sku.
- forecast_review: User wants analysis/feedback on a SKU forecast (e.g. "review forecast for G10B1", "give me feedback on the forecast"). Return sku.
- forecast_recompute: User wants to rerun/reforecast/update the statistical baseline for one SKU (or all if no SKU). Return sku when specified.
- forecast_override_set: User wants to change/set a manual forecast for a specific month (e.g. "change November to 500", "set forecast for METALCLIP-2.2 in Nov to 500"). Return sku, year_month (YYYY-MM), qty. Convert month names (November, Nov, etc.) to YYYY-MM using current year.
- sales_summary_get: User wants sales performance data (how are sales, top sellers, revenue). Return period ('today'|'yesterday'|'week'|'month'), sku (optional).
- memory_core_update: User expresses a high-level preference to remember (e.g. "I prefer short answers", "always mention SKU codes"). Return preference (text to append to SOUL).
- memory_subconscious_search: User asks about past context or wants to recall prior conversations. Return query (natural language search).
- python_execute: User wants complex math, data analysis, chart generation, or trendline calculation (e.g. "plot copper vs steel sales", "calculate profit margin if we raise prices 4.2%"). Return objective (short description of what to compute or plot).
- email_send: User wants to send an email to a supplier, customer, or contact. Return to (email address), subject, body.
- document_parse: User wants to extract text from a local PDF (catalog, report). Return filePath (e.g. data/catalog.pdf or absolute path).
- browser_actuate: User wants to perform actions on a webpage (click button, fill form). Return url, actions (array of {action:"click"|"type", selector:"#id or .class", value:"text" for type only}).
- legion_deploy_agent: User wants forecasting, pattern recognition, heavy math, or deep research. Deploy a sub-agent. Return role ('quant' for forecasting/math, 'researcher' for web research), taskContext (clear description of the task).
- system_settings_update: User wants to change Piko's internal schedule or automation toggles. Keys: proactiveIntervalHours (number, e.g. 24 for daily), proactiveUpdatesEnabled (true/false), nightlyQuantEnabled (true/false), salesCachePath (absolute or relative path to sales_cache.sqlite), poGenerateDay (Monday-Sunday), poGenerateHour (0-23). Return key, value.
- none: Casual chat, greeting, or doesn't match anything above.

${cultureRoutingRules()}

CRITICAL ROUTING RULES FOR INVENTORY:
1. Stock on hand / SOH / units in store / how many of SKU X -> stock_on_hand_get with sku.
   - Example: "Hi Piko - tell me stock on hand for 48SCOTCH-MED" -> stock_on_hand_get 48SCOTCH-MED
2. Which SKUs need reorder / low stock scan -> inventory.low_stock.scan
3. List/export all reorder products / CSV download -> inventory.report.export or inventory.csv.generate
4. Do NOT use none for stock/sales/forecast/SKU data questions.

CRITICAL ROUTING RULES FOR FORECASTS:
1. RERUN/REFORECAST/UPDATE baseline for a specific SKU -> forecast_recompute with sku (NOT legion_deploy_agent).
2. REVIEW / feedback / analyse a SKU forecast -> forecast_review with sku.
3. READ/SHOW current forecast numbers only -> forecast_get with sku.
4. Update ALL statistical forecasts (whole catalog, quant agent) -> legion_deploy_agent role=quant.

SCHEDULE FORMAT (create_intent): You MUST use one of these exact formats:
- daily HH:MM (24h, e.g. daily 09:00 for 9am)
- hourly HH:MM-HH:MM (24h range, e.g. hourly 06:00-23:00 for every hour 6am–11pm)
- cron min hour dom month dow (e.g. cron 0 17 * * 1-5 for weekdays 5pm)

CRITICAL DISTINCTION - IMMEDIATE VS. SCHEDULED:
If the user asks for data NOW (e.g., "list", "show", "what are", "run", "check", "which SKUs", "stock on hand"), you MUST use run_capability or a data action.
If the user asks to do something LATER or REPEATEDLY (e.g., "every day", "hourly", "remind me", "schedule"), you MUST use create_intent.

FOLLOW-UP RULE: If the previous assistant message offered a CSV download or top-10 list for reorder items, and the user says yes/csv/download/export/top 10, route to inventory.csv.generate or inventory.low_stock.scan accordingly.

DIG DEEPER RULE: If the user asks to "dig deeper", "find more", "expand", or "find additional drivers" about a topic you just researched, DO NOT return "none". You MUST trigger web_research_run again with a NEW, more specific query.

RULES:
1. Respond ONLY with valid JSON. No markdown, no explanation.
2. For run_capability: {"actionType":"run_capability","capability":"<id>"}
3. For create_intent: {"actionType":"create_intent","schedule":"<format>","objective":"<short phrase>"}
4. For create_reminder: {"actionType":"create_reminder","dueAt":"<ISO>","objective":"<text>"}
5. For create_tripwire: {"actionType":"create_tripwire","sku":"<SKU>","field":"stock","operator":"<","value":25}
6. For create_digest_schedule: {"actionType":"create_digest_schedule","time":"HH:MM"} (24h, e.g. 16:00 for 4pm, 09:00 for 9am)
7. For stock_on_hand_get: {"actionType":"stock_on_hand_get","sku":"<SKU>"}
8. For forecast_get: {"actionType":"forecast_get","sku":"<SKU>"}
9. For forecast_review: {"actionType":"forecast_review","sku":"<SKU>"}
10. For forecast_recompute: {"actionType":"forecast_recompute","sku":"<SKU or empty>"}
11. For forecast_override_set: {"actionType":"forecast_override_set","sku":"<SKU>","year_month":"YYYY-MM","qty":<number>}
12. For sales_summary_get: {"actionType":"sales_summary_get","period":"today"|"yesterday"|"week"|"month","sku":"<optional SKU>"}
13. For memory_core_update: {"actionType":"memory_core_update","preference":"<text to append>"}
14. For memory_subconscious_search: {"actionType":"memory_subconscious_search","query":"<search query>"}
15. For web_research_run: {"actionType":"web_research_run","query":"<search terms>"}
16. For python_execute: {"actionType":"python_execute","objective":"<what to compute or plot>"}
17. For email_send: {"actionType":"email_send","to":"<email>","subject":"<subject>","body":"<body text>"}
18. For document_parse: {"actionType":"document_parse","filePath":"<path to PDF>"}
19. For browser_actuate: {"actionType":"browser_actuate","url":"<url>","actions":[{"action":"click","selector":"#id"},{"action":"type","selector":"#input","value":"text"}]}
20. For legion_deploy_agent: {"actionType":"legion_deploy_agent","role":"quant"|"researcher","taskContext":"<task description>"}
21. For system_settings_update: {"actionType":"system_settings_update","key":"...","value":...}
22. For none: {"actionType":"none"}
23. NEVER invent commands like /legion or /queue. Use ONLY the capability IDs from the list above.

EXAMPLES:
User: "Hi Piko - tell me stock on hand for 48SCOTCH-MED"
{"actionType":"stock_on_hand_get","sku":"48SCOTCH-MED"}

User: "how many 48SCOTCH-MED do we have?"
{"actionType":"stock_on_hand_get","sku":"48SCOTCH-MED"}

User: "SOH 48SCOTCH-MED"
{"actionType":"stock_on_hand_get","sku":"48SCOTCH-MED"}

User: "What's pending?"
{"actionType":"run_capability","capability":"system.intents.read"}

User: "How are you doing?"
{"actionType":"none"}

User: "Which SKUs need reorder?"
{"actionType":"run_capability","capability":"inventory.low_stock.scan"}

User: "List all reorder products"
{"actionType":"run_capability","capability":"inventory.report.export"}

User: "download csv"
{"actionType":"run_capability","capability":"inventory.csv.generate"}

User: "How are sales doing today?"
{"actionType":"sales_summary_get","period":"today"}

User: "What's the forecast for METALCLIP-2.2?"
{"actionType":"forecast_get","sku":"METALCLIP-2.2"}

User: "Review the forecast for G10B1 and give me feedback"
{"actionType":"forecast_review","sku":"G10B1"}

User: "Please reforecast SKU G10B1"
{"actionType":"forecast_recompute","sku":"G10B1"}

User: "Schedule low stock scan daily at 9am"
{"actionType":"create_intent","schedule":"daily 09:00","objective":"low stock scan"}
${cultureRoutingExamples()}`;
}

function cultureRoutingExamples() {
  let isCulture = false;
  try {
    isCulture = require('./tenantBackgroundJobs').getTenantBackgroundProfile().isCulture === true;
  } catch (_) {}
  if (!isCulture) {
    return `
User: "Transcribe these hieroglyphs to Gardiner signs"
{"actionType":"none"}`;
  }
  return `
User: "Review this papyrus translation"
{"actionType":"run_capability","capability":"translation.critique"}

User: "Transcribe these hieroglyphs to Gardiner signs"
{"actionType":"run_capability","capability":"scribe.transcribe.image"}

User: "Harvest Egyptian hieroglyph images from the British Museum"
{"actionType":"run_capability","capability":"research.scrape.run"}

User: "Run the full scribe to scholar pipeline on the latest papyrus"
{"actionType":"run_capability","capability":"culture.pipeline.run"}

User: "Search the culture corpus for Rosetta"
{"actionType":"run_capability","capability":"culture.corpus.search"}`;
}

/**
 * Route user message to an action. LLM-only with description-based capabilities.
 * @param {string} userMessage - Raw user message
 * @param {string} model - Ollama model (e.g. piko:finetune)
 * @param {{ lastAssistantMessage?: string }} [opts]
 * @returns {Promise<{ actionType, capability?, schedule?, objective?, dueAt?, intentId?, sku? }>}
 */
async function routeToAction(userMessage, model, opts = {}) {
  const lastAssistant = String(opts.lastAssistantMessage || '').slice(0, 600);

  const capabilities = getCapabilitiesForRouter();
  const capabilityText = capabilities.map((c) => `- ${c.id}: ${c.description}`).join('\n');
  const routerSystemPrompt = buildRouterSystemPrompt(capabilityText);

  const userContent = String(userMessage || '').trim().slice(0, 400);
  const augmentedUser = lastAssistant
    ? `${userContent}\n\n[Context — your last reply to the user: ${lastAssistant.slice(0, 300)}]`
    : userContent;

  const messages = [
    { role: 'system', content: routerSystemPrompt },
    { role: 'user', content: augmentedUser },
  ];

  const routerModel = process.env.PIKO_ROUTER_MODEL || model || process.env.OLLAMA_MODEL || 'piko:finetune';
  const registry = loadCapabilityRegistry();
  const nativeIds = getPikoNativeCapabilityIds();
  const validIds = new Set([...registry.map((c) => c.id), ...nativeIds]);

  const VALID_ACTION_TYPES = [
    'run_capability', 'create_intent', 'create_reminder', 'create_tripwire', 'create_digest_schedule',
    'stock_on_hand_get', 'forecast_get', 'forecast_review', 'forecast_recompute', 'forecast_override_set',
    'sales_summary_get', 'memory_core_update', 'memory_subconscious_search', 'web_research_run',
    'python_execute', 'email_send', 'document_parse', 'browser_actuate', 'legion_deploy_agent',
    'system_settings_update', 'cancel_intent', 'none',
  ];

  const rStart = Date.now();
  try {
    console.log('[ACTION-ROUTER] Asking router to route:', String(userMessage || '').slice(0, 60));
    const routerTimeoutMs = Math.max(2000, Number(process.env.PIKO_OLLAMA_ROUTER_TIMEOUT_MS || 8000));
    const raw = await ollamaNativeChat(routerModel, messages, {
      format: 'json',
      temperature: 0,
      max_tokens: 80,
      timeoutMs: routerTimeoutMs,
    });
    const rTime = ((Date.now() - rStart) / 1000).toFixed(2);
    console.log(`[ACTION-ROUTER] Routing completed in ${rTime}s`);
    if (!raw || typeof raw !== 'string') {
      console.log('[ACTION-ROUTER] Decision: none (no raw response)');
      return { actionType: 'none' };
    }
    const parsed = extractJsonObject(raw);
    const actionType = String(parsed.actionType || 'none').toLowerCase();

    if (!VALID_ACTION_TYPES.includes(actionType)) {
      console.warn(`[ACTION-ROUTER] Hallucination caught: Invalid actionType '${actionType}'`);
      return {
        actionType: 'clarification_needed',
        fallbackMessage: "I'm having a little trouble understanding exactly what you want me to do. Did you want to run a task, check the queue, or schedule something?",
      };
    }

    if (actionType === 'run_capability' && parsed.capability) {
      const cap = String(parsed.capability).trim();
      if (validIds.has(cap)) {
        console.log('[ACTION-ROUTER] Decision: run_capability →', cap);
        return { actionType: 'run_capability', capability: cap };
      }
      console.warn(`[ACTION-ROUTER] Hallucination caught: Invalid capability '${cap}'`);
      return {
        actionType: 'clarification_needed',
        fallbackMessage: "I know you want me to look into something, but I'm not entirely sure which tool to use. Did you want me to run an inventory scan, check sales, or something else?",
      };
    }
    if (actionType === 'stock_on_hand_get' && parsed.sku) {
      const sku = String(parsed.sku || '').trim();
      if (isValidSku(sku)) {
        console.log('[ACTION-ROUTER] Decision: stock_on_hand_get', sku);
        return { actionType: 'stock_on_hand_get', sku };
      }
    }
    if (actionType === 'create_intent' && parsed.schedule && parsed.objective) {
      console.log('[ACTION-ROUTER] Decision: create_intent', String(parsed.schedule).trim());
      return {
        actionType: 'create_intent',
        schedule: String(parsed.schedule).trim(),
        objective: String(parsed.objective).trim().slice(0, 200),
      };
    }
    if (actionType === 'create_reminder' && parsed.dueAt && parsed.objective) {
      console.log('[ACTION-ROUTER] Decision: create_reminder', String(parsed.dueAt).trim());
      return {
        actionType: 'create_reminder',
        dueAt: String(parsed.dueAt).trim(),
        objective: String(parsed.objective).trim().slice(0, 200),
      };
    }
    if (actionType === 'create_tripwire' && parsed.sku && parsed.operator != null && parsed.value != null) {
      const field = String(parsed.field || 'stock').toLowerCase();
      const op = String(parsed.operator).trim();
      if (['<', '<=', '>', '>=', '==', '='].includes(op) && isValidSku(String(parsed.sku).trim())) {
        console.log('[ACTION-ROUTER] Decision: create_tripwire', parsed.sku, field, op, parsed.value);
        return {
          actionType: 'create_tripwire',
          sku: String(parsed.sku).trim(),
          field,
          operator: op === '=' ? '==' : op,
          value: parseFloat(parsed.value),
        };
      }
    }
    if (actionType === 'create_digest_schedule' && parsed.time) {
      const { normalizeTimeString } = require('./tripwireEngine');
      const normalized = normalizeTimeString(parsed.time);
      if (normalized) {
        console.log('[ACTION-ROUTER] Decision: create_digest_schedule', normalized);
        return { actionType: 'create_digest_schedule', time: normalized };
      }
    }
    if (actionType === 'forecast_get' && parsed.sku) {
      const sku = String(parsed.sku || '').trim();
      if (isValidSku(sku)) {
        console.log('[ACTION-ROUTER] Decision: forecast_get', sku);
        return { actionType: 'forecast_get', sku };
      }
    }
    if (actionType === 'forecast_review' && parsed.sku) {
      const sku = String(parsed.sku || '').trim();
      if (isValidSku(sku)) {
        console.log('[ACTION-ROUTER] Decision: forecast_review', sku);
        return { actionType: 'forecast_review', sku };
      }
    }
    if (actionType === 'forecast_recompute') {
      const sku = parsed.sku ? String(parsed.sku).trim() : '';
      console.log('[ACTION-ROUTER] Decision: forecast_recompute', sku || '(catalog)');
      return { actionType: 'forecast_recompute', sku: sku || undefined };
    }
    if (actionType === 'forecast_override_set' && parsed.sku && parsed.year_month != null && parsed.qty != null) {
      const sku = String(parsed.sku || '').trim();
      const ym = String(parsed.year_month || '').trim();
      const qty = parseInt(parsed.qty, 10);
      if (isValidSku(sku) && isYearMonth(ym) && !isNaN(qty)) {
        console.log('[ACTION-ROUTER] Decision: forecast_override_set', sku, ym, qty);
        return { actionType: 'forecast_override_set', sku, year_month: ym, qty };
      }
    }
    if (actionType === 'sales_summary_get') {
      const { normalizePeriod } = require('./salesSummary');
      const period = normalizePeriod(parsed.period || 'today');
      const sku = parsed.sku ? String(parsed.sku).trim() : null;
      console.log('[ACTION-ROUTER] Decision: sales_summary_get', period, sku || '(all)');
      return { actionType: 'sales_summary_get', period, sku };
    }
    if (actionType === 'memory_core_update' && parsed.preference) {
      const pref = String(parsed.preference).trim().slice(0, 500);
      if (pref) {
        console.log('[ACTION-ROUTER] Decision: memory_core_update');
        return { actionType: 'memory_core_update', preference: pref };
      }
    }
    if (actionType === 'memory_subconscious_search' && parsed.query) {
      const q = String(parsed.query).trim().slice(0, 300);
      if (q) {
        console.log('[ACTION-ROUTER] Decision: memory_subconscious_search');
        return { actionType: 'memory_subconscious_search', query: q };
      }
    }
    if (actionType === 'web_research_run' && parsed.query) {
      const q = String(parsed.query).trim().slice(0, 500);
      if (q) {
        console.log('[ACTION-ROUTER] Decision: web_research_run');
        return { actionType: 'web_research_run', query: q };
      }
    }
    if (actionType === 'python_execute' && parsed.objective) {
      const obj = String(parsed.objective).trim().slice(0, 500);
      if (obj) {
        console.log('[ACTION-ROUTER] Decision: python_execute');
        return { actionType: 'python_execute', objective: obj };
      }
    }
    if (actionType === 'email_send' && parsed.to && parsed.subject != null) {
      const to = String(parsed.to).trim();
      const subject = String(parsed.subject || '').trim();
      const body = String(parsed.body || '').trim();
      if (to && subject) {
        console.log('[ACTION-ROUTER] Decision: email_send');
        return { actionType: 'email_send', to, subject, body };
      }
    }
    if (actionType === 'document_parse' && parsed.filePath) {
      const fp = String(parsed.filePath).trim().slice(0, 500);
      if (fp) {
        console.log('[ACTION-ROUTER] Decision: document_parse');
        return { actionType: 'document_parse', filePath: fp };
      }
    }
    if (actionType === 'browser_actuate' && parsed.url && Array.isArray(parsed.actions)) {
      const url = String(parsed.url).trim().slice(0, 500);
      const actions = parsed.actions.slice(0, 10).map((a) => ({
        action: String(a.action || '').toLowerCase(),
        selector: String(a.selector || '').trim(),
        value: a.value != null ? String(a.value) : undefined,
      })).filter((a) => a.action && a.selector);
      if (url && actions.length > 0) {
        console.log('[ACTION-ROUTER] Decision: browser_actuate');
        return { actionType: 'browser_actuate', url, actions };
      }
    }
    if (actionType === 'legion_deploy_agent' && parsed.role && parsed.taskContext) {
      const role = String(parsed.role).toLowerCase();
      const taskContext = String(parsed.taskContext).trim().slice(0, 1000);
      if (['quant', 'researcher'].includes(role) && taskContext) {
        console.log('[ACTION-ROUTER] Decision: legion_deploy_agent', role);
        return { actionType: 'legion_deploy_agent', role, taskContext };
      }
    }
    if (actionType === 'system_settings_update' && parsed.key != null) {
      console.log('[ACTION-ROUTER] Decision: system_settings_update', parsed.key);
      return { actionType: 'system_settings_update', key: String(parsed.key), value: parsed.value };
    }
    if (actionType === 'cancel_intent' && validIds.has('system.intents.manage')) {
      console.log('[ACTION-ROUTER] Decision: run_capability → system.intents.manage (re-routed cancel_intent)');
      return { actionType: 'run_capability', capability: 'system.intents.manage' };
    }
    console.log('[ACTION-ROUTER] Decision: none');
    return { actionType: 'none' };
  } catch (e) {
    const rTime = ((Date.now() - rStart) / 1000).toFixed(2);
    console.error(`[ACTION-ROUTER] Routing FAILED after ${rTime}s`, e.message);
    return { actionType: 'none' };
  }
}

module.exports = {
  routeToAction,
  loadCapabilityRegistry,
  getPikoNativeCapabilityIds,
  buildRouterSystemPrompt,
  capabilityAllowedForProfile,
  PIKO_NATIVE_CAPABILITIES: getPikoNativeCapabilityIds(),
};
