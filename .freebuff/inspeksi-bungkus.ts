import { db } from '../server/db.ts';

for (const t of ['stock_ledger', 'stock_balances', 'packs', 'pack_items', 'units', 'unit_conversions', 'products']) {
  console.log(t + ':', db.prepare(`PRAGMA table_info(${t})`).all().map((c: any) => c.name).join(','));
}
console.log('units isi:', JSON.stringify(db.prepare(`SELECT id, kode, nama FROM units`).all()));
console.log(
  'kodi dipakai:',
  JSON.stringify(
    db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM unit_conversions WHERE unit_id IN (SELECT id FROM units WHERE lower(kode)='kodi' OR lower(nama) LIKE '%kodi%')) konversi,
          (SELECT COUNT(*) FROM sale_items WHERE unit_id IN (SELECT id FROM units WHERE lower(kode)='kodi' OR lower(nama) LIKE '%kodi%')) sale_items,
          (SELECT COUNT(*) FROM purchase_items WHERE unit_id IN (SELECT id FROM units WHERE lower(kode)='kodi' OR lower(nama) LIKE '%kodi%')) purchase_items`,
      )
      .get(),
  ),
);
console.log('produk aktif:', (db.prepare(`SELECT COUNT(*) c FROM products WHERE aktif = 1 AND deleted_at IS NULL`).get() as any).c);
console.log('ledger contoh:', JSON.stringify(db.prepare(`SELECT * FROM stock_ledger ORDER BY id DESC LIMIT 2`).all(), null, 1));
console.log('packs contoh:', JSON.stringify(db.prepare(`SELECT * FROM packs`).all()));
process.exit(0);
