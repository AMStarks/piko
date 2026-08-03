const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getLatestDatasetBuild,
  getLatestTrainingRun,
  getLatestGateEvaluation,
  getModelOpsOverview,
} = require('../lib/modelRegistry');

test('model registry latest helpers select most recent entries', () => {
  const registry = {
    updatedAt: '2026-03-01T01:00:00.000Z',
    stages: { candidate: 'piko:cand', shadow: null, canary: null, primary: 'piko:primary' },
    models: {
      'piko:cand': { tag: 'piko:cand', lastTrainingRunId: 'train_2' },
      'piko:primary': { tag: 'piko:primary' },
    },
    datasetBuilds: [{ id: 'dataset_1' }, { id: 'dataset_2' }],
    trainingRuns: [{ id: 'train_1' }, { id: 'train_2' }],
    gateEvaluations: [{ id: 'gate_1', pass: false }, { id: 'gate_2', pass: true }],
    history: [],
  };
  assert.equal(getLatestDatasetBuild(registry).id, 'dataset_2');
  assert.equal(getLatestTrainingRun(registry).id, 'train_2');
  assert.equal(getLatestGateEvaluation(registry).id, 'gate_2');
});

test('model ops overview reports readiness and counts', () => {
  const registry = {
    updatedAt: '2026-03-01T01:00:00.000Z',
    stages: { candidate: 'piko:cand', shadow: null, canary: null, primary: 'piko:primary' },
    models: {
      'piko:cand': { tag: 'piko:cand', lastTrainingRunId: 'train_2' },
      'piko:primary': { tag: 'piko:primary' },
    },
    datasetBuilds: [{ id: 'dataset_1' }],
    trainingRuns: [{ id: 'train_2' }],
    gateEvaluations: [{ id: 'gate_2', pass: true }],
    history: [{ id: 'promote_1' }],
  };
  const out = getModelOpsOverview(registry);
  assert.equal(out.counts.models, 2);
  assert.equal(out.counts.datasetBuilds, 1);
  assert.equal(out.readiness.hasDatasetBuild, true);
  assert.equal(out.readiness.hasTrainingRun, true);
  assert.equal(out.readiness.gatePass, true);
  assert.equal(out.readiness.candidateAssigned, true);
  assert.equal(out.readiness.candidateHasRun, true);
  assert.equal(out.readiness.primaryAssigned, true);
});

