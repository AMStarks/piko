const { readCalendarSnapshot } = require('./utils');

function detectCalendarConflicts({ dataDir, now }) {
  const events = readCalendarSnapshot(dataDir)
    .map((e) => ({
      title: String(e.title || e.summary || 'Event').slice(0, 80),
      start: e.start ? new Date(e.start).getTime() : NaN,
      end: e.end ? new Date(e.end).getTime() : NaN,
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start)
    .filter((e) => e.end > now.getTime() && e.start < now.getTime() + (24 * 60 * 60 * 1000))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      if (events[j].start >= events[i].end) break;
      if (events[j].start < events[i].end) {
        return [{
          category: 'calendarConflicts',
          confidence: 0.88,
          urgency: 'normal',
          subject: `"${events[i].title}" overlaps "${events[j].title}"`,
          dedupeKey: `calendar:${events[i].title.toLowerCase()}|${events[j].title.toLowerCase()}`,
          reason: 'overlapping calendar events in next 24 hours',
          signalSource: 'calendarConflicts.js',
        }];
      }
    }
  }
  return [];
}

module.exports = {
  detectCalendarConflicts,
};
