/**
 * P3 Tier 3 — runtime enable/disable for background jobs (in-process + preference for external).
 */
const fs = require('fs');
const path = require('path');
const { listControllableJobs } = require('./operationsRegistry');

function getDataDir() {
  return process.env.PIKO_DATA_DIR || path.join(__dirname, '..', 'data');
}

function getOverridePath() {
  return path.join(getDataDir(), 'operations-overrides.json');
}

function loadOverrides() {
  try {
    const p = getOverridePath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveOverrides(overrides) {
  const p = getOverridePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(overrides, null, 2), 'utf8');
}

function getJobOverride(jobId) {
  const all = loadOverrides();
  return all[jobId] || null;
}

function isJobEnabled(jobId) {
  const row = getJobOverride(jobId);
  if (row && row.enabled === false) return false;
  if (row && row.enabled === true) return true;
  return true;
}

function setJobEnabled(jobId, enabled, meta = {}) {
  if (!listControllableJobs().some((j) => j.id === jobId)) {
    return { ok: false, error: `Unknown job: ${jobId}` };
  }
  const all = loadOverrides();
  all[jobId] = {
    enabled: !!enabled,
    updatedAt: new Date().toISOString(),
    ...meta,
  };
  saveOverrides(all);
  return { ok: true, jobId, enabled: !!enabled };
}

function getOperationsStatus() {
  const { getConfig } = require('./configManager');
  const config = getConfig();
  const overrides = loadOverrides();
  return listControllableJobs().map((job) => {
    let enabled = isJobEnabled(job.id);
    let control = 'override';
    if (job.toggleType === 'config' && job.configKey) {
      control = 'config';
      enabled = config[job.configKey] !== false;
    }
    return {
      id: job.id,
      name: job.name,
      source: job.source,
      control,
      enabled,
      override: overrides[job.id] || null,
      purpose: job.purpose || '',
    };
  });
}

module.exports = {
  loadOverrides,
  isJobEnabled,
  setJobEnabled,
  getOperationsStatus,
  getJobOverride,
};
