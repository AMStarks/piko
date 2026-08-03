const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('WP6.5 skip without LEGION_QUEUE_DIR stamps queue_drop=skipped_no_dir', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-qdrop-'));
  const prevData = process.env.PIKO_DATA_DIR;
  const prevQ = process.env.LEGION_QUEUE_DIR;
  const prevQ2 = process.env.PIKO_EI_ENG_QUEUE_DIR;
  process.env.PIKO_DATA_DIR = dataDir;
  delete process.env.LEGION_QUEUE_DIR;
  delete process.env.PIKO_EI_ENG_QUEUE_DIR;

  for (const key of Object.keys(require.cache)) {
    if (/eiEngineeringQueue|eiOutcomeLedger|notificationFeed/.test(key)) delete require.cache[key];
  }

  try {
    const eng = require('../lib/eiEngineeringQueue');
    const task = eng.enqueueFixTask({
      kind: 'smoke',
      check_id: 'wp6_drop',
      fix_brief: 'fix something',
      files_hint: ['lib/eiEngineeringQueue.js'],
    }, dataDir);

    // processEngineeringTask moves pending → approved → done and drops to legion queue
    const out = await eng.processEngineeringTask(task.id, { rootDir: dataDir });
    assert.equal(out.ok, true);
    assert.equal(out.legion_queue.skipped, true);
    assert.equal(out.legion_queue.queue_drop, 'skipped_no_dir');
    assert.equal(out.task.queue_drop, 'skipped_no_dir');
  } finally {
    if (prevData == null) delete process.env.PIKO_DATA_DIR;
    else process.env.PIKO_DATA_DIR = prevData;
    if (prevQ == null) delete process.env.LEGION_QUEUE_DIR;
    else process.env.LEGION_QUEUE_DIR = prevQ;
    if (prevQ2 == null) delete process.env.PIKO_EI_ENG_QUEUE_DIR;
    else process.env.PIKO_EI_ENG_QUEUE_DIR = prevQ2;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
