/**
 * Sovereign Web Reader — fetches HTML, extracts article via Readability, converts to Markdown.
 * Uses Playwright for SPAs (React/Next.js); falls back to fetch+JSDOM for static sites.
 * Aggressive sanitization: strips nav/header/footer before parsing, removes link URLs to avoid token bloat.
 */
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');

const USE_PLAYWRIGHT = process.env.PIKO_WEB_READER_PLAYWRIGHT !== '0';
const PLAYWRIGHT_TIMEOUT_MS = parseInt(process.env.PIKO_WEB_READER_TIMEOUT_MS, 10) || 15000;

/** Fallback: fetch + JSDOM (works for static sites, fails on SPAs) */
async function extractMarkdownFromUrlFetch(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  return parseHtmlToMarkdown(html, url);
}

/** Parse HTML string to markdown using Readability + Turndown */
const {
  squeezeBlankLines,
} = require('./text');

function parseHtmlToMarkdown(html, url) {
  const doc = new JSDOM(html, { url });
  const document = doc.window.document;

  const selectorsToRemove = ['nav', 'header', 'footer', 'aside', '.menu', '.sidebar', '[role="navigation"]', '#header', '#footer', 'script', 'style', 'noscript'];
  selectorsToRemove.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    } catch (_) {}
  });

  const reader = new Readability(document);
  const article = reader.parse();
  if (!article || !article.content) return null;

  const wrap = document.createElement('div');
  wrap.innerHTML = article.content;
  wrap.querySelectorAll('a').forEach((a) => {
    const text = a.textContent || '';
    a.replaceWith(document.createTextNode(text));
  });
  const contentWithoutLinks = wrap.innerHTML;

  const turndownService = new TurndownService();
  turndownService.addRule('remove-images', { filter: ['img', 'svg'], replacement: () => '' });

  let markdown = turndownService.turndown(contentWithoutLinks);
  markdown = squeezeBlankLines(markdown).trim();
  if (markdown.length > 6000) markdown = markdown.substring(0, 6000);

  return `Title: ${article.title}\nSource: ${url}\n\n${markdown}`;
}

/** Playwright path: headless browser for SPAs (executes JS before scrape) */
async function extractMarkdownFromUrlPlaywright(url) {
  let browser;
  try {
    const { chromium } = require('playwright');
    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[WEB READER] Playwright: ${url}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: PLAYWRIGHT_TIMEOUT_MS });
    const html = await page.content();
    await browser.close();
    return parseHtmlToMarkdown(html, url);
  } catch (error) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn(`[WEB READER] Playwright failed for ${url}:`, error.message);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

async function extractMarkdownFromUrl(url) {
  try {
    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[WEB READER] Fetching article from: ${url}`);

    if (USE_PLAYWRIGHT) {
      const result = await extractMarkdownFromUrlPlaywright(url);
      if (result) return result;
      if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[WEB READER] Playwright returned empty, falling back to fetch`);
    }

    const result = await extractMarkdownFromUrlFetch(url);
    if (result) return result;

    return null;
  } catch (error) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.error(`[WEB READER] Failed to parse ${url}:`, error.message);
    return null;
  }
}

/** Web actuation — performs click/type actions on a page. Use for form submission, checkout flows. */
async function actuateWebPage(url, actions) {
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: PLAYWRIGHT_TIMEOUT_MS });

    const results = [];
    for (const step of Array.isArray(actions) ? actions : []) {
      if (step.action === 'click' && step.selector) {
        await page.click(step.selector);
        results.push(`Clicked ${step.selector}`);
      } else if (step.action === 'type' && step.selector && step.value != null) {
        await page.fill(step.selector, String(step.value));
        results.push(`Typed into ${step.selector}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    await browser.close();
    return `Web actions completed on ${url}.\nLog: ${results.join(', ') || 'no actions'}`;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return `Web actuation failed: ${error.message}`;
  }
}

module.exports = { extractMarkdownFromUrl, actuateWebPage };
