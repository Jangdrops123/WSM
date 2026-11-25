import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
const rows = db
  .prepare(
    `SELECT id, nama, sku, barcode, aktif
       FROM products
      WHERE lower(nama) LIKE '%chx%' OR lower(sku) LIKE '%chx%'
      ORDER BY id`,
  )
  .all();
for (const r of rows) console.log(`p${r.id} ${r.nama} | sku=${r.sku} bc=${r.barcode ?? '-'} aktif=${r.aktif}`);
console.log('--- jumlah produk dengan token serupa:');
for (const r of db.prepare(`SELECT id, nama FROM products WHERE lower(nama) LIKE '%chx%' OR lower(nama) LIKE '%ston%'`).all()) {
  console.log(r.id, r.nama, 'stok=', db.prepare(`SELECT COALESCE(SUM(qty),0) n FROM stock_balances WHERE product_id = ?`).get(r.id).n);
}
