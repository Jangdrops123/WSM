// Uji BAGIAN AB — mesin impor bersama di semua modul:
//   1. Umum (kategori): pra-tinjau → konfirmasi → perbarui → urungkan
//   2. Konversi: satuan baru dibuat otomatis → urungkan (satuan ikut hilang)
//   3. Paket: baris baru + turunan pack_items → urungkan
//   4. Persediaan: tanggal dd/mm/yyyy, qty format Indonesia, gudang auto-create → batal
//   5. Laporan error Excel (POST) — magic bytes PK
// Bersih sendiri di akhir.
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { headerUji } from '../scripts/sesi-uji.mjs';

const BASE = 'http://127.0.0.1:3001/api';
const db = new DatabaseSync('data/app.db');
let gagal = 0;
const cek = (nama, ok, info = '') => {
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
  if (!ok) gagal++;
};

const xlsx = async (rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
};

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await headerUji(),
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  return { status: res.status, body: b };
};

const bersihkan = () => {
  db.prepare(`DELETE FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches WHERE nama_file LIKE 'ab-%')`).run();
  db.prepare(`DELETE FROM import_batches WHERE nama_file LIKE 'ab-%'`).run();
  db.prepare(`DELETE FROM categories WHERE nama LIKE 'AB Kat %'`).run();
  db.prepare(`DELETE FROM pack_items WHERE pack_id IN (SELECT id FROM packs WHERE kode_box LIKE 'ABPKT-%')`).run();
  db.prepare(`DELETE FROM packs WHERE kode_box LIKE 'ABPKT-%'`).run();
  db.prepare(`DELETE FROM unit_conversions WHERE unit_id IN (SELECT id FROM units WHERE kode LIKE 'ABSAT-%')`).run();
  db.prepare(`DELETE FROM units WHERE kode LIKE 'ABSAT-%'`).run();
};
bersihkan();

// ---------------------------------------------------------------------------
// 1. UMUM — kategori (entitas sederhana)
// ---------------------------------------------------------------------------
const kat = await xlsx([
  ['Nama'],
  ['AB Kat Satu'],
  ['AB Kat Dua'],
  ['AB Kat Satu'], // duplikat dalam file → error unik
  [''], // baris seluruh kosong → dibuang saat baca (bukan error)
]);
const katPra = await post('/master/kategori/impor/pra-tinjau', { nama_file: 'ab-kat.xlsx', data_base64: kat });
cek(
  'kategori pra-tinjau: 2 valid + 1 error unik, baris kosong dibuang',
  katPra.status === 200 && katPra.body.baris_valid === 2 && katPra.body.baris_error === 1 && katPra.body.total_baris === 3,
  `total=${katPra.body.total_baris} valid=${katPra.body.baris_valid} error=${katPra.body.baris_error}`,
);
cek(
  'kategori error berkonteks kolom & nilai',
  Array.isArray(katPra.body.errors) &&
    katPra.body.errors.every((e) => typeof e.kolom === 'string' && 'nilai' in e && typeof e.pesan === 'string'),
  JSON.stringify(katPra.body.errors?.slice(0, 2)),
);
cek(
  'kategori ringkasan alasan tersedia',
  Array.isArray(katPra.body.ringkasan) && katPra.body.ringkasan.length > 0,
  JSON.stringify(katPra.body.ringkasan),
);

const katImpor = await post('/master/kategori/impor', { nama_file: 'ab-kat.xlsx', data_base64: kat });
cek(
  'kategori konfirmasi: 2 masuk, jumlah_baru=2, urungkan tersedia',
  katImpor.status === 200 && katImpor.body.baris_valid === 2 && katImpor.body.jumlah_baru === 2 && katImpor.body.urungkan_tersedia === true,
  `batch=${katImpor.body.batch_id} baru=${katImpor.body.jumlah_baru}`,
);

// Impor ulang (mode perbarui default) → idempoten + dihitung diperbarui.
const katUlang = await post('/master/kategori/impor', { nama_file: 'ab-kat.xlsx', data_base64: kat });
const katJumlah = Number(db.prepare(`SELECT COUNT(*) c FROM categories WHERE nama LIKE 'AB Kat %'`).get()?.c ?? -1);
cek(
  'kategori impor ulang idempoten (tetap 2, diperbarui 2)',
  katUlang.status === 200 && katJumlah === 2 && katUlang.body.jumlah_perbarui === 2,
  `jumlah=${katJumlah} perbarui=${katUlang.body.jumlah_perbarui}`,
);

// Mode perbarui mati → baris sudah ada dilewati (bukan error).
const katMati = await post('/master/kategori/impor', {
  nama_file: 'ab-kat.xlsx',
  data_base64: kat,
  opsi: { perbarui: false, lewati_error: true, buat_otomatis: true },
});
cek(
  'kategori opsi perbarui mati → 0 menulis, 2 dilewati, 1 error',
  katMati.status === 200 && katMati.body.baris_valid === 0 && katMati.body.baris_dilewati === 2 && katMati.body.baris_error === 1,
  `valid=${katMati.body.baris_valid} dilewati=${katMati.body.baris_dilewati} error=${katMati.body.baris_error}`,
);

// Urungkan batch konfirmasi pertama → kategori buatan batch itu hilang.
const katUrung = await post('/master/kategori/impor/urungkan', { batch_id: katImpor.body.batch_id });
const katSisa = Number(db.prepare(`SELECT COUNT(*) c FROM categories WHERE nama LIKE 'AB Kat %'`).get()?.c ?? -1);
cek(
  'kategori urungkan: batch pertama dibalik (2 kategori hilang)',
  katUrung.status === 200 && katUrung.body.dikembalikan === 2 && katSisa === 0,
  `dikembalikan=${katUrung.body.dikembalikan} sisa=${katSisa}`,
);
// Batch terakhir (mode perbarui mati) tidak menulis apa pun — aman diurungkan juga.
// Bersihkan sisa kategori uji.
db.prepare(`DELETE FROM categories WHERE nama LIKE 'AB Kat %'`).run();

// ---------------------------------------------------------------------------
// 2. KONVERSI — satuan referensi dibuat otomatis, urungkan menghapusnya
// ---------------------------------------------------------------------------
const produk = db
  .prepare(`SELECT sku FROM products WHERE deleted_at IS NULL AND sku IS NOT NULL AND sku <> '' LIMIT 1`)
  .get();
cek('produk acuan konversi tersedia', !!produk, `sku=${produk?.sku}`);

if (produk) {
  const konv = await xlsx([['SKU', 'Satuan', 'Jumlah per Satuan Dasar'], [produk.sku, 'ABSAT-KARDUS', '1.250,5']]);
  const konvImpor = await post('/master/konversi/impor', { nama_file: 'ab-konv.xlsx', data_base64: konv });
  // Kode satuan dipangkas 10 karakter oleh mesin (ABSAT-KARD) — cocokkan pakai LIKE.
  const unitId = db.prepare(`SELECT id FROM units WHERE kode LIKE 'ABSAT-%' ORDER BY id DESC LIMIT 1`).get()?.id;
  const konvRow = db
    .prepare(`SELECT jumlah_per_satuan_dasar j FROM unit_conversions WHERE unit_id = ?`)
    .get(Number(unitId ?? 0));
  cek(
    'konversi: format "1.250,5" → 1250.5, satuan baru dibuat otomatis, urungkan tersedia',
    konvImpor.status === 200 &&
      konvImpor.body.baris_valid === 1 &&
      Number(unitId) > 0 &&
      Number(konvRow?.j) === 1250.5 &&
      konvImpor.body.urungkan_tersedia === true &&
      (konvImpor.body.peringatan ?? []).length === 1,
    `valid=${konvImpor.body.baris_valid} unit=${unitId} jumlah=${konvRow?.j} peringatan=${JSON.stringify((konvImpor.body.peringatan ?? []).map((p) => p.pesan))}`,
  );

  const konvUrung = await post('/master/konversi/impor/urungkan', { batch_id: konvImpor.body.batch_id });
  const unitSisa = db.prepare(`SELECT id FROM units WHERE kode LIKE 'ABSAT-%'`).get();
  cek(
    'konversi urungkan: konversi & satuan buatan ikut hilang',
    konvUrung.status === 200 && !unitSisa,
    `dikembalikan=${konvUrung.body.dikembalikan}`,
  );
}

// ---------------------------------------------------------------------------
// 3. PAKET — baris baru + turunan pack_items, urungkan menghapus semuanya
// ---------------------------------------------------------------------------
const duaSku = db
  .prepare(`SELECT sku FROM products WHERE deleted_at IS NULL AND sku IS NOT NULL AND sku <> '' LIMIT 2`)
  .all();
if (duaSku.length === 2) {
  const isi = `${duaSku[0].sku} x12; ${duaSku[1].sku} x4`;
  const paket = await xlsx([['Kode Box', 'Barcode Box', 'Nama Paket', 'Isi (SKU xQty)'], ['ABPKT-1', '', 'Paket Uji AB', isi]]);
  const paketImpor = await post('/master/paket/impor', { nama_file: 'ab-paket.xlsx', data_base64: paket });
  const packId = db.prepare(`SELECT id FROM packs WHERE kode_box = 'ABPKT-1'`).get()?.id;
  const isiJumlah = db.prepare(`SELECT COUNT(*) c FROM pack_items WHERE pack_id = ?`).get(Number(packId ?? 0))?.c;
  cek(
    'paket: dibuat + 2 pack_items + urungkan tersedia',
    paketImpor.status === 200 && paketImpor.body.baris_valid === 1 && Number(packId) > 0 && Number(isiJumlah) === 2 && paketImpor.body.urungkan_tersedia === true,
    `pack=${packId} items=${isiJumlah}`,
  );

  // Impor ulang dengan isi berbeda → mode perbarui mengganti isi (turunan).
  const paket2 = await xlsx([
    ['Kode Box', 'Barcode Box', 'Nama Paket', 'Isi (SKU xQty)'],
    ['ABPKT-1', '', 'Paket Uji AB Updated', `${duaSku[0].sku} x7`],
  ]);
  const paketUpdate = await post('/master/paket/impor', { nama_file: 'ab-paket2.xlsx', data_base64: paket2 });
  const isiBaru = db.prepare(`SELECT COUNT(*) c FROM pack_items WHERE pack_id = ?`).get(Number(packId ?? 0))?.c;
  cek(
    'paket perbarui: isi diganti jadi 1 baris',
    paketUpdate.status === 200 && paketUpdate.body.jumlah_perbarui === 1 && Number(isiBaru) === 1,
    `perbarui=${paketUpdate.body.jumlah_perbarui} items=${isiBaru}`,
  );

  // Urungkan batch perbarui → isi lama (2 baris) dipulihkan lewat turunan.
  const urung2 = await post('/master/paket/impor/urungkan', { batch_id: paketUpdate.body.batch_id });
  const isiPulih = db.prepare(`SELECT COUNT(*) c FROM pack_items WHERE pack_id = ?`).get(Number(packId ?? 0))?.c;
  const namaPulih = db.prepare(`SELECT nama n FROM packs WHERE id = ?`).get(Number(packId ?? 0))?.n;
  cek(
    'paket urungkan (perbarui): isi & nama lama pulih dari turunan',
    urung2.status === 200 && Number(isiPulih) === 2 && namaPulih === 'Paket Uji AB',
    `items=${isiPulih} nama=${namaPulih}`,
  );

  // Urungkan batch pertama → paket baris dihapus beserta isinya.
  const urung1 = await post('/master/paket/impor/urungkan', { batch_id: paketImpor.body.batch_id });
  const packSisa = db.prepare(`SELECT id FROM packs WHERE kode_box = 'ABPKT-1'`).get();
  const itemSisa = Number(db.prepare(`SELECT COUNT(*) c FROM pack_items WHERE pack_id = ?`).get(Number(packId ?? 0))?.c ?? -1);
  cek(
    'paket urungkan (tambah): paket & pack_items ikut terhapus',
    urung1.status === 200 && !packSisa && Number(itemSisa) === 0,
    `dikembalikan=${urung1.body.dikembalikan}`,
  );
}

// ---------------------------------------------------------------------------
// 4. PERSEDIAAN — tanggal dd/mm/yyyy, qty "1.250,5"… pakai 15; gudang auto-create
// ---------------------------------------------------------------------------
const gudangUji = 'AB Gudang Uji';
const pers = await xlsx([
  ['Tanggal', 'Gudang', 'Alasan', 'Kode Item', 'Qty', 'Keterangan'],
  ['01/10/2026', gudangUji, 'Stok Awal', duaSku[0]?.sku ?? '', 15, 'UJI-AB masuk'],
  ['01/10/2026', gudangUji, 'Alasan Ngawur', duaSku[0]?.sku ?? '', 3, 'salah alasan'],
]);
const persImpor = await post('/persediaan/impor', { arah: 'masuk', nama_file: 'ab-pers.xlsx', data_base64: pers });
const pd = persImpor.body.data ?? persImpor.body;
const gudangBaru = db.prepare(`SELECT id FROM warehouses WHERE nama = ?`).get(gudangUji);
const dok = db.prepare(`SELECT id FROM sub_stock_docs WHERE keterangan = 'UJI-AB masuk' ORDER BY id DESC LIMIT 1`).get();
cek(
  'persediaan: 1 dokumen dibuat (tanggal dd/mm/yyyy ok), 1 error alasan, gudang dibuat otomatis',
  persImpor.status === 200 && pd.dokumen_dibuat === 1 && pd.baris_error === 1 && Number(gudangBaru?.id) > 0,
  `dokumen=${pd.dokumen_dibuat} error=${pd.baris_error} gudang=${gudangBaru?.id} peringatan=${JSON.stringify(pd.peringatan ?? [])}`,
);
cek(
  'persediaan error berkonteks kolom + ringkasan alasan',
  Array.isArray(pd.errors) && pd.errors[0]?.kolom === 'Alasan' && Array.isArray(pd.ringkasan) && pd.ringkasan.length > 0,
  JSON.stringify(pd.errors?.[0]),
);

// Batalkan dokumen uji (stok kembali), lalu bersihkan jejak SQL.
if (dok) {
  const batal = await fetch(`${BASE}/persediaan/${dok.id}/batal`, {
    method: 'POST',
    headers: await headerUji(),
    body: JSON.stringify({ alasan: 'UJI-AB selesai' }),
  });
  cek('persediaan: dokumen uji bisa dibatalkan (stok kembali)', batal.ok, `status=${batal.status}`);
  db.prepare(`DELETE FROM stock_ledger WHERE dokumen_id = ? AND tipe_dokumen = 'penyesuaian'`).run(Number(dok.id));
  db.prepare(`DELETE FROM sub_stock_items WHERE doc_id = ?`).run(Number(dok.id));
  db.prepare(`DELETE FROM sub_stock_docs WHERE id = ?`).run(Number(dok.id));
}
if (gudangBaru) {
  db.prepare(`DELETE FROM stock_balances WHERE warehouse_id = ?`).run(Number(gudangBaru.id));
  db.prepare(`DELETE FROM warehouses WHERE id = ?`).run(Number(gudangBaru.id));
}

// ---------------------------------------------------------------------------
// 5. LAPORAN ERROR EXCEL (POST) — magic bytes PK + konten xlsx valid
// ---------------------------------------------------------------------------
const laporan = await fetch(`${BASE}/master/produk/impor/laporan-error`, {
  method: 'POST',
  headers: await headerUji(),
  body: JSON.stringify({
    nama_file: 'ab.xlsx',
    errors: [
      { nomor_baris: 4, kolom: 'nama_produk', nilai: '', pesan: 'nama_produk wajib diisi.' },
      { nomor_baris: 5, kolom: 'kode_item', nilai: 'IMP', pesan: 'kode_item wajib diisi.' },
    ],
  }),
});
const buf = Buffer.from(await laporan.arrayBuffer());
cek(
  'laporan error: 200 + xlsx (magic PK)',
  laporan.status === 200 && buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4b,
  `status=${laporan.status} bytes=${buf.length} ct=${laporan.headers.get('content-type')}`,
);
if (laporan.status === 200) {
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const isi = wb2.getWorksheet(1)?.getRow(2).values ?? [];
  cek('laporan error: baris pertama berisi nomor & alasan', String(isi[1]) === '4' && String(isi[4]).includes('wajib'), JSON.stringify(isi));
}
const laporanKosong = await fetch(`${BASE}/master/produk/impor/laporan-error`, {
  method: 'POST',
  headers: await headerUji(),
  body: JSON.stringify({ nama_file: 'ab.xlsx', errors: [] }),
});
cek('laporan error kosong ditolak 400', laporanKosong.status === 400, `status=${laporanKosong.status}`);

bersihkan();
db.close();
console.log(gagal === 0 ? '\nSEMUA UJI AB MODUL LULUS' : `\nADA ${gagal} UJI GAGAL`);
process.exit(gagal === 0 ? 0 : 1);
