const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDatasetManifest } = require('../lib/modelops/datasetManifest');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('dataset manifest reports missing required sources', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-dataset-manifest-'));
  writeFile(path.join(dataDir, 'finetune', 'train.jsonl'), '{"a":1}\n');
  const out = buildDatasetManifest({
    dataDir,
    requiredSources: ['train', 'val'],
    strictRequired: false,
  });
  assert.equal(out.summary.requiredMissing, 1);
  assert.equal(out.summary.missingRequiredSources.includes('val'), true);
  assert.equal(out.summary.warnings.length > 0, true);
});

test('dataset manifest enforces required sources in strict mode', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-dataset-manifest-'));
  assert.throws(() => {
    buildDatasetManifest({
      dataDir,
      requiredSources: ['train'],
      strictRequired: true,
    });
  }, (err) => err && err.code === 'REQUIRED_SOURCES_MISSING');
});

test('dataset manifest enforces line thresholds in strict threshold mode', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-dataset-manifest-'));
  writeFile(path.join(dataDir, 'finetune', 'train.jsonl'), '{"a":1}\n');
  writeFile(path.join(dataDir, 'finetune', 'val.jsonl'), '');
  assert.throws(() => {
    buildDatasetManifest({
      dataDir,
      requiredSources: ['train', 'val'],
      strictRequired: true,
      minTrainLines: 2,
      minValLines: 1,
      strictThresholds: true,
    });
  }, (err) => err && err.code === 'DATASET_THRESHOLD_FAILED');
});

