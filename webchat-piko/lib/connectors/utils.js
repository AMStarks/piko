const fs = require('fs');
const path = require('path');
const https = require('https');

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function resolveDataPath(ctx, fileName) {
  return path.join(ctx.dataDir, fileName);
}

function httpsJsonRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) {}
        resolve({ statusCode: res.statusCode, data, json: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function refreshGmailAccessToken(env) {
  const refreshToken = env.GMAIL_REFRESH_TOKEN;
  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  const { statusCode, json } = await httpsJsonRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (statusCode !== 200 || !json || !json.access_token) return null;
  return json.access_token;
}

async function getGmailAccessToken(env) {
  if (env.GMAIL_ACCESS_TOKEN) return env.GMAIL_ACCESS_TOKEN;
  return refreshGmailAccessToken(env);
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  resolveDataPath,
  httpsJsonRequest,
  getGmailAccessToken,
};
