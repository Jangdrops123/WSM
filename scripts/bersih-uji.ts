/* Bersihkan data fixture uji (dipakai setelah uji-massal / uji-tambah-banyak). */
import { all, get, pool, run } from '../server/db.pg.ts';
// Pemakaian stok uji pada BRG-0002 (agar bisa dihapus normal lagi)
(await run(`DELETE FROM stock_balances WHERE product_id IN (
  SELECT id FROM products WHERE kode_item = 'BRG-0002'
)`));

// Produk fixture (anak dulu — FK)
(await run(`DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %' OR nama LIKE 'Massal Uji %')`));
(await run(`DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %' OR nama LIKE 'Massal Uji %')`));
(await run(`DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %' OR nama LIKE 'Massal Uji %')`));
(await run(`DELETE FROM products WHERE nama LIKE 'Massal Banyak %' OR nama LIKE 'Massal Uji %'`));

// Pelanggan & kategori fixture
(await run(`DELETE FROM customers WHERE nama LIKE 'Pelanggan Uji %' OR nama = 'Pelanggan Massal Uji'`));
(await run(`DELETE FROM categories WHERE nama = 'Kategori Massal Uji'`));

const sisa = {
  produk: ((await get(`SELECT COUNT(*) AS n FROM products WHERE nama LIKE 'Massal %'`)) as { n: number }).n,
  pelanggan: ((await get(`SELECT COUNT(*) AS n FROM customers WHERE nama LIKE 'Pelanggan %'`)) as { n: number }).n,
};
console.log('Bersih. sisa fixture:', JSON.stringify(sisa));
