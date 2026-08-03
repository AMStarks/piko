const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isValidSku,
  formatStockOnHandReply,
  getStockOnHand,
} = require('../lib/inventoryStockOnHand');

describe('inventoryStockOnHand', () => {
  it('validates SKU shape without inventing', () => {
    assert.equal(isValidSku('48SCOTCH-MED'), true);
    assert.equal(isValidSku('G10B1'), true);
    assert.equal(isValidSku('a'), false);
    assert.equal(isValidSku('bad sku!'), false);
  });

  it('formats found stock from tool data only', () => {
    const reply = formatStockOnHandReply({
      found: true,
      sku: '48SCOTCH-MED',
      stock_on_hand: 85,
      available: 80,
      allocated: 5,
      on_order: 0,
      supplier_name: 'Shanghai Kakas Hardware Technology',
      source: 'sales_cache',
    });
    assert.match(reply, /48SCOTCH-MED has 85 units on hand/);
    assert.match(reply, /available 80/);
    assert.doesNotMatch(reply, /dozen/i);
  });

  it('refuses to invent when SKU missing', () => {
    const reply = formatStockOnHandReply({ found: false, sku: 'NOPE-SKU' });
    assert.match(reply, /could not find stock data/i);
    assert.doesNotMatch(reply, /\d+ units/);
  });

  it('reads SOH from sales_cache fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-soh-'));
    const dbPath = path.join(dir, 'sales_cache.sqlite');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE products (
      sku TEXT PRIMARY KEY, soh INTEGER, moq INTEGER, allocated INTEGER,
      available INTEGER, on_order INTEGER, on_order_deliveries TEXT,
      updated_at TEXT, average_cost REAL, supplier_name TEXT, supplier_id TEXT, sell_price REAL
    )`);
    db.prepare(
      `INSERT INTO products (sku, soh, allocated, available, on_order, supplier_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('48SCOTCH-MED', 85, 0, 85, 0, 'Test Supplier', '2026-07-17');
    db.close();

    const prev = process.env.PIKO_SALES_CACHE_PATH;
    process.env.PIKO_SALES_CACHE_PATH = dbPath;
    try {
      // Force AusMaker miss by pointing at unreachable host
      const result = await getStockOnHand('48SCOTCH-MED', {
        ausmakerBase: 'http://127.0.0.1:1',
        dataDir: dir,
      });
      assert.equal(result.found, true);
      assert.equal(result.stock_on_hand, 85);
      assert.equal(result.source, 'sales_cache');
      const reply = formatStockOnHandReply(result);
      assert.match(reply, /85 units on hand/);
    } finally {
      if (prev == null) delete process.env.PIKO_SALES_CACHE_PATH;
      else process.env.PIKO_SALES_CACHE_PATH = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
