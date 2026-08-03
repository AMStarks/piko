/**
 * Strip markdown code fences from LLM JSON without regex (routing files must stay regex-free).
 */
function stripJsonFences(raw) {
  let s = String(raw || '').trim();
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n');
    if (firstNl >= 0) s = s.slice(firstNl + 1);
    else s = s.slice(3);
  }
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  if (s.startsWith('json')) {
    const rest = s.slice(4).trim();
    if (rest.startsWith('{') || rest.startsWith('[')) s = rest;
  }
  return s.trim();
}

function extractJsonObject(raw) {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`Invalid JSON: ${cleaned.slice(0, 120)}`);
  }
}

function isYearMonth(ym) {
  const s = String(ym || '').trim();
  if (s.length !== 7 || s[4] !== '-') return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return Number.isInteger(y) && Number.isInteger(m) && y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
}

module.exports = {
  stripJsonFences,
  extractJsonObject,
  isYearMonth,
};
