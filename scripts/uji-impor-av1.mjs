/* Uji ringkas alur impor dua tahap: pra-tinjau → konfirmasi.
   Format kolom baru (tanpa varian): kode_item, nama_produk, sku, kategori,
   merek, satuan, barcode, harga_beli, harga_jual, status, nama_file_foto.
   Pakai kode scratch IMP- dan SKU IMPU- agar tidak menyentuh katalog demo;
   bersih sendiri di akhir (produk, batch impor, kategori fixture). */
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { headerUji } from './sesi-uji.mjs';

const BASE = `${process.env.BASE ?? 'http://127.0.0.1:3001'}/api`;
const db = new DatabaseSync(process.env.DB_FILE ?? 'data/app.db');

const bersihkan = () => {
  db.prepare(`DELETE FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches WHERE nama_file LIKE 'uji-impor%')`).run();
  db.prepare(`DELETE FROM import_batches WHERE nama_file LIKE 'uji-impor%'`).run();
  db.prepare(`DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'IMPU-%')`).run();
  db.prepare(`DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'IMPU-%')`).run();
  db.prepare(`DELETE FROM products WHERE sku LIKE 'IMPU-%'`).run();
  db.prepare(`DELETE FROM categories WHERE nama = 'Kategori Impor Uji'`).run();
};
bersihkan();

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Data');
ws.addRow(['kode_item', 'nama_produk', 'sku', 'kategori', 'merek', 'satuan', 'barcode', 'harga_beli', 'harga_jual', 'status', 'nama_file_foto']);
ws.addRow(['IMP-0001', 'Impor Uji Alpha', 'IMPU-ALPHA', 'Kategori Impor Uji', '', '', '', 1000, 2000, 'Aktif', '']);
ws.addRow(['IMP-0002', 'Impor Uji Beta', 'IMPU-BETA', '', '', '', '', 500, 900, 'Aktif', '']);
ws.addRow(['IMP-0003', '', 'IMPU-ERR1', '', '', '', '', 100, 200, 'Aktif', '']); // nama kosong → error
ws.addRow(['', 'Impor Uji Tanpa Kode', 'IMPU-ERR2', '', '', '', '', 100, 200, 'Aktif', '']); // kode wajib → error
const buf = Buffer.from(await wb.xlsx.writeBuffer());
const data_base64 = buf.toString('base64');

const post = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await headerUji(),
    body: JSON.stringify({ nama_file: 'uji-impor.xlsx', data_base64 }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

const cek = (nama, ok, info = '') => console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);

const pra = await post('/master/produk/impor/pra-tinjau');
console.log('pra-tinjau:', pra.status, JSON.stringify(pra.body).slice(0, 700));
cek('pra-tinjau: 200, 2 valid + 2 error', pra.status === 200 && pra.body.baris_valid === 2 && pra.body.baris_error === 2, `valid=${pra.body.baris_valid} error=${pra.body.baris_error}`);

if (pra.status === 200) {
  const impor = await post('/master/produk/impor');
  console.log('konfirmasi:', impor.status, JSON.stringify(impor.body).slice(0, 700));
  cek('konfirmasi: 200 & 2 baris valid masuk', impor.status === 200 && impor.body.baris_valid === 2, `valid=${impor.body.baris_valid}`);

  // UPSERT: impor ulang baris valid yang sama → tidak dobel, data diperbarui.
  const ulang = await post('/master/produk/impor');
  const n = Number(db.prepare(`SELECT COUNT(*) AS c FROM products WHERE sku LIKE 'IMPU-%'`).get()?.c ?? -1);
  cek('impor ulang idempoten (produk tetap 2)', ulang.status === 200 && n === 2, `jumlah=${n}`);

  const alpha = db.prepare(`SELECT nama, harga_beli, harga_jual, aktif FROM products WHERE sku = 'IMPU-ALPHA'`).get();
  cek('data Alpha tersimpan sesuai', alpha?.nama === 'Impor Uji Alpha' && Number(alpha?.harga_beli) === 1000 && Number(alpha?.harga_jual) === 2000 && Number(alpha?.aktif) === 1, JSON.stringify(alpha));

  const kat = db.prepare(`SELECT COUNT(*) AS c FROM categories WHERE nama = 'Kategori Impor Uji'`).get();
  cek('kategori impor dibuat otomatis', Number(kat?.c ?? 0) === 1);
}

const daftar = await fetch(`${BASE}/master/produk?per=50&urut=kode_item&arah=ASC`, { headers: await headerUji() }).then((r) => r.json());
const rows = (daftar.data ?? []).map((p) => `${p.kode_item}|${p.nama}`);
console.log('daftar produk:', rows.join(' ; '));
cek('produk impor muncul di daftar', rows.some((s) => s.startsWith('IMP-0001|')), '');

bersihkan();
db.close();
console.log('Fiks uji impor dibersihkan.');
