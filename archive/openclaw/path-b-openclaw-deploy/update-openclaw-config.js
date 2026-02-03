#!/usr/bin/env node
/**
 * Patches /root/.openclaw/openclaw.json for Path B:
 * - Primary model: ollama/qwen2.5:32b-instruct-q4_K_M
 * - bootstrapMaxChars: 4000
 * - Ollama provider api: openai-completions (openai-chat rejected by OpenClaw schema)
 * - Add qwen2.5:32b-instruct-q4_K_M to models.providers.ollama.models
 * Usage: node update-openclaw-config.js [path-to-openclaw.json]
 */
const fs = require('fs');

const configPath = process.argv[2] || '/root/.openclaw/openclaw.json';

if (!fs.existsSync(configPath)) {
  console.error('Config not found:', configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// agents.defaults
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = { primary: 'ollama/qwen2.5:32b-instruct-q4_K_M' };
config.agents.defaults.bootstrapMaxChars = 4000;

// models.providers.ollama
config.models = config.models || {};
config.models.providers = config.models.providers || {};
config.models.providers.ollama = config.models.providers.ollama || {};
config.models.providers.ollama.api = 'openai-completions';
config.models.providers.ollama.models = config.models.providers.ollama.models || [];

const qwenId = 'qwen2.5:32b-instruct-q4_K_M';
const hasQwen = config.models.providers.ollama.models.some(m => m.id === qwenId);
if (!hasQwen) {
  config.models.providers.ollama.models.push({
    id: qwenId,
    name: 'Qwen 2.5 32B',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096
  });
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log('Updated', configPath);
