// Preferensi tampilan per pengguna (P3): tema, aksen, sidebar.
// Disimpan di tabel settings (kunci: tema, aksen, sidebar_tampilan) —
// modul login menyusul, jadi preferensi menempel pada pengguna bawaan
// (sama seperti pengaturan dashboard). Nilai dikirim juga oleh klien ke
// localStorage agar pemuatan tanpa kedip.
//
// BAGIAN Y2 — Identitas Aplikasi: satu sumber data untuk nama, tagline,
// judul tab, favicon, warna aksen & latar ikon, varian logo (Siang/Malam/
// Ikon kecil), cakupan (semua toko / per toko), serta opsi pemakaian identitas
// untuk faktur & struk. Semua perubahan dicatat di `audit_logs` dan hanya
// boleh dilakukan Admin/Owner.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { all, get, run } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { wajibSel } from '../lib/hak.ts';

const TEMA = new Set(['terang', 'gelap', 'sistem']);
const AKSEN = new Set(['', 'teal', 'biru', 'indigo', 'hijau', 'oranye']);
const SIDEBAR = new Set(['gelap', 'terang']);

const baca = async (kunci: string, daftar: Set<string>, awal: string): Promise<string> => {
  const v = await ((await get<{ nilai: string }>(`SELECT nilai FROM settings WHERE kunci = ?`, kunci)))?.nilai ?? '';
  return daftar.has(v) ? v : awal;
};

const tulis = async (kunci: string, nilai: string) =>
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    kunci,
    nilai,
  );

/* ============== X1/Y2 — Identitas aplikasi (nama, tagline, logo) ========= */

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGO_DIR = path.join(ROOT_DIR, 'data', 'uploads', 'identitas');
const LOGO_MAKS_BYTES = 2 * 1024 * 1024; /* X1.1 / Y2.1 — maks 2 MB */
const LOGO_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const VARIAN = new Set(['siang', 'malam', 'ikon']);
const LATAR = new Set(['', 'surface', 'surface-2', 'primer-lembut', 'panel']);
const CAKUPAN = new Set(['semua', 'per-toko']);

type KunciLogo = 'app_logo_siang' | 'app_logo_malam' | 'app_logo_ikon';
const KUNCI_VARIAN: Record<string, KunciLogo> = {
  siang: 'app_logo_siang',
  malam: 'app_logo_malam',
  ikon: 'app_logo_ikon',
};

/** Semua kunci identitas yang ikut kebawaan / cakupan per toko. */
const KUNCI_TEKS = [
  'app_nama',
  'app_tagline',
  'app_judul_tab',
  'app_favicon',
  'app_aksen',
  'app_logo_latar',
  'app_kartu',
  'app_pakai_faktur',
] as const;

/** Warna kartu latar: '' (bawaan putih) atau heks #rrggbb. */
const KARTU_BAWAN = '';
function kartuValid(v: string): boolean {
  return v === '' || /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Nilai mentah baris settings — `null` bila baris belum pernah ditulis. */
async function bacaMentah(kunci: string): Promise<string | null> {
  return await ((await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = ?`, kunci)))?.nilai ?? null;
}

/** Naikkan versi identitas — klien memakai nilai ini untuk cache-busting logo. */
async function naikkanVersi(): Promise<string> {
  const v = Number(await bacaMentah('app_identitas_versi') ?? '0') + 1;
  await tulis('app_identitas_versi', String(v));
  return String(v);
}

/**
 * Baca satu nilai identitas dengan cakupan: bila mode "per toko" dan kode toko
 * tersedia, baris `@<toko>` menang; baris yang belum pernah ditulis memakai
 * nilai bawaan (baris kosong = pilihan sadar pengguna, tetap dikembalikan).
 */
async function ambil(dasar: string, toko: string | null, bawaan = ''): Promise<string> {
  if (toko) {
    const khusus = await bacaMentah(`${dasar}@${toko}`);
    if (khusus !== null) return khusus;
  }
  const umum = await bacaMentah(dasar);
  return umum === null ? bawaan : umum;
}

/** Tulis satu nilai identitas sesuai cakupan aktif. */
async function simpanKunci(dasar: string, nilai: string, cakupan: string, toko: string | null): Promise<void> {
  await tulis(cakupan === 'per-toko' && toko ? `${dasar}@${toko}` : dasar, nilai);
}

/**
 * Hapus baris identitas agar kembali memakai nilai BAWAAN (penting: baris
 * yang berisi "" berarti "pilihan sadar pengguna", bukan nilai bawaan).
 */
async function hapusKunci(dasar: string, cakupan: string, toko: string | null): Promise<void> {
  await run(`DELETE FROM settings WHERE kunci = ?`, cakupan === 'per-toko' && toko ? `${dasar}@${toko}` : dasar);
}

/** Simpan berkas logo (PNG/JPEG/WebP maks 2 MB; SVG sebagai teks UTF-8). */
function simpanLogo(varian: string, body: Record<string, unknown>): string {
  const teks = String(body.data_base64 ?? '').trim();
  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const namaAman = `${varian}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // SVG — teks murni (Y2.1 mengizinkan SVG).
  const svg = /^data:image\/svg\+xml(;charset=[\w-]+)?,(.*)$/s.exec(teks);
  if (svg) {
    const isi = decodeURIComponent(svg[2]);
    if (Buffer.byteLength(isi, 'utf8') > LOGO_MAKS_BYTES) throw tolak(413, 'Logo melebihi batas 2 MB.');
    if (!/<svg[\s>]/i.test(isi)) throw tolak(400, 'Berkas SVG tidak valid.');
    const namaFile = `${namaAman}.svg`;
    fs.writeFileSync(path.join(LOGO_DIR, namaFile), isi, 'utf8');
    return `/uploads/identitas/${namaFile}`;
  }
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(teks);
  if (!m) throw tolak(400, 'Format logo tidak didukung (PNG, JPG, WebP, atau SVG).');
  const biner = Buffer.from(m[2], 'base64');
  if (biner.length === 0) throw tolak(400, 'Berkas logo kosong.');
  if (biner.length > LOGO_MAKS_BYTES) throw tolak(413, 'Logo melebihi batas 2 MB.');
  const namaFile = `${namaAman}.${LOGO_MIME[m[1]]}`;
  fs.writeFileSync(path.join(LOGO_DIR, namaFile), biner);
  return `/uploads/identitas/${namaFile}`;
}

/** Hapus berkas logo internal (abaikan gagal; cegah path traversal). */
function hapusBerkas(url: string | null): void {
  if (!url || !url.startsWith('/uploads/identitas/')) return;
  const tujuan = path.join(ROOT_DIR, 'data', 'uploads', url.replace(/^\/uploads\//, ''));
  if (!tujuan.startsWith(path.join(ROOT_DIR, 'data', 'uploads'))) return;
  try {
    fs.rmSync(tujuan, { force: true });
  } catch {
    /* file mungkin sudah tidak ada */
  }
}

/** Bentuk identitas untuk klien (+ ?v= versi pada logo internal). */
async function bacaIdentitas(toko: string | null = null) {
  const cakupan = await bacaMentah('app_cakupan') === 'per-toko' ? 'per-toko' : 'semua';
  const efektif = cakupan === 'per-toko' ? toko : null;
  const versi = await bacaMentah('app_identitas_versi') ?? '1';
  const versiUrl = (u: string) => (u.startsWith('/uploads/') ? `${u}?v=${versi}` : u);
  return {
    nama: await ambil('app_nama', efektif, 'NusaSuite'),
    tagline: await ambil('app_tagline', efektif, 'POS · WMS · Akuntansi'),
    judulTab: await ambil('app_judul_tab', efektif),
    favicon: versiUrl(await ambil('app_favicon', efektif)),
    aksen: AKSEN.has(await ambil('app_aksen', efektif)) ? await ambil('app_aksen', efektif) : '',
    logoSiang: versiUrl(await ambil('app_logo_siang', efektif)),
    logoMalam: versiUrl(await ambil('app_logo_malam', efektif)),
    ikon: versiUrl(await ambil('app_logo_ikon', efektif)),
    latar: LATAR.has(await ambil('app_logo_latar', efektif)) ? await ambil('app_logo_latar', efektif) : '',
    kartu: kartuValid(await ambil('app_kartu', efektif, KARTU_BAWAN)) ? await ambil('app_kartu', efektif, KARTU_BAWAN) : KARTU_BAWAN,
    pakaiFaktur: await ambil('app_pakai_faktur', efektif) === 'true',
    cakupan,
    toko: efektif,
    versi,
  };
}

type Identitas = Awaited<ReturnType<typeof bacaIdentitas>>;

/** URL logo faktur (tanpa ?v=) yang dipakai saat opsi "juga untuk faktur" aktif. */
function logoFaktur(i: Identitas): string {
  const bersih = (u: string) => (u.startsWith('/uploads/') ? u.split('?')[0] : u);
  return bersih(i.logoSiang) || bersih(i.logoMalam) || bersih(i.ikon);
}

/**
 * Y2.2 — opsi "Pakai logo dan nama ini juga untuk faktur dan struk".
 * Saat dicentang, nama_usaha & logo_usaha (Profil Usaha → kop faktur/struk)
 * disalin dari identitas; nilai sebelumnya disimpan agar saat dicentang lagi
 * nilainya tidak hilang. Saat dilepas, snapshot dipulihkan → logo faktur
 * kembali terpisah.
 */
async function sinkronFaktur(pakai: boolean, i: Identitas): Promise<void> {
  const kunciSnapshot = 'app_faktur_snapshot';
  const lama = await bacaMentah(kunciSnapshot);
  if (pakai) {
    if (!lama) {
      await tulis(
        kunciSnapshot,
        JSON.stringify({
          nama: await bacaMentah('nama_usaha') ?? '',
          logo: await bacaMentah('logo_usaha') ?? '',
        }),
      );
    }
    await tulis('nama_usaha', i.nama);
    await tulis('logo_usaha', logoFaktur(i));
    return;
  }
  if (!lama) return;
  try {
    const s = JSON.parse(lama) as { nama?: unknown; logo?: unknown };
    await tulis('nama_usaha', String(s.nama ?? ''));
    await tulis('logo_usaha', String(s.logo ?? ''));
  } catch {
    /* snapshot rusak — biarkan nilai sekarang */
  }
  await tulis(kunciSnapshot, '');
}

/** Salin ulang logo ke Profil Usaha bila opsi faktur sedang aktif. */
async function sinkronLogoFaktur(toko: string | null): Promise<void> {
  const id = await bacaIdentitas(toko);
  if (!id.pakaiFaktur) return;
  await tulis('logo_usaha', logoFaktur(id));
}

/** Validasi & ambil teks dari body. */
function teksBody(body: Record<string, unknown>, kunci: string, maks: number): string {
  return String(body[kunci] ?? '').trim().slice(0, maks);
}

export function routerTampilan(): Router {
  const r = Router();

  r.get(
    '/tampilan',
    asyncHandler(async (_req, res) => {
      res.json({
        tema: await baca('tema', TEMA, 'sistem'),
        aksen: await baca('aksen', AKSEN, ''),
        sidebar: await baca('sidebar_tampilan', SIDEBAR, 'gelap'),
      });
    }),
  );

  r.put(
    '/tampilan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tema = String(body.tema ?? '');
      const aksen = String(body.aksen ?? '');
      const sidebar = String(body.sidebar ?? '');
      if (!TEMA.has(tema)) throw tolak(400, 'Tema tidak dikenal (terang/gelap/sistem).');
      if (!AKSEN.has(aksen)) throw tolak(400, 'Aksen tidak dikenal (teal/biru/indigo/hijau/oranye).');
      if (!SIDEBAR.has(sidebar)) throw tolak(400, 'Sidebar tidak dikenal (gelap/terang).');
      await tulis('tema', tema);
      await tulis('aksen', aksen);
      await tulis('sidebar_tampilan', sidebar);
      res.json({ ok: true, tema, aksen, sidebar });
    }),
  );

  /* ------------------- Y2 — Identitas Aplikasi -------------------------- */

  /**
   * Baca identitas. Publik (sidebar & layar muat membacanya), tetapi nilai
   * per toko hanya dikembalikan bila `?toko=` diberikan — klien mengirim kode
   * toko aktif sehingga perubahan langsung terlihat tanpa muat ulang.
   */
  r.get(
    '/tampilan/identitas',
    asyncHandler(async (req, res) => {
      const toko = String(req.query.toko ?? '').trim() || null;
      res.json(await bacaIdentitas(toko));
    }),
  );

  /**
   * AI4 — Identitas publik untuk layar muat: dibaca TANPA login (lihat PUBLIK
   * di server/lib/auth.ts) dan HANYA memuat data identitas (bukan data bisnis).
   * `?toko=` membuatnya mengikuti database/toko yang terakhir dipilih pengguna.
   */
  r.get(
    '/tampilan/identitas-publik',
    asyncHandler(async (req, res) => {
      const toko = String(req.query.toko ?? '').trim() || null;
      const i = await bacaIdentitas(toko);
      res.set('cache-control', 'no-store');
      res.json({
        v: 1,
        nama: i.nama,
        tagline: i.tagline,
        judulTab: i.judulTab,
        favicon: i.favicon,
        logoSiang: i.logoSiang,
        logoMalam: i.logoMalam,
        ikon: i.ikon,
        latar: i.latar,
        aksen: i.aksen,
        kartu: i.kartu,
        pakaiFaktur: i.pakaiFaktur,
        cakupan: i.cakupan,
        tema: await baca('tema', TEMA, 'sistem'),
        toko: i.toko,
        versi: i.versi,
      });
    }),
  );

  /** Data pendukung halaman Identitas Aplikasi (hanya Admin/Owner). */
  r.get(
    '/tampilan/identitas/meta',
    asyncHandler(async (_req, res) => {
      const toko = await (await all<{ kode: string; nama: string }>(
        'SELECT kode, nama FROM stores WHERE aktif = TRUE ORDER BY nama',
      )).map((t) => ({ nilai: t.kode, label: `${t.nama} (${t.kode})` }));
      res.json({
        multiToko: toko.length > 1,
        toko,
        cakupan: await bacaMentah('app_cakupan') === 'per-toko' ? 'per-toko' : 'semua',
        pakaiFaktur: await bacaMentah('app_pakai_faktur') === 'true',
        namaUsaha: await bacaMentah('nama_usaha') ?? '',
        logoUsaha: await bacaMentah('logo_usaha') ?? '',
      });
    }),
  );

  // Nama, tagline, judul tab, favicon, aksen, latar ikon, cakupan, opsi faktur.
  r.put(
    '/tampilan/identitas',
    (req, _res, next) => {
      (async () => {
        // AX — Identitas Aplikasi = sel Ubah pada Pengaturan.
        await wajibSel(req, 'pengaturan', 'ubah');
        next();
      })().catch(next);
    },
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const nama = teksBody(body, 'nama', 60);
      if (!nama) throw tolak(400, 'Nama aplikasi tidak boleh kosong.');
      const tagline = teksBody(body, 'tagline', 80);
      const judulTab = teksBody(body, 'judulTab', 80);
      const favicon = teksBody(body, 'favicon', 240);
      if (favicon && !favicon.startsWith('/')) {
        throw tolak(400, 'Favicon harus berupa jalur berkas internal (diawali "/").');
      }
      const aksen = String(body.aksen ?? '');
      if (!AKSEN.has(aksen)) throw tolak(400, 'Warna aksen aplikasi tidak dikenal.');
      const kartu = String(body.kartu ?? '');
      if (!kartuValid(kartu)) throw tolak(400, 'Warna latar kartu harus berupa heks #rrggbb.');
      const latar = String(body.latar ?? '');
      if (!LATAR.has(latar)) throw tolak(400, 'Warna latar ikon tidak dikenal.');
      const cakupan = String(body.cakupan ?? 'semua');
      if (!CAKUPAN.has(cakupan)) throw tolak(400, 'Cakupan tidak dikenal (semua / per-toko).');
      const toko = String(body.toko ?? '').trim() || null;
      if (cakupan === 'per-toko' && !toko) {
        throw tolak(400, 'Cakupan "Berbeda per toko" membutuhkan toko aktif.');
      }
      if (toko && !await ((await all('SELECT id FROM stores WHERE kode = ?', toko))).length) {
        throw tolak(404, `Toko "${toko}" tidak ditemukan.`);
      }
      const pakaiFaktur = body.pakaiFaktur === true || body.pakaiFaktur === 'true';
      const target = cakupan === 'per-toko' ? toko : null;

      const sebelum = await bacaIdentitas(target);

      await tulis('app_cakupan', cakupan);
      await simpanKunci('app_nama', nama, cakupan, target);
      await simpanKunci('app_tagline', tagline, cakupan, target);
      await simpanKunci('app_judul_tab', judulTab, cakupan, target);
      await simpanKunci('app_favicon', favicon, cakupan, target);
      await simpanKunci('app_aksen', aksen, cakupan, target);
      await simpanKunci('app_logo_latar', latar, cakupan, target);
      await simpanKunci('app_kartu', kartu, cakupan, target);
      await simpanKunci('app_pakai_faktur', pakaiFaktur ? 'true' : 'false', cakupan, target);

      // Versi dinaikkan lebih dulu supaya balasan & cache klien langsung
      // memakai nomor versi baru (logo lama tidak pernah tersaji ulang).
      await naikkanVersi();
      const sesudah = await bacaIdentitas(target);
      await sinkronFaktur(pakaiFaktur, sesudah);

      await catatAudit({
        userId: pengguna.id,
        aksi: 'ubah',
        tabel: 'settings',
        recordId: cakupan === 'per-toko' ? `app_identitas@${toko}` : 'app_identitas',
        sebelum: { nama: sebelum.nama, tagline: sebelum.tagline, judulTab: sebelum.judulTab, aksen: sebelum.aksen, latar: sebelum.latar, kartu: sebelum.kartu, cakupan: sebelum.cakupan, pakaiFaktur: sebelum.pakaiFaktur },
        sesudah: { nama, tagline, judulTab, aksen, latar, kartu, cakupan, pakaiFaktur },
        alasan: 'Pengaturan ▸ Identitas Aplikasi',
      });
      res.json(sesudah);
    }),
  );

  // Unggah logo (siang/malam/ikon) — disimpan ke /uploads/identitas (Y2.1).
  r.post(
    '/tampilan/identitas/logo',
    (req, _res, next) => {
      (async () => {
        // AX — Identitas Aplikasi = sel Ubah pada Pengaturan.
        await wajibSel(req, 'pengaturan', 'ubah');
        next();
      })().catch(next);
    },
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const varian = String(body.varian ?? '');
      if (!VARIAN.has(varian)) throw tolak(400, 'Varian logo tidak dikenal (siang/malam/ikon).');
      const toko = String(body.toko ?? '').trim() || null;
      const cakupan = await bacaMentah('app_cakupan') === 'per-toko' ? 'per-toko' : 'semua';
      if (cakupan === 'per-toko' && !toko) throw tolak(400, 'Pilih toko aktif terlebih dahulu.');
      const kunci = KUNCI_VARIAN[varian];
      const efektif = cakupan === 'per-toko' ? toko : null;
      const kunciTulis = efektif ? `${kunci}@${efektif}` : kunci;
      const url = simpanLogo(varian, body);
      const lama = await bacaMentah(kunciTulis) ?? '';
      // Berkas lama tidak lagi dirujuk — hapus agar tidak menumpuk (Y2.1).
      hapusBerkas(lama || null);
      await tulis(kunciTulis, url);
      const versi = await naikkanVersi();
      await sinkronLogoFaktur(efektif);
      await catatAudit({
        userId: pengguna.id,
        aksi: 'ubah',
        tabel: 'settings',
        recordId: kunciTulis,
        sebelum: { url: lama },
        sesudah: { url },
        alasan: 'Pengaturan ▸ Identitas Aplikasi',
      });
      res.json({ ok: true, url: url.startsWith('/uploads/') ? `${url}?v=${versi}` : url, versi });
    }),
  );

  // Kembali ke logo bawaan (Y2.1 — tombol Hapus).
  r.post(
    '/tampilan/identitas/logo/hapus',
    (req, _res, next) => {
      (async () => {
        // AX — Identitas Aplikasi = sel Ubah pada Pengaturan.
        await wajibSel(req, 'pengaturan', 'ubah');
        next();
      })().catch(next);
    },
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const varian = String(body.varian ?? '');
      if (!VARIAN.has(varian)) throw tolak(400, 'Varian logo tidak dikenal (siang/malam/ikon).');
      const toko = String(body.toko ?? '').trim() || null;
      const cakupan = await bacaMentah('app_cakupan') === 'per-toko' ? 'per-toko' : 'semua';
      const efektif = cakupan === 'per-toko' ? toko : null;
      const kunci = KUNCI_VARIAN[varian];
      const kunciTulis = efektif ? `${kunci}@${efektif}` : kunci;
      const lama = await bacaMentah(kunciTulis) ?? '';
      hapusBerkas(lama || null);
      await tulis(kunciTulis, '');
      const versi = await naikkanVersi();
      await sinkronLogoFaktur(efektif);
      await catatAudit({
        userId: pengguna.id,
        aksi: 'hapus',
        tabel: 'settings',
        recordId: kunciTulis,
        sebelum: { url: lama },
        sesudah: { url: '' },
        alasan: 'Pengaturan ▸ Identitas Aplikasi',
      });
      res.json({ ok: true, versi });
    }),
  );

  // Y2.1 — "Kembalikan bawaan": seluruh identitas kembali ke nilai bawaan.
  r.post(
    '/tampilan/identitas/bawaan',
    (req, _res, next) => {
      (async () => {
        // AX — Identitas Aplikasi = sel Ubah pada Pengaturan.
        await wajibSel(req, 'pengaturan', 'ubah');
        next();
      })().catch(next);
    },
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const toko = String(body.toko ?? '').trim() || null;
      const cakupan = await bacaMentah('app_cakupan') === 'per-toko' ? 'per-toko' : 'semua';
      const efektif = cakupan === 'per-toko' ? toko : null;
      const sebelum = await bacaIdentitas(efektif);

      // Logo ikut dihapus (file fisik) agar bersih — hanya varian cakupan ini.
      for (const v of ['siang', 'malam', 'ikon'] as const) {
        const kunci =
          cakupan === 'per-toko' && efektif ? `${KUNCI_VARIAN[v]}@${efektif}` : KUNCI_VARIAN[v];
        hapusBerkas(await bacaMentah(kunci) || null);
        await hapusKunci(KUNCI_VARIAN[v], cakupan, efektif);
      }
      for (const k of KUNCI_TEKS) await hapusKunci(k, cakupan, efektif);
      if (efektif === null) await hapusKunci('app_cakupan', 'semua', null);

      await naikkanVersi();
      const sesudah = await bacaIdentitas(efektif);
      await sinkronFaktur(false, sesudah);
      const versi = sesudah.versi;

      await catatAudit({
        userId: pengguna.id,
        aksi: 'pulihkan',
        tabel: 'settings',
        recordId: efektif ? `app_identitas@${efektif}` : 'app_identitas',
        sebelum: { nama: sebelum.nama, tagline: sebelum.tagline },
        sesudah: { nama: sesudah.nama, tagline: sesudah.tagline },
        alasan: 'Pengaturan ▸ Identitas Aplikasi — kembalikan bawaan',
      });
      res.json({ ok: true, versi, identitas: sesudah });
    }),
  );

  return r;
}
