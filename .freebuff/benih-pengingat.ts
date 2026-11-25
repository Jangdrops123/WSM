/* Benih sementara untuk tur visual: satu piutang penjualan terlambat + satu
   hutang pembelian terlambat. Hapus dengan: npx tsx .freebuff/benih-hapus.ts */
import { db } from '../server/db.ts';

const BASE = 'http://127.0.0.1:3001/api';

db.prepare(`DELETE FROM customers WHERE nama = 'Budi Demo'`).run();
db.prepare(`INSERT INTO customers (nama, telepon) VALUES ('Budi Demo', '081234556677')`).run();
const cust = db.prepare(`SELECT id FROM customers WHERE nama = 'Budi Demo'`).get() as { id: number };

const kand = db.prepare(
  `SELECT p.id AS product_id, p.nama, p.harga_jual AS harga, sb.warehouse_id
     FROM products p JOIN stock_balances sb ON sb.product_id = p.id
    WHERE p.aktif = 1 AND p.deleted_at IS NULL AND p.harga_jual > 0
    GROUP BY p.id, sb.warehouse_id HAVING SUM(sb.qty) >= 3
    ORDER BY SUM(sb.qty) DESC LIMIT 2`,
).all() as { product_id: number; nama: string; harga: number; warehouse_id: number }[];
if (kand.length < 2) throw new Error('stok demo tidak cukup');

const aktif = (await (await fetch(`${BASE}/pos/shift/aktif`)).json()) as any;
if (!aktif?.data?.id) {
  await fetch(`${BASE}/pos/shift/buka`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kas_awal: 250000 }),
  });
}

const jual = await fetch(`${BASE}/pos/sales`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    warehouse_id: kand[0].warehouse_id,
    customer_id: cust.id,
    items: [
      { product_id: kand[0].product_id, qty: 2, harga: kand[0].harga },
      { product_id: kand[1].product_id, qty: 1, harga: kand[1].harga },
    ],
    payments: [{ metode: 'kredit', jumlah: kand[0].harga * 2 + kand[1].harga }],
    jatuh_tempo: '2026-10-05',
  }),
}).then((r) => r.json());
console.log('penjualan kredit:', jual.status ?? jual);

const sup = db.prepare(`SELECT id FROM suppliers ORDER BY id LIMIT 1`).get() as { id: number } | undefined;
if (sup) {
  db.prepare(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen = 'PB-DEMO-1')`).run();
  db.prepare(`DELETE FROM purchases WHERE no_dokumen = 'PB-DEMO-1'`).run();
  const pbId = Number(
    db.prepare(`INSERT INTO purchases (no_dokumen, supplier_id, warehouse_id, total, status) VALUES ('PB-DEMO-1', ?, ?, 320000, 'disahkan')`)
      .run(sup.id, kand[0].warehouse_id).lastInsertRowid,
  );
  db.prepare(`INSERT INTO payables (purchase_id, supplier_id, jatuh_tempo, total, terbayar, status) VALUES (?, ?, '2026-10-09', 320000, 100000, 'sebagian')`)
    .run(pbId, sup.id);
  console.log('hutang demo dibuat');
}

// Stok menipis: naikkan stok_minimum satu produk di atas stoknya saat ini.
// Nilai lama disimpan di settings agar bisa dikembalikan (benih-hapus.ts).
const idMenipis = (db.prepare(`SELECT product_id FROM stock_balances GROUP BY product_id ORDER BY SUM(qty) DESC LIMIT 1`).get() as any)?.product_id;
if (idMenipis) {
  const lama = (db.prepare(`SELECT stok_min FROM products WHERE id = ?`).get(idMenipis) as any)?.stok_min ?? 0;
  db.prepare(`INSERT INTO settings (kunci, nilai) VALUES ('demo_stok_min_lama', ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`).run(String(lama));
  db.prepare(
    `UPDATE products SET stok_min = COALESCE((SELECT SUM(qty) FROM stock_balances WHERE product_id = products.id), 0) + 5 WHERE id = ?`,
  ).run(idMenipis);
}
console.log('selesai — muat ulang halaman untuk melihat pengingat.');
