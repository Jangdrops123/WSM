import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
for (const t of ['purchases', 'purchase_items', 'payables', 'purchase_scan_logs', 'purchase_chat_logs', 'suppliers', 'units']) {
  try {
    console.log(t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  } catch (e) {
    console.log(t, 'ERR', (e as Error).message);
  }
}
console.log('accounts:', JSON.stringify(db.prepare('SELECT kode, nama FROM accounts').all()));
console.log('suppliers:', JSON.stringify(db.prepare('SELECT id, nama FROM suppliers LIMIT 5').all()));
console.log('units:', JSON.stringify(db.prepare('SELECT id, nama FROM units LIMIT 8').all()));
console.log(db.prepare(`SELECT sql FROM sqlite_master WHERE name='products'`).get().sql);
console.log(db.prepare(`SELECT sql FROM sqlite_master WHERE name='trg_purchases_disahkan_terkunci'`).get().sql);
