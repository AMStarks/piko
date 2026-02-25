#!/usr/bin/env node
/**
 * Notion sync: push data/learning/*.md → Notion databases; pull Notion → data/learning/.
 * Run: node scripts/notion-sync.js --push | --pull
 * Env: NOTION_TOKEN, NOTION_DATABASE_ID_STICKY_IDEAS, NOTION_DATABASE_ID_TENSIONS, NOTION_DATABASE_ID_RABBIT_HOLE
 * Cron: push 5 * * * * ; pull 10 * * * * (or load .env and run)
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client } = require('@notionhq/client');

const DATA_LEARNING = path.join(__dirname, '..', 'data', 'learning');
const STICKY_FILE = path.join(DATA_LEARNING, 'sticky-ideas.md');
const TENSIONS_FILE = path.join(DATA_LEARNING, 'tensions.md');
const RABBIT_FILE = path.join(DATA_LEARNING, 'rabbit-hole-notes.md');

const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DB_STICKY = process.env.NOTION_DATABASE_ID_STICKY_IDEAS;
const DB_TENSIONS = process.env.NOTION_DATABASE_ID_TENSIONS;
const DB_RABBIT = process.env.NOTION_DATABASE_ID_RABBIT_HOLE;

function getClient() {
  if (!NOTION_TOKEN) {
    console.error('[notion-sync] Set NOTION_TOKEN (or NOTION_API_KEY) in .env');
    process.exitCode = 1;
    process.exit(1);
  }
  return new Client({ auth: NOTION_TOKEN });
}

// ——— Parsing local files ———

function readStickyIdeas() {
  if (!fs.existsSync(STICKY_FILE)) return [];
  const raw = fs.readFileSync(STICKY_FILE, 'utf8');
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
      items.push(line.slice(2).trim());
    }
  }
  return items;
}

function readTensions() {
  if (!fs.existsSync(TENSIONS_FILE)) return [];
  const raw = fs.readFileSync(TENSIONS_FILE, 'utf8');
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (line.startsWith('- ') && !line.startsWith('#') && !line.toLowerCase().startsWith('- max ')) {
      items.push(line.slice(2).trim());
    }
  }
  return items;
}

function readRabbitHoleBlocks() {
  if (!fs.existsSync(RABBIT_FILE)) return [];
  const raw = fs.readFileSync(RABBIT_FILE, 'utf8');
  const blocks = raw.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter((b) => b.trim());
  return blocks.map((block) => {
    const firstLine = block.split('\n')[0] || '';
    const titleMatch = firstLine.match(/^##\s+(.+)$/);
    const title = titleMatch ? titleMatch[1].trim() : firstLine.slice(0, 80);
    return { title, content: block.trim() };
  });
}

// ——— Notion helpers: property builders (Name = title, Content = rich_text) ———

function titleProp(name) {
  return {
    Name: {
      title: [{ type: 'text', text: { content: (name || '').slice(0, 2000) } }],
    },
  };
}

function richTextProp(content) {
  const text = (content || '').slice(0, 2000);
  return {
    Content: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

// Notion DBs may use "Name" or "Title" and "Content" or "Body". We use Name + Content; if your DB uses different names, add NOTION_PROP_TITLE / NOTION_PROP_CONTENT env.
const PROP_TITLE = process.env.NOTION_PROP_TITLE || 'Name';
const PROP_CONTENT = process.env.NOTION_PROP_CONTENT || 'Content';

function buildProps(title, content) {
  const props = {};
  props[PROP_TITLE] = { title: [{ type: 'text', text: { content: (title || '').slice(0, 2000) } }] };
  props[PROP_CONTENT] = { rich_text: [{ type: 'text', text: { content: (content || '').slice(0, 2000) } }] };
  return props;
}

// ——— Push: local files → Notion (replace existing rows to avoid duplicates) ———

async function archiveAllInDatabase(client, databaseId) {
  const pages = await queryAll(client, databaseId);
  for (const page of pages) {
    try {
      await client.pages.update({ page_id: page.id, archived: true });
    } catch (e) {
      console.error('[notion-sync] archive error:', e.message);
    }
  }
}

async function pushToNotion(client) {
  if (DB_STICKY) {
    const items = readStickyIdeas();
    await archiveAllInDatabase(client, DB_STICKY);
    for (let i = 0; i < items.length; i++) {
      try {
        await client.pages.create({
          parent: { database_id: DB_STICKY.trim() },
          properties: buildProps(`Sticky ${i + 1}`, items[i]),
        });
      } catch (e) {
        console.error('[notion-sync] sticky create error:', e.message);
      }
    }
    console.log('[notion-sync] Pushed sticky ideas:', items.length);
  }

  if (DB_TENSIONS) {
    const items = readTensions();
    await archiveAllInDatabase(client, DB_TENSIONS);
    for (let i = 0; i < items.length; i++) {
      try {
        await client.pages.create({
          parent: { database_id: DB_TENSIONS.trim() },
          properties: buildProps(`Tension ${i + 1}`, items[i]),
        });
      } catch (e) {
        console.error('[notion-sync] tension create error:', e.message);
      }
    }
    console.log('[notion-sync] Pushed tensions:', items.length);
  }

  if (DB_RABBIT) {
    const blocks = readRabbitHoleBlocks();
    await archiveAllInDatabase(client, DB_RABBIT);
    for (const block of blocks) {
      try {
        await client.pages.create({
          parent: { database_id: DB_RABBIT.trim() },
          properties: buildProps(block.title, block.content),
        });
      } catch (e) {
        console.error('[notion-sync] rabbit-hole create error:', e.message);
      }
    }
    console.log('[notion-sync] Pushed rabbit-hole blocks:', blocks.length);
  }
}

// ——— Pull: Notion → local files ———

function extractTitle(prop) {
  if (!prop || !prop.title) return '';
  return (prop.title || []).map((t) => t.plain_text || '').join('').trim();
}

function extractRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return (prop.rich_text || []).map((t) => t.plain_text || '').join('').trim();
}

async function queryAll(client, databaseId) {
  const results = [];
  let cursor;
  do {
    const resp = await client.databases.query({
      database_id: databaseId.trim(),
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...(resp.results || []));
    cursor = resp.next_cursor;
  } while (cursor);
  return results;
}

async function pullFromNotion(client) {
  fs.mkdirSync(DATA_LEARNING, { recursive: true });

  const getProp = (props, key) => props && (props[key] || props['Name'] || props['Content']);

  if (DB_STICKY) {
    try {
      const pages = await queryAll(client, DB_STICKY);
      const items = pages
        .map((p) => {
          const contentProp = getProp(p.properties, PROP_CONTENT);
          const titleProp = getProp(p.properties, PROP_TITLE);
          return extractRichText(contentProp) || extractTitle(titleProp);
        })
        .filter(Boolean);
      const content = '# Piko sticky ideas (synced from Notion)\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
      fs.writeFileSync(STICKY_FILE, content, 'utf8');
      console.log('[notion-sync] Pulled sticky ideas:', items.length);
    } catch (e) {
      console.error('[notion-sync] pull sticky error:', e.message);
    }
  }

  if (DB_TENSIONS) {
    try {
      const pages = await queryAll(client, DB_TENSIONS);
      const items = pages
        .map((p) => {
          const contentProp = getProp(p.properties, PROP_CONTENT);
          const titleProp = getProp(p.properties, PROP_TITLE);
          return extractRichText(contentProp) || extractTitle(titleProp);
        })
        .filter(Boolean);
      const content = '# Piko tensions (synced from Notion)\n\nMax 5 entries.\n\n' + items.map((s) => '- ' + s).join('\n') + '\n';
      fs.writeFileSync(TENSIONS_FILE, content, 'utf8');
      console.log('[notion-sync] Pulled tensions:', items.length);
    } catch (e) {
      console.error('[notion-sync] pull tensions error:', e.message);
    }
  }

  if (DB_RABBIT) {
    try {
      const pages = await queryAll(client, DB_RABBIT);
      const blocks = pages.map((p) => {
        const title = p.properties && extractTitle(getProp(p.properties, PROP_TITLE));
        const body = p.properties && extractRichText(getProp(p.properties, PROP_CONTENT));
        return { title: title || 'Note', body: body || '' };
      });
      const content = '# Piko rabbit-hole notes (synced from Notion)\n\n' + blocks.map((b) => `## ${b.title}\n\n${b.body}`).join('\n\n') + '\n';
      fs.writeFileSync(RABBIT_FILE, content, 'utf8');
      console.log('[notion-sync] Pulled rabbit-hole blocks:', blocks.length);
    } catch (e) {
      console.error('[notion-sync] pull rabbit-hole error:', e.message);
    }
  }
}

// ——— Main ———

async function main() {
  const mode = process.argv.includes('--pull') ? 'pull' : process.argv.includes('--push') ? 'push' : null;
  if (!mode) {
    console.log('Usage: node notion-sync.js --push | --pull');
    console.log('Env: NOTION_TOKEN, NOTION_DATABASE_ID_STICKY_IDEAS, NOTION_DATABASE_ID_TENSIONS, NOTION_DATABASE_ID_RABBIT_HOLE');
    process.exitCode = 1;
    return;
  }

  if (!DB_STICKY && !DB_TENSIONS && !DB_RABBIT) {
    console.error('[notion-sync] Set at least one NOTION_DATABASE_ID_* in .env');
    process.exitCode = 1;
    return;
  }

  const client = getClient();

  if (mode === 'push') {
    await pushToNotion(client);
  } else {
    await pullFromNotion(client);
  }
}

main().catch((e) => {
  console.error('[notion-sync]', e.message);
  process.exitCode = 1;
});
