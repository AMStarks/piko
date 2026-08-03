#!/usr/bin/env node
/**
 * Operate ei-text-scout from Cursor / CLI.
 *
 * Local (against Optimus API):
 *   PIKO_EI_BASE=http://127.0.0.1:3021 node scripts/operate-ei-text-scout.js --site giza
 *   node scripts/operate-ei-text-scout.js --assess-only --sites abydos,heliopolis,giza
 *   node scripts/operate-ei-text-scout.js --async --find
 *
 * In-process (needs EGYPTIAN_INSIGHTS_DATA_DIR + agent orch env):
 *   node scripts/operate-ei-text-scout.js --local --assess-only
 */
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}

function opt(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}

function buildBrief() {
  const sitesRaw = opt('--sites', '') || (opt('--site', '') ? opt('--site') : '');
  const sites = sitesRaw
    ? String(sitesRaw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    find: flag('--assess-only') ? false : !flag('--no-find'),
    assess: !flag('--find-only'),
    sites: sites && sites.length ? sites : undefined,
    limit: Number(opt('--limit', '8')) || 8,
    harvest_limit: Number(opt('--harvest-limit', '5')) || 5,
  };
}

const { stripTrailingSlash } = require('../lib/text');

async function viaHttp(brief) {
  const base = stripTrailingSlash(String(process.env.PIKO_EI_BASE || 'http://127.0.0.1:3021'));
  const asyncMode = flag('--async');
  const body = {
    ...brief,
    brief: JSON.stringify(brief),
    async: asyncMode,
    source: 'operate_cli',
  };
  const res = await fetch(`${base}/api/ei/text-scout/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  if (asyncMode) {
    console.log(JSON.stringify(data, null, 2));
    const jobId = data.job && data.job.id;
    if (!jobId) return;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const jr = await fetch(`${base}/api/agents/jobs/${jobId}`);
      const jd = await jr.json();
      const st = jd.job && jd.job.status;
      process.stderr.write(`poll ${i + 1}: ${st}\n`);
      if (st === 'done' || st === 'failed' || st === 'cancelled') {
        console.log(jd.job.result && jd.job.result.reply_snip
          ? jd.job.result.reply_snip
          : JSON.stringify(jd.job, null, 2));
        process.exit(st === 'done' && jd.job.result && jd.job.result.ok !== false ? 0 : 2);
      }
    }
    process.exit(3);
  }
  console.log(data.artifact_text || JSON.stringify(data, null, 2));
  process.exit(data.pass ? 0 : 2);
}

async function viaLocal(brief) {
  process.chdir(root);
  const { runTextScout } = require('../lib/eiTextScout');
  const out = await runTextScout({
    rootDir: root,
    ...brief,
    brief: JSON.stringify(brief),
    source: 'operate_cli_local',
  });
  console.log(out.artifact_text);
  process.exit(out.pass ? 0 : 2);
}

async function main() {
  const brief = buildBrief();
  if (flag('--local')) return viaLocal(brief);
  return viaHttp(brief);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
