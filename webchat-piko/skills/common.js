/**
 * Shared helpers for local skills. No marketplace — skills/ only.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const TODO_FILE = path.join(DATA_DIR, 'todo.json');

function loadJson(file, defaultVal) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : defaultVal;
  } catch (_) {
    return defaultVal;
  }
}

function saveJson(file, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Allow only public http/https URLs (no localhost, private IPs, or file:). Prevents SSRF. */
function isUrlAllowedForFetch(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = (u.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('0.0.0.0')) return false;
    if (/^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || /^192\.168\./.test(host)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (_) {
      return reject(new Error('Invalid URL'));
    }
    if (!isUrlAllowedForFetch(urlStr)) return reject(new Error('URL not allowed (use public http/https only)'));
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + u.search, method: 'GET' };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (ch) => (data += ch));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = { DATA_DIR, NOTES_FILE, TODO_FILE, loadJson, saveJson, stripHtml, fetchUrl, isUrlAllowedForFetch };
