const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'model-registry.json');
const STAGES = ['candidate', 'shadow', 'canary', 'primary'];

function nowIso() {
  return new Date().toISOString();
}

function ensureRegistryShape(input) {
  const src = input && typeof input === 'object' ? input : {};
  const stages = src.stages && typeof src.stages === 'object' ? src.stages : {};
  return {
    version: 1,
    updatedAt: src.updatedAt || null,
    stages: {
      candidate: stages.candidate || null,
      shadow: stages.shadow || null,
      canary: stages.canary || null,
      primary: stages.primary || null,
    },
    lastStable: src.lastStable || null,
    models: src.models && typeof src.models === 'object' ? src.models : {},
    datasetBuilds: Array.isArray(src.datasetBuilds) ? src.datasetBuilds : [],
    trainingRuns: Array.isArray(src.trainingRuns) ? src.trainingRuns : [],
    gateEvaluations: Array.isArray(src.gateEvaluations) ? src.gateEvaluations : [],
    history: Array.isArray(src.history) ? src.history : [],
  };
}

function loadRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return ensureRegistryShape({});
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    return ensureRegistryShape(JSON.parse(raw));
  } catch (_) {
    return ensureRegistryShape({});
  }
}

function saveRegistry(registry) {
  const out = ensureRegistryShape(registry);
  out.updatedAt = nowIso();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function upsertModel(modelTag, patch) {
  const tag = String(modelTag || '').trim();
  if (!tag) throw new Error('Missing model tag');
  const registry = loadRegistry();
  const prev = registry.models[tag] || { tag, createdAt: nowIso() };
  registry.models[tag] = {
    ...prev,
    ...patch,
    tag,
    updatedAt: nowIso(),
  };
  return saveRegistry(registry);
}

function recordDatasetBuild(build) {
  const registry = loadRegistry();
  registry.datasetBuilds.push({
    id: build.id,
    createdAt: build.createdAt || nowIso(),
    manifestPath: build.manifestPath || '',
    summary: build.summary || {},
  });
  return saveRegistry(registry);
}

function recordTrainingRun(run) {
  const registry = loadRegistry();
  registry.trainingRuns.push({
    id: run.id,
    createdAt: run.createdAt || nowIso(),
    modelTag: run.modelTag || '',
    datasetBuildId: run.datasetBuildId || '',
    outputPath: run.outputPath || '',
    notes: run.notes || '',
    metrics: run.metrics || {},
  });
  if (run.modelTag) {
    const prev = registry.models[run.modelTag] || { tag: run.modelTag, createdAt: nowIso() };
    registry.models[run.modelTag] = {
      ...prev,
      tag: run.modelTag,
      status: 'trained',
      lastTrainingRunId: run.id,
      updatedAt: nowIso(),
    };
  }
  return saveRegistry(registry);
}

function recordGateEvaluation(result) {
  const registry = loadRegistry();
  registry.gateEvaluations.push({
    id: result.id,
    createdAt: result.createdAt || nowIso(),
    source: result.source || '',
    pass: !!result.pass,
    metrics: result.metrics || {},
    reasons: Array.isArray(result.reasons) ? result.reasons : [],
  });
  return saveRegistry(registry);
}

function getLatestGateEvaluation(registryInput) {
  const registry = registryInput || loadRegistry();
  const list = Array.isArray(registry.gateEvaluations) ? registry.gateEvaluations : [];
  if (!list.length) return null;
  return list[list.length - 1];
}

function getLatestDatasetBuild(registryInput) {
  const registry = registryInput || loadRegistry();
  const list = Array.isArray(registry.datasetBuilds) ? registry.datasetBuilds : [];
  if (!list.length) return null;
  return list[list.length - 1];
}

function getLatestTrainingRun(registryInput) {
  const registry = registryInput || loadRegistry();
  const list = Array.isArray(registry.trainingRuns) ? registry.trainingRuns : [];
  if (!list.length) return null;
  return list[list.length - 1];
}

function getModelOpsOverview(registryInput) {
  const registry = ensureRegistryShape(registryInput || loadRegistry());
  const latestDatasetBuild = getLatestDatasetBuild(registry);
  const latestTrainingRun = getLatestTrainingRun(registry);
  const latestGateEvaluation = getLatestGateEvaluation(registry);
  const candidateTag = registry.stages && registry.stages.candidate ? String(registry.stages.candidate) : '';
  const primaryTag = registry.stages && registry.stages.primary ? String(registry.stages.primary) : '';
  const candidateModel = candidateTag && registry.models && registry.models[candidateTag]
    ? registry.models[candidateTag]
    : null;
  return {
    updatedAt: registry.updatedAt || null,
    counts: {
      models: Object.keys(registry.models || {}).length,
      datasetBuilds: Array.isArray(registry.datasetBuilds) ? registry.datasetBuilds.length : 0,
      trainingRuns: Array.isArray(registry.trainingRuns) ? registry.trainingRuns.length : 0,
      gateEvaluations: Array.isArray(registry.gateEvaluations) ? registry.gateEvaluations.length : 0,
      history: Array.isArray(registry.history) ? registry.history.length : 0,
    },
    stages: registry.stages || { candidate: null, shadow: null, canary: null, primary: null },
    latestDatasetBuild,
    latestTrainingRun,
    latestGateEvaluation,
    readiness: {
      hasDatasetBuild: !!latestDatasetBuild,
      hasTrainingRun: !!latestTrainingRun,
      gatePass: !!(latestGateEvaluation && latestGateEvaluation.pass === true),
      candidateAssigned: !!candidateTag,
      candidateHasRun: !!(candidateModel && candidateModel.lastTrainingRunId),
      primaryAssigned: !!primaryTag,
    },
  };
}

function validatePromotionTransition(registry, tag, toStage, allowUnsafe) {
  if (!STAGES.includes(toStage)) {
    const err = new Error(`Invalid target stage: ${toStage}`);
    err.code = 'INVALID_STAGE';
    throw err;
  }
  if (!registry.models[tag]) {
    const err = new Error(`Model not found in registry: ${tag}`);
    err.code = 'UNKNOWN_MODEL';
    throw err;
  }
  if (allowUnsafe) return;
  if (toStage === 'shadow' && registry.stages.candidate !== tag) {
    const err = new Error('Model must be candidate before shadow');
    err.code = 'INVALID_PROMOTION_PATH';
    throw err;
  }
  if (toStage === 'canary' && registry.stages.shadow !== tag) {
    const err = new Error('Model must be shadow before canary');
    err.code = 'INVALID_PROMOTION_PATH';
    throw err;
  }
  if (toStage === 'primary' && registry.stages.canary !== tag) {
    const err = new Error('Model must be canary before primary');
    err.code = 'INVALID_PROMOTION_PATH';
    throw err;
  }
}

function promoteModel(input) {
  const tag = String(input && input.modelTag || '').trim();
  const toStage = String(input && input.toStage || '').trim();
  const by = String(input && input.by || 'system').trim();
  const notes = String(input && input.notes || '').trim();
  const allowUnsafe = !!(input && input.allowUnsafe);
  if (!tag) throw new Error('Missing modelTag');
  const registry = loadRegistry();
  validatePromotionTransition(registry, tag, toStage, allowUnsafe);
  const previous = registry.stages[toStage];
  if (toStage === 'primary' && previous && previous !== tag) {
    registry.lastStable = previous;
  }
  registry.stages[toStage] = tag;
  registry.models[tag] = {
    ...(registry.models[tag] || { tag, createdAt: nowIso() }),
    tag,
    status: toStage,
    updatedAt: nowIso(),
  };
  registry.history.push({
    id: `promote_${Date.now()}`,
    at: nowIso(),
    type: 'promote',
    by,
    modelTag: tag,
    toStage,
    fromStageValue: previous || null,
    notes,
    allowUnsafe,
  });
  return saveRegistry(registry);
}

function rollbackModel(input) {
  const by = String(input && input.by || 'system').trim();
  const notes = String(input && input.notes || '').trim();
  const targetModel = String(input && input.targetModel || '').trim();
  const registry = loadRegistry();
  const target = targetModel || registry.lastStable || null;
  if (!target) {
    const err = new Error('No rollback target available');
    err.code = 'NO_ROLLBACK_TARGET';
    throw err;
  }
  if (!registry.models[target]) {
    const err = new Error(`Rollback target not found: ${target}`);
    err.code = 'UNKNOWN_MODEL';
    throw err;
  }
  const previousPrimary = registry.stages.primary || null;
  if (previousPrimary && previousPrimary !== target) {
    registry.lastStable = previousPrimary;
  }
  registry.stages.primary = target;
  registry.models[target] = {
    ...(registry.models[target] || { tag: target, createdAt: nowIso() }),
    tag: target,
    status: 'primary',
    updatedAt: nowIso(),
  };
  registry.history.push({
    id: `rollback_${Date.now()}`,
    at: nowIso(),
    type: 'rollback',
    by,
    previousPrimary,
    target,
    notes,
  });
  return saveRegistry(registry);
}

module.exports = {
  DATA_DIR,
  REGISTRY_FILE,
  STAGES,
  loadRegistry,
  saveRegistry,
  upsertModel,
  recordDatasetBuild,
  recordTrainingRun,
  recordGateEvaluation,
  getLatestGateEvaluation,
  getLatestDatasetBuild,
  getLatestTrainingRun,
  getModelOpsOverview,
  promoteModel,
  rollbackModel,
};
