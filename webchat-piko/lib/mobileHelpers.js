/**
 * Mobile preferences + URL helpers (P6.4 extract from server.js).
 */
const fs = require('fs');
const path = require('path');

function createMobileHelpers(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const preferencesFile = opts.preferencesFile || path.join(dataDir, 'ea-preferences.json');
  const loadIntents = opts.loadIntents || (() => []);
  const stripTrailingSlash = opts.stripTrailingSlash
    || ((s) => {
      let t = String(s || '');
      while (t.endsWith('/')) t = t.slice(0, -1);
      return t;
    });
  const mergeMobilePreferences = opts.mergeMobilePreferences
    || ((cur, next) => ({ ...cur, ...(next || {}), updatedAt: new Date().toISOString() }));

  function loadMobilePreferences() {
    const defaults = {
      quietStart: null,
      quietEnd: null,
      mobilePushEnabled: true,
      backgroundSyncEnabled: true,
      updatedAt: null,
    };
    try {
      if (!fs.existsSync(preferencesFile)) return defaults;
      const raw = fs.readFileSync(preferencesFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        ...defaults,
        ...parsed,
        mobilePushEnabled: parsed.mobilePushEnabled !== false,
        backgroundSyncEnabled: parsed.backgroundSyncEnabled !== false,
        updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : null,
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveMobilePreferences(nextPrefs, expectedUpdatedAt) {
    const current = loadMobilePreferences();
    const expected = String(expectedUpdatedAt || '').trim();
    if (expected && current.updatedAt && expected !== current.updatedAt) {
      const err = new Error('Preference version conflict');
      err.code = 'PREFERENCES_CONFLICT';
      err.current = current;
      throw err;
    }
    const merged = mergeMobilePreferences(current, nextPrefs);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(preferencesFile, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }

  function buildIntentSnapshot(now) {
    const intents = loadIntents();
    const reminders = intents.filter((i) => i.type === 'reminder' && (i.status === 'pending' || !i.status));
    const scheduled = intents.filter((i) => i.type === 'scheduled' && (i.status === 'pending' || !i.status));
    const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
    const reminderDue = (r) => r.dueAt || r.time;
    const scheduledRun = (s) => s.dueAt || s.run;
    const nextReminder = reminders
      .filter((r) => new Date(reminderDue(r) || 0) > now)
      .sort((a, b) => new Date(reminderDue(a)) - new Date(reminderDue(b)))[0] || null;
    const nextScheduled = scheduled
      .filter((s) => new Date(scheduledRun(s) || 0) > now)
      .sort((a, b) => new Date(scheduledRun(a)) - new Date(scheduledRun(b)))[0] || null;
    return {
      queueLength: queue.length,
      remindersCount: reminders.length,
      scheduledCount: scheduled.length,
      nextReminder: nextReminder ? {
        at: reminderDue(nextReminder),
        text: (nextReminder.title || nextReminder.message || nextReminder.text || '').slice(0, 120),
      } : null,
      nextScheduled: nextScheduled ? {
        at: scheduledRun(nextScheduled),
        command: (nextScheduled.command || '').slice(0, 120),
      } : null,
    };
  }

  function getMobilePollHintSeconds(intentSnapshot) {
    if (intentSnapshot.nextReminder) return 60;
    if (intentSnapshot.queueLength > 0) return 120;
    return 300;
  }

  function getMobileLanBaseURL() {
    const fromEnv = stripTrailingSlash(String(process.env.PIKO_LAN_BASE_URL || process.env.PIKO_IOS_BASE_URL || '').trim());
    if (fromEnv) return fromEnv;
    try {
      const { execSync } = require('child_process');
      const out = String(execSync('hostname -I', { encoding: 'utf8', timeout: 2000 })).trim().split(' ').filter(Boolean);
      const ip = out.find((x) => x.startsWith('192.168.') || x.startsWith('10.'));
      if (ip) return `http://${ip}:3000`;
    } catch (_) { /* ignore */ }
    return null;
  }

  function getMobilePublicBaseURL() {
    const fromEnv = stripTrailingSlash(String(process.env.PIKO_PUBLIC_BASE_URL || process.env.PIKO_IOS_PUBLIC_URL || '').trim());
    if (fromEnv) return fromEnv;
    const defaultPublic = 'https://andrewstarkey.net/piko';
    if (process.env.PIKO_DEFAULT_PUBLIC_URL !== '0') return defaultPublic;
    try {
      const filePath = process.env.PIKO_IOS_PUBLIC_URL_FILE || '/opt/piko/ios_public_url.txt';
      if (fs.existsSync(filePath)) {
        const raw = stripTrailingSlash(String(fs.readFileSync(filePath, 'utf8')).trim());
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  return {
    loadMobilePreferences,
    saveMobilePreferences,
    buildIntentSnapshot,
    getMobilePollHintSeconds,
    getMobileLanBaseURL,
    getMobilePublicBaseURL,
  };
}

module.exports = { createMobileHelpers };
