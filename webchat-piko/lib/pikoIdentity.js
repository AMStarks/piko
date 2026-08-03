/**
 * Universal identity header — injected into every chat/triage/synthesis lane
 * so fast paths never claim Piko "can't" do work he actually can.
 */
const path = require('path');

// Tenant-neutral: specific tools/domains come from the tenant persona pack
// (PERSONA.md), never hardcoded here — no cross-tenant capability bleed.
const BASE_IDENTITY = `SYSTEM IDENTITY: You are Piko, an autonomous operations AI. You orchestrate Legion tasks, background scheduled jobs, and the business or research tools configured for this deployment. You can view, schedule, start, cancel, and review this work when asked. You are not "just a chat mate" — chat is one surface; agents and tools are real.`;

const LEGATE_IDENTITY_ADDON = `LEGATE ROLE: You are the Legate. FIRST read and understand THIS operator message on its own — exact title, author, singular vs plural, constraints. Only THEN decide: answer directly, or dispatch a specialist. Never rewrite the ask into a broader mission. Never pretend corpus ingest or research succeeded without a reviewed agent result. Never invent corpus counts, author lists, or agent status — use local lookups for those facts.`;

/**
 * @returns {string}
 */
function getLegateIdentityAddon() {
  return LEGATE_IDENTITY_ADDON;
}

/**
 * @param {string} [rootDir]
 * @returns {string}
 */
function getUniversalIdentityHeader(rootDir) {
  const root = rootDir || path.join(__dirname, '..');
  let extra = '';
  try {
    const { isAgentOrchEnabled, listAgents } = require('./agentOrchestrator');
    if (isAgentOrchEnabled(root)) {
      const ids = listAgents(root).map((a) => a.id).slice(0, 12);
      extra = `\nAGENT ORCH (this spine): enabled. Named agents you can put on tasks: ${ids.join(', ') || '(none registered)'}. Chat: /agents, /agent run <id> <brief>, /agents status, /agent stop <job_id>. Dashboard Agents tab works the same.`;
    }
  } catch (_) {}
  try {
    const off = String(process.env.PIKO_LEGATE_CHAT || '').trim().toLowerCase();
    const forcedOn = off === '1' || off === 'true' || off === 'yes' || off === 'on';
    const forcedOff = off === '0' || off === 'false' || off === 'off';
    const { getTenantBackgroundProfile } = require('./tenantBackgroundJobs');
    const culture = getTenantBackgroundProfile(root).isCulture === true;
    if (!forcedOff && (forcedOn || culture)) {
      extra += `\n${LEGATE_IDENTITY_ADDON}`;
    }
  } catch (_) {}
  try {
    const overlay = require('./personaPack').getPersonaOverlay();
    if (overlay) extra += `\nTENANT PERSONA: ${overlay}`;
  } catch (_) {}
  return BASE_IDENTITY + extra;
}

/**
 * Prepend identity to any system prompt string.
 * @param {string} prompt
 * @param {string} [rootDir]
 */
function withUniversalIdentity(prompt, rootDir) {
  const header = getUniversalIdentityHeader(rootDir);
  const body = String(prompt || '').trim();
  if (!body) return header;
  if (body.startsWith('SYSTEM IDENTITY:')) return body;
  return `${header}\n\n${body}`;
}

module.exports = {
  BASE_IDENTITY,
  LEGATE_IDENTITY_ADDON,
  getLegateIdentityAddon,
  getUniversalIdentityHeader,
  withUniversalIdentity,
};
