#!/usr/bin/env node
/**
 * Daily memory summarization — run after midnight (cron on Optimus).
 * For yesterday's date: for each session that has interactions, summarize via LLM,
 * write to day_summary (date YYYY-MM-DD accompanies the summary). Raw interactions
 * for that day are then deleted. Day summaries are kept indefinitely.
 * Requires: PIKO_DATA_DIR, OLLAMA_URL (or default). Uses lib/llm.js ai().
 */
const path = require('path');
const dailyMemory = require(path.join(__dirname, '..', 'lib', 'dailyMemory'));
const { ai } = require(path.join(__dirname, '..', 'lib', 'llm'));

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function buildSummaryPrompt(rows) {
  const lines = rows.map((r) => `[${r.role}] ${(r.content || '').slice(0, 2000)}`).join('\n');
  return `Summarize this conversation from one day. Themes, decisions, things the user cares about, follow-ups. One short paragraph (3–5 sentences). No meta. Output only the summary.\n\n${lines}`;
}

async function main() {
  const dateStr = process.argv[2] || getYesterdayDateStr();
  const sessions = dailyMemory.getSessionsWithInteractionsOnDate(dateStr);
  if (sessions.length === 0) {
    console.log('[daily-memory-summarize] No interactions for', dateStr);
    return;
  }
  for (const sessionId of sessions) {
    const rows = dailyMemory.getInteractionsForDate(sessionId, dateStr);
    if (rows.length === 0) continue;
    const prompt = buildSummaryPrompt(rows);
    let summary;
    try {
      summary = (await ai(prompt, { max_tokens: 500, temperature: 0.4 })).trim();
    } catch (e) {
      console.error('[daily-memory-summarize] LLM failed for', sessionId, dateStr, e.message);
      continue;
    }
    if (!summary) summary = '(No summary generated.)';
    dailyMemory.writeDaySummary(sessionId, dateStr, summary);
    dailyMemory.deleteInteractionsForDate(sessionId, dateStr);
    console.log('[daily-memory-summarize]', dateStr, sessionId, 'summarized, raw deleted');
  }
}

main().catch((e) => {
  console.error('[daily-memory-summarize]', e.message);
  process.exitCode = 1;
});
