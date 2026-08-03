/**
 * Sovereign Search — local SearXNG indexer + Web Reader pipeline.
 * No tracking, no subscriptions, no API rate limits.
 */
const { extractMarkdownFromUrl } = require('./webReader');
const { ollamaNativeChat } = require('./llm');

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:8080';

/**
 * Quick query: just hit SearXNG, return results (no Reader). For /search command.
 */
const {
  stripTrailingSlash,
} = require('./text');

async function querySearXNG(query, maxResults = 5) {
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return [];
  try {
    const searchUrl = `${stripTrailingSlash(SEARXNG_URL)}/search?q=${encodeURIComponent(q)}&format=json`;
    const res = await fetch(searchUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, maxResults);
  } catch (_) {
    return [];
  }
}

/**
 * Run the full pipeline: SearXNG → top URLs → Readability → Markdown.
 * @param {string} query - Search query
 * @param {{ topN?: number }} [opts] - Number of URLs to fetch (default 2)
 * @returns {Promise<string>} Combined markdown for LLM, or error message
 */
async function sovereignSearch(query, opts = {}) {
  const topN = opts.topN ?? 2;
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return 'Please provide a query to search.';

  try {
    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[SOVEREIGN SEARCH] Querying local SearXNG for: "${q}"`);

    const searchUrl = `${stripTrailingSlash(SEARXNG_URL)}/search?q=${encodeURIComponent(q)}&format=json`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error(`SearXNG returned ${searchRes.status}`);

    const searchData = await searchRes.json();
    const results = searchData.results || [];

    if (results.length === 0) {
      return `I searched the web for "${q}" but found no results. Ensure SearXNG is running on port 8080.`;
    }

    const topUrls = results.slice(0, topN).map((r) => r.url);

    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[SOVEREIGN SEARCH] Found URLs, initiating Web Reader...`);

    let combinedMarkdown = `Web Research Results for: "${q}"\n\n`;

    for (const url of topUrls) {
      const articleText = await extractMarkdownFromUrl(url);
      if (articleText) {
        combinedMarkdown += `--- ARTICLE ---\n${articleText}\n\n`;
      } else {
        const fallbackResult = results.find((r) => r.url === url);
        combinedMarkdown += `--- ARTICLE (Snippet Only) ---\nSource: ${url}\nSnippet: ${fallbackResult?.content || 'N/A'}\n\n`;
      }
    }

    return `${combinedMarkdown}\n\nSystem Instruction: Read the above extracted articles, synthesize the data, and answer the user's original query.`;
  } catch (err) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.error('[SOVEREIGN SEARCH] Pipeline failed:', err);
    return "I tried to search the web, but my local search indexer failed. Please ensure SearXNG is running on port 8080.";
  }
}

/**
 * Synthesize raw scraped markdown into natural language via the main LLM.
 * Prevents Piko from vomiting raw HTML/markdown to the user.
 * @param {string} rawMarkdown - Output from sovereignSearch
 * @param {string} userQuery - Original user message
 * @param {string} model - Session model for synthesis
 * @returns {Promise<string>} Natural, conversational response
 */
async function synthesizeWebResearch(rawMarkdown, userQuery, model) {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return "Couldn't find anything useful.";
  if (rawMarkdown.includes('found no results') || rawMarkdown.includes('search indexer failed')) return rawMarkdown;

  const synthesisPrompt = `You are Piko, an elite supply chain agent. The user asked a question requiring web research.

Below is the raw data scraped from the internet.

Your Rules:
1. Synthesize this information into a concise, 2-3 paragraph Executive Briefing.
2. Extract the exact numbers, dates, and core reasons requested.
3. Do NOT ramble. Finish your thought completely.
4. Do NOT output raw markdown logs or HTML.

User query: ${String(userQuery || '').slice(0, 300)}

RAW DATA:
${rawMarkdown.slice(0, 8000)}`;

  try {
    const { getHeavyModel, heavySynthesisEnabled } = require('./frontDesk');
    const modelForSynthesis = heavySynthesisEnabled()
      ? getHeavyModel()
      : (model || process.env.PIKO_CASUAL_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune');
    const raw = await ollamaNativeChat(modelForSynthesis, [{ role: 'user', content: synthesisPrompt }], {
      temperature: 0.4,
      max_tokens: 1024,
    });
    return (raw || "Couldn't synthesize that — try again in a moment.").trim().slice(0, 2000);
  } catch (err) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.error('[SOVEREIGN SEARCH] Synthesis failed:', err);
    return "I found some data but couldn't turn it into a clear answer. Try rephrasing your question.";
  }
}

/**
 * Full pipeline: search → scrape → synthesize. Returns natural language response.
 */
async function sovereignSearchAndSynthesize(query, userQuery, model, opts = {}) {
  const raw = await sovereignSearch(query, opts);
  return synthesizeWebResearch(raw, userQuery || query, model);
}

module.exports = { sovereignSearch, querySearXNG, synthesizeWebResearch, sovereignSearchAndSynthesize };
