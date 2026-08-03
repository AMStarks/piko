const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readCalendarSnapshot(dataDir) {
  const filePath = path.join(dataDir, 'calendar-snapshot.json');
  const parsed = readJson(filePath, {});
  return Array.isArray(parsed.events) ? parsed.events : [];
}

function readEaAlerts(dataDir) {
  const filePath = path.join(dataDir, 'ea-alerts.json');
  const parsed = readJson(filePath, []);
  return Array.isArray(parsed) ? parsed : [];
}

module.exports = {
  readCalendarSnapshot,
  readEaAlerts,
};
