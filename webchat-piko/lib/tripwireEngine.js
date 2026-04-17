/**
 * Agnostic Tripwire Engine — user-defined rules (e.g. "alert if SKU drops below X").
 * Rules stored in data/tripwires.json; evaluated every 5 min by proactive loop.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
const TRIPWIRES_FILE = path.join(DATA_DIR, 'tripwires.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'digest_schedules.json');
const AUSMAKER_BASE_URL = String(process.env.AUSMAKER_BASE_URL || process.env.PIKO_AUSMAKER_BASE_URL || 'http://127.0.0.1:5001').trim();

function loadTripwires() {
  try {
    fs.mkdirSync(path.dirname(TRIPWIRES_FILE), { recursive: true });
    if (!fs.existsSync(TRIPWIRES_FILE)) return [];
    const raw = fs.readFileSync(TRIPWIRES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[tripwire] load:', e.message);
    return [];
  }
}

function saveTripwires(tripwires) {
  try {
    fs.mkdirSync(path.dirname(TRIPWIRES_FILE), { recursive: true });
    fs.writeFileSync(TRIPWIRES_FILE, JSON.stringify(tripwires, null, 2), 'utf8');
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[tripwire] save:', e.message);
  }
}

/**
 * Add a new tripwire rule. Called by Piko's Action Router.
 */
function addTripwire(sku, field, operator, value) {
  const tripwires = loadTripwires();
  const newRule = {
    id: Date.now().toString(),
    sku: String(sku || '').toUpperCase().trim(),
    field: String(field || 'stock').toLowerCase(),
    operator: String(operator || '<').trim(),
    value: parseFloat(value),
    isTriggered: false,
    createdAt: new Date().toISOString(),
  };
  tripwires.push(newRule);
  saveTripwires(tripwires);
  return newRule;
}

/**
 * Agnostic evaluation loop. Called by the proactive cron every 5 min.
 * @param {function(string): Promise<void>} sendAlertCallback - e.g. (msg) => telegramNotify(msg)
 */
async function evaluateTripwires(sendAlertCallback) {
  const tripwires = loadTripwires();
  const activeRules = tripwires.filter((t) => !t.isTriggered);
  if (activeRules.length === 0) return;

  try {
    const { getUrl } = require('./legionRunPoller');
    const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/forecast`;
    const res = await getUrl(url);
    if (res.statusCode !== 200) return;
    const data = JSON.parse(res.body || '{}');
    const items = data.purchase_order_items || data.purchase_recommendations || [];

    let stateChanged = false;

    for (const rule of activeRules) {
      const item = items.find(
        (i) =>
          (String(i.shopify_sku || i.sku || i['Shopify SKU'] || '').toUpperCase() === rule.sku) ||
          (String(i.cin7_sku || '').toUpperCase() === rule.sku)
      );
      if (!item) continue;

      let currentValue;
      if (rule.field.includes('quant') || rule.field.includes('stock') || rule.field === 'inventory') {
        currentValue = parseFloat(item.current_inventory ?? item['Current Inventory'] ?? item.quantity ?? item.soh ?? 0);
      } else if (rule.field === 'demand' || rule.field.includes('forecast')) {
        currentValue = parseFloat(item.forecasted_demand ?? item['Forecasted Demand'] ?? item.total_forecasted_units ?? 0);
      } else {
        currentValue = parseFloat(item[rule.field] ?? item[rule.field.replace(/_/g, ' ')] ?? 0);
      }

      let isConditionMet = false;
      if (rule.operator === '<') isConditionMet = currentValue < rule.value;
      else if (rule.operator === '<=') isConditionMet = currentValue <= rule.value;
      else if (rule.operator === '>') isConditionMet = currentValue > rule.value;
      else if (rule.operator === '>=') isConditionMet = currentValue >= rule.value;
      else if (rule.operator === '==' || rule.operator === '=') isConditionMet = currentValue === rule.value;

      if (isConditionMet) {
        const msg = `🚨 **Tripwire Alert for ${rule.sku}**\nYour rule (${rule.field} ${rule.operator} ${rule.value}) was triggered! Current value is **${currentValue}**.`;
        if (typeof sendAlertCallback === 'function') {
          await sendAlertCallback(msg);
        } else {
          console.log('[PROACTIVE MESSAGE TO USER]:', msg);
        }
        rule.isTriggered = true;
        stateChanged = true;
      }
    }

    if (stateChanged) saveTripwires(tripwires);
  } catch (e) {
    console.error('[TRIPWIRE] Evaluation failed:', e.message);
  }
}

// —— Dynamic Schedule Engine (digest_schedules.json) ——
function loadSchedules() {
  try {
    fs.mkdirSync(path.dirname(SCHEDULES_FILE), { recursive: true });
    if (!fs.existsSync(SCHEDULES_FILE)) return [];
    const raw = fs.readFileSync(SCHEDULES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[schedule] load:', e.message);
    return [];
  }
}

function saveSchedules(schedules) {
  try {
    fs.mkdirSync(path.dirname(SCHEDULES_FILE), { recursive: true });
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf8');
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[schedule] save:', e.message);
  }
}

/** Clear all digest schedules (user requested stop). Writes empty array to digest_schedules.json. */
function clearDigestSchedule() {
  try {
    saveSchedules([]);
    if (process.env.PIKO_LOG_PLANNER === '1') console.log('[TRIPWIRE] Digest schedule cleared by user.');
    return true;
  } catch (e) {
    console.error('[TRIPWIRE] Failed to clear digest schedule:', e);
    return false;
  }
}

/** Add or update a daily digest schedule. timeString in "HH:MM" 24-hour format. */
function addSummarySchedule(timeString) {
  const normalized = normalizeTimeString(timeString);
  if (!normalized) return null;
  const schedules = loadSchedules();
  const exists = schedules.find((s) => s.time === normalized);
  if (!exists) {
    schedules.push({ time: normalized, lastSentDate: null });
    saveSchedules(schedules);
  }
  return normalized;
}

/** Normalize "4pm", "16:00", "4:00 PM" → "16:00" */
function normalizeTimeString(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const hhmm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Math.min(23, Math.max(0, parseInt(hhmm[1], 10)));
    const m = Math.min(59, Math.max(0, parseInt(hhmm[2], 10)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const pm = /(\d{1,2})\s*(?:am|pm|a\.m\.|p\.m\.)/i.exec(t);
  if (pm) {
    let h = parseInt(pm[1], 10);
    if (/p\.?m/i.test(t)) h = h === 12 ? 12 : h + 12;
    else if (/a\.?m/i.test(t)) h = h === 12 ? 0 : h;
    h = Math.min(23, Math.max(0, h));
    return `${String(h).padStart(2, '0')}:00`;
  }
  const hOnly = /^(\d{1,2})$/;
  if (hOnly.test(t)) {
    const h = Math.min(23, Math.max(0, parseInt(t, 10)));
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

/** Build and send the daily digest (product change summary). Calls sendCallback with the message. */
async function flushDailyDigest(sendCallback) {
  const EA_ALERTS_FILE = path.join(DATA_DIR, 'ea-alerts.json');
  const INTENTS_FILE = path.join(DATA_DIR, 'intents.json');
  const EOD_SESSION = process.env.PIKO_EA_EOD_SESSION || 'main';

  function getYesterdaySummary() {
    try {
      const dm = require('./dailyMemory');
      const summaries = dm.getSummaries(EOD_SESSION, 3);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const row = summaries.find((s) => s.date === yesterdayStr);
      return row ? row.summary_text : null;
    } catch (_) {
      return null;
    }
  }

  function getTodayAlertsCount() {
    try {
      if (!fs.existsSync(EA_ALERTS_FILE)) return 0;
      const raw = fs.readFileSync(EA_ALERTS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return 0;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const cutoff = todayStart.getTime();
      return list.filter((a) => (a.at || 0) >= cutoff).length;
    } catch (_) {
      return 0;
    }
  }

  function getNextReminder() {
    try {
      if (!fs.existsSync(INTENTS_FILE)) return null;
      const raw = fs.readFileSync(INTENTS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      const now = new Date();
      const reminders = (Array.isArray(arr) ? arr : []).filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
      const dueAt = (r) => r.dueAt || r.time;
      const next = reminders.filter((r) => new Date(dueAt(r) || 0) > now).sort((a, b) => new Date(dueAt(a)) - new Date(dueAt(b)))[0];
      if (next) return (next.title || next.message || next.text || '').slice(0, 80);
    } catch (_) {}
    return null;
  }

  const yesterdayStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const summary = getYesterdaySummary();
  const alertsToday = getTodayAlertsCount();
  const nextRem = getNextReminder();

  const parts = ['📋 Product Change Summary'];
  if (summary) parts.push(`Yesterday (${yesterdayStr}): ${summary.slice(0, 400)}${summary.length > 400 ? '…' : ''}`);
  parts.push(`Look-in alerts today: ${alertsToday}`);
  if (nextRem) parts.push(`Next reminder: ${nextRem}`);

  const message = parts.join('\n\n');
  if (typeof sendCallback === 'function') {
    await sendCallback(message);
  } else {
    console.log('[DAILY DIGEST]:', message.slice(0, 120) + '…');
  }
}

/**
 * Weekly PO Draft — fetch master CSV from AusMaker and send via Telegram.
 * Uses Markdown Data URI for clickable download link.
 * @param {function(string): Promise<void>} sendReportCallback - e.g. (msg) => telegramNotify(msg)
 */
async function flushWeeklyPO(sendReportCallback) {
  try {
    const { getUrl } = require('./legionRunPoller');
    const url = `${AUSMAKER_BASE_URL.replace(/\/$/, '')}/api/purchase_orders/draft_csv`;
    const res = await getUrl(url);
    if (res.statusCode !== 200) {
      console.error('[WEEKLY PO] draft_csv failed', { url, statusCode: res.statusCode, bodySnippet: (res.body || '').slice(0, 200) });
      throw new Error(`API returned ${res.statusCode} for ${url} (check AUSMAKER_BASE_URL / PIKO_AUSMAKER_BASE_URL and that AusMaker app is this repo version with GET /api/purchase_orders/draft_csv)`);
    }
    const csvText = res.body || '';
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) {
      const msg = "I checked the forecasts, and we have sufficient stock across the board. No POs needed this week!";
      if (typeof sendReportCallback === 'function') {
        await sendReportCallback(msg);
      } else {
        console.log('[WEEKLY PO]:', msg);
      }
      return;
    }
    const encodedCsv = encodeURIComponent(csvText);
    const dataUri = `data:text/csv;charset=utf-8,${encodedCsv}`;
    const message = `I've drafted a single PO recommendation for your suppliers based on this week's forecast.\n\n[📥 Click here to download your Weekly PO Draft](${dataUri})`;
    if (typeof sendReportCallback === 'function') {
      await sendReportCallback(message);
    } else {
      console.log('[WEEKLY PO TO USER]:', message.slice(0, 80) + '…');
    }
  } catch (err) {
    console.error('[WEEKLY PO] Failed to generate PO draft:', err.message);
    if (typeof sendReportCallback === 'function') {
      await sendReportCallback(`Sorry, I couldn't generate the Weekly PO draft. ${err.message}`);
    }
  }
}

module.exports = {
  addTripwire,
  evaluateTripwires,
  loadTripwires,
  saveTripwires,
  loadSchedules,
  saveSchedules,
  addSummarySchedule,
  clearDigestSchedule,
  flushDailyDigest,
  flushWeeklyPO,
  normalizeTimeString,
};
