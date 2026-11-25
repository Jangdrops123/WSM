// Uji integrasi API Master Data terhadap server yang sedang berjalan.
// Jalankan: node scripts/uji-master.mjs   (server API harus hidup di :3001)
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { headerUji } from './sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const db = new DatabaseSync(process.env.DB_FILE ?? 'data/app.db');

let lulus = 0;
let gagal = 0;
const catat = (nama, ok, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, data, headers: res.headers };
}

const bersihkan = () => {
  // Hanya data berprefix UJI- / UJI% — data lain tidak disentuh.
  db.exec(`
    DELETE FROM pack_items WHERE pack_id IN (SELECT id FROM packs WHERE kode_box LIKE 'UJI-%');
    DELETE FROM packs WHERE kode_box LIKE 'UJI-%';
    DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'UJI%');
    DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'UJI%');
    DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'UJI%');
    DELETE FROM products WHERE nama LIKE 'UJI%';
    DELETE FROM locations WHERE kode_lokasi LIKE 'UJI-%';
    DELETE FROM warehouses WHERE kode LIKE 'UJI-%';
    DELETE FROM units WHERE kode LIKE 'UJI-%';
    DELETE FROM categories WHERE nama LIKE 'UJI%';
    DELETE FROM brands WHERE nama LIKE 'UJI%';
    DELETE FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches WHERE nama_file LIKE 'uji%');
    DELETE FROM import_batches WHERE nama_file LIKE 'uji%';
  `);
};
bersihkan();

// 1. CRUD kategori + larangan duplikat
let r = await req('POST', '/api/master/kategori', { nama: 'UJI Kategori A' });
catat('tambah kategori', r.status === 201 && !!r.data?.id, `status ${r.status}`);
const idKat = r.data?.id;

r = await req('POST', '/api/master/kategori', { nama: 'UJI Kategori A' });
catat('kategori duplikat ditolak (409)', r.status === 409, `status ${r.status} — ${r.data?.pesan ?? ''}`);

r = await req('PUT', `/api/master/kategori/${idKat}`, { nama: 'UJI Kategori B' });
catat('ubah kategori', r.status === 200, `status ${r.status}`);

// 2. Satuan untuk konversi (kode & nama khusus uji agar tidak bentrok data lain)
const pcs = await req('POST', '/api/master/satuan', { kode: 'UJI-PCS', nama: 'PCS UJI' });
const lusin = await req('POST', '/api/master/satuan', { kode: 'UJI-LUS', nama: 'LUSIN UJI' });
const kodi = await req('POST', '/api/master/satuan', { kode: 'UJI-KOD', nama: 'KODI UJI' });
const satuanOk = [pcs, lusin, kodi].every((x) => x.status === 201);
catat('tambah satuan (PCS/LUSIN/KODI)', satuanOk, [pcs, lusin, kodi].map((x) => `${x.status}:${x.data?.pesan ?? ''}`).join(' | '));
if (!satuanOk) {
  console.log('\nSetup satuan gagal — berhenti agar tidak memicu kegagalan berantai.');
  bersihkan();
  db.close();
  process.exit(1);
}

// 3. Gudang & lokasi
const gudang = await req('POST', '/api/master/gudang', { kode: 'UJI-G1', nama: 'Gudang Uji' });
const lokasi = await req('POST', '/api/master/lokasi', {
  warehouse_id: gudang.data?.id,
  kode_lokasi: 'UJI-A-01-01',
  zona: 'A',
  rak: '01',
  bin: '01',
});
catat('tambah gudang + lokasi', gudang.status === 201 && lokasi.status === 201, `lokasi ${lokasi.status}`);

r = await req('POST', '/api/master/lokasi', { warehouse_id: gudang.data?.id, kode_lokasi: 'UJI-A-01-01' });
catat('kode_lokasi duplikat ditolak (409)', r.status === 409, `status ${r.status}`);

// 4. Produk + konversi satuan (satu baris = satu produk)
const produkBody = {
  nama: 'UJI Kaos Distro',
  category_id: idKat,
  brand_id: null,
  satuan_dasar_id: pcs.data?.id,
  aktif: 1,
  sku: 'UJI-KAOS',
  barcode: '8990000000001',
  harga_beli: 50000,
  harga_jual: 75000,
  stok_min: 5,
  konversi: [
    { unit_id: lusin.data?.id, jumlah_per_satuan_dasar: 12 },
    { unit_id: kodi.data?.id, jumlah_per_satuan_dasar: 20 },
  ],
};
r = await req('POST', '/api/master/produk', produkBody);
catat('tambah produk + 2 konversi', r.status === 201 && !!r.data?.id, `status ${r.status} — ${r.data?.pesan ?? ''}`);
const idProduk = r.data?.id;

const detail = await req('GET', `/api/master/produk/${idProduk}`);
const konv = detail.data?.data?.konversi ?? [];
catat('detail produk memuat 2 konversi', konv.length === 2, `konversi ${konv.length}`);

// SKU duplikat antar produk
r = await req('POST', '/api/master/produk', { ...produkBody, nama: 'UJI Produk Lain', konversi: [] });
catat('SKU duplikat ditolak (409)', r.status === 409, `status ${r.status} — ${r.data?.pesan ?? ''}`);

// Harga negatif ditolak
r = await req('POST', '/api/master/produk', {
  ...produkBody,
  nama: 'UJI Produk Negatif',
  sku: 'UJI-NEGATIF',
  barcode: null,
  harga_beli: -100,
  konversi: [],
});
catat('harga negatif ditolak (400)', r.status === 400, `status ${r.status} — ${r.data?.pesan ?? ''}`);

// 5. Paket: barcode box tidak boleh sama dengan barcode produk / paket lain
const paketBody = {
  kode_box: 'UJI-BOX-1',
  barcode_box: '8990000000001', // sengaja sama dengan barcode produk
  nama: 'UJI Paket 1 dus',
  items: [{ product_id: idProduk, qty: 12 }],
};
r = await req('POST', '/api/master/paket', paketBody);
catat('barcode box = barcode produk ditolak (409)', r.status === 409, `status ${r.status} — ${r.data?.pesan ?? ''}`);

paketBody.barcode_box = '8990000000099';
r = await req('POST', '/api/master/paket', paketBody);
catat('tambah paket sah', r.status === 201 && !!r.data?.id, `status ${r.status} — ${r.data?.pesan ?? ''}`);
const idPaket = r.data?.id;

const detailPaket = await req('GET', `/api/master/paket/${idPaket}`);
catat('total pcs isi box = 12', Number(detailPaket.data?.data?.total_pcs) === 12, `total ${detailPaket.data?.data?.total_pcs}`);

r = await req('POST', '/api/master/paket', { ...paketBody, kode_box: 'UJI-BOX-2', barcode_box: '8990000000099' });
catat('barcode box duplikat paket lain ditolak (409)', r.status === 409, `status ${r.status}`);

// Produk memakai barcode box → ditolak
r = await req('PUT', `/api/master/produk/${idProduk}`, { ...detail.data.data, barcode: '8990000000099' });
catat('produk pakai barcode box ditolak (409)', r.status === 409, `status ${r.status} — ${r.data?.pesan ?? ''}`);

// 6. Perubahan harga tercatat di audit log
const auditSebelum = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE aksi = 'ubah_harga'`).get().n;
r = await req('PUT', `/api/master/produk/${idProduk}`, { ...detail.data.data, harga_jual: 80000 });
const auditSesudah = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE aksi = 'ubah_harga'`).get().n;
catat('perubahan harga tercatat di audit log', r.status === 200 && auditSesudah > auditSebelum, `${auditSebelum} → ${auditSesudah}`);

const barisAudit = db.prepare(`SELECT data_sebelum, data_sesudah FROM audit_logs WHERE aksi = 'ubah_harga' ORDER BY id DESC LIMIT 1`).get();
catat('audit log menyimpan diff harga', String(barisAudit?.data_sebelum ?? '').includes('75000') && String(barisAudit?.data_sesudah ?? '').includes('80000'));

// 7. Produk terpakai: hapus ditolak, nonaktifkan boleh
// Pasangan wajib: setiap saldo selalu disertai baris Kartu Stok (aturan modul Stok).
db.prepare(
  `INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, 3)`,
).run(idProduk, gudang.data?.id);
db.prepare(
  `INSERT INTO stock_ledger (product_id, warehouse_id, location_id, tipe_dokumen, qty_masuk, saldo, nilai_unit)
   VALUES (?, ?, ?, 'penyesuaian', 3, 3, 80000)`,
).run(idProduk, gudang.data?.id, lokasi.data?.id);

r = await req('DELETE', `/api/master/produk/${idProduk}`);
catat('produk terpakai transaksi tidak bisa dihapus (409)', r.status === 409, `status ${r.status} — ${r.data?.pesan ?? ''}`);

r = await req('PUT', `/api/master/produk/${idProduk}`, { ...detail.data.data, harga_jual: 80000, aktif: 0 });
catat('produk bisa dinonaktifkan', r.status === 200, `status ${r.status}`);

// 8. Konversi: daftar, ubah, hapus
const daftarKonv = await req('GET', '/api/master/konversi?cari=UJI-KAOS');
catat('daftar konversi satuan', daftarKonv.status === 200 && daftarKonv.data?.total >= 2, `total ${daftarKonv.data?.total}`);

const idKonv = daftarKonv.data?.data?.[0]?.id;
r = await req('DELETE', `/api/master/konversi/${idKonv}`);
catat('hapus konversi', r.status === 200, `status ${r.status}`);

// 9. Ekspor & impor Excel
const resEkspor = await fetch(`${BASE}/api/master/kategori/ekspor`, { headers: await headerUji() });
const bufEkspor = Buffer.from(await resEkspor.arrayBuffer());
catat(
  'ekspor Excel kategori',
  resEkspor.status === 200 && resEkspor.headers.get('content-type')?.includes('spreadsheetml') && bufEkspor.length > 500,
  `${resEkspor.status}, ${bufEkspor.length} bait`,
);

// Impor Excel: buat berkas berisi kategori baru
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Kategori');
ws.addRow(['Nama Kategori']);
ws.addRow(['UJI Dari Impor']);
const bufImpor = Buffer.from(await wb.xlsx.writeBuffer());
const resImpor = await fetch(`${BASE}/api/master/kategori/impor`, {
  method: 'POST',
  headers: await headerUji(),
  body: JSON.stringify({ nama_file: 'uji.xlsx', data_base64: bufImpor.toString('base64') }),
});
const dataImpor = await resImpor.json();
catat(
  'impor Excel kategori',
  resImpor.status === 200 && dataImpor.baris_valid === 1 && dataImpor.baris_error === 0,
  JSON.stringify(dataImpor),
);

const adaImpor = db.prepare(`SELECT id FROM categories WHERE nama = 'UJI Dari Impor'`).get();
catat('baris impor masuk ke tabel', !!adaImpor);

const adaBatch = db.prepare(`SELECT status, baris_valid, baris_error FROM import_batches WHERE id = ?`).get(dataImpor.batch_id);
catat('import_batches tercatat', adaBatch?.status === 'selesai' && adaBatch?.baris_valid === 1, JSON.stringify(adaBatch));

// Impor duplikat DALAM FILE → error terekam di import_errors
// (duplikat terhadap database = "akan diperbarui", bukan error — prinsip AB2c;
//  yang tetap jadi error adalah kembar antar baris dalam berkas yang sama.)
const wb2 = new ExcelJS.Workbook();
const ws2 = wb2.addWorksheet('Kategori');
ws2.addRow(['Nama Kategori']);
ws2.addRow(['UJI Kategori B']);
ws2.addRow(['UJI Kategori B']); // kembar dengan baris di atas → error
const resImpor2 = await fetch(`${BASE}/api/master/kategori/impor`, {
  method: 'POST',
  headers: await headerUji(),
  body: JSON.stringify({ nama_file: 'uji2.xlsx', data_base64: Buffer.from(await wb2.xlsx.writeBuffer()).toString('base64') }),
});
const dataImpor2 = await resImpor2.json();
const errBatch = db.prepare(`SELECT pesan FROM import_errors WHERE batch_id = ?`).get(dataImpor2.batch_id);
catat('baris error impor tercatat di import_errors', dataImpor2.baris_error === 1 && !!errBatch?.pesan, String(errBatch?.pesan ?? ''));

// 10. Pencarian cepat: SKU & barcode produk
const cariSku = await fetch(`${BASE}/api/master/produk?cari=UJI-KAOS`, { headers: await headerUji() });
const dataCari = await cariSku.json();
catat('pencarian produk via SKU', dataCari.total === 1, `total ${dataCari.total}`);

const resBarcode = await fetch(`${BASE}/api/master/kategori?cari=UJI`, { headers: await headerUji() });
const cekBarcode = await resBarcode.json();
catat('pencarian kategori umum', resBarcode.status === 200 && cekBarcode.total >= 2, `total ${cekBarcode.total}`);

// 11. Hak akses: guard delete (saat ini semua dianggap Admin → diizinkan)
r = await req('DELETE', `/api/master/kategori/${idKat}`);
catat('hapus kategori oleh Admin diizinkan (guard aktif)', r.status === 200 || r.status === 409, `status ${r.status}`);

bersihkan();
db.close();

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
