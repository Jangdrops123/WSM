/**
 * Uji integrasi API Master > Produk — dijalankan saat server hidup:
 *   npx tsx scripts/uji-produk.ts
 *
 * Cakupan: kode_item (backfill, otomatis, duplikat), pencarian & urutan,
 * template (2 sheet + kolom persis), ekspor format sama, impor dua tahap
 * (pra-tinjau tanpa tulis → konfirmasi UPSERT), foto (unggah/hapus/peta).
 * Satu baris = satu produk (tanpa varian).
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, pool, run } from '../server/db.pg.ts';
import { headerUji } from './sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';

let lulus = 0;
let gagal = 0;
const catat = async (nama: string, ok: boolean, info = '') => {
  if (ok) {
    lulus++;
    console.log(`✔ ${nama}${info ? ` — ${info}` : ''}`);
  } else {
    gagal++;
    console.log(`✘ ${nama}${info ? ` — ${info}` : ''}`);
  }
};

async function req(method: string, url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

const bersihkan = async () => {
  await run(`
    DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE kode_item LIKE 'UJIP-%' OR nama LIKE 'UJIP%');
    DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE kode_item LIKE 'UJIP-%' OR nama LIKE 'UJIP%');
    DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE kode_item LIKE 'UJIP-%' OR nama LIKE 'UJIP%');
    DELETE FROM products WHERE nama LIKE 'UJIP%' OR kode_item LIKE 'UJIP-%';
    DELETE FROM categories WHERE nama LIKE 'UJIP%';
    DELETE FROM brands WHERE nama LIKE 'UJIP%';
    DELETE FROM unit_conversions WHERE unit_id IN (SELECT id FROM units WHERE nama = 'TIDAK-ADA');
    DELETE FROM units WHERE nama = 'TIDAK-ADA';
    DELETE FROM import_errors WHERE batch_id IN (SELECT id FROM import_batches WHERE nama_file LIKE 'ujip%');
    DELETE FROM import_batches WHERE nama_file LIKE 'ujip%';
  `)
  // File foto uji
  const dir = path.join('data', 'uploads', 'produk');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.startsWith('UJIP-')) fs.rmSync(path.join(dir, f), { force: true });
  }
};

/** PNG 2×2 pixel merah (base64) untuk uji unggah foto. */
const PNG_KECIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP8z8Dwn4EIwAgAKQMDAXY3JVQAAAAASUVORK5CYII=';

async function buatWorkbook(kolom: string[], baris: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(kolom);
  for (const b of baris) ws.addRow(b);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString('base64');
}

const KOLOM = [
  'kode_item', 'nama_produk', 'sku', 'kategori', 'merek', 'satuan', 'profil_size', 'barcode',
  'harga_beli', 'harga_jual', 'status', 'nama_file_foto',
];

async function main() {
  await bersihkan();

  // --- Kode item: backfill --------------------------------------------------
  const daftar = await req('GET', '/api/master/produk?per=100');
  const semua = daftar.data?.data ?? [];
  // Invarian hasil backfill: TIDAK ADA produk tanpa kode_item. Awalan BRG-
  // hanya untuk kode hasil generate otomatis — API juga menerima kode kustom
  // (mis. fixture MB-xxx), jadi prefix-nya tidak diwajibkan di sini.
  const tanpaKode = semua.filter((p: any) => typeof p.kode_item !== 'string' || !p.kode_item.trim());
  await catat(
    'semua produk punya kode_item (backfill migrasi)',
    semua.length > 0 && tanpaKode.length === 0,
    `produk=${semua.length} tanpa kode=${tanpaKode.length} non-BRG=${semua.filter((p: any) => !String(p.kode_item ?? '').startsWith('BRG-')).length}`,
  );

  // Satuan untuk impor (pakai yang ada atau buat)
  let satuan = (await get(`SELECT nama FROM units LIMIT 1`)) as { nama: string } | undefined;
  if (!satuan) {
    const r = await req('POST', '/api/master/satuan', { kode: 'PCS', nama: 'Pcs' });
    satuan = r.status === 201 ? { nama: 'Pcs' } : undefined;
  }
  const namaSatuan = satuan?.nama ?? 'Pcs';

  // --- Auto generate + duplikat --------------------------------------------
  const auto1 = await req('POST', '/api/master/produk', {
    nama: 'UJIP Produk Auto',
    sku: 'UJIP-AUTO-1',
  });
  const idAuto1 = auto1.data?.id;
  const det1 = await req('GET', `/api/master/produk/${idAuto1}`);
  const kode1 = String(det1.data?.data?.kode_item ?? '');
  await catat('tanpa kode_item → otomatis BRG-XXXX', auto1.status === 201 && /^BRG-\d{4}$/.test(kode1), kode1);

  const auto2 = await req('POST', '/api/master/produk', {
    nama: 'UJIP Produk Auto 2',
    sku: 'UJIP-AUTO-2',
  });
  const det2 = await req('GET', `/api/master/produk/${auto2.data?.id}`);
  const kode2 = String(det2.data?.data?.kode_item ?? '');
  const urut1 = Number(kode1.slice(4));
  const urut2 = Number(kode2.slice(4));
  await catat('penomoran berurutan', auto2.status === 201 && urut2 === urut1 + 1, `${kode1} → ${kode2}`);

  const buatA = await req('POST', '/api/master/produk', {
    kode_item: 'UJIP-A',
    nama: 'UJIP Produk A',
    sku: 'UJIP-A-S1',
  });
  const idA = buatA.data?.id;
  await catat('buat dengan kode_item sendiri', buatA.status === 201, `id ${idA}`);

  const dupKecil = await req('POST', '/api/master/produk', {
    kode_item: 'ujip-a', // beda huruf besar/kecil tetap ditolak
    nama: 'UJIP Duplikat',
    sku: 'UJIP-DUP-1',
  });
  await catat('kode_item duplikat (case-insensitive) → 409', dupKecil.status === 409, dupKecil.data?.pesan ?? '');

  const buatB = await req('POST', '/api/master/produk', {
    kode_item: 'UJIP-B',
    nama: 'UJIP Produk B',
    sku: 'UJIP-B-M',
  });
  const idB = buatB.data?.id;
  const ubahKodeB = await req('PUT', `/api/master/produk/${idB}`, {
    kode_item: 'UJIP-A',
    nama: 'UJIP Produk B',
    sku: 'UJIP-B-M',
  });
  await catat('ubah kode ke milik produk lain → 409', ubahKodeB.status === 409, ubahKodeB.data?.pesan ?? '');

  const ubahSendiri = await req('PUT', `/api/master/produk/${idA}`, {
    kode_item: 'UJIP-A',
    nama: 'UJIP Produk A',
    sku: 'UJIP-A-S1',
  });
  await catat('ubah produk dengan kode tetap → 200', ubahSendiri.status === 200, ubahSendiri.data?.pesan ?? 'ok');

  // --- Produk bertransaksi: hapus ditolak, hanya nonaktif ------------------
  const buatDel = await req('POST', '/api/master/produk', {
    kode_item: 'UJIP-DEL',
    nama: 'UJIP Produk Bertransaksi',
    sku: 'UJIP-DEL-1',
  });
  const idDel = Number(buatDel.data?.id);
  // Tandai "bertransaksi": satu baris saldo stok (jalur termudah tanpa kasir).
  (await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty) SELECT ?, id, 1 FROM warehouses LIMIT 1`, idDel));

  const hapusDipakai = await req('DELETE', `/api/master/produk/${idDel}`);
  await catat(
    'produk bertransaksi → hapus ditolak 409 + pesan nonaktifkan',
    hapusDipakai.status === 409 && /nonaktifkan/i.test(hapusDipakai.data?.pesan ?? ''),
    hapusDipakai.data?.pesan ?? `status ${hapusDipakai.status}`,
  );
  const matikan = await req('PUT', `/api/master/produk/${idDel}`, {
    kode_item: 'UJIP-DEL',
    nama: 'UJIP Produk Bertransaksi',
    sku: 'UJIP-DEL-1',
    aktif: 0,
  });
  const detDel = await req('GET', `/api/master/produk/${idDel}`);
  await catat('produk bertransaksi → nonaktifkan tetap boleh', matikan.status === 200 && Number(detDel.data?.data?.aktif) === 0, `status ${matikan.status}`);

  // Lepaskan pemakaian → hapus (soft delete) kembali jalan.
  (await run(`DELETE FROM stock_balances WHERE product_id = ?`, idDel));
  const hapusBersih = await req('DELETE', `/api/master/produk/${idDel}`);
  await catat('setelah tak bertransaksi → hapus (soft delete) 200', hapusBersih.status === 200, `status ${hapusBersih.status}`);
  const detHapus = await req('GET', `/api/master/produk/${idDel}`);
  await catat('produk terhapus masuk mode sampah (deleted_at terisi)', Boolean(detHapus.data?.data?.deleted_at), String(detHapus.data?.data?.deleted_at ?? ''));

  // --- Pencarian & urutan ---------------------------------------------------
  const cari = await req('GET', `/api/master/produk?cari=UJIP-B&per=50`);
  await catat('pencarian mencakup kode_item', (cari.data?.data ?? []).some((p: any) => p.kode_item === 'UJIP-B'));

  const urut = await req('GET', `/api/master/produk?urut=kode_item&arah=DESC&per=100`);
  const kodesUrut = (urut.data?.data ?? []).map((p: any) => String(p.kode_item));
  const urutBenar = kodesUrut.every((k: string, i: number) => i === 0 || kodesUrut[i - 1] >= k);
  await catat('urut kolom kode_item', urutBenar && kodesUrut.length > 0, `${kodesUrut[0]} … ${kodesUrut[kodesUrut.length - 1]}`);

  // --- Template & ekspor ----------------------------------------------------
  const tpl = await fetch(`${BASE}/api/master/produk/template`, { headers: await headerUji() });
  const wbTpl = new ExcelJS.Workbook();
  await (wbTpl.xlsx.load as unknown as (d: unknown) => Promise<unknown>)(await tpl.arrayBuffer());
  const dataWs = wbTpl.worksheets[0];
  const headerData = dataWs.getRow(1).values.slice(1).map((v) => String(v));
  const adaPetunjuk = wbTpl.worksheets.length === 2 && wbTpl.worksheets[1].name === 'Petunjuk';
  const contohBaris = dataWs.rowCount - 1;
  const petunjukBaris = adaPetunjuk ? wbTpl.worksheets[1].rowCount - 1 : 0;
  // Template = KOLOM + kolom khusus impor (gudang, stok_awal) — ekspor
  // tidak ikut (hanya bermakna sebagai masukan; lihat hanyaImpor di server).
  // Header Excel = KOLOM_IMPOR + stok (lihat kolomExcelImpor di server).
  const KOLOM_TEMPLATE = [...KOLOM, 'gudang', 'stok_awal', 'stok'];
  await catat(
    'template: kolom persis spesifikasi + 2 sheet',
    tpl.status === 200 &&
      JSON.stringify(headerData) === JSON.stringify(KOLOM_TEMPLATE) &&
      adaPetunjuk &&
      contohBaris >= 2 &&
      contohBaris <= 4 &&
      petunjukBaris >= KOLOM_TEMPLATE.length,
    `Data: ${contohBaris} contoh, Petunjuk: ${petunjukBaris} baris`,
  );

  const ekspor = await fetch(`${BASE}/api/master/produk/ekspor`, { headers: await headerUji() });
  const wbEk = new ExcelJS.Workbook();
  await (wbEk.xlsx.load as unknown as (d: unknown) => Promise<unknown>)(await ekspor.arrayBuffer());
  const wsEk = wbEk.worksheets[0];
  const headerEk = wsEk.getRow(1).values.slice(1).map((v) => String(v));
  const barisEk: Record<string, unknown>[] = [];
  for (let i = 2; i <= wsEk.rowCount; i++) {
    const row = wsEk.getRow(i);
    const o: Record<string, unknown> = {};
    headerEk.forEach((h, idx) => (o[h] = row.getCell(idx + 1).value));
    barisEk.push(o);
  }
  await catat(
    'ekspor: format sama dengan template, satu baris per produk',
    ekspor.status === 200 &&
      // Default ekspor = semua kolom template + kolom turunan "stok" (lihat
      // KOLOM_TAMBAHAN_EKSPOR di server) — urutan & judul template wajib persis.
      JSON.stringify(headerEk) === JSON.stringify([...KOLOM, 'gudang', 'stok_awal', 'stok']) &&
      barisEk.length >= semua.length &&
      barisEk.some((r) => r.kode_item === 'UJIP-A'),
    `${barisEk.length} baris`,
  );

  // --- Impor dua tahap ------------------------------------------------------
  // 6 baris: 3 valid (B, A, D) + 3 error (kode kembar, tanpa kode, satuan hilang).
  const data1 = await buatWorkbook(KOLOM, [
    ['UJIP-B', 'UJIP Produk B Baru', 'UJIP-B-M', 'UJIP Kategori', '', namaSatuan, '', '', 10000, 20000, 'Aktif', ''],
    ['UJIP-A', 'UJIP Produk A Diubah', 'UJIP-A-S1', '', '', namaSatuan, '', '', 5000, 9000, 'Aktif', ''],
    ['UJIP-D', 'UJIP Produk D', 'UJIP-D-1', 'UJIP Kategori', '', namaSatuan, '', '', 7000, 15000, 'Aktif', ''],
    ['UJIP-B', 'UJIP Produk B Duplikat', 'UJIP-B-DUP', '', '', namaSatuan, '', '', 1000, 2000, 'Aktif', ''],
    ['', 'Tanpa Kode', 'UJIP-X-1', '', '', namaSatuan, '', '', '', '', '', ''],
    ['UJIP-C', 'Satuan Hilang', 'UJIP-C-1', '', '', 'TIDAK-ADA', '', '', '', '', '', ''],
  ]);

  // Snapshot sebelum pra-tinjau — invarian yang diuji: pratinjau tidak menulis apa pun.
  const ujipSebelumPra = ((await get(`SELECT COUNT(*) c FROM products WHERE kode_item LIKE 'UJIP-%'`)) as { c: number }).c;
  // Mode bawaan mesin bersama (AB2e): referensi (kategori/merek/satuan) yang
  // belum ada → PERINGATAN "akan dibuat otomatis", bukan error.
  const pra = await req('POST', '/api/master/produk/impor/pra-tinjau', { nama_file: 'ujip-impor.xlsx', data_base64: data1 });
  await catat(
    'pra-tinjau: hitungan valid/error per baris (mode buat otomatis)',
    pra.status === 200 && pra.data?.total_baris === 6 && pra.data?.baris_valid === 4 && pra.data?.baris_error === 2,
    `valid ${pra.data?.baris_valid}, error ${pra.data?.baris_error}`,
  );
  const errPra = (pra.data?.errors ?? []).map((e: any) => `baris ${e.nomor_baris}: ${e.pesan}`);
  await catat(
    'pra-tinjau: pesan error jelas & baris benar',
    errPra.length === 2 &&
      errPra.some((s: string) => s.includes('kembar dalam file')) &&
      errPra.some((s: string) => s.includes('kode_item wajib')),
    errPra.join(' | '),
  );
  const peringatanPra = (pra.data?.peringatan ?? []).map((p: any) => String(p.pesan ?? ''));
  await catat(
    'pra-tinjau: referensi baru jadi peringatan (AB2e)',
    peringatanPra.some((s: string) => s.includes('Kategori "UJIP Kategori"') && s.includes('akan dibuat otomatis')) &&
      peringatanPra.some((s: string) => s.includes('Satuan "TIDAK-ADA"') && s.includes('akan dibuat otomatis')),
    peringatanPra.join(' | '),
  );
  const aksi = (pra.data?.baris ?? []).map((b: any) => b.aksi);
  await catat(
    'pra-tinjau: aksi baru/perbarui per baris',
    aksi.length === 4 && aksi[0] === 'perbarui' && aksi[2] === 'baru' && aksi[3] === 'baru',
    aksi.join(', '),
  );

  // Mode ketat (opsi "Buat otomatis" mati) → referensi hilang kembali jadi error.
  const praKetat = await req('POST', '/api/master/produk/impor/pra-tinjau', {
    nama_file: 'ujip-impor.xlsx',
    data_base64: data1,
    opsi: { buat_otomatis: false },
  });
  const errKetat = (praKetat.data?.errors ?? []).map((e: any) => String(e.pesan ?? ''));
  await catat(
    'pra-tinjau mode ketat: referensi hilang = error',
    praKetat.status === 200 &&
      praKetat.data?.baris_valid === 1 &&
      errKetat.some((s: string) => s.includes('Kategori "UJIP Kategori" tidak ditemukan')) &&
      errKetat.some((s: string) => s.includes('Satuan "TIDAK-ADA"')),
    `valid ${praKetat.data?.baris_valid}, error ${praKetat.data?.baris_error}: ${errKetat.filter((s: string) => s.includes('tidak ditemukan') || s.includes('Satuan')).join(' | ')}`,
  );

  const produkDBelum = (await get(`SELECT COUNT(*) c FROM products WHERE kode_item = 'UJIP-D'`)) as { c: number };
  const jumlahUjip = ((await get(`SELECT COUNT(*) c FROM products WHERE kode_item LIKE 'UJIP-%'`)) as { c: number }).c;
  await catat(
    'pra-tinjau TIDAK menulis data (UJIP-D belum dibuat, jumlah UJIP tidak berubah)',
    produkDBelum.c === 0 && jumlahUjip === ujipSebelumPra,
    `UJIP-D: ${produkDBelum.c}, jumlah UJIP: ${jumlahUjip} (sebelum ${ujipSebelumPra})`,
  );

  const impor = await req('POST', '/api/master/produk/impor', { nama_file: 'ujip-impor.xlsx', data_base64: data1 });
  await catat(
    'konfirmasi: valid diterapkan, error tercatat',
    // Mode bawaan: 4 baris valid (B, A, D + C dengan satuan dibuat otomatis),
    // 2 error (kode kembar, tanpa kode) — referensi baru = peringatan (AB2e).
    impor.status === 200 && impor.data?.baris_valid === 4 && impor.data?.baris_error === 2,
    `batch ${impor.data?.batch_id}, valid ${impor.data?.baris_valid}, error ${impor.data?.baris_error}`,
  );
  const detB = await req('GET', `/api/master/produk/${idB}`);
  await catat(
    'UPSERT: kode sama → diperbarui (nama + harga jual 20000)',
    detB.data?.data?.nama === 'UJIP Produk B Baru' &&
      detB.data?.data?.sku === 'UJIP-B-M' &&
      Number(detB.data?.data?.harga_jual) === 20000,
    `nama "${detB.data?.data?.nama}", SKU ${detB.data?.data?.sku}, jual ${detB.data?.data?.harga_jual}`,
  );
  const detAd = await req('GET', `/api/master/produk/${idA}`);
  const kategoriA = detAd.data?.data?.kategori_nama;
  await catat(
    'UPSERT: data lama diperbarui (nama & harga jual 9000)',
    detAd.data?.data?.nama === 'UJIP Produk A Diubah' && Number(detAd.data?.data?.harga_jual) === 9000,
    `nama "${detAd.data?.data?.nama}", jual ${detAd.data?.data?.harga_jual}, kategori ${kategoriA ?? '—'}`,
  );
  const kategoriBaru = (await get(`SELECT COUNT(*) c FROM categories WHERE nama = 'UJIP Kategori'`)) as { c: number };
  await catat('kategori baru dibuat saat konfirmasi', kategoriBaru.c === 1);

  const impor2 = await req('POST', '/api/master/produk/impor', { nama_file: 'ujip-impor.xlsx', data_base64: data1 });
  const hitungB = (await get(`SELECT COUNT(*) c FROM products WHERE kode_item = 'UJIP-B'`)) as { c: number };
  const hitungD = (await get(`SELECT COUNT(*) c FROM products WHERE kode_item = 'UJIP-D'`)) as { c: number };
  const skuB = (await get(`SELECT sku FROM products WHERE kode_item = 'UJIP-B'`)) as { sku: string } | undefined;
  await catat(
    'impor ulang idempoten (tidak dobel produk, SKU tetap)',
    impor2.status === 200 && hitungB.c === 1 && hitungD.c === 1 && skuB?.sku === 'UJIP-B-M',
    `produk B ${hitungB.c}, produk D ${hitungD.c}, SKU B ${skuB?.sku}`,
  );

  // --- Foto -----------------------------------------------------------------
  const foto = await req('POST', '/api/master/produk/foto', {
    target: 'produk',
    id: idB,
    data_base64: PNG_KECIL,
    nama_file: 'UJIP-B.jpg',
  });
  const url = foto.data?.url ?? '';
  await catat('unggah foto → URL /uploads/…', foto.status === 200 && url.startsWith('/uploads/produk/'), url);

  const unduh = await fetch(`${BASE}${url}`);
  const ct = unduh.headers.get('content-type') ?? '';
  await catat('foto bisa diunduh lewat /uploads (static + proxy)', unduh.status === 200 && ct.startsWith('image/'), `${unduh.status} ${ct}`);

  const peta = await req('GET', '/api/master/produk/foto-map');
  const barisPeta = (peta.data?.data ?? []).find((p: any) => p.id === idB);
  await catat('foto-map memuat kode_item + sku + foto', !!barisPeta && barisPeta.foto_url === url && barisPeta.sku === 'UJIP-B-M');

  const bukanGambar = await req('POST', '/api/master/produk/foto', {
    target: 'produk',
    id: idB,
    data_base64: 'data:text/plain;base64,aGVsbG8=',
    nama_file: 'x.txt',
  });
  await catat('berkas non-gambar → 400', bukanGambar.status === 400, bukanGambar.data?.pesan ?? '');

  const hapus = await req('POST', '/api/master/produk/foto/hapus', { target: 'produk', id: idB });
  const setelahHapus = await req('GET', `/api/master/produk/${idB}`);
  const fileHilang = url ? !fs.existsSync(path.join('data', 'uploads', 'produk', path.basename(url))) : true;
  await catat(
    'hapus foto: kolom dibersihkan + berkas dihapus',
    hapus.status === 200 && !setelahHapus.data?.data?.foto_url && fileHilang,
  );

  // --- Audit ----------------------------------------------------------------
  const auditImpor = (await get(`SELECT COUNT(*) c FROM audit_logs WHERE tabel = 'products' AND aksi = 'impor'`)) as { c: number };
  const auditFoto = (await get(
    `SELECT COUNT(*) c FROM audit_logs WHERE aksi = 'ubah' AND data_sesudah LIKE '%foto_url%'`,
  )) as { c: number };
  await catat('audit: impor & perubahan foto tercatat', auditImpor.c >= 1 && auditFoto.c >= 1, `impor ${auditImpor.c}, foto ${auditFoto.c}`);

  await bersihkan();
  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal === 0 ? 0 : 1);
}

await main().catch(async (err) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  await bersihkan();
  process.exit(1);
});
