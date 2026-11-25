/* Uji API fitur Pilih Massal & Aksi Massal (produk + entitas generik). */
import { all, get, pool, run } from '../server/db.pg.ts';
import { headerUji } from './sesi-uji.mjs';

const BASE = `${process.env.BASE ?? 'http://127.0.0.1:3001'}/api`;
let lulus = 0;
let gagal = 0;

const cek = async (nama: string, kondisi: boolean, info = '') => {
  if (kondisi) {
    lulus++;
    console.log(`✔ ${nama}`);
  } else {
    gagal++;
    console.log(`✘ ${nama} ${info}`);
  }
};

const jalan = async <T = any>(metod: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
  const res = await fetch(`${BASE}${path}`, {
    method: metod,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as T };
};

const daftar = async (path: string) => (await jalan('GET', path)).data as any;

const bersihkanUji = async () => {
  (await run(`DELETE FROM stock_ledger WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Uji %')`));
  (await run(`DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Uji %')`));
  (await run(`DELETE FROM unit_conversions WHERE product_id IN (SELECT id FROM products WHERE nama LIKE 'Massal Uji %')`));
  (await run(`DELETE FROM products WHERE nama LIKE 'Massal Uji %'`));
  (await run(`DELETE FROM customers WHERE nama = 'Pelanggan Massal Uji'`));
  (await run(`DELETE FROM categories WHERE nama = 'Kategori Massal Uji'`));
};

(async () => {
  // Bersihkan sisa data uji dari run sebelumnya (gagal di tengah).
  await bersihkanUji();

  // --- Siapkan 2 produk baru ------------------------------------------------
  const buatProduk = async (nama: string, sku: string, he: number) => {
    const r = await jalan('POST', '/master/produk', {
      kode_item: '',
      nama,
      sku,
      category_id: null,
      brand_id: null,
      satuan_dasar_id: null,
      harga_beli: 1000,
      harga_jual: he,
      stok_min: 0,
      aktif: 1,
      konversi: [],
    });
    return r.data.id as number;
  };
  const p1 = await buatProduk('Massal Uji 1', 'MASAL-UJI-1', 10000);
  const p2 = await buatProduk('Massal Uji 2', 'MASAL-UJI-2', 20000);

  // Kategori 'Kaos' — dipakai uji 2 (target pindah) & uji 5 (wajib dipakai agar
  // hapus massal melewatinya). Buat bila belum ada; produk penambat memastikan
  // Kaos selalu dipakai (pulih kategori p1/p2 oleh urungkan tak berpengaruh).
  let kaosBuatanSendiri = false;
  let kaos = (await daftar('/master/kategori?per=100')).data.find((k: any) => k.nama === 'Kaos');
  if (!kaos) {
    kaos = { id: (await jalan('POST', '/master/kategori', { nama: 'Kaos' })).data.id };
    kaosBuatanSendiri = true;
  }
  const p0 = await buatProduk('Massal Uji Penambat', 'MASAL-UJI-0', 5000);
  (await run(`UPDATE products SET category_id = ? WHERE id = ?`, kaos.id, p0));
  await cek('setup: 2 produk dibuat', Number.isInteger(p1) && Number.isInteger(p2), `p1=${p1} p2=${p2}`);

  // --- 1) set-aktif + urungkan ---------------------------------------------
  const setAktif = await jalan('POST', '/master/produk/massal/set-aktif', { ids: [p1, p2], aktif: 0 });
  await cek('set-aktif: 200 & berhasil=2', setAktif.status === 200 && setAktif.data.berhasil === 2, JSON.stringify(setAktif.data).slice(0, 200));
  await cek('set-aktif: balas sebelum untuk undo', (setAktif.data.sebelum?.produk ?? []).length === 2);
  // Cari bernama: jumlah produk katalog bisa ratusan, daftar default (urut nama,
  // per=200) tak menjamin produk uji termuat — filter `cari` membuat uji deterministik.
  let baris = (await daftar(`/master/produk?per=200&cari=Massal%20Uji`)).data.filter((r: any) => [p1, p2].includes(Number(r.id)));
  await cek('set-aktif: produk jadi nonaktif', baris.length === 2 && baris.every((r: any) => Number(r.aktif) === 0));

  const undo1 = await jalan('POST', '/master/produk/massal/urungkan', setAktif.data.sebelum);
  await cek('urungkan status: 200', undo1.status === 200 && undo1.data.berhasil >= 2, JSON.stringify(undo1.data));
  baris = (await daftar(`/master/produk?per=200&cari=Massal%20Uji`)).data.filter((r: any) => [p1, p2].includes(Number(r.id)));
  await cek('urungkan status: kembali aktif', baris.every((r: any) => Number(r.aktif) === 1));

  // --- 2) ubah massal: pratinjau → terapkan → urungkan ----------------------
  const kategori = (await daftar('/master/kategori?per=50')).data.find((k: any) => k.nama === 'Kaos');
  const patch = { category_id: kategori.id, harga: { cara: 'naik_persen', nilai: 10 } };
  const pra = await jalan('POST', '/master/produk/massal/ubah/pratinjau', { ids: [p1, p2], patch });
  await cek('pratinjau ubah: 200 & ada sebelum→sesudah', pra.status === 200 && pra.data.baris?.length === 2 && pra.data.baris[0].perubahan.some((x: any) => x.label.startsWith('Harga')), JSON.stringify(pra.data).slice(0, 300));

  const ubah = await jalan('POST', '/master/produk/massal/ubah', { ids: [p1, p2], patch });
  await cek('ubah massal: berhasil=2 + sebelum', ubah.status === 200 && ubah.data.berhasil === 2 && ubah.data.sebelum.produk.length === 2, JSON.stringify(ubah.data).slice(0, 200));
  let detik = (await jalan('GET', `/master/produk/${p1}`)).data.data;
  await cek('ubah massal: harga naik 10% & kategori pindah', Number(detik.harga_jual) === 11000 && Number(detik.category_id) === kategori.id, `he=${detik.harga_jual} kat=${detik.category_id}`);

  const undo2 = await jalan('POST', '/master/produk/massal/urungkan', ubah.data.sebelum);
  await cek('urungkan ubah: 200', undo2.status === 200 && undo2.data.berhasil >= 2, JSON.stringify(undo2.data));
  detik = (await jalan('GET', `/master/produk/${p1}`)).data.data;
  await cek('urungkan ubah: harga & kategori pulih', Number(detik.harga_jual) === 10000 && detik.category_id === null, `he=${detik.harga_jual}`);

  // --- 3) hapus massal: p1 dipakai stok → dilewati; p2 soft delete ----------
  (await run(
    `INSERT INTO stock_balances (product_id, warehouse_id, qty)
     SELECT ?, w.id, 1 FROM warehouses w LIMIT 1`,
    p1,
  ));
  const hapus = await jalan('POST', '/master/produk/massal/hapus', { ids: [p1, p2] });
  await cek('hapus massal: 1 berhasil + 1 dilewati', hapus.status === 200 && hapus.data.berhasil === 1 && hapus.data.dilewati?.length === 1, JSON.stringify(hapus.data).slice(0, 300));
  await cek('hapus massal: alasan menyebut pemakaian', /Dipakai|stok/i.test(hapus.data.dilewati?.[0]?.alasan ?? ''), hapus.data.dilewati?.[0]?.alasan ?? '');

  let def = (await daftar('/master/produk?per=200&cari=Massal%20Uji')).data.filter((r: any) => [p1, p2].includes(Number(r.id)));
  await cek('hapus massal: terhapus hilang dari daftar', def.length === 1 && Number(def[0].id) === p1, JSON.stringify(def.map((r: any) => r.id)));
  const sampah = await daftar('/master/produk?per=200&sampah=1&cari=Massal%20Uji');
  await cek('mode sampah: memuat yang terhapus', sampah.data.some((r: any) => Number(r.id) === p2) && (sampah.sampah_total ?? 0) >= 1);

  const pulih = await jalan('POST', '/master/produk/massal/pulihkan', { ids: [p2] });
  def = (await daftar('/master/produk?per=200&cari=Massal%20Uji')).data.filter((r: any) => Number(r.id) === p2);
  await cek('pulihkan: 200 & kembali ke daftar', pulih.status === 200 && pulih.data.berhasil === 1 && def.length === 1);

  // --- 4) ekspor terpilih ---------------------------------------------------
  const e1 = await fetch(`${BASE}/master/produk/ekspor?ids=${p1}`, { headers: await headerUji() });
  const e2 = await fetch(`${BASE}/master/produk/ekspor`, { headers: await headerUji() });
  await cek('ekspor ?ids: 200 xlsx', e1.status === 200 && (e1.headers.get('content-type') ?? '').includes('spreadsheet'));
  await cek('ekspor tanpa ids: 200 xlsx', e2.status === 200);
  (await run('DELETE FROM stock_balances WHERE product_id = ?', p1)); // bersihkan pemakaian uji

  // --- 5) entitas generik: hapus (FK → dilewati), set-aktif, ekspor ids -----
  const katList = await daftar('/master/kategori?per=100');
  const katDipakai = katList.data.find((k: any) => k.nama === 'Kaos');
  const katBaru = (await jalan('POST', '/master/kategori', { nama: 'Kategori Massal Uji' })).data.id;
  const hapusKat = await jalan('POST', '/master/kategori/massal/hapus', { ids: [katDipakai.id, katBaru] });
  await cek('generik hapus: 1 dilewati (dipakai) + 1 terhapus', hapusKat.status === 200 && hapusKat.data.berhasil === 1 && hapusKat.data.dilewati?.length === 1, JSON.stringify(hapusKat.data).slice(0, 300));

  const pel = (await jalan('POST', '/master/pelanggan', { nama: 'Pelanggan Massal Uji', telepon: '0811', alamat: '', limit_piutang: 0, aktif: 1 })).data.id;
  const setAktifPel = await jalan('POST', '/master/pelanggan/massal/set-aktif', { ids: [pel], aktif: 0 });
  await cek('generik set-aktif: 200 & sebelum', setAktifPel.status === 200 && setAktifPel.data.berhasil === 1, JSON.stringify(setAktifPel.data));
  let pelBaris = (await daftar('/master/pelanggan?per=100')).data.find((r: any) => Number(r.id) === pel);
  await cek('generik set-aktif: pelanggan nonaktif', Number(pelBaris.aktif) === 0);
  const undoPel = await jalan('POST', '/master/pelanggan/massal/urungkan', setAktifPel.data.sebelum);
  pelBaris = (await daftar('/master/pelanggan?per=100')).data.find((r: any) => Number(r.id) === pel);
  await cek('generik urungkan: kembali aktif', undoPel.status === 200 && Number(pelBaris.aktif) === 1);

  const e3 = await fetch(`${BASE}/master/kategori/ekspor?ids=${katDipakai.id}`, { headers: await headerUji() });
  await cek('generik ekspor ?ids: 200 xlsx', e3.status === 200 && (e3.headers.get('content-type') ?? '').includes('spreadsheet'));

  const e4 = await fetch(`${BASE}/master/kategori/massal/set-aktif`, {
    method: 'POST',
    headers: await headerUji(),
    body: JSON.stringify({ ids: [katDipakai.id], aktif: 0 }),
  });
  await cek('generik set-aktif tanpa kolom aktif → 400', e4.status === 400, `status=${e4.status}`);

  // --- 6) audit log ---------------------------------------------------------
  const audit = (await all(
    `SELECT aksi, COUNT(*) AS n FROM audit_logs WHERE aksi IN ('aktifkan','nonaktifkan','ubah_massal','hapus_massal','pulihkan','urungkan') GROUP BY aksi`,
  )) as { aksi: string; n: number }[];
  const ringkas = Object.fromEntries(audit.map((a) => [a.aksi, a.n]));
  await cek('audit: aksi massal tercatat', (ringkas.nonaktifkan ?? 0) >= 1 && (ringkas.ubah_massal ?? 0) >= 1 && (ringkas.hapus_massal ?? 0) >= 1, JSON.stringify(ringkas));

  // Bersihkan data uji
  await bersihkanUji();
  if (kaosBuatanSendiri) {
    (await run(`DELETE FROM categories WHERE nama = 'Kaos' AND id NOT IN (SELECT category_id FROM products WHERE category_id IS NOT NULL)`));
  }

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
})().catch((e) => {
  console.error('GAGAL TOTAL:', e);
  process.exit(1);
});
