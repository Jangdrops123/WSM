/* Tandai/bersihkan pemakaian stok (stock_balances) untuk uji hapus dilewati. */
import { all, get, pool, run } from '../server/db.pg.ts';
const [kode, mode] = process.argv.slice(2);
if (!kode || !mode) {
  console.log('Pakai: tsx scripts/tandai-pakai.ts <kode_item> insert|bersih');
  process.exit(1);
}

const produk = (await get(`SELECT id FROM products WHERE kode_item = ?`, kode)) as { id: number } | undefined;

if (!produk) {
  console.log(`Produk ${kode} tidak ditemukan.`);
  process.exit(1);
}

if (mode === 'insert') {
  (await run(
    `INSERT INTO stock_balances (product_id, warehouse_id, qty)
     SELECT ?, w.id, 1 FROM warehouses w LIMIT 1
     ON CONFLICT DO NOTHING`,
    produk.id,
  ));
  console.log(`Produk ${produk.id} (${kode}) ditandai dipakai stok.`);
} else {
  (await run(`DELETE FROM stock_balances WHERE product_id = (SELECT id FROM products WHERE kode_item = ?)`, kode));
  console.log(`Pemakaian stok ${kode} dibersihkan.`);
}
