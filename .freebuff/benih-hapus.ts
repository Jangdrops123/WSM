/* Hapus semua data tur visual: penjualan Budi Demo, hutang PB-DEMO-2,
   pemasok PT Maju Jaya, stok_min produk dipulihkan, pengaturan & preferensi
   tampilan dikembalikan ke bawaan. */
import { db } from '../server/db.ts';

// 1) Pulihkan stok_min produk yang diubah benih-pengingat.ts.
const lama = db.prepare(`SELECT nilai FROM settings WHERE kunci = 'demo_stok_min_lama'`).get() as any;
if (lama) {
  db.prepare(
    `UPDATE products SET stok_min = ? WHERE id = (SELECT product_id FROM stock_balances GROUP BY product_id ORDER BY SUM(qty) DESC LIMIT 1)`,
  ).run(Number(lama.nilai));
}

// 2) Hapus penjualan Budi Demo (kembalikan stok + jurnal terkait).
const jual = db.prepare(`SELECT id, warehouse_id FROM sales WHERE no_dokumen = 'SJ-2026-10-0016'`).all() as { id: number; warehouse_id: number }[];
for (const s of jual) {
  const baris = db.prepare(`SELECT product_id, qty FROM sale_items WHERE sale_id = ?`).all(s.id) as { product_id: number; qty: number }[];
  for (const b of baris) {
    db.prepare(`INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = qty + excluded.qty`)
      .run(b.product_id, s.warehouse_id, b.qty);
  }
  db.prepare(`UPDATE journals SET status = 'batal' WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ? AND status = 'disahkan'`).run(s.id);
  db.prepare(`DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?)`).run(s.id);
  db.prepare(`DELETE FROM journals WHERE sumber_tipe IN ('penjualan', 'hpp') AND sumber_id = ?`).run(s.id);
  db.prepare(`DELETE FROM receivables WHERE sale_id = ?`).run(s.id);
  db.prepare(`DELETE FROM sale_payments WHERE sale_id = ?`).run(s.id);
  db.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).run(s.id);
  db.prepare(`DELETE FROM stock_ledger WHERE tipe_dokumen = 'penjualan' AND dokumen_id = ?`).run(s.id);
  db.prepare(`DELETE FROM sales WHERE id = ?`).run(s.id);
}

// 3) Jurnal & tabel pembayaran piutang/hutang dari tur.
db.prepare(`UPDATE journals SET status = 'batal' WHERE sumber_tipe = 'pembayaran' AND status = 'disahkan'`).run();
db.prepare(`DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journals WHERE sumber_tipe = 'pembayaran')`).run();
db.prepare(`DELETE FROM journals WHERE sumber_tipe = 'pembayaran'`).run();
db.prepare(`DELETE FROM payments WHERE tipe IN ('piutang', 'hutang')`).run();

// 4) Pembelian demo.
db.prepare(`DELETE FROM payables WHERE purchase_id IN (SELECT id FROM purchases WHERE no_dokumen IN ('PB-DEMO-1', 'PB-DEMO-2'))`).run();
db.prepare(`DELETE FROM purchases WHERE no_dokumen IN ('PB-DEMO-1', 'PB-DEMO-2')`).run();

// 5) Master demo & preferensi.
db.prepare(`DELETE FROM customers WHERE nama = 'Budi Demo'`).run();
db.prepare(`DELETE FROM suppliers WHERE nama = 'PT Maju Jaya'`).run();
db.prepare(`DELETE FROM pengaturan_dashboard`).run();
db.prepare(`DELETE FROM pengaturan_dashboard_peran`).run();
db.prepare(`DELETE FROM settings WHERE kunci LIKE 'pengingat_%' OR kunci = 'demo_stok_min_lama'`).run();
db.prepare(`DELETE FROM audit_logs WHERE tabel IN ('pengaturan_dashboard_peran', 'receivables', 'payables')`).run();

// 6) Tutup shift yang dibuka benih bila masih aktif.
const aktif = db.prepare(`SELECT id, kas_awal FROM cashier_shifts WHERE tutup_pada IS NULL`).get() as any;
if (aktif) {
  db.prepare(`UPDATE cashier_shifts SET kas_akhir_sistem = kas_awal, kas_akhir_fisik = kas_awal, selisih = 0, tutup_pada = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?`).run(aktif.id);
}

const sisa = {
  sales: (db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as any).n,
  purchasesDemo: (db.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE no_dokumen LIKE 'PB-DEMO-%'`).get() as any).n,
  bayar: (db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE tipe IN ('piutang', 'hutang')`).get() as any).n,
  jurnalBayar: (db.prepare(`SELECT COUNT(*) AS n FROM journals WHERE sumber_tipe = 'pembayaran'`).get() as any).n,
};
console.log('bersih:', sisa);
