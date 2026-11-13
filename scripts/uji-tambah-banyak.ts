/* Buat 24 produk uji (untuk uji pilih-massal lintas halaman). */
import { all, get, pool, run } from '../server/db.pg.ts';
(await run(`DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %')`));
(await run(`DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %')`));
(await run(`DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Banyak %')`));
(await run(`DELETE FROM products WHERE nama LIKE 'Massal Banyak %'`));

const ins = async (...a: unknown[]): Promise<void> => {
  await run(
    `INSERT INTO products (kode_item, nama, sku, harga_beli, harga_jual, stok_min, aktif)
     VALUES (?, ?, ?, 500, 1000, 0, TRUE)`,
    ...a,
  );
};
for (let i = 1; i <= 24; i++) {
  const kode = `MB-${String(i).padStart(3, '0')}`;
  await ins(kode, `Massal Banyak ${i}`, `MB-${i}-A`);
}
console.log('24 produk uji dibuat.');
