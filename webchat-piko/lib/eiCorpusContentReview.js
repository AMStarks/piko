/**
 * Mandatory corpus content review — Piko reads the source (OCR/text/PDF/image), not just metadata.
 */
const { getDocumentBuffer, getImageBuffer } = require('./culturesCorpusApi');
const { ollamaNativeChat, getOllamaBaseUrl } = require('./llm');
const { extractJsonObject } = require('./routingParse');
const { loadRules, formatRulesSummary } = require('./corpusReviewRules');
const { loadResearchGoal } = require('./eiResearchGoal');
const { endsWithAny, toLowerAsciiish, includesAny, startsWithIgnoreCase } = require('./text');

function pathEndsWithExt(p, exts) {
  const lower = toLowerAsciiish(String(p || ''));
  return endsWithAny(lower, exts);
}

function hasOcrMarker(text) {
  const t = String(text || '');
  // Match "--- OCR ---" with flexible whitespace around OCR
  const idx = toLowerAsciiish(t).indexOf('ocr');
  if (idx < 0) return false;
  // Look for --- before and after nearby
  const window = t.slice(Math.max(0, idx - 8), idx + 12);
  return includesAny(window, ['---']) && includesAny(toLowerAsciiish(window), ['ocr']);
}

function countReplacementChars(s) {
  const str = String(s || '');
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\uFFFD') n += 1;
  }
  return n;
}

const MIN_TEXT_CHARS = 400;
const MAX_PROMPT_CHARS = Number(process.env.PIKO_EI_CONTENT_REVIEW_CHARS || 10000);
const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.PIKO_EI_OCR_FETCH_TIMEOUT_MS || 20000));

function ollamaBaseUrl() {
  return getOllamaBaseUrl({ priority: 'background', lane: 'worker' });
}

function contentReviewEnabled() {
  const v = String(process.env.PIKO_EI_CONTENT_REVIEW || '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function getTextModel() {
  return (
    process.env.PIKO_EI_CONTENT_REVIEW_MODEL
    || process.env.EGYPTIAN_SCHOLAR_MODEL
    || process.env.PIKO_HEAVY_MODEL
    || process.env.OLLAMA_MODEL
    || 'llama3.1:8b'
  );
}

function getVisionModel() {
  return (
    process.env.PIKO_EI_CONTENT_REVIEW_VISION_MODEL
    || process.env.EGYPTIAN_SCRIBE_MODEL
    || 'llama3.2-vision:11b'
  );
}

async function extractPdfText(buffer) {
  try {
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    return String(data.text || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Extract text from a local document of any supported type.
 * PDFs go through pdf-parse; .txt/.md (e.g. web_text site scrapes) are read verbatim.
 */
async function extractDocumentText(doc) {
  if (!doc || !doc.buffer || !doc.buffer.length) return '';
  const isPdf = doc.buffer.slice(0, 4).toString('latin1') === '%PDF'
    || pathEndsWithExt(doc.path, ['.pdf']);
  if (isPdf) return extractPdfText(doc.buffer);
  if (pathEndsWithExt(doc.path, ['.txt', '.text', '.md'])) {
    return doc.buffer.toString('utf8').trim();
  }
  const viaPdf = await extractPdfText(doc.buffer);
  if (viaPdf) return viaPdf;
  // Plain-text fallback: accept only if it decodes cleanly.
  const asText = doc.buffer.toString('utf8');
  const junk = countReplacementChars(asText.slice(0, 4000));
  return junk > 20 ? '' : asText.trim();
}

async function fetchUrlText(url) {
  if (!url || !(startsWithIgnoreCase(url, 'http://') || startsWithIgnoreCase(url, 'https://'))) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Piko-EI-ContentReview/1.0' },
    });
    if (!res.ok) return '';
    const text = await res.text();
    return String(text || '').trim();
  } catch (_) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the best readable material for an item.
 * @param {object} item
 * @param {{ maxChars?: number }} [opts] — override default prompt slice (content review stays short;
 *   deep digest may request a much larger window of the underlying text).
 * @returns {Promise<{ kind: 'text'|'image'|'none', text?: string, source?: string, imagePath?: string, imageBase64?: string, chars?: number }>}
 */
async function resolveReadableContent(item, opts = {}) {
  const maxChars = Math.max(
    400,
    Math.min(2_000_000, Number(opts.maxChars) || MAX_PROMPT_CHARS),
  );
  const official = String(item.official_text || '').trim();
  // official_text may be only an excerpt (web_text stores ~12k chars; the full
  // scrape lives in the local .txt). When the caller wants a deeper window than
  // the excerpt can provide, prefer the local document.
  const wantsMoreThanOfficial = maxChars > official.length;
  if (
    (official.length >= MIN_TEXT_CHARS || hasOcrMarker(official))
    && !wantsMoreThanOfficial
  ) {
    return {
      kind: 'text',
      text: official.slice(0, maxChars),
      source: 'official_text',
      chars: official.length,
    };
  }

  // Local document (PDF or plain-text scrape)
  try {
    const doc = getDocumentBuffer(item.id);
    if (doc && doc.buffer && doc.buffer.length) {
      const extracted = await extractDocumentText(doc);
      if (extracted.length >= MIN_TEXT_CHARS && extracted.length > official.length) {
        return {
          kind: 'text',
          text: extracted.slice(0, maxChars),
          source: pathEndsWithExt(doc.path, ['.txt', '.text', '.md']) ? 'local_text' : 'local_pdf',
          chars: extracted.length,
          path: doc.path,
        };
      }
    }
  } catch (_) { /* continue */ }

  if (official.length >= MIN_TEXT_CHARS || hasOcrMarker(official)) {
    return {
      kind: 'text',
      text: official.slice(0, maxChars),
      source: 'official_text',
      chars: official.length,
    };
  }

  // Remote OCR URL from harvest meta
  const meta = item.meta || {};
  const ocrUrl = meta.ocr_url || meta.ocrUrl;
  if (ocrUrl) {
    const remote = await fetchUrlText(ocrUrl);
    if (remote.length >= MIN_TEXT_CHARS) {
      return {
        kind: 'text',
        text: remote.slice(0, maxChars),
        source: 'remote_ocr',
        chars: remote.length,
      };
    }
  }

  // Museum / object rows: prefer caption + title via text model (vision model swaps are slow).
  // Vision only when there is no usable label text.
  if (item.has_image && official.length >= 80) {
    const caption = [
      `Title: ${item.title || item.source_name || ''}`,
      `Site: ${item.site || item.location || ''}`,
      `Source: ${item.source || ''}`,
      '',
      'Object / image label text:',
      official,
    ].join('\n');
    return {
      kind: 'text',
      text: caption.slice(0, maxChars),
      source: 'image_caption',
      chars: official.length,
    };
  }

  // Image-only primary object (no usable caption)
  if (item.has_image) {
    try {
      const img = getImageBuffer(item.id);
      if (img && img.buffer && img.buffer.length) {
        return {
          kind: 'image',
          source: 'local_image',
          imagePath: img.path,
          imageBase64: img.buffer.toString('base64'),
          bytes: img.buffer.length,
        };
      }
    } catch (_) { /* continue */ }
  }

  // Short official text as last resort (still better than nothing)
  if (official.length >= 80) {
    return {
      kind: 'text',
      text: official.slice(0, maxChars),
      source: 'official_text_thin',
      chars: official.length,
    };
  }

  return { kind: 'none', source: 'none' };
}

function buildJudgmentPrompt(item, goal, rulesSummary) {
  return `You are reviewing one Egyptian Insights corpus source for the research goal.

RESEARCH GOAL:
${goal.title || ''}
${goal.summary || ''}

OPERATOR FLAG RULES:
${rulesSummary}

ITEM:
- id: ${item.id}
- title: ${item.title || item.source_name || ''}
- site: ${item.site || item.location || ''}
- source: ${item.source || ''}
- type: ${item.type || item.kind || ''}
- has_local_document: ${!!(item.has_document || item.has_local_document)}
- has_image: ${!!item.has_image}

Read the SOURCE MATERIAL carefully. Decide whether to KEEP or DROP it for this research goal.
Keep only if it is a genuine primary/early scholarly source (excavation report, museum object/inscription, site documentation) useful for earliest writing at Abydos / Heliopolis / Giza.
Drop tourism fluff, CIA/irrelevant dumps, empty catalogue stubs, popular pseudohistory unless the operator rules explicitly keep it, and thin link-only records with no real content.

Return JSON only:
{"verdict":"keep"|"drop","confidence":0.0,"why":"one short sentence"}`;
}

async function judgeTextContent(item, content, opts = {}) {
  const goal = opts.goal || loadResearchGoal();
  const rulesSummary = opts.rulesSummary || formatRulesSummary(loadRules());
  const model = getTextModel();
  const messages = [
    { role: 'system', content: buildJudgmentPrompt(item, goal, rulesSummary) },
    {
      role: 'user',
      content: `SOURCE MATERIAL (${content.source}, ${content.chars || content.text.length} chars):\n\n${content.text}`,
    },
  ];
  const raw = await ollamaNativeChat(model, messages, {
    format: 'json',
    temperature: 0,
    max_tokens: 160,
    num_ctx: Number(process.env.PIKO_EI_CONTENT_REVIEW_NUM_CTX || 8192),
    timeoutMs: Math.max(8000, Number(process.env.PIKO_EI_CONTENT_REVIEW_TIMEOUT_MS || 60000)),
    priority: 'background',
    lane: 'worker',
  });
  return parseJudgment(raw, 'text');
}

async function judgeImageContent(item, content, opts = {}) {
  const goal = opts.goal || loadResearchGoal();
  const rulesSummary = opts.rulesSummary || formatRulesSummary(loadRules());
  const model = getVisionModel();
  const baseUrl = ollamaBaseUrl();
  const timeoutMs = Math.max(15000, Number(process.env.PIKO_EI_CONTENT_REVIEW_VISION_TIMEOUT_MS || 120000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = {
      model,
      stream: false,
      format: 'json',
      messages: [
        {
          role: 'user',
          content: `${buildJudgmentPrompt(item, goal, rulesSummary)}\n\nSOURCE MATERIAL: attached image of the museum/object/page.`,
          images: [content.imageBase64],
        },
      ],
      options: { temperature: 0, num_predict: 160 },
    };
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`vision ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const raw = (json && json.message && json.message.content) || '';
    return parseJudgment(raw, 'image');
  } finally {
    clearTimeout(timer);
  }
}

function parseJudgment(raw, modality) {
  const parsed = extractJsonObject(raw) || {};
  let verdict = String(parsed.verdict || '').toLowerCase().trim();
  if (verdict !== 'keep' && verdict !== 'drop') verdict = 'review';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const why = String(parsed.why || '').trim().slice(0, 240);
  return {
    ok: true,
    verdict,
    confidence,
    why,
    modality,
    reason_tag: `content_review:${verdict}`,
  };
}

/**
 * Full content review for one harvest item.
 */
async function reviewItemContent(item, opts = {}) {
  if (!contentReviewEnabled()) {
    return { ok: true, skipped: true, verdict: null, reason_tag: 'content_review:skipped' };
  }
  const content = await resolveReadableContent(item);
  if (content.kind === 'none') {
    return {
      ok: true,
      verdict: 'drop',
      confidence: 1,
      why: 'No readable text, PDF, OCR, or image to review',
      modality: 'none',
      reason_tag: 'content_review:no_readable_content',
      content_source: 'none',
    };
  }
  if (content.kind === 'image') {
    const judged = await judgeImageContent(item, content, opts);
    return { ...judged, content_source: content.source };
  }
  const judged = await judgeTextContent(item, content, opts);
  return { ...judged, content_source: content.source, content_chars: content.chars };
}

module.exports = {
  contentReviewEnabled,
  resolveReadableContent,
  reviewItemContent,
  extractDocumentText,
  getTextModel,
  getVisionModel,
  MIN_TEXT_CHARS,
};
