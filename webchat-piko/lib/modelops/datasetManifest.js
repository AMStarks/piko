const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_SPECS = Object.freeze([
  { id: 'train', relPath: path.join('finetune', 'train.jsonl'), kind: 'jsonl' },
  { id: 'val', relPath: path.join('finetune', 'val.jsonl'), kind: 'jsonl' },
  { id: 'chat_export', relPath: path.join('finetune', 'chat_export', 'conversations.jsonl'), kind: 'jsonl' },
  { id: 'synthetic_approved', relPath: path.join('finetune', 'synthetic', 'synthetic_approved.jsonl'), kind: 'jsonl' },
  { id: 'synthetic_casual_smalltalk', relPath: path.join('finetune', 'synthetic', 'synthetic_casual_smalltalk.jsonl'), kind: 'jsonl' },
  { id: 'synthetic_pending_theology_islam', relPath: path.join('finetune', 'pending_review', 'synthetic_theology_islam.jsonl'), kind: 'jsonl' },
  { id: 'truth_corrections', relPath: path.join('truth', 'corrections.json'), kind: 'json' },
  { id: 'mind_beliefs', relPath: path.join('mind', 'beliefs.json'), kind: 'json' },
]);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function lineCount(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return 0;
  return raw.split('\n').filter(Boolean).length;
}

function parseRequiredSources(raw, defaults) {
  const fallback = Array.isArray(defaults) && defaults.length ? defaults : ['train', 'val'];
  if (!raw) return fallback;
  const out = String(raw)
    .split(',')
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return out.length ? out : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function buildDatasetManifest(input) {
  const opts = input && typeof input === 'object' ? input : {};
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error('Missing dataDir');
  const sourceSpecs = Array.isArray(opts.sourceSpecs) && opts.sourceSpecs.length ? opts.sourceSpecs : SOURCE_SPECS;
  const requiredSources = Array.isArray(opts.requiredSources) ? opts.requiredSources : ['train', 'val'];
  const strictRequired = opts.strictRequired === true;
  const minTrainLines = clampInt(opts.minTrainLines, 0, 100000000, 0);
  const minValLines = clampInt(opts.minValLines, 0, 100000000, 0);
  const strictThresholds = opts.strictThresholds === true;

  const files = sourceSpecs.map((spec) => {
    const absPath = path.join(dataDir, spec.relPath);
    const exists = fs.existsSync(absPath);
    const base = {
      id: spec.id,
      kind: spec.kind,
      path: absPath,
      exists,
    };
    if (!exists) return base;
    const stat = fs.statSync(absPath);
    const out = {
      ...base,
      bytes: stat.size,
      sha256: sha256File(absPath),
      modifiedAt: stat.mtime.toISOString(),
    };
    if (spec.kind === 'jsonl') out.lines = lineCount(absPath);
    return out;
  });

  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  const missingRequiredSources = requiredSources.filter((id) => !byId[id] || !byId[id].exists);
  const trainLines = Number((byId.train && byId.train.lines) || 0);
  const valLines = Number((byId.val && byId.val.lines) || 0);

  const warnings = [];
  if (missingRequiredSources.length) {
    warnings.push(`Missing required sources: ${missingRequiredSources.join(', ')}`);
  }
  if (minTrainLines > 0 && trainLines < minTrainLines) {
    warnings.push(`train lines ${trainLines} below minimum ${minTrainLines}`);
  }
  if (minValLines > 0 && valLines < minValLines) {
    warnings.push(`val lines ${valLines} below minimum ${minValLines}`);
  }

  if (missingRequiredSources.length && strictRequired) {
    const err = new Error(`Required dataset sources missing: ${missingRequiredSources.join(', ')}`);
    err.code = 'REQUIRED_SOURCES_MISSING';
    err.details = { missingRequiredSources };
    throw err;
  }
  if (strictThresholds && warnings.some((w) => w.includes('below minimum'))) {
    const err = new Error('Dataset line thresholds not met');
    err.code = 'DATASET_THRESHOLD_FAILED';
    err.details = { minTrainLines, minValLines, trainLines, valLines };
    throw err;
  }

  const summary = {
    totalFiles: files.length,
    existingFiles: files.filter((f) => f.exists).length,
    requiredSources,
    requiredMissing: missingRequiredSources.length,
    missingRequiredSources,
    trainLines,
    valLines,
    minTrainLines,
    minValLines,
    warnings,
  };

  return { files, summary };
}

module.exports = {
  SOURCE_SPECS,
  parseRequiredSources,
  buildDatasetManifest,
};
