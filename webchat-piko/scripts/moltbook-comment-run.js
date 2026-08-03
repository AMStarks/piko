#!/usr/bin/env node
/**
 * Moltbook comment run: up to 5 replies per half hour. Prioritize engaging people who replied to our posts.
 * 1. Fetch our posts from state; GET each post and collect comments from others → "reply targets".
 * 2. Fetch hot feed; build candidates (popular posts), exclude our posts and already-commented.
 * 3. Process reply targets first (up to 2), then fill with feed (up to 5 total); draft with Ollama, POST comment, verify if required.
 * Run from app root. Cron (e.g. every 30 min): 15,45 * * * * cd /root/webchat-piko && (set -a && . ./.env 2>/dev/null; set +a) && node scripts/moltbook-comment-run.js >> logs/moltbook-comment.log 2>&1
 * Ensure .env has MOLTBOOK_API_KEY, OLLAMA_URL, OLLAMA_MODEL.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_DIR = path.join(ROOT, 'data');
const LOGS_DIR = path.join(ROOT, 'logs');
const COMMENT_STATE_FILE = path.join(DATA_DIR, 'moltbook-comment-state.json');
const MOLTBOOK_STATE_FILE = path.join(DATA_DIR, 'moltbook-state.json');
const MAX_COMMENTS_PER_RUN = 5;
const MAX_REPLY_TO_US = 2;
const OUR_POSTS_TO_CHECK = 10;
const FEED_LIMIT = 40;
const { ai } = require('../lib/llm');
const { collapseNewlinesToSpace, keepAsciiDigitsDotMinus } = require('../lib/text');
const KEY = process.env.MOLTBOOK_API_KEY || process.env.MOLTBOOK_KEY;

function moltbookGet(key, pathWithQuery) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.moltbook.com',
      port: 443,
      path: '/api/v1' + pathWithQuery,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (ch) => (d += ch));
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, data: JSON.parse(d) }); } catch (_) { resolve({ statusCode: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function moltbookPost(key, pathWithQuery, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.moltbook.com',
      port: 443,
      path: '/api/v1' + pathWithQuery,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (ch) => (d += ch));
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, data: JSON.parse(d) }); } catch (_) { resolve({ statusCode: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function readCommentState() {
  try {
    const raw = fs.readFileSync(COMMENT_STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { commentedPostIds: j.commentedPostIds || [], lastRunAt: j.lastRunAt || null };
  } catch (_) {
    return { commentedPostIds: [], lastRunAt: null };
  }
}

function writeCommentState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed = (state.commentedPostIds || []).slice(-500);
  fs.writeFileSync(COMMENT_STATE_FILE, JSON.stringify({ ...state, commentedPostIds: trimmed, lastRunAt: state.lastRunAt || new Date().toISOString() }, null, 2), 'utf8');
}

async function main() {
  if (!KEY) {
    console.error('[moltbook-comment-run] MOLTBOOK_API_KEY not set');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const state = readCommentState();
  const commentedSet = new Set((state.commentedPostIds || []).map(String));

  let agentId = null;
  try {
    const { statusCode, data: meData } = await moltbookGet(KEY, '/agents/me');
    if (statusCode === 200 && meData) {
      const agent = meData.agent || meData;
      agentId = agent.id || null;
    }
  } catch (e) {
    console.error('[moltbook-comment-run] agents/me error:', e.message);
    process.exitCode = 1;
    return;
  }

  let feedItems = [];
  try {
    const { statusCode, data: feedData } = await moltbookGet(KEY, '/feed?sort=hot&limit=' + FEED_LIMIT);
    if (statusCode === 200 && feedData) {
      const raw = Array.isArray(feedData) ? feedData : (feedData.data || feedData.posts || feedData.items || []);
      feedItems = Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    console.error('[moltbook-comment-run] feed error:', e.message);
  }

  if (!feedItems.length) {
    try {
      const { statusCode, data: postsData } = await moltbookGet(KEY, '/posts?sort=new&limit=' + FEED_LIMIT);
      if (statusCode === 200 && postsData) {
        const raw = Array.isArray(postsData) ? postsData : (postsData.posts || postsData.data || []);
        feedItems = Array.isArray(raw) ? raw : [];
      }
    } catch (_) {}
  }

  const replyTargets = [];
  try {
    let ourPostIds = [];
    if (fs.existsSync(MOLTBOOK_STATE_FILE)) {
      const raw = fs.readFileSync(MOLTBOOK_STATE_FILE, 'utf8');
      const j = JSON.parse(raw);
      const posts = j.posts || [];
      ourPostIds = posts.slice(0, OUR_POSTS_TO_CHECK).map((p) => p.id).filter(Boolean);
    }
    for (const postId of ourPostIds) {
      if (commentedSet.has(postId)) continue;
      const { statusCode, data: pData } = await moltbookGet(KEY, '/posts/' + encodeURIComponent(postId));
      if (statusCode !== 200 || !pData) continue;
      const p = pData.post || pData;
      const comments = p.comments || pData.comments || [];
      const list = Array.isArray(comments) ? comments : [];
      const fromOthers = list.filter((c) => (c.author && c.author.id && c.author.id !== agentId) || (c.agent_id && c.agent_id !== agentId));
      if (fromOthers.length === 0) continue;
      const c = fromOthers[0];
      replyTargets.push({
        id: postId,
        title: (p.title || p.content || '').toString().slice(0, 200),
        content: (p.content || '').toString().slice(0, 400),
        commentText: (c.content || c.text || '').toString().slice(0, 300),
        commentAuthor: (c.author && c.author.name) ? c.author.name : '',
        isReplyToUs: true,
      });
    }
  } catch (e) {
    console.error('[moltbook-comment-run] replies-to-us fetch error:', e.message);
  }

  const candidates = feedItems
    .map((p) => ({
      id: (p && p.id) ? String(p.id) : null,
      title: (p.title || p.content || '').toString().slice(0, 200),
      content: (p.content || p.body || '').toString().slice(0, 500),
      upvotes: p.upvotes != null ? p.upvotes : 0,
      authorId: (p.author && p.author.id) ? String(p.author.id) : (p.agent_id || ''),
      followerCount: (p.author && p.author.follower_count != null) ? p.author.follower_count : 0,
    }))
    .filter((p) => p.id && !commentedSet.has(p.id) && (!agentId || p.authorId !== agentId));

  candidates.sort((a, b) => {
    const scoreA = (a.upvotes || 0) + (a.followerCount || 0) / 10;
    const scoreB = (b.upvotes || 0) + (b.followerCount || 0) / 10;
    return scoreB - scoreA;
  });

  const replyFirst = replyTargets.slice(0, MAX_REPLY_TO_US).filter((r) => !commentedSet.has(r.id));
  const feedFirst = candidates.slice(0, MAX_COMMENTS_PER_RUN - replyFirst.length);
  const toComment = [...replyFirst, ...feedFirst];
  let done = 0;

  for (const post of toComment) {
    let content = '';
    try {
      const prompt = post.isReplyToUs
        ? `You are Piko. Someone commented on your post. Write a short, friendly reply (1-2 sentences) to continue the conversation. No meta-commentary. Output only the reply.

Your post: ${(post.title || '').slice(0, 100)} — ${(post.content || '').slice(0, 200)}
Their comment: ${(post.commentText || '').slice(0, 250)}${post.commentAuthor ? ' (by ' + post.commentAuthor + ')' : ''}

Reply:`
        : `You are Piko. Write one short, genuine comment (1-2 sentences) on this post. Be relevant and concise. No meta-commentary. Output only the comment text.

Post title: ${(post.title || '').slice(0, 150)}
Post excerpt: ${(post.content || '').slice(0, 300)}

Comment:`;
      content = (await ai(prompt)).trim();
      content = collapseNewlinesToSpace(content || '').slice(0, 500);
    } catch (e) {
      console.error('[moltbook-comment-run] Ollama comment draft error:', e.message);
      continue;
    }
    if (!content) continue;

    let res;
    try {
      res = await moltbookPost(KEY, '/posts/' + encodeURIComponent(post.id) + '/comments', { content });
    } catch (e) {
      console.error('[moltbook-comment-run] comment POST error for', post.id, e.message);
      continue;
    }

    const status = res.statusCode;
    const data = res.data && typeof res.data === 'object' ? res.data : {};

    if (status >= 200 && status < 300) {
      state.commentedPostIds = state.commentedPostIds || [];
      state.commentedPostIds.push(post.id);
      commentedSet.add(post.id);
      done++;
      if (post.isReplyToUs) console.log('[moltbook-comment-run] Replied to thread (our post):', post.id);

      if (data.verification_required && data.verification) {
        const code = data.verification.code || data.verification.verification_code;
        const challenge = data.verification.challenge || '';
        let answer = '';
        try {
          const solvePrompt = `Solve this problem. Reply with ONLY the number with 2 decimal places (e.g. 41.00). No other text.

${challenge}`;
          answer = (await ai(solvePrompt)).trim();
          answer = keepAsciiDigitsDotMinus(answer || '').trim();
          if (answer && !answer.includes('.')) answer = answer + '.00';
          if (!answer) answer = '0.00';
        } catch (_) {
          answer = '0.00';
        }
        if (code) {
          try {
            const verifyRes = await moltbookPost(KEY, '/verify', { verification_code: code, answer });
            if (verifyRes.statusCode >= 200 && verifyRes.statusCode < 300) {
              console.log('[moltbook-comment-run] Comment + verify OK:', post.id);
            } else {
              console.log('[moltbook-comment-run] Comment OK, verify failed:', post.id, verifyRes.statusCode);
            }
          } catch (e) {
            console.log('[moltbook-comment-run] Comment OK, verify error:', e.message);
          }
        } else {
          console.log('[moltbook-comment-run] Comment created (pending verify):', post.id);
        }
      } else {
        console.log('[moltbook-comment-run] Comment posted:', post.id);
      }
    } else if (status === 429) {
      console.log('[moltbook-comment-run] Rate limit at comment', done + 1);
      break;
    } else {
      console.error('[moltbook-comment-run] Comment failed', post.id, status, typeof data === 'object' ? (data.error || data.message || '') : '');
    }
  }

  state.lastRunAt = new Date().toISOString();
  writeCommentState(state);
  console.log('[moltbook-comment-run] Done. Comments this run:', done, 'total commented:', (state.commentedPostIds || []).length);
}

main().catch((e) => {
  console.error('[moltbook-comment-run]', e.message);
  process.exitCode = 1;
});
