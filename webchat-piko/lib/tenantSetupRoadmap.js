/**
 * Full tenant go-live roadmap — shared by HQ provision UI and Stage 4 docs.
 * Stages are ordered; each must be done before the tenant can show HEALTHY in HQ.
 */
const TENANT_SETUP_STAGES = [
  {
    id: 'scaffold',
    title: 'Scaffold site pack',
    detail: 'Create sites/{id}/site.yaml, smoke.json, knowledge/{id}/manifest.json, and a planned registry row.',
  },
  {
    id: 'adapter',
    title: 'Implement Legion adapter',
    detail: 'Register adapter capabilities (health + domain tools). No shared AusMaker inventory/sales caps unless intentional.',
  },
  {
    id: 'node',
    title: 'Assign dedicated node',
    detail: 'Pick Rodimus or Optimus (or another host). Never co-host two tenants in one Piko process/data dir.',
  },
  {
    id: 'spine',
    title: 'Deploy tenant spine on the node',
    detail: 'Dedicated webchat (own PORT + PIKO_TENANT_ID + PIKO_KNOWLEDGE_PATH + PIKO_DATA_DIR) and Legion adapter for this tenant.',
  },
  {
    id: 'observe',
    title: 'Wire observe_url',
    detail: 'Point registry observe_url at http://<node-lan>:<piko_port>/api/observe/summary so HQ can probe the spine.',
  },
  {
    id: 'go_live',
    title: 'Mark live + smoke',
    detail: 'Set status=live, run tenant smoke, confirm HQ shows webchat/adapter/context (healthy or degraded — not blank).',
  },
];

function buildSetupChecklist({ completed = ['scaffold'] } = {}) {
  const done = new Set(completed);
  return TENANT_SETUP_STAGES.map((stage, idx) => ({
    ...stage,
    order: idx + 1,
    status: done.has(stage.id) ? 'done' : 'pending',
  }));
}

function defaultNextSteps({ tenant_id, adapter_id, node_host, piko_port }) {
  const node = node_host && node_host !== 'unassigned' ? node_host : '<node>';
  const port = piko_port || '<piko_port>';
  return [
    `1. Scaffold complete for ${tenant_id} (site + knowledge + planned registry row).`,
    `2. Implement / register Legion adapter '${adapter_id}'.`,
    `3. Assign node (${node}) — dedicated process, not shared with another customer.`,
    `4. Deploy spine: ./scripts/deploy-tenant-spine-optimus.sh ${tenant_id}   (or Rodimus equivalent) with PORT=${port}.`,
    `5. Set observe_url to http://<lan-ip>:${port}/api/observe/summary and status=live.`,
    '6. Smoke + confirm HQ spine is no longer blank (webchat · adapter · context).',
  ];
}

module.exports = {
  TENANT_SETUP_STAGES,
  buildSetupChecklist,
  defaultNextSteps,
};
