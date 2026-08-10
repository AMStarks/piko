const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withDataDir(fn) {
  const prev = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
  const prevIngest = process.env.PIKO_RESEARCH_PM_INGEST;
  const prevDigest = process.env.PIKO_RESEARCH_PM_DIGEST;
  const prevSeeker = process.env.PIKO_EI_SEEKER_LLM;
  const prevConfirm = process.env.PIKO_RESEARCH_PM_CONFIRM_LLM;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-pm-'));
  process.env.EGYPTIAN_INSIGHTS_DATA_DIR = dir;
  process.env.PIKO_RESEARCH_PM_INGEST = '0';
  process.env.PIKO_RESEARCH_PM_DIGEST = '0';
  process.env.PIKO_EI_SEEKER_LLM = '0';
  process.env.PIKO_RESEARCH_PM_CONFIRM_LLM = '0';
  for (const key of Object.keys(require.cache)) {
    if (/eiResearchPm|eiSeeker|eiResearchCampaign|culturesCorpusApi|eiAgentTools|eiWorkPlanner|agentReview/.test(key)) {
      delete require.cache[key];
    }
  }
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (prev == null) delete process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
      else process.env.EGYPTIAN_INSIGHTS_DATA_DIR = prev;
      if (prevIngest == null) delete process.env.PIKO_RESEARCH_PM_INGEST;
      else process.env.PIKO_RESEARCH_PM_INGEST = prevIngest;
      if (prevDigest == null) delete process.env.PIKO_RESEARCH_PM_DIGEST;
      else process.env.PIKO_RESEARCH_PM_DIGEST = prevDigest;
      if (prevSeeker == null) delete process.env.PIKO_EI_SEEKER_LLM;
      else process.env.PIKO_EI_SEEKER_LLM = prevSeeker;
      if (prevConfirm == null) delete process.env.PIKO_RESEARCH_PM_CONFIRM_LLM;
      else process.env.PIKO_RESEARCH_PM_CONFIRM_LLM = prevConfirm;
    });
}

test('A: startPm pauses campaign daemon; dueForCycle is false', async () => {
  await withDataDir(async (dir) => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    camp.saveState({
      ...camp.loadState(),
      enabled: true,
      paused: false,
      topic: 'forklift topic',
      leads: [],
      thread_coverage: { 'self-view': { keeps: 2 } },
    });
    assert.equal(camp.dueForCycle(), true);
    const out = pm.startPm({ topic: 'Egyptian primary self-view' });
    assert.equal(out.ok, true);
    assert.equal(pm.isPmManaging(), true);
    const afterCamp = camp.loadState();
    assert.equal(afterCamp.enabled, false);
    assert.equal(afterCamp.paused, true);
    assert.equal(camp.dueForCycle(), false);
    assert.ok(fs.existsSync(path.join(dir, 'research_pm.json')));
  });
});

test('iaDjvuTxtUrl from details/download', () => {
  const { iaDjvuTxtUrl } = require('../lib/eiSeeker');
  assert.equal(
    iaDjvuTxtUrl('https://archive.org/details/diealtaegyptisch03sethuoft'),
    'https://archive.org/stream/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_djvu.txt',
  );
});

test('retag: titleLooksHeliopolis needs site cue; self-view matches PT/BoD', () => {
  const pm = require('../lib/eiResearchPm');
  assert.equal(pm.titleLooksSelfView('The Pyramid Texts Index'), true);
  assert.equal(pm.titleLooksSelfView('The Egyptian Book of the Dead'), true);
  assert.equal(pm.titleLooksHeliopolis('Heliopolis, Kafr Ammar And Shurafa : Petrie'), true);
  assert.equal(pm.titleLooksHeliopolis('The Life and Confession of Asenath: The Daughter of Pentephres of Heliopolis'), false);
});

test('A: proposeNextWork prefers dead self-view over supporting', async () => {
  await withDataDir(async () => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    camp.saveState({
      ...camp.loadState(),
      thread_coverage: {
        'self-view': { keeps: 1 },
        heliopolis: { keeps: 8 },
        'premodern-reception': { keeps: 20 },
        abydos: { keeps: 20 },
        giza: { keeps: 20 },
        atlantis: { keeps: 40 },
        'gobekli-tepe': { keeps: 20 },
      },
    });
    const proposed = pm.proposeNextWork();
    assert.equal(proposed.ok, true);
    assert.equal(proposed.work.thread, 'self-view');
    assert.ok((proposed.work.seed_urls || []).length);
    assert.match(proposed.work.why || '', /keep floor|self-view/i);
  });
});

test('harvestIdFromIngest reads items[].harvest_id when top-level hid missing', () => {
  const pm = require('../lib/eiResearchPm');
  assert.equal(pm.harvestIdFromIngest({ result: { items: [{ harvest_id: 2403 }] } }), 2403);
  assert.equal(pm.harvestIdFromIngest({ result: { harvest_id: 12, items: [{ id: 99 }] } }), 12);
});

test('substantiveIngest ignores scrape out.ok; thin and hid-only fail', () => {
  const pm = require('../lib/eiResearchPm');
  assert.equal(pm.substantiveIngest(2403, 50000).ok, true);
  assert.equal(pm.substantiveIngest(2402, 120).ok, false);
  assert.equal(pm.substantiveIngest(2402, 120).reason, 'thin_extract');
  assert.equal(pm.substantiveIngest(2401, 0).ok, false);
  assert.equal(pm.substantiveIngest(null, 9000).ok, false);
});

test('Westcar seed is live IA OCR, not the thin rhbarnhart PDF', () => {
  const { getSeeds } = require('../lib/eiSeedPack');
  const w = getSeeds().find((s) => (s.title_hints || []).some((t) => /westcar/i.test(t)));
  assert.ok(w);
  assert.ok((w.urls || []).some((u) => /DieMarchenDesPapyrusWestcar1/i.test(u)));
  assert.ok(!(w.urls || []).some((u) => /rhbarnhart/i.test(u)));
});

test('Petrie Heliopolis seed is live IA, not Heidelberg diglit viewer', () => {
  const { getSeeds } = require('../lib/eiSeedPack');
  const h = getSeeds().find((s) =>
    s.thread === 'heliopolis'
    && (s.authors || []).some((a) => /petrie/i.test(a))
    && (s.title_hints || []).some((t) => /^heliopolis$/i.test(t) || /kafr ammar/i.test(t)));
  assert.ok(h);
  assert.ok((h.ia_ids || []).includes('heliopoliskafram0000wmfl'));
  assert.ok((h.urls || []).some((u) => /heliopoliskafram0000wmfl/i.test(u)));
  assert.ok(!(h.urls || []).some((u) => /digi\.ub\.uni-heidelberg/i.test(u)));
});

test('Perseus text↔dltext share dead memory so propose cannot loop', async () => {
  await withDataDir(async () => {
    const pm = require('../lib/eiResearchPm');
    const text = 'https://www.perseus.tufts.edu/hopper/text?doc=Plut.+Isis';
    const dl = 'https://www.perseus.tufts.edu/hopper/dltext?doc=Plut.+Isis';
    const s = pm.loadState();
    pm.rememberFailedUrl(s, dl, 'url_unreachable');
    pm.saveState(s);
    assert.equal(pm.seedUrlStatus(dl), 'dead');
    assert.equal(pm.seedUrlStatus(text), 'dead');
    assert.ok(pm.urlDeadAliases(text).includes(pm.normalizeUrlKey(dl)));
  });
});

test('woah→go: ingest_failed marks URL dead; next propose never reuses it', async () => {
  await withDataDir(async () => {
    process.env.PIKO_RESEARCH_PM_INGEST = '1';
    process.env.PIKO_RESEARCH_PM_DIGEST = '0';
    const toolsPath = require.resolve('../lib/eiAgentTools');
    const tools = require('../lib/eiAgentTools');
    const origRun = tools.runTool;
    tools.runTool = async () => ({ ok: false, result: { items: [], errors: ['forced_fail'] } });
    try {
      for (const key of Object.keys(require.cache)) {
        if (/eiResearchPm|eiSeeker/.test(key)) delete require.cache[key];
      }
      const camp = require('../lib/eiResearchCampaign');
      const pm = require('../lib/eiResearchPm');
      const seeker = require('../lib/eiSeeker');
      camp.saveState({
        ...camp.loadState(),
        thread_coverage: { 'self-view': { keeps: 4 }, heliopolis: { keeps: 0 }, abydos: { keeps: 5 } },
      });
      pm.startPm({ topic: 'spine' });
      const bad = 'https://digi.ub.uni-heidelberg.de/diglit/petrie1915';
      const raw = seeker.heuristicPacket({
        title: 'Heliopolis',
        author: 'W. M. Flinders Petrie',
        thread: 'heliopolis',
        seed_urls: [bad],
        why: 'Heliopolis under floor.',
      });
      raw.url = bad;
      const accepted = pm.acceptSeekerPacket(raw);
      const out = await pm.confirmPacket(accepted.id, {
        verdict: 'keep',
        thread: 'heliopolis',
        why: 'test keep',
        url: bad,
      }, { noAltRetry: true, by: 'piko' });
      assert.equal(out.ok, false);
      assert.equal(out.packet.status, 'ingest_failed');
      assert.equal(pm.seedUrlStatus(bad), 'dead');
      assert.ok(pm.loadState().dead_urls && Object.keys(pm.loadState().dead_urls).length >= 1);

      // Exact overnight failure mode: propose again must not hand back Heidelberg.
      const again = pm.proposeNextWork();
      assert.equal(again.ok, true, JSON.stringify(again));
      const urls = again.work.seed_urls || [];
      assert.ok(!urls.some((u) => /digi\.ub\.uni-heidelberg\.de\/diglit\/petrie1915/i.test(u)), JSON.stringify(urls));
      if (again.work.thread === 'heliopolis' && /heliopolis/i.test(again.work.title || '')) {
        assert.ok(urls.some((u) => /heliopoliskafram0000wmfl|archive\.org/i.test(u)), JSON.stringify(urls));
      }

      // Second failed confirm on same URL must stay dead and still not loop.
      const raw2 = seeker.heuristicPacket({
        title: 'Heliopolis',
        author: 'W. M. Flinders Petrie',
        thread: 'heliopolis',
        seed_urls: [bad],
      });
      raw2.url = bad;
      const accepted2 = pm.acceptSeekerPacket(raw2);
      await pm.confirmPacket(accepted2.id, {
        verdict: 'keep', thread: 'heliopolis', why: 'retry', url: bad,
      }, { noAltRetry: true });
      const third = pm.proposeNextWork();
      assert.ok(!(third.work && (third.work.seed_urls || []).some((u) => /diglit\/petrie1915/i.test(u))));
    } finally {
      tools.runTool = origRun;
      delete require.cache[toolsPath];
    }
  });
});

test('A: proposeNextWork skips a work if any seed URL is already kept', async () => {
  await withDataDir(async () => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    camp.saveState({
      ...camp.loadState(),
      thread_coverage: { 'self-view': { keeps: 1 }, heliopolis: { keeps: 1 } },
    });
    const proposed = pm.proposeNextWork({
      urlKept: (u) => String(u).includes('sacred-texts.com'),
    });
    assert.equal(proposed.ok, true);
    const urls = proposed.work.seed_urls || [];
    assert.ok(!urls.some((u) => String(u).includes('sacred-texts.com')));
  });
});

test('forklift: runCampaignCycle no-ops while PM managing; saveState cannot unpause', async () => {
  await withDataDir(async () => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    pm.startPm({ topic: 'spine' });
    const cycle = await camp.runCampaignCycle();
    assert.equal(cycle.skipped, 'research_pm_managing');
    camp.saveState({ ...camp.loadState(), enabled: true, paused: false, running: true });
    const after = camp.loadState();
    assert.equal(after.enabled, false);
    assert.equal(after.paused, true);
    assert.equal(after.running, false);
    assert.equal(camp.dueForCycle(), false);
    const started = camp.startCampaign({ topic: 'forklift sneak' });
    assert.equal(started.ok, false);
    assert.equal(started.error, 'research_pm_managing');
    assert.equal(camp.loadState().enabled, false);
    assert.equal(camp.loadState().pm_owns, true);
    camp.saveState({ ...camp.loadState(), enabled: true, paused: false, running: true });
    const latched = camp.loadState();
    assert.equal(latched.pm_owns, true);
    assert.equal(latched.enabled, false);
    assert.equal(latched.running, false);
    assert.equal(camp.dueForCycle(), false);
    const fs = require('fs');
    const path = require('path');
    const dir = process.env.EGYPTIAN_INSIGHTS_DATA_DIR;
    fs.writeFileSync(path.join(dir, 'research_campaign.json'), JSON.stringify({
      enabled: true, paused: false, running: false, topic: 'sneak',
    }));
    const relatch = camp.loadState();
    assert.equal(relatch.pm_owns, true);
    assert.equal(relatch.enabled, false);
    assert.equal(camp.dueForCycle(), false);
    const mem = { ...camp.loadState(), enabled: true, paused: false, running: true, pm_owns: false };
    fs.writeFileSync(path.join(dir, 'research_campaign.json'), JSON.stringify({
      enabled: false, paused: true, running: false, pm_owns: true, topic: 'pm',
    }));
    const merged = camp.mergeExternalState(mem);
    assert.equal(merged.enabled, false);
    assert.equal(merged.paused, true);
    assert.equal(merged.running, false);
    assert.equal(merged.pm_owns, true);
  });
});

test('A: supporting seeds gated until self-view ≥ 10', async () => {
  await withDataDir(async () => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    camp.saveState({
      ...camp.loadState(),
      thread_coverage: {
        'self-view': { keeps: 4 },
        heliopolis: { keeps: 4 },
        'premodern-reception': { keeps: 4 },
        abydos: { keeps: 4 },
        giza: { keeps: 4 },
        atlantis: { keeps: 0 },
      },
    });
    const proposed = pm.proposeNextWork();
    assert.equal(proposed.ok, true);
    assert.ok(!['atlantis', 'gobekli-tepe', 'cataclysm', 'tiahuanaco', 'flood-myths'].includes(proposed.work.thread));
  });
});

test('B: seeker packet reasons; Perseus viewer → dltext; kept:1 is not thinking', async () => {
  await withDataDir(async () => {
    const seeker = require('../lib/eiSeeker');
    const packet = seeker.heuristicPacket({
      title: 'Histories',
      author: 'Herodotus',
      thread: 'premodern-reception',
      seed_urls: ['https://www.perseus.tufts.edu/hopper/text?doc=Perseus%3atext%3a1999.01.0126'],
      why: 'Pre-modern witness of Egypt.',
    });
    assert.equal(seeker.packetIsThinking(packet), true);
    assert.match(packet.url, /\/hopper\/dltext\?/);
    const ranked = seeker.heuristicPacket({
      title: 'Pyramid Texts',
      author: 'Mercer',
      thread: 'self-view',
      seed_urls: [
        'https://archive.org/details/pyramidtextseast00merc',
        'https://sacred-texts.com/egy/pyt/',
      ],
    });
    assert.match(ranked.url, /sacred-texts\.com/);
    assert.match(packet.reasoning, /edition|TEI|dltext|stub|thread/i);
    assert.notEqual(packet.reasoning.trim().toLowerCase(), 'kept: 1');
    assert.equal(seeker.packetIsThinking({ reasoning: 'kept: 1' }), false);
    const art = seeker.formatPacketArtifact(packet);
    assert.match(art, /\[ei-seeker \/ reasoning packet\]/);
    assert.match(art, /Reasoning:/);
  });
});

test('A+B+D: confirm keep (no ingest) counts spine scorecard, not other volume', async () => {
  await withDataDir(async () => {
    const pm = require('../lib/eiResearchPm');
    const seeker = require('../lib/eiSeeker');
    pm.startPm({ topic: 'spine' });
    const raw = seeker.heuristicPacket({
      title: 'Pyramid Texts',
      author: 'Mercer',
      thread: 'self-view',
      seed_urls: ['https://archive.org/details/pyramidtextseast00merc'],
      why: 'Egyptian self-view primary.',
    });
    const accepted = pm.acceptSeekerPacket(raw);
    const out = await pm.confirmPacket(accepted.id, { verdict: 'keep', thread: 'self-view', why: 'Open Mercer PT edition.' });
    assert.equal(out.ok, true);
    assert.equal(out.verdict.verdict, 'keep');
    assert.equal(out.packet.status, 'approved');
    const card = pm.pmScorecard();
    assert.equal(card.confirmed_spine_keeps['self-view'], 1);
    assert.equal(card.confirmed_spine_total, 1);
    assert.equal(card.other_volume_ignored, true);
    assert.equal(card.pending_confirms, 0);
  });
});

test('C: dueForPmTick after start; tick deploys one seeker under cap', async () => {
  await withDataDir(async () => {
    const camp = require('../lib/eiResearchCampaign');
    const pm = require('../lib/eiResearchPm');
    camp.saveState({
      ...camp.loadState(),
      thread_coverage: { 'self-view': { keeps: 0 }, heliopolis: { keeps: 0 } },
    });
    pm.startPm({ interval_minutes: 15 });
    assert.equal(pm.dueForPmTick(), true);
    const tick = await pm.tickPm({ force: true });
    assert.equal(tick.ok, true);
    assert.ok(!tick.skipped, JSON.stringify(tick));
    assert.ok(tick.packet || (tick.confirm && tick.confirm.packet));
    const state = pm.loadState();
    assert.equal(state.seeker_running, false);
    assert.ok(state.stats.deployed >= 1);
    assert.equal(pm.dueForPmTick(), false);
  });
});

test('dueForPmTick true when confirm queue has work even if seeker latch stuck', async () => {
  await withDataDir(async () => {
    const pm = require('../lib/eiResearchPm');
    pm.startPm({ interval_minutes: 15 });
    const s = pm.loadState();
    s.seeker_running = true;
    s.seeker_started_at = new Date().toISOString();
    s.last_pm_at = new Date().toISOString();
    s.pending_confirms = [{
      id: 'rpc_stuck', status: 'pending_confirm',
      work: { title: 'Heliopolis', author: 'Petrie', thread: 'heliopolis' },
    }];
    pm.saveState(s);
    assert.equal(pm.dueForPmTick(), true);
    const cleared = pm.clearSeekerLockAtBoot();
    assert.equal(cleared.cleared, true);
    assert.equal(pm.loadState().seeker_running, false);
  });
});

test('research_pm tool + planner confirm/deploy', async () => {
  await withDataDir(async () => {
    const { getTool, runTool } = require('../lib/eiAgentTools');
    assert.ok(getTool('research_pm'));
    const { planWorkRules } = require('../lib/eiWorkPlanner');
    const confirm = planWorkRules('Confirm the seeker packet and keep it');
    assert.equal(confirm.steps[0].tool, 'research_pm');
    assert.equal(confirm.steps[0].args.action, 'confirm');
    assert.equal(confirm.steps[0].args.verdict, 'keep');
    const deploy = planWorkRules('Deploy a thinking seeker');
    assert.equal(deploy.steps[0].tool, 'research_pm');
    assert.equal(deploy.steps[0].args.action, 'deploy');
    const keep = planWorkRules('Keep thinking, gather more resources');
    assert.equal(keep.steps[0].tool, 'research_campaign');
    assert.equal(keep.steps[0].args.action, 'run_now');
    const st = await runTool('research_pm', { action: 'start', topic: 'Heliopolis memoirs' });
    assert.equal(st.ok, true);
    assert.match(st.artifact, /Research PM/i);
  });
});

test('agentReview accepts thinking seeker; revises kept:1 dump', async () => {
  await withDataDir(async () => {
    const { rulesReview } = require('../lib/agentReview');
    const ok = rulesReview({
      agentId: 'ei-seeker',
      artifactText: '[ei-seeker / reasoning packet]\nReasoning: Seeking Mercer Pyramid Texts for self-view; Archive.org details is an open edition.',
      status: 'ok',
      result: {
        packet: {
          url: 'https://archive.org/details/pyramidtextseast00merc',
          reasoning: 'Seeking Mercer Pyramid Texts for thread self-view. Seed URL treated as a suggestion; selected Archive.org details as an open edition, not a search stub.',
        },
      },
    });
    assert.equal(ok.verdict, 'accept');
    const bad = rulesReview({
      agentId: 'ei-seeker',
      artifactText: 'kept: 1',
      status: 'ok',
      result: { packet: { url: 'https://example.com', reasoning: 'kept: 1' } },
    });
    assert.equal(bad.verdict, 'revise');
  });
});
