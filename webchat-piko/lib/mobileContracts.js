function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeIso(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function toWidgetPayload(input, meta) {
  const base = input && typeof input === 'object' ? input : {};
  const tensions = clampInt(base.tensions, 0, 10000, 0);
  const nextReminder = base.nextReminder == null ? null : String(base.nextReminder).slice(0, 60);
  const moltbook = base.moltbook == null ? null : String(base.moltbook).slice(0, 80);
  const generatedAt = safeIso(meta && meta.generatedAt);
  const refreshAfterSec = clampInt(meta && meta.refreshAfterSec, 30, 86400, 300);
  return {
    ok: true,
    contractVersion: '2026-03-01.widget.v1',
    generatedAt,
    refreshAfterSec,
    tensions,
    nextReminder,
    moltbook,
    data: {
      tensions,
      nextReminder,
      moltbook,
    },
  };
}

function toLiveActivityPayload(input, meta) {
  const base = input && typeof input === 'object' ? input : {};
  const generatedAt = safeIso(meta && meta.generatedAt);
  const refreshAfterSec = clampInt(base.refreshAfterSec != null ? base.refreshAfterSec : (meta && meta.refreshAfterSec), 30, 86400, 300);
  const queueLength = clampInt(base.queueLength, 0, 100000, 0);
  const remindersCount = clampInt(base.remindersCount, 0, 100000, 0);
  return {
    ok: true,
    contractVersion: '2026-03-01.live-activity.v1',
    generatedAt,
    refreshAfterSec,
    expiresAt: new Date(Date.parse(generatedAt) + refreshAfterSec * 1000).toISOString(),
    status: String(base.status || 'All clear').slice(0, 180),
    queueLength,
    remindersCount,
    nextReminderAt: base.nextReminderAt ? safeIso(base.nextReminderAt) : null,
    cadence: base.cadence && typeof base.cadence === 'object' ? {
      urgency: base.cadence.urgency ? String(base.cadence.urgency).slice(0, 20) : 'low',
      reason: base.cadence.reason ? String(base.cadence.reason).slice(0, 80) : '',
      degraded: base.cadence.degraded === true,
    } : undefined,
    service: base.service && typeof base.service === 'object' ? {
      modelReachable: base.service.modelReachable !== false,
      modelCheckedAt: base.service.modelCheckedAt ? safeIso(base.service.modelCheckedAt) : '',
    } : undefined,
    data: {
      status: String(base.status || 'All clear').slice(0, 180),
      queueLength,
      remindersCount,
      nextReminderAt: base.nextReminderAt ? safeIso(base.nextReminderAt) : null,
    },
  };
}

function toIosDashboardPayload(input, meta) {
  const base = input && typeof input === 'object' ? input : {};
  const generatedAt = safeIso(meta && meta.generatedAt);
  const refreshAfterSec = clampInt(meta && meta.refreshAfterSec, 30, 86400, 300);
  const learning = base.learning && typeof base.learning === 'object' ? base.learning : {};
  return {
    ok: true,
    contractVersion: '2026-03-01.ios-dashboard.v1',
    generatedAt,
    refreshAfterSec,
    learning: {
      tensionsCount: clampInt(learning.tensionsCount, 0, 10000, 0),
      firstTension: learning.firstTension ? String(learning.firstTension).slice(0, 120) : null,
      stickyCount: clampInt(learning.stickyCount, 0, 10000, 0),
      firstSticky: learning.firstSticky ? String(learning.firstSticky).slice(0, 120) : null,
    },
    nextReminder: base.nextReminder || null,
    moltbookLast: base.moltbookLast || null,
    contextHint: base.contextHint ? String(base.contextHint).slice(0, 180) : null,
    freeSlot: base.freeSlot ? String(base.freeSlot).slice(0, 80) : null,
    ea: base.ea || null,
    rabbitHole: base.rabbitHole || null,
    calendarTodayCount: clampInt(base.calendarTodayCount, 0, 10000, 0),
    remindersPendingCount: clampInt(base.remindersPendingCount, 0, 10000, 0),
    tensionsUpdatedDaysAgo: base.tensionsUpdatedDaysAgo == null ? null : clampInt(base.tensionsUpdatedDaysAgo, 0, 10000, 0),
    gpuTemps: Array.isArray(base.gpuTemps) ? base.gpuTemps : null,
    researchTopics: Array.isArray(base.researchTopics) ? base.researchTopics.slice(0, 50).map((s) => String(s).slice(0, 120)) : undefined,
  };
}

module.exports = {
  toWidgetPayload,
  toLiveActivityPayload,
  toIosDashboardPayload,
};
