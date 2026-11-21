// ============================================================================
// uji-profil-size — BAGIAN AF (AF7): klasifikasi barang Pria/Wanita lewat
// Kategori → Profil Size dipakai parser Chatbot Pembelian.
//
// Uji WAJIB AF7:
//  1) Kategori "Sepatu Wanita" → profil Wanita; "Sepatu Pria" → profil Pria.
//  2) "amara hitam 1 kd db 37 tp 40" (produk wanita) → 37:10, 38:5, 39:5,
//     40:0, total 20, status hijau (seimbang).
//  3) "rulfine mocca 4 kd" (pria) → tiap size 16, total 80.
//  4) Produk tanpa klasifikasi + "db 37" → saran "Gunakan profil Wanita".
//  5) Produk tanpa klasifikasi + "db 39" → pertanyaan profil (39 di dua profil).
//  6) Ubah kategori Pria → Wanita: produk ikut kategori pindah; override tidak.
//  7) Pesan campuran → dua blok profil + total gabungan + verifikasi "Total = N kd".
//
// Ditambah: pesan per baris (AF5), endpoint klasifikasi/terdampak/hitung/koreksi
// (AF2/AF6), aksi massal profil size, dan hak akses Admin/Manajer.
//
// Parser & resolusi diuji langsung (tanpa server); bagian API dijalankan bila
// server hidup di :3001 (atau env BASE).
// Jalankan: npx tsx scripts/uji-profil-size.ts
// ============================================================================
import { all, get, pool, run } from '../server/db.pg.ts';
import { headerUji } from './sesi-uji.mjs';
import { uraiPembelianBaris } from '../server/lib/urai.ts';
import { daftarProfilSize, profilSizeDariId, profilSizeDariKode, resolusiProfilSize } from '../server/lib/profilSize.ts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

const q1 = async (sql: string, ...p: unknown[]) => (await get(sql, ...(p as never[]))) as any;
const semua = async (sql: string, ...p: unknown[]) => (await all(sql, ...(p as never[]))) as any[];

async function req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: await headerUji(extra),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* bukan json */
  }
  return { status: res.status, data };
}

// --- Fiks (dibersihkan di akhir) -------------------------------------------
const SKU = { amara: 'UFA-001', rulfine: 'UFR-001', tanpa: 'UFT-001', dioverride: 'UFO-001', zamora: 'UFZ-001' };
let kategoriBaruDibuat: number[] = [];
let operatorUjiDibuat: number[] = [];
const profilSebelumKategori = new Map<number, number | null>();

const priaId = async () => (await profilSizeDariKode('sepatu-pria'))?.id ?? 0;
const wanitaId = async () => (await profilSizeDariKode('sepatu-wanita'))?.id ?? 0;

async function bersihkanProdukUji() {
  (await run(`DELETE FROM products WHERE sku IN (?, ?, ?, ?, ?)`, SKU.amara, SKU.rulfine, SKU.tanpa, SKU.dioverride, SKU.zamora));
}

async function siapkan() {
  const pria = await profilSizeDariKode('sepatu-pria');
  const wanita = await profilSizeDariKode('sepatu-wanita');
  if (!pria || !wanita) throw new Error('Profil bawaan sepatu-pria/sepatu-wanita tidak ada (migrasi 022 belum jalan).');

  // Operator komposisi Db/Tp — konfigurasi pengguna yang dipakai parser;
  // buat bila belum ada (dibuang di akhir bila milik uji ini).
  for (const [label, pengali, kata] of [['Db', 2, '["db"]'], ['Tp', 0, '["tp"]']] as const) {
    const ada = await q1(`SELECT id FROM operator_komposisi WHERE lower(label) = lower(?)`, label);
    if (!ada) {
      const id = Number((await run(`INSERT INTO operator_komposisi (label, pengali, kata_kunci) VALUES (?, ?, ?)`, label, pengali, kata)).lastInsertRowid);
      operatorUjiDibuat.push(id);
    }
  }

  // Kategori uji — pakai nama persis AF7; bila belum ada, buat (nanti dihapus).
  for (const nama of ['Sepatu Pria', 'Sepatu Wanita']) {
    let k = await q1(`SELECT id, size_profile_id FROM categories WHERE lower(nama) = lower(?)`, nama);
    if (!k) {
      const id = Number(
        (await run(`INSERT INTO categories (nama) VALUES (?)`, nama)).lastInsertRowid,
      );
      kategoriBaruDibuat.push(id);
      k = { id, size_profile_id: null };
    }
    if (!profilSebelumKategori.has(Number(k.id))) profilSebelumKategori.set(Number(k.id), k.size_profile_id ?? null);
    (await run(`UPDATE categories SET size_profile_id = ? WHERE id = ?`, nama === 'Sepatu Pria' ? pria.id : wanita.id,
      k.id,));
  }

  await bersihkanProdukUji();
  const idKatPria = Number((await q1(`SELECT id FROM categories WHERE nama = 'Sepatu Pria'`))?.id);
  const idKatWanita = Number((await q1(`SELECT id FROM categories WHERE nama = 'Sepatu Wanita'`))?.id);
  const adaNetral = await q1(`SELECT id FROM categories WHERE nama = 'Kategori Uji Netral'`);
  const idKatNetral = adaNetral
    ? Number(adaNetral.id)
    : Number((await run(`INSERT INTO categories (nama) VALUES ('Kategori Uji Netral')`)).lastInsertRowid);
  if (!adaNetral) kategoriBaruDibuat.push(idKatNetral);
  profilSebelumKategori.set(idKatNetral, null);

  const ins = async (...a: unknown[]): Promise<void> => {
    await run(
      `INSERT INTO products (nama, sku, kode_item, category_id, harga_beli, harga_jual, size_profile_id)
       VALUES (?, ?, ?, ?, 100000, 150000, ?)`,
      ...a,
    );
  };
  await ins('Amara Hitam', SKU.amara, 'UF-AMARA', idKatWanita, null);
  await ins('Rulfine Mocca', SKU.rulfine, 'UF-RULF', idKatPria, null);
  await ins('Produk Netral Uji', SKU.tanpa, 'UF-TANPA', idKatNetral, null);
  // Produk dengan override profil (pria) pada kategori wanita — untuk uji 6.
  await ins('Override Khusus Uji', SKU.dioverride, 'UF-OVRR', idKatWanita, pria.id);
  // Produk Pria dengan kecocokan YAKIN (nama unik) — untuk pesan AF5 size di luar profil.
  await ins('Zamora Mocca', SKU.zamora, 'UF-ZAMORA', idKatPria, null);

  return { idKatPria, idKatWanita, idKatNetral };
}

async function pulihkanKategori() {
  for (const [id, sebelum] of profilSebelumKategori) {
    (await run(`UPDATE categories SET size_profile_id = ? WHERE id = ?`, sebelum, id));
  }
}

/** Ambil pratinjau grup berdasarkan teks baris (mengandung kunci). */
const grupDari = async (hasil: any, kunci: string) =>
  (hasil.pratinjau ?? []).find((g: any) => String(g.teks).toLowerCase().includes(kunci));

// ============================================================================
async function main() {
  const kat = await siapkan();
  const pria = await profilSizeDariKode('sepatu-pria')!;
  const wanita = await profilSizeDariKode('sepatu-wanita')!;

  // --- AF1 — profil bawaan sesuai spesifikasi -------------------------------
  await cek('AF1 profil Pria: 39-43 jatah 4, 20/kodi', JSON.stringify(pria.sizes.map((s) => `${s.size}:${s.jatah}`)) === JSON.stringify(['39:4', '40:4', '41:4', '42:4', '43:4']) && pria.pasang_per_kodi === 20);
  await cek('AF1 profil Wanita: 37-40 jatah 5, 20/kodi', JSON.stringify(wanita.sizes.map((s) => `${s.size}:${s.jatah}`)) === JSON.stringify(['37:5', '38:5', '39:5', '40:5']) && wanita.pasang_per_kodi === 20);

  // --- AF7.1 — kategori → profil -------------------------------------------
  const idAmara = Number((await q1(`SELECT id FROM products WHERE sku = ?`, SKU.amara))?.id);
  const r1 = await resolusiProfilSize({ produkId: idAmara });
  await cek('AF7.1 Kategori "Sepatu Wanita" → profil Wanita', r1.profil?.kode === 'sepatu-wanita' && r1.dari === 'kategori', `dari=${r1.dari}`);
  const idRulfine = Number((await q1(`SELECT id FROM products WHERE sku = ?`, SKU.rulfine))?.id);
  const r2 = await resolusiProfilSize({ produkId: idRulfine });
  await cek('AF7.1 Kategori "Sepatu Pria" → profil Pria', r2.profil?.kode === 'sepatu-pria' && r2.dari === 'kategori', `dari=${r2.dari}`);

  // --- AF7.2 — wanita db 37 tp 40 -------------------------------------------
  const h2 = await uraiPembelianBaris('amara hitam 1 kd db 37 tp 40');
  const g2 = await grupDari(h2, 'amara');
  const rinc2 = Object.fromEntries((g2?.rincian ?? []).map((r: any) => [r.size, r.pasang]));
  await cek(
    'AF7.2 rincian 37:10, 38:5, 39:5, 40:0',
    rinc2['37'] === 10 && rinc2['38'] === 5 && rinc2['39'] === 5 && rinc2['40'] === 0,
    JSON.stringify(rinc2),
  );
  await cek('AF7.2 total 20 pasang (1 kodi)', g2?.total_pasang === 20 && g2?.total_kodi === 1, `total=${g2?.total_pasang} pasang / ${g2?.total_kodi} kd`);
  await cek('AF7.2 status hijau (seimbang 20/kd)', g2?.seimbang === true && g2?.sisa_per_kodi === 20, `sisa=${g2?.sisa_per_kodi}`);
  await cek('AF7.2 profil baris = Wanita', g2?.profil_id === wanita.id && g2?.profil_kode === 'sepatu-wanita', `profil=${g2?.profil}`);

  // --- AF7.3 — pria 4 kodi ---------------------------------------------------
  const h3 = await uraiPembelianBaris('rulfine mocca 4 kd');
  const g3 = await grupDari(h3, 'rulfine');
  const rinc3 = (g3?.rincian ?? []).map((r: any) => r.pasang);
  await cek('AF7.3 tiap size 16 pasang', rinc3.length === 5 && rinc3.every((n: number) => n === 16), JSON.stringify(rinc3));
  await cek('AF7.3 total 80 pasang', g3?.total_pasang === 80 && g3?.total_kodi === 4, `total=${g3?.total_pasang} / ${g3?.total_kodi} kd`);

  // --- AF7.4/5 — produk tanpa klasifikasi -----------------------------------
  const idTanpa = Number((await q1(`SELECT id FROM products WHERE sku = ?`, SKU.tanpa))?.id);
  const h4 = await uraiPembelianBaris('produk netral uji 1 kd db 37');
  const g4 = await grupDari(h4, 'netral');
  await cek('AF7.4 saran "Gunakan profil Wanita" untuk db 37', (g4?.alasan ?? []).some((a: string) => a.includes('Gunakan profil Wanita')), (g4?.alasan ?? []).join(' | '));
  await cek('AF7.4 saran_profil = Wanita', g4?.saran_profil?.id === wanita.id && g4?.ragu === false, JSON.stringify(g4?.saran_profil));
  await cek('AF7.4 resolusi memakai Wanita (dari size)', (await profilSizeDariId(g4?.profil_id))?.kode === 'sepatu-wanita', `dari=${g4?.profil_dari}`);

  const h5 = await uraiPembelianBaris('produk netral uji 1 kd db 39');
  const g5 = await grupDari(h5, 'netral');
  await cek(
    'AF7.5 pertanyaan profil untuk db 39 (dua profil)',
    (g5?.alasan ?? []).some((a: string) => a.includes('Kategori barang belum diklasifikasikan. Pilih profil')),
    (g5?.alasan ?? []).join(' | '),
  );
  await cek('AF7.5 ragu=true, tanpa menebak', g5?.ragu === true && g5?.saran_profil === null, `ragu=${g5?.ragu}`);
  const r5 = await resolusiProfilSize({ produkId: idTanpa, teks: 'netral 1 kd db 39', sizes: [39] });
  await cek('AF7.5 ukuranRagu = [39]', r5.ukuranRagu.includes('39') && r5.ragu === true, JSON.stringify(r5.ukuranRagu));

  // --- AF5 — pesan per baris dengan aksi ------------------------------------
  const h6 = await uraiPembelianBaris('zamora mocca 6 kd (2kd db 44 tp 40)');
  const g6 = await grupDari(h6, 'zamora');
  const pesanSeimbang = (g6?.pesan ?? []).map((p: any) => p.teks);
  await cek(
    'AF5 pesan "Tp 40 menyisakan 16 pasang per kodi" + aksi seimbangkan',
    pesanSeimbang.some((t: string) => t.includes('Tp 40 menyisakan 16 pasang per kodi')) &&
      (g6?.pesan ?? []).some((p: any) => p.aksi === 'seimbangkan'),
    pesanSeimbang.join(' | '),
  );
  await cek('AF5 status kuning saat tidak seimbang', g6?.seimbang === false, `sisa=${g6?.sisa_per_kodi}`);
  await cek('AF5 baris tetap terklasifikasi Pria (bukan ragu)', g6?.profil_id === pria.id && g6?.ragu === false, `dari=${g6?.profil_dari}`);

  const h7 = await uraiPembelianBaris('zamora mocca size 37 4 kd');
  const g7 = await grupDari(h7, 'zamora');
  await cek(
    'AF5 "Size 37 tidak ada di profil Pria (39-43). Barang ini termasuk Wanita?"',
    (g7?.pesan ?? []).some(
      (p: any) =>
        p.aksi === 'pakai_profil' &&
        p.profil_id === wanita.id &&
        p.teks === 'Size 37 tidak ada di profil Pria (39-43). Barang ini termasuk Wanita?',
    ),
    JSON.stringify(g7?.pesan ?? []),
  );

  // --- AF5 — ukuran hanya milik satu profil tidak dipakai menebak ----------
  const r37 = await resolusiProfilSize({ teks: 'kasual 1 kd', sizes: [37] });
  await cek('AF1.4 size 37 (hanya Wanita) → profil Wanita + saran', r37.profil?.kode === 'sepatu-wanita' && r37.dari === 'size' && r37.saran?.kode === 'sepatu-wanita');
  const r43 = await resolusiProfilSize({ teks: 'kasual 1 kd', sizes: [43] });
  await cek('AF1.4 size 43 (hanya Pria) → profil Pria', r43.profil?.kode === 'sepatu-pria' && r43.dari === 'size');
  const r39 = await resolusiProfilSize({ teks: 'kasual 1 kd', sizes: [39] });
  await cek('AF1.4 size 39 (dua profil) → ragu, jatuh ke default', r39.ragu === true && r39.ukuranRagu.includes('39'));
  const rk = await resolusiProfilSize({ teks: 'sepatu wanita 2 kd' });
  await cek('AF1.3 kata penanda "wanita" → profil Wanita', rk.profil?.kode === 'sepatu-wanita' && rk.dari === 'kata' && rk.ragu === false);

  // --- AF7.6 — ubah kategori: ikut kategori pindah, override tidak ----------
  (await run(`UPDATE categories SET size_profile_id = ? WHERE id = ?`, wanita.id, kat.idKatPria));
  const rPindah = await resolusiProfilSize({ produkId: idRulfine });
  const idOvrr = Number((await q1(`SELECT id FROM products WHERE sku = ?`, SKU.dioverride))?.id);
  const rOvrr = await resolusiProfilSize({ produkId: idOvrr });
  await cek('AF7.6 produk ikut kategori pindah ke Wanita', rPindah.profil?.kode === 'sepatu-wanita' && rPindah.dari === 'kategori');
  await cek('AF7.6 produk dengan override TIDAK berubah (tetap Pria)', rOvrr.profil?.kode === 'sepatu-pria' && rOvrr.dari === 'produk');
  (await run(`UPDATE categories SET size_profile_id = ? WHERE id = ?`, pria.id, kat.idKatPria));

  // --- AF7.7 — pesan campuran: dua blok + total gabungan ---------------------
  const catatan = ['Bos Uji', '16 Okt 2026', '• rulfine mocca 4 kd', '• amara hitam 1 kd db 37 tp 40', 'Total = 5 kd'].join('\n');
  const h8 = await uraiPembelianBaris(catatan);
  const blok = [...new Set((h8.pratinjau ?? []).map((g: any) => g.profil_kode))];
  await cek('AF7.7 dua blok profil (pria + wanita)', blok.length === 2 && blok.includes('sepatu-pria') && blok.includes('sepatu-wanita'), JSON.stringify(blok));
  await cek('AF7.7 total gabungan 5 kodi', h8.cek?.hitung === 5 && h8.cek?.ada === true, `hitung=${h8.cek?.hitung} klaim=${h8.cek?.klaim}`);
  await cek('AF7.7 verifikasi "Total = 5 kd" cocok', h8.cek?.ok === true && h8.cek?.selisih === 0);
  const totalGabung = (h8.pratinjau ?? []).reduce((n: number, g: any) => n + g.total_pasang, 0);
  await cek('AF7.7 jumlah pasang gabungan 100 (80 pria + 20 wanita)', totalGabung === 100, `${totalGabung} pasang`);

  // --- AF1 urutan: override produk menang atas kategori ----------------------
  const rUrut = await resolusiProfilSize({ produkId: idOvrr, teks: 'wanita 1 kd', sizes: [37] });
  await cek('AF1 urutan (1) override produk > kategori/kata/size', rUrut.dari === 'produk' && rUrut.profil?.kode === 'sepatu-pria');

  // ======================= BAGIAN API (server hidup) ========================
  const hidup = await fetch(`${BASE}/api/auth/masuk`, { method: 'GET' }).then((r) => r.status !== 0).catch(() => false);
  if (!hidup) {
    console.log('\n⚠ Server API tidak terjangkau — bagian uji API (AF2/AF6) dilewati.');
  } else {
    // AF2 — Klasifikasi Barang
    const klas = await req('GET', '/api/profil-size/klasifikasi');
    await cek('API GET /klasifikasi (200)', klas.status === 200, `status=${klas.status}`);
    await cek('API /klasifikasi memuat profil Pria & Wanita', (klas.data?.profil ?? []).some((p: any) => p.kode === 'sepatu-pria') && (klas.data?.profil ?? []).some((p: any) => p.kode === 'sepatu-wanita'));
    await cek('API /klasifikasi memuat kategori + usulan', Array.isArray(klas.data?.kategori) && klas.data.kategori.length > 0);
    await cek('API /klasifikasi ringkasan laporan (AF6)', !!klas.data?.ringkasan && typeof klas.data.ringkasan.kategori_tanpa_profil === 'number' && typeof klas.data.ringkasan.produk_dikoreksi === 'number', JSON.stringify(klas.data?.ringkasan ?? {}));

    // AF2 — buat kategori cepat (nama persis AF7 sudah ada → boleh dilewat)
    const katSebelum = new Set((await semua('SELECT id FROM categories')).map((r) => Number(r.id)));
    const cepat = await req('POST', '/api/profil-size/kategori-cepat', {});
    await cek('API POST /kategori-cepat (201)', cepat.status === 201, `status=${cepat.status} ${JSON.stringify(cepat.data)}`);
    const katPria = await q1(`SELECT id, size_profile_id FROM categories WHERE nama = 'Sepatu Pria'`);
    const katWanita = await q1(`SELECT id, size_profile_id FROM categories WHERE nama = 'Sepatu Wanita'`);
    const katSandal = await q1(`SELECT id, size_profile_id FROM categories WHERE nama = 'Sandal Wanita'`);
    await cek('Kategori cepat terhubung ke profilnya', katPria?.size_profile_id === await priaId() && katWanita?.size_profile_id === await wanitaId() && katSandal?.size_profile_id === (await profilSizeDariKode('sandal-wanita'))?.id, JSON.stringify({ pria: katPria?.size_profile_id, wanita: katWanita?.size_profile_id }));
    // Kategori yang TERNYATA dibuat oleh uji ini → dibersihkan di akhir.
    for (const k of await semua('SELECT id FROM categories')) {
      const id = Number(k.id);
      if (!katSebelum.has(id) && !kategoriBaruDibuat.includes(id)) kategoriBaruDibuat.push(id);
    }

    // AF2 — terdampak (konfirmasi ubah profil kategori)
    const td = await req('GET', `/api/profil-size/terdampak?kategori_id=${kat.idKatWanita}`);
    const ikut = Number((await q1(`SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND size_profile_id IS NULL AND deleted_at IS NULL`, kat.idKatWanita))?.n ?? 0);
    await cek('API GET /terdampak = jumlah produk ikut kategori', td.status === 200 && td.data?.ikut === ikut && td.data?.dioverride === 1, JSON.stringify(td.data));

    // AF3/AF4 — hitung ulang satu baris pratinjau
    const hg = await req('POST', '/api/profil-size/hitung', { profil_id: await wanitaId(), kodi_normal: 0, kodi_komp: 1, pcs: 0, db: 37, tp: 40 });
    const sizesHitung = Object.fromEntries((hg.data?.sizes ?? []).map((s: any) => [s.size, s.pasang]));
    await cek('API POST /hitung profil Wanita db 37 tp 40 → 10/5/5/0 seimbang', hg.status === 200 && sizesHitung['37'] === 10 && sizesHitung['40'] === 0 && hg.data?.seimbang === true && hg.data?.total_pasang === 20, JSON.stringify(sizesHitung));
    const hb = await req('POST', '/api/profil-size/hitung', { profil_id: await priaId(), kodi_normal: 0, kodi_komp: 1, pcs: 0, db: 44, tp: 40 });
    await cek('API POST /hitung tidak seimbang → pesan aksi', hb.data?.seimbang === false && (hb.data?.pesan ?? []).some((t: string) => t.includes('Tp 40 menyisakan 16 pasang per kodi')), JSON.stringify(hb.data?.pesan));

    // AF6 — simpan koreksi profil produk
    const koreksi = await req('POST', '/api/profil-size/koreksi', { tipe: 'produk', id: idTanpa, profil_id: await wanitaId() });
    const setelahKoreksi = await q1(`SELECT size_profile_id FROM products WHERE id = ?`, idTanpa);
    await cek('API POST /koreksi menyetel override produk', koreksi.status === 200 && Number(setelahKoreksi.size_profile_id) === await wanitaId(), `status=${koreksi.status}`);
    const rKoreksi = await resolusiProfilSize({ produkId: idTanpa, teks: '1 kd db 39' });
    await cek('Setelah koreksi, pesan berikutnya otomatis benar (tanpa ragu)', rKoreksi.profil?.kode === 'sepatu-wanita' && rKoreksi.ragu === false, `dari=${rKoreksi.dari} ragu=${rKoreksi.ragu}`);
    await req('POST', '/api/profil-size/koreksi', { tipe: 'produk', id: idTanpa, profil_id: null });

    // AF2 — hak akses: Manajer boleh, Kasir tidak
    const manajer = await req('POST', '/api/profil-size/kategori-cepat', {}, { 'x-peran': 'manajer' });
    await cek('Hak akses: Manajer boleh mengklasifikasi', manajer.status === 201, `status=${manajer.status}`);
    const kasir = await req('POST', '/api/profil-size/kategori-cepat', {}, { 'x-peran': 'kasir' });
    await cek('Hak akses: Kasir ditolak (403)', kasir.status === 403, `status=${kasir.status}`);

    // AF2 — Master Kategori: field Profil size
    const daftarKat = await req('GET', `/api/master/kategori/${kat.idKatPria}`);
    await cek('Master Kategori menyimpan size_profile_id', daftarKat.status === 200 && Number(daftarKat.data?.data?.size_profile_id) === await priaId(), JSON.stringify(daftarKat.data));
    const ubahKat = await req('PUT', `/api/master/kategori/${kat.idKatNetral}`, { size_profile_id: await wanitaId() });
    await cek('PUT /api/master/kategori set Profil size (200)', ubahKat.status === 200, `status=${ubahKat.status} ${JSON.stringify(ubahKat.data)}`);
    await req('PUT', `/api/master/kategori/${kat.idKatNetral}`, { size_profile_id: null });

    // AF2 — aksi massal produk: Atur profil size
    const massal = await req('POST', '/api/master/produk/massal/ubah', { ids: [idAmara], patch: { size_profile_id: await priaId() } });
    const sesudahMassal = await q1(`SELECT size_profile_id FROM products WHERE id = ?`, idAmara);
    await cek('Aksi massal "Atur profil size" berlaku', massal.status === 200 && Number(sesudahMassal.size_profile_id) === await priaId(), `status=${massal.status}`);
    await req('POST', '/api/master/produk/massal/ubah', { ids: [idAmara], patch: { size_profile_id: null } });

    // AF2 — catat log aktivitas untuk perubahan klasifikasi
    const audit = Number((await q1(`SELECT COUNT(*) AS n FROM audit_logs WHERE tabel = 'categories'`))?.n ?? 0);
    await cek('Perubahan klasifikasi tercatat di log aktivitas', audit > 0, `baris audit=${audit}`);
  }

  // --- bersihkan fiks --------------------------------------------------------
  await bersihkanProdukUji();
  await pulihkanKategori();
  for (const id of operatorUjiDibuat) {
    (await run(`DELETE FROM operator_komposisi WHERE id = ?`, id));
  }
  for (const id of kategoriBaruDibuat) {
    (await run(`DELETE FROM categories WHERE id = ? AND id NOT IN (SELECT category_id FROM products WHERE category_id IS NOT NULL)`, id));
  }

  console.log(`\nRingkasan: ${lulus} lulus, ${gagal} gagal.`);
  if (gagal > 0) process.exit(1);
}

await main().catch(async (err) => {
  console.error('Galat uji:', err);
  process.exit(1);
});
