// Pengaturan ▸ API — daftar tab, baca/tulis nilai, kembalikan ke bawaan,
// dan Log Aktivitas. Semua perubahan dicatat di `audit_logs`
// (siapa, kapan, sebelum/sesudah).
import express, { Router } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { PERAN_ADMIN, penggunaSaatIni, peranDariHeader } from '../lib/akses.ts';
import type { RequestHandler } from 'express';
import { asyncHandler, tolak } from '../lib/http.ts';
import {
  buatBackup,
  daftarBackup,
  infoSistem,
  pathBackup,
  periksaPembaruan,
  pulihkanBackup,
  pulihkanDariUnggahan,
  rawatDatabase,
  type ModeRawat,
} from '../lib/sistem.ts';
import { verifikasiSandiAktif } from '../lib/prosesTahunan.ts';
import { JENIS_RESET, jalankanReset, ringkasanReset, type JenisReset } from '../lib/resetData.ts';
import {
  daftarMasterTanpaTransaksi,
  hapusMasterTanpaTransaksi,
} from '../lib/pembersihanTransaksi.ts';
import { ENTITAS } from './master/konfigurasi.ts';
import { catatAudit } from '../lib/audit.ts';
import { resetRegional } from '../lib/zonaWaktu.ts';
import {
  GRUP,
  JENIS_NOMOR,
  KARTU_DASHBOARD_PENGATURAN,
  TAB_PENGATURAN,
  bacaTab,
  bacaTampilanAkun,
  bawaanTab,
  cariTab,
  hapusTampilanAkun,
  konfigNomor,
  pratinjauNomor,
  prefixNomor,
  resetTab,
  tulisTab,
  tulisTampilanAkun,
  validasi,
  type Perubahan,
} from '../lib/pengaturanBaru.ts';

interface BarisToko {
  id: number;
  kode: string;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  logo: string | null;
  warehouse_id: number | null;
  gudang_nama: string | null;
  aktif: number;
}

async function catatPerubahan(
  req: Parameters<typeof penggunaSaatIni>[0],
  tabKode: string,
  tabLabel: string,
  toko: string | null,
  daftar: Perubahan[],
  aksi: 'ubah' | 'pulihkan',
): Promise<void> {
  if (!daftar.length) return;
  const pengguna = penggunaSaatIni(req);
  await catatAudit({
    userId: pengguna.id,
    aksi,
    tabel: 'pengaturan',
    recordId: toko ? `${tabKode}@${toko}` : tabKode,
    sebelum: Object.fromEntries(daftar.map((p) => [p.kunci, p.sebelum])),
    sesudah: Object.fromEntries(daftar.map((p) => [p.kunci, p.sesudah])),
    alasan: `Pengaturan ▸ ${tabLabel}${toko ? ` (toko ${toko})` : ''}`,
  });
}

/**
 * AH2d — daftar perubahan untuk penyimpanan Tampilan per-akun (audit_logs).
 * `sebelum` = nilai efektif (global ∪ override akun), `sesudah` = nilai baru.
 */
function bedahPerubahan(
  tab: Parameters<typeof bawaanTab>[0],
  sebelum: Record<string, unknown>,
  sesudah: Record<string, unknown>,
  skop: 'akun',
): Perubahan[] {
  const out: Perubahan[] = [];
  for (const b of tab.bidang) {
    const lama = sebelum[b.kunci] ?? null;
    const baru = sesudah[b.kunci] ?? null;
    if (JSON.stringify(lama) === JSON.stringify(baru)) continue;
    out.push({ kunci: `${b.kunci} (${skop})`, label: b.label, sebelum: lama, sesudah: baru });
  }
  return out;
}

/**
 * Hak akses tab Pengaturan.
 *
 * Hanya Admin yang boleh membuka Pengaturan. Admin dapat memberi izin peran
 * lain per tab (mis. Manajer ke Penomoran & Pajak) lewat baris settings
 * `peng.akses.<kode-tab>` berisi daftar peran — endpoint
 * `PUT /pengguna/akses/:tab`.
 *
 * Peran aktif diambil dari header `x-peran` (dikirim klien dari Pengaturan,
 * sama seperti guard modul Akuntansi) sehingga matriks ini benar-benar
 * dijalankan dan bisa diuji. Saat modul login ada, ganti dengan baca sesi —
 * seluruh pemanggil izinTab tidak berubah.
 */
// Peran yang dikenali untuk izin tab. Peran kustom (dibuat di Pengguna &
// Hak Akses) ikut dikenali lewat daftar `roles` di database — sebelumnya
// hanya 5 peran bawaan, sehingga peran buatan Admin tidak pernah cocok.
const PERAN_DIKENAL_PENGATURAN = new Set(['admin', 'owner', 'administrator', 'manajer', 'akuntan', 'kasir', 'gudang']);

/** Peran Admin: `admin` (dikirim klien) maupun owner/administrator (sesi). */
const adalahPeranAdmin = (peran: string): boolean => PERAN_ADMIN.has(peran) || peran === 'admin';

/**
 * Nama peran sesi apa adanya (mis. "Supervisor") — bukan kunci peran.
 * Izin tab disimpan memakai NAMA peran (sesuai matriks di UI), sedangkan
 * sesi membawa kunci peran; keduanya dibandingkan di sini.
 */
function namaPeranSesi(req: Parameters<typeof penggunaSaatIni>[0]): string {
  return (req.konteks?.roleNama ?? penggunaSaatIni(req).peran ?? '').toLowerCase().trim();
}

async function peranDikenal(p: string): Promise<boolean> {
  if (PERAN_DIKENAL_PENGATURAN.has(p)) return true;
  return Boolean((await get<{ id: number }>('SELECT id FROM roles WHERE lower(nama) = ?', p)));
}

export async function izinTab(req: Parameters<typeof penggunaSaatIni>[0], kodeTab: string): Promise<boolean> {
  const peran = peranDariHeader(req);
  const nama = namaPeranSesi(req);
  if (adalahPeranAdmin(peran) || adalahPeranAdmin(nama)) return true;
  // Y2.1 / Y2.6 — Identitas Aplikasi selalu dan hanya untuk Admin/Owner,
  // tidak bisa diberi izin lewat matriks Hak Akses.
  if (kodeTab === 'identitas-aplikasi') return false;
  const mentah = await ((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', `peng.akses.${kodeTab}`)))?.nilai;
  if (!mentah) return false;
  try {
    const daftar = JSON.parse(mentah) as unknown;
    if (!Array.isArray(daftar)) return false;
    // Cocokkan nama peran sesi ("Manajer", "Supervisor", …) atau kunci
    // peran ("manajer") — hanya untuk peran yang benar-benar ada.
    for (const x of daftar) {
      const p = String(x).toLowerCase().trim();
      if ((p === nama || p === peran) && (await peranDikenal(p))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Tulis izin tab & baca daftar izin: hanya Admin (matriks hak akses). */
const wajibAdminAkses: RequestHandler = (req, _res, next) => {
  if (adalahPeranAdmin(peranDariHeader(req))) {
    next();
    return;
  }
  next(tolak(403, 'Matriks izin tab hanya dapat dibaca/diubah Admin.'));
};

/**
 * Baris log aktivitas untuk tab Log Aktivitas.
 *
 * Sengaja mencakup SEMUA tabel (bukan hanya `pengaturan`) agar modul lain
 * (produk, transaksi, jurnal, toko) ikut terlihat — sesuai kebutuhan tab
 * "Log Aktivitas" yang memfilter pengguna, modul, dan tanggal.
 */
export interface BarisLog {
  id: number;
  waktu: string;
  aksi: string;
  tab: string;
  alasan: string | null;
  oleh: string;
  sebelum: Record<string, unknown> | null;
  sesudah: Record<string, unknown> | null;
}

/** Tabel yang pernah muncul di log — dipakai sebagai pilihan filter modul. */
async function daftarModulLog(): Promise<string[]> {
  const rows = await (await all<{ tabel: string }>(
    'SELECT DISTINCT tabel FROM audit_logs ORDER BY tabel',
  )).map((r) => r.tabel);
  return rows.includes('stores') ? ['stores', ...rows.filter((t) => t !== 'stores')] : rows;
}

function parseJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function bacaLogAktivitas(
  req: Parameters<typeof penggunaSaatIni>[0],
  batas: number,
  saring?: { pengguna?: string; modul?: string; dari?: string; sampai?: string },
): Promise<{ baris: BarisLog[] }> {
  // Modul login menyusul — bila user_id kosong, tampilkan peran aktif dari
  // permintaan agar kolom "siapa" tetap terisi.
  const namaPengguna = penggunaSaatIni(req).nama;
  const where: string[] = [];
  const arg: (string | number)[] = [];

  const pengguna = saring?.pengguna?.trim();
  if (pengguna) {
    where.push("(u.nama ILIKE ? OR (u.nama IS NULL AND ? = 'lainnya'))");
    arg.push(`%${pengguna}%`, pengguna);
  }
  const modul = saring?.modul?.trim();
  if (modul && modul !== 'semua') {
    where.push('l.tabel = ?');
    arg.push(modul);
  }
  const dari = saring?.dari?.trim();
  if (dari) {
    where.push('l.waktu >= ?');
    arg.push(`${dari} 00:00:00`);
  }
  const sampai = saring?.sampai?.trim();
  if (sampai) {
    where.push('l.waktu <= ?');
    arg.push(`${sampai} 23:59:59`);
  }

  const rows = await all<{
    id: number; waktu: string; aksi: string; tabel: string; record_id: string | null;
    data_sebelum: string | null; data_sesudah: string | null; alasan: string | null; nama: string | null;
  }>(
    `SELECT l.id, l.waktu, l.aksi, l.tabel, l.record_id, l.data_sebelum, l.data_sesudah, l.alasan, u.nama
       FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC LIMIT ?`,
    ...arg,
    batas,
  );

  return {
    baris: rows.map((x) => ({
      id: x.id,
      waktu: x.waktu,
      aksi: x.aksi,
      tab: x.tabel,
      alasan: x.alasan,
      oleh: x.nama ?? namaPengguna,
      sebelum: parseJson(x.data_sebelum),
      sesudah: parseJson(x.data_sesudah),
    })),
  };
}

/**
 * Guard untuk endpoint data satu tab (info, cadangan, riwayat, ekspor, ...).
 * Boleh: Admin, ATAU peran yang diberi izin Admin pada SALAH SATU tab yang
 * disebut — jadi tab yang dibuka non-Admin benar-benar bisa dipakai.
 */
export const wajibIzinTabInfo = (...kodeTab: string[]): RequestHandler => (req, _res, next) => {
  (async () => {
    for (const k of kodeTab) {
      if (await izinTab(req, k)) return next();
    }
    next(
      tolak(
        403,
        `Endpoint ini hanya untuk Admin (atau peran yang diizinkan Admin pada tab ${kodeTab.join(' / ')}). ` +
          'Minta Admin memberi izin pada Pengguna & Hak Akses.',
      ),
    );
  })().catch(next);
};

/**
 * Reset Data (Database & Backup) — hanya Admin utama.
 *
 * Izin tab saja tidak cukup: Admin boleh memberi izin tab Database pada peran
 * lain, tetapi menghapus seluruh data tetap hak Admin utama (Super Admin).
 * Peran dibaca dari SESI login (`req.konteks.roleNama`) — bukan dari header
 * `x-peran` yang bisa dikirim klien. Tanpa sesi yang sah, permintaan ditolak.
 */
const wajibAdminUtama: RequestHandler = (req, _res, next) => {
  const k = req.konteks;
  if (!k || k.userId === null) {
    next(tolak(401, 'Masuk sebagai Admin utama (Super Admin) untuk menjalankan aksi ini.'));
    return;
  }
  if (!adalahPeranAdmin(String(k.roleNama ?? '').toLowerCase().trim())) {
    next(tolak(403, 'Aksi ini hanya untuk Admin utama (Super Admin).'));
    return;
  }
  next();
};

/* ------------------- Pemeliharaan database (VACUUM/REINDEX) ------------- */

const fmtByte = (n: number): string =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

/** Pemeliharaan database hanya untuk Administrator (pesan khusus). */
const wajibAdminRawat: RequestHandler = (req, _res, next) => {
  if (!adalahPeranAdmin(peranDariHeader(req))) {
    next(tolak(403, 'Pemeliharaan database (VACUUM / REINDEX) hanya untuk Administrator.'));
    return;
  }
  next();
};

/** Alias mode dari klien (standar/standard/vacuum, penuh/full, reindex). */
const MODE_RAWAT_ALIAS: Record<string, ModeRawat> = {
  standar: 'standar',
  standard: 'standar',
  vacuum: 'standar',
  penuh: 'penuh',
  full: 'penuh',
  reindex: 'reindex',
  're-index': 'reindex',
  re_index: 'reindex',
};

/**
 * Handler pemeliharaan database — SATU sumber untuk dua rute:
 *   POST /api/pengaturan/sistem/rawat      (dipakai UI lama)
 *   POST /api/settings/database/maintenance (nama endpoint sesuai spesifikasi)
 * Hanya Admin utama yang lolos (izin tab Database saja tidak cukup).
 */
const handlerRawatDatabase = asyncHandler(async (req, res) => {
  const mode = MODE_RAWAT_ALIAS[String(req.body?.mode ?? '').trim().toLowerCase()];
  if (!mode) {
    throw tolak(400, 'Mode perawatan tidak dikenal (standar/penuh/reindex).');
  }
  const label = mode === 'standar' ? 'Vacuum Standard' : mode === 'penuh' ? 'Vacuum Full' : 'Re Index';
  const pengguna = penggunaSaatIni(req);
  const hasil = await rawatDatabase(mode);
  await catatAudit({
    userId: pengguna.id, aksi: 'ubah', tabel: 'pengaturan', recordId: 'database',
    sesudah: { perawatan: label, ...hasil },
    alasan: `${label} database oleh ${pengguna.nama ?? pengguna.id}`,
  });
  res.json({
    ...hasil,
    mode,
    label,
    pesan: `${label} selesai dalam ${(hasil.durasiMs / 1000).toFixed(1)} dtk — ukuran ${fmtByte(hasil.sebelum)} → ${fmtByte(hasil.sesudah)}.`,
  });
});

/** Router alias: /api/settings/database/maintenance. */
export function routerPemeliharaanDb(): Router {
  const r = Router();
  r.post('/database/maintenance', wajibIzinTabInfo('database'), wajibAdminRawat, handlerRawatDatabase);
  return r;
}

/** Tolak permintaan bila peran aktif tidak punya izin membuka tab ini. */
const wajibIzinTab: RequestHandler = async (req, _res, next) => {
  const kode = String(req.params.tab ?? '');
  if (!TAB_PENGATURAN.some((t) => t.kode === kode)) return next();
  if (!await izinTab(req, kode)) {
    next(tolak(403, 'Pengaturan hanya untuk Admin. Minta Admin memberi izin tab ini pada Pengguna & Hak Akses.'));
    return;
  }
  next();
};

export function routerPengaturan(): Router {
  const r = Router();

  /* --------------------------- DAFTAR TAB -------------------------------- */

  r.get(
    '/daftar',
    asyncHandler(async (req, res) => {
      res.json({
        grup: GRUP,
        kartu: KARTU_DASHBOARD_PENGATURAN,
        jenisNomor: await Promise.all(JENIS_NOMOR.map(async (j) => ({
          kode: j.kode,
          label: j.label,
          prefix: await prefixNomor(j.kode),
          contoh: await pratinjauNomor(j.kode),
          konfig: await konfigNomor(j.kode),
        }))),
        tab: await Promise.all(TAB_PENGATURAN.map(async (t) => ({
          kode: t.kode,
          grup: t.grup,
          label: t.label,
          ket: t.ket ?? null,
          cakupan: t.cakupan,
          kustom: t.kustom ?? null,
          informatif: Boolean(t.informatif),
          dampak: t.dampak ?? null,
          // Izin per tab untuk peran aktif — dipakai navigasi kiri agar peran
          // non-Admin hanya melihat tab yang diizinkan Admin padanya.
          boleh: await izinTab(req, t.kode),
          bidang: t.bidang.map((b) => ({
            kunci: b.kunci,
            label: b.label,
            tipe: b.tipe,
            opsi: b.opsi ?? null,
            ket: b.ket ?? null,
            satuan: b.satuan ?? null,
            min: b.min ?? null,
            max: b.max ?? null,
            wajib: Boolean(b.wajib),
            cakupan: b.cakupan ?? t.cakupan,
            opsiUrl: b.opsiUrl ?? null,
            pratinjau: Boolean(b.pratinjau),
            dampak: b.dampak ?? null,
            ke: b.ke ?? null,
            nonaktif: b.nonaktif ?? null,
          })),
        }))),
      });
    }),
  );

  /* --------------------------- LOG AKTIVITAS ----------------------------- */

  r.get(
    '/log/aktivitas',
    wajibIzinTabInfo('log-aktivitas'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(2000, Math.max(1, Number.parseInt(String(req.query.per ?? '100'), 10) || 100));
      const { baris } = await bacaLogAktivitas(req, limit, {
        pengguna: String(req.query.pengguna ?? ''),
        modul: String(req.query.modul ?? ''),
        dari: String(req.query.dari ?? ''),
        sampai: String(req.query.sampai ?? ''),
      });
      res.json({ data: baris, modul: await daftarModulLog() });
    }),
  );

  /* ------------------------------ TOKO ----------------------------------- */

  r.get(
    '/toko/opsi',
    asyncHandler(async (_req, res) => {
      const rows = await all<{ id: number; kode: string; nama: string }>(
        'SELECT id, kode, nama FROM stores WHERE aktif = TRUE ORDER BY nama',
      );
      res.json({ data: rows.map((t) => ({ id: t.id, nilai: t.kode, label: `${t.nama} (${t.kode})` })) });
    }),
  );

  r.get(
    '/toko',
    asyncHandler(async (_req, res) => {
      const rows = await all<BarisToko>(
        `SELECT s.*, w.nama AS gudang_nama
           FROM stores s LEFT JOIN warehouses w ON w.id = s.warehouse_id
          ORDER BY s.nama`,
      );
      res.json({ data: rows, gudang: await all('SELECT id, kode, nama FROM warehouses ORDER BY nama') });
    }),
  );

  const bacaToko = (body: Record<string, unknown>): { kode: string; nama: string; alamat: string | null; telepon: string | null; email: string | null; logo: string | null; warehouse_id: number | null; aktif: boolean } => {
    const kode = String(body.kode ?? '').trim().toUpperCase();
    const nama = String(body.nama ?? '').trim();
    if (!kode) throw tolak(400, 'Kode toko wajib diisi.');
    if (kode.length > 20) throw tolak(400, 'Kode toko maksimal 20 karakter.');
    if (!nama) throw tolak(400, 'Nama toko wajib diisi.');
    if (nama.length > 120) throw tolak(400, 'Nama toko maksimal 120 karakter.');
    const teks = (k: string): string | null => {
      const v = String(body[k] ?? '').trim();
      return v ? v.slice(0, 400) : null;
    };
    const wid = body.warehouse_id === null || body.warehouse_id === undefined || body.warehouse_id === ''
      ? null
      : Number(body.warehouse_id);
    if (wid !== null && !Number.isInteger(wid)) throw tolak(400, 'Gudang tidak valid.');
    return {
      kode, nama,
      alamat: teks('alamat'), telepon: teks('telepon'), email: teks('email'), logo: teks('logo'),
      warehouse_id: wid,
      aktif: body.aktif === undefined ? true : Boolean(body.aktif),
    };
  };

  r.post(
    '/toko',
    wajibIzinTabInfo('toko-gudang'),
    asyncHandler(async (req, res) => {
      const t = bacaToko((req.body ?? {}) as Record<string, unknown>);
      const pengguna = penggunaSaatIni(req);
      const id = await withTransaction(async () => {
        const hasil = await run(
          `INSERT INTO stores (kode, nama, alamat, telepon, email, logo, warehouse_id, aktif)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          t.kode, t.nama, t.alamat, t.telepon, t.email, t.logo, t.warehouse_id, t.aktif ? 1 : 0,
        );
        const idBaru = Number(hasil.lastInsertRowid);
        await catatAudit({
          userId: pengguna.id, aksi: 'tambah', tabel: 'stores', recordId: idBaru,
          sesudah: { kode: t.kode, nama: t.nama, alamat: t.alamat, telepon: t.telepon, gudang_id: t.warehouse_id },
        });
        return idBaru;
      });
      res.status(201).json({ id, pesan: `Toko "${t.nama}" ditambahkan.` });
    }),
  );

  r.put(
    '/toko/:id',
    wajibIzinTabInfo('toko-gudang'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await ((await all<Record<string, unknown>>('SELECT * FROM stores WHERE id = ?', id)))[0];
      if (!lama) throw tolak(404, 'Toko tidak ditemukan.');
      const t = bacaToko((req.body ?? {}) as Record<string, unknown>);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(
          `UPDATE stores SET kode = ?, nama = ?, alamat = ?, telepon = ?, email = ?, logo = ?,
                            warehouse_id = ?, aktif = ? WHERE id = ?`,
          t.kode, t.nama, t.alamat, t.telepon, t.email, t.logo, t.warehouse_id, t.aktif ? 1 : 0, id,
        );
        await catatAudit({
          userId: pengguna.id, aksi: 'ubah', tabel: 'stores', recordId: id,
          sebelum: { kode: lama.kode, nama: lama.nama, alamat: lama.alamat, telepon: lama.telepon, gudang_id: lama.warehouse_id },
          sesudah: { kode: t.kode, nama: t.nama, alamat: t.alamat, telepon: t.telepon, gudang_id: t.warehouse_id },
        });
      });
      res.json({ pesan: 'Toko diperbarui.' });
    }),
  );

  r.delete(
    '/toko/:id',
    wajibIzinTabInfo('toko-gudang'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await ((await all<Record<string, unknown>>('SELECT * FROM stores WHERE id = ?', id)))[0];
      if (!lama) throw tolak(404, 'Toko tidak ditemukan.');
      const dipakai = await ((await all<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM stock_balances WHERE warehouse_id = w.id AND qty <> 0) AS n
           FROM warehouses w WHERE w.id = ?`,
        lama.warehouse_id ?? -1,
      )))[0];
      if (dipakai && dipakai.n > 0) {
        throw tolak(409, 'Gudang toko ini masih memuat stok — pindahkan atau opname dulu sebelum menghapus toko.');
      }
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run('DELETE FROM stores WHERE id = ?', id);
        // Pengaturan per toko ikut dibersihkan.
        await run(`DELETE FROM settings WHERE kunci LIKE 'peng.%@' || ?`, String(lama.kode));
        await catatAudit({
          userId: pengguna.id, aksi: 'hapus', tabel: 'stores', recordId: id,
          sebelum: { kode: lama.kode, nama: lama.nama },
        });
      });
      res.json({ pesan: 'Toko dihapus.' });
    }),
  );

  /* --------------------------- BACA / TULIS TAB --------------------------- */

  r.get(
    '/:tab',
    wajibIzinTab,
    asyncHandler(async (req, res) => {
      const tab = cariTab(String(req.params.tab));
      const toko = tab.cakupan === 'toko' ? String(req.query.toko ?? '').trim() || null : null;
      // AH2d — tab Tampilan: nilai per-akun MENIMPA nilai global (database).
      const uid = penggunaSaatIni(req).id;
      if (tab.kode === 'tampilan') {
        const global = await bacaTab(tab, toko);
        const perAkun = await bacaTampilanAkun(uid);
        const cakupanAkun = perAkun ? String(perAkun.tampilan_cakupan ?? 'akun') : 'semua';
        const nilai = cakupanAkun === 'akun' && perAkun ? { ...global, ...perAkun } : global;
        res.json({ tab: tab.kode, label: tab.label, cakupan: tab.cakupan, toko, nilai, bawaan: bawaanTab(tab) });
        return;
      }
      res.json({
        tab: tab.kode,
        label: tab.label,
        cakupan: tab.cakupan,
        toko,
        nilai: await bacaTab(tab, toko),
        bawaan: bawaanTab(tab),
      });
    }),
  );

  r.put(
    '/:tab',
    wajibIzinTab,
    asyncHandler(async (req, res) => {
      const tab = cariTab(String(req.params.tab));
      // Suara & Getar Scan (termasuk file audio kustom) dikunci untuk Admin.
      if (tab.kode === 'suara-scan' && !adalahPeranAdmin(peranDariHeader(req))) {
        throw tolak(403, 'Pengaturan suara dan getar scan dikunci — hanya Administrator yang dapat mengubahnya.');
      }
      const toko = tab.cakupan === 'toko' ? String(req.query.toko ?? '').trim() || null : null;
      if (tab.cakupan === 'toko' && !toko) throw tolak(400, 'Pilih toko terlebih dahulu.');
      if (toko && !await ((await all('SELECT id FROM stores WHERE kode = ?', toko))).length) {
        throw tolak(404, `Toko "${toko}" tidak ditemukan.`);
      }
      const body = (req.body ?? {}) as { nilai?: unknown };
      if (!body.nilai || typeof body.nilai !== 'object') throw tolak(400, 'Data nilai tidak ditemukan.');
      const nilai = body.nilai as Record<string, unknown>;
      validasi(tab, nilai);

      // AH2d — tab Tampilan: "Hanya akun saya" disimpan per akun (menimpa
      // global); "Semua pengguna" menulis global & membuang override akun.
      if (tab.kode === 'tampilan') {
        const uid = penggunaSaatIni(req).id;
        const labelSkop = nilai.tampilan_cakupan === 'akun' ? `${tab.label} (hanya akun saya)` : tab.label;
        if (nilai.tampilan_cakupan === 'akun') {
          if (uid === null) throw tolak(401, 'Pilihan "Hanya akun saya" memerlukan login.');
          const sebelum = { ...await bacaTab(tab, toko), ...(await bacaTampilanAkun(uid) ?? {}) };
          await tulisTampilanAkun(uid, nilai);
          const daftar = bedahPerubahan(tab, sebelum, nilai, 'akun');
          await catatPerubahan(req, tab.kode, labelSkop, toko, daftar, 'ubah');
          res.json({ pesan: daftar.length ? `${daftar.length} pengaturan disimpan (hanya akun saya).` : 'Tidak ada perubahan.', jumlah: daftar.length });
          return;
        }
        const daftar = await tulisTab(tab, nilai, toko);
        await hapusTampilanAkun(uid); // kembali memakai pengaturan global
        await catatPerubahan(req, tab.kode, labelSkop, toko, daftar, 'ubah');
        res.json({ pesan: daftar.length ? `${daftar.length} pengaturan disimpan.` : 'Tidak ada perubahan.', jumlah: daftar.length });
        return;
      }

      const daftar = await tulisTab(tab, nilai, toko);
      // Zona/format regional berlaku seketika (tanpa restart): buang cache.
      if (tab.kode === 'umum-regional') resetRegional();
      await catatPerubahan(req, tab.kode, tab.label, toko, daftar, 'ubah');
      res.json({ pesan: daftar.length ? `${daftar.length} pengaturan disimpan.` : 'Tidak ada perubahan.', jumlah: daftar.length });
    }),
  );

  r.post(
    '/:tab/bawaan',
    wajibIzinTab,
    asyncHandler(async (req, res) => {
      const tab = cariTab(String(req.params.tab));
      // Reset suara scan hanya boleh dilakukan Admin.
      if (tab.kode === 'suara-scan' && !adalahPeranAdmin(peranDariHeader(req))) {
        throw tolak(403, 'Pengaturan suara dan getar scan dikunci — hanya Administrator yang dapat mengubahnya.');
      }
      const toko = tab.cakupan === 'toko' ? String(req.body?.toko ?? req.query.toko ?? '').trim() || null : null;
      if (tab.cakupan === 'toko' && !toko) throw tolak(400, 'Pilih toko terlebih dahulu.');
      // AH2d — reset mengikuti cakupan aktif: pemilik override per-akun hanya
      // membuang override miliknya sendiri; sisanya mengembalikan global ke bawaan.
      if (tab.kode === 'tampilan') {
        const uid = penggunaSaatIni(req).id;
        const perAkun = await bacaTampilanAkun(uid);
        if (perAkun) {
          const sebelum = { ...await bacaTab(tab, toko), ...perAkun };
          await hapusTampilanAkun(uid);
          const daftar = bedahPerubahan(tab, sebelum, bawaanTab(tab), 'akun');
          await catatPerubahan(req, tab.kode, `${tab.label} (hanya akun saya)`, toko, daftar, 'pulihkan');
          res.json({
            pesan: 'Pengaturan tampilan akun dikembalikan ke bawaan (mengikuti pengaturan global).',
            jumlah: daftar.length,
          });
          return;
        }
      }
      const daftar = await resetTab(tab, toko);
      if (tab.kode === 'umum-regional') resetRegional();
      await catatPerubahan(req, tab.kode, tab.label, toko, daftar, 'pulihkan');
      res.json({
        pesan: daftar.length ? `${daftar.length} pengaturan dikembalikan ke bawaan.` : 'Sudah memakai nilai bawaan.',
        jumlah: daftar.length,
      });
    }),
  );

  /* ================== SISTEM: INFO, CADANGAN, PEMULIHAN ================= */

  r.get(
    '/sistem/info',
    wajibIzinTabInfo('database', 'tentang'),
    asyncHandler(async (_req, res) => {
      res.json({ ...await infoSistem(), cadangan: daftarBackup() });
    }),
  );

  r.post(
    '/sistem/backup',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const alasan = String(req.body?.alasan ?? 'cadangan manual').slice(0, 120);
      const nama = await buatBackup(alasan);
      await catatAudit({
        userId: pengguna.id, aksi: 'tambah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { cadangan: nama, alasan },
      });
      res.status(201).json({ nama, pesan: `Cadangan ${nama} berhasil dibuat.` });
    }),
  );

  r.get(
    '/sistem/backup/unduh',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      const nama = String(req.query.nama ?? '');
      const p = pathBackup(nama);
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ekspor', tabel: 'pengaturan',
        recordId: 'database', sesudah: { cadangan: nama },
      });
      res.download(p, nama);
    }),
  );

  /* Perawatan database: Vacuum Standard / Vacuum Full / Re Index. */
  r.post('/sistem/rawat', wajibIzinTabInfo('database'), wajibAdminRawat, handlerRawatDatabase);

  r.post(
    '/sistem/pulihkan',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      const nama = String(req.body?.nama ?? '');
      const konfirmasi = String(req.body?.konfirmasi ?? '');
      if (konfirmasi !== 'PULIHKAN') {
        throw tolak(400, 'Konfirmasi salah. Ketik PULIHKAN untuk melanjutkan.');
      }
      const pengguna = penggunaSaatIni(req);
      await pulihkanBackup(nama);
      await catatAudit({
        userId: pengguna.id, aksi: 'ubah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { dipulihkan_dari: nama },
        alasan: 'Pemulihan database dari cadangan',
      });
      res.json({
        pesan: 'Database berhasil dipulihkan! Halaman akan dimuat ulang.',
        sumber: nama,
      });
    }),
  );

  /* Restore database dari BERKAS UNGGAHAN (tombol "Restore Database").
   * Terisolasi: tidak menyentuh alur backup/vacuum/reindex/pulihkan-cadangan.
   * Isi biner dibaca via express.raw (bukan JSON); nama + konfirmasi lewat query.
   * Cadangan pengaman dibuat otomatis; kegagalan = transaksi tergulung.
   */
  r.post(
    '/sistem/pulihkan-unggah',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    express.raw({ type: 'application/octet-stream', limit: '512mb' }),
    asyncHandler(async (req, res) => {
      const nama = String(req.query.nama ?? '');
      const konfirmasi = String(req.query.konfirmasi ?? '');
      if (konfirmasi !== 'PULIHKAN') {
        throw tolak(400, 'Konfirmasi salah. Ketik PULIHKAN untuk melanjutkan.');
      }
      const isi = req.body as Buffer;
      if (!Buffer.isBuffer(isi) || isi.length === 0) {
        throw tolak(400, 'Berkas unggahan kosong atau tidak terbaca.');
      }
      const pengguna = penggunaSaatIni(req);
      const pengaman = await pulihkanDariUnggahan(isi, nama);
      await catatAudit({
        userId: pengguna.id, aksi: 'ubah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { dipulihkan_dari_unggahan: nama, cadangan_pengaman: pengaman },
        alasan: 'Restore database dari berkas unggahan',
      });
      res.json({
        pesan: 'Database berhasil dipulihkan! Halaman akan dimuat ulang.',
        sumber: nama ? `unggahan ${nama}` : 'unggahan',
        pengaman,
      });
    }),
  );

  r.get(
    '/sistem/pembaruan',
    wajibIzinTabInfo('tentang'),
    asyncHandler((_req, res) => {
      res.json(periksaPembaruan());
    }),
  );

  /* ==================== SISTEM: RESET DATA (ADMIN) ====================== */

  // Langkah 1 — ringkasan jumlah data yang akan dihapus per modul.
  r.get(
    '/sistem/reset/ringkasan',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      res.json(await ringkasanReset(String(req.query.jenis ?? '') as JenisReset));
    }),
  );

  // Langkah 4 — eksekusi: kata "RESET" + kata sandi Admin, satu transaksi.
  r.post(
    '/sistem/reset',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      const jenis = String(req.body?.jenis ?? '') as JenisReset;
      if (!JENIS_RESET.some((j) => j.kode === jenis)) {
        throw tolak(400, 'Jenis reset tidak dikenal (transaksi / master / total).');
      }
      if (String(req.body?.konfirmasi ?? '') !== 'RESET') {
        throw tolak(400, 'Konfirmasi salah. Ketik kata RESET dengan huruf kapital untuk melanjutkan.');
      }
      const aktif = penggunaSaatIni(req);
      if (aktif.id === null) throw tolak(401, 'Sesi tidak valid. Masuk ulang lalu coba lagi.');
      if (!await verifikasiSandiAktif(aktif.id, String(req.body?.sandi ?? ''))) {
        await catatAudit({
          userId: aktif.id, aksi: 'batal', tabel: 'pengaturan', recordId: 'database',
          sesudah: { percobaan: 'reset', hasil: 'kata sandi salah' },
          alasan: `Gagal reset ${jenis} — kata sandi pengguna ${aktif.nama ?? aktif.id} tidak cocok`,
        });
        throw tolak(401, 'Kata sandi Anda tidak cocok. Reset dibatalkan — gunakan kata sandi akun yang sedang login.');
      }
      const hasil = await jalankanReset(jenis, penggunaSaatIni(req).id, peranDariHeader(req));
      // Bentuk respons baku: `success` + `message` (klien baru) sekaligus
      // `pesan` + rincian (klien lama) — tidak ada perubahan yang memutus UI.
      const pesan =
        jenis === 'transaksi'
          ? 'Data transaksi berhasil di-reset dan dibersihkan secara permanen.'
          : `${hasil.label} selesai — ${hasil.total} baris data diproses. Cadangan pengaman ${hasil.cadangan_pengaman} dibuat sebelum reset.`;
      res.json({
        success: true,
        message: 'Reset Data berhasil diproses.',
        pesan,
        ...hasil,
      });
    }),
  );

  // Opsi terpisah — Hapus Master Produk Tanpa Transaksi (produk non-aktif
  // yang tidak lagi dirujuk riwayat transaksi apa pun).
  r.get(
    '/sistem/reset/master-tanpa-transaksi',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (_req, res) => {
      const data = await daftarMasterTanpaTransaksi();
      res.json({ jumlah: data.length, produk: data });
    }),
  );

  r.post(
    '/sistem/reset/master-tanpa-transaksi',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    asyncHandler(async (req, res) => {
      if (String(req.body?.konfirmasi ?? '') !== 'HAPUS') {
        throw tolak(400, 'Konfirmasi salah. Ketik HAPUS dengan huruf kapital untuk melanjutkan.');
      }
      const aktif = penggunaSaatIni(req);
      const pengaman = await buatBackup('sebelum hapus master produk tanpa transaksi');
      const hasil = await withTransaction(() => hapusMasterTanpaTransaksi());
      await catatAudit({
        userId: aktif.id,
        aksi: 'hapus',
        tabel: 'products',
        recordId: 'tanpa-transaksi',
        sesudah: { produk: hasil.produk, dilewati: hasil.dilewati, cadangan_pengaman: pengaman },
        alasan: 'Hapus Master Produk Tanpa Transaksi',
      });
      res.json({
        pesan: `${hasil.produk} master produk tanpa transaksi berhasil dihapus permanen.`,
        ...hasil,
        cadangan_pengaman: pengaman,
      });
    }),
  );

  // Pulihkan dari Backup — unggah file cadangan (.dump) yang pernah diunduh.
  // express.json global hanya memproses JSON; body biner diteruskan ke parser
  // raw di sini (batas 256 MB cukup untuk basis data berukuran besar).
  r.post(
    '/sistem/pulihkan/unggah',
    wajibIzinTabInfo('database'),
    wajibAdminUtama,
    express.raw({ type: () => true, limit: '256mb' }),
    asyncHandler(async (req, res) => {
      if (String(req.query.konfirmasi ?? '') !== 'PULIHKAN') {
        throw tolak(400, 'Konfirmasi salah. Ketik PULIHKAN untuk melanjutkan.');
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw tolak(400, 'File backup tidak diterima.');
      const namaAsli = String(req.query.nama ?? 'unggahan.dump');
      const pengaman = await pulihkanDariUnggahan(body, namaAsli);
      await catatAudit({
        userId: penggunaSaatIni(req).id,
        aksi: 'pulihkan',
        tabel: 'pengaturan',
        recordId: 'database',
        sesudah: { dipulihkan_dari_unggahan: namaAsli, cadangan_pengaman: pengaman },
        alasan: 'Pemulihan database dari file backup hasil unduhan',
      });
      res.json({
        nama: namaAsli,
        pengaman,
        pesan: 'Database berhasil dipulihkan! Halaman akan dimuat ulang.',
      });
    }),
  );

  /* ==================== SISTEM: IMPOR & EKSPOR ========================= */

  /**
   * Daftar modul impor beserta contoh kolomnya.
   *
   * Hanya modul yang benar-benar punya kemampuan impor yang menunjuk berkas
   * contoh. Pembelian dan Penjualan belum memiliki impor, jadi ditandai
   * `tersedia: false` dengan alasannya — bukan tautan mati. Opname kini punya
   * wizard Impor Excel (BAGIAN L) di layar Stok ▸ Opname.
   */
  r.get(
    '/impor/modul',
    wajibIzinTabInfo('impor-ekspor'),
    asyncHandler((_req, res) => {
      const entitas = Object.values(ENTITAS).map((e) => ({
        kode: e.kode,
        label: e.label,
        kolom: e.kolom.map((k) => ({ key: k.key, label: k.label })),
        template: `/api/master/${e.kode}/template`,
        tersedia: true,
        ket: null as string | null,
      }));

      // Modul dengan rute template sendiri (kolomnya lebih kaya dari entitas generik).
      const khusus: { kode: string; label: string; template: string; ket: string | null }[] = [
        { kode: 'produk', label: 'Produk', template: '/api/master/produk/template', ket: null },
        { kode: 'paket', label: 'Paket / Bundling', template: '/api/master/paket/template', ket: null },
        { kode: 'persediaan', label: 'Persediaan Sub (Item Masuk / Keluar)', template: '/api/persediaan/template', ket: null },
        { kode: 'opname', label: 'Opname', template: '/api/opname/template?isi=kosong', ket: 'Impor lewat wizard Stok ▸ Opname (ikon Impor Excel): pilih/buat sesi → unduh template → validasi → konfirmasi (Draft / Sahkan).' },
      ];

      // Modul yang belum mendukung impor — ditampilkan nonaktif dengan petunjuk.
      const belumAda: { kode: string; label: string; ket: string }[] = [
        { kode: 'pembelian', label: 'Pembelian', ket: 'Modul Pembelian belum memiliki impor massal. Masukkan dokumen lewat layar Pembelian (biasa atau scan barcode).' },
        { kode: 'penjualan', label: 'Penjualan', ket: 'Modul Penjualan belum memiliki impor massal. Transaksi dibuat lewat POS atau layar Penjualan.' },
      ];

      res.json({
        data: [
          ...entitas,
          ...khusus.map((k) => ({ ...k, kolom: [] as { key: string; label: string }[], tersedia: true })),
          ...belumAda.map((b) => ({ ...b, kolom: [] as { key: string; label: string }[], template: '', tersedia: false })),
        ],
      });
    }),
  );

  r.get(
    '/impor/riwayat',
    wajibIzinTabInfo('impor-ekspor'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.per ?? '50'), 10) || 50));
      const rows = await all<{
        id: number; modul: string; nama_file: string; total_baris: number;
        baris_valid: number; baris_error: number; status: string; waktu: string; nama: string | null;
      }>(
        `SELECT b.*, u.nama FROM import_batches b LEFT JOIN users u ON u.id = b.user_id
          ORDER BY b.id DESC LIMIT ?`,
        limit,
      );
      res.json({ data: rows });
    }),
  );

  /* ==================== SISTEM: NOTIFIKASI & PESAN ===================== */

  r.post(
    '/notifikasi/tes',
    wajibIzinTabInfo('notifikasi'),
    asyncHandler(async (req, res) => {
      const kanal = String(req.body?.kanal ?? '');
      const s = await getSettings();
      if (kanal === 'wa') {
        if (s['wa_kirim_otomatis'] !== 'true') {
          throw tolak(409, 'WhatsApp otomatis belum aktif — masih memerlukan WhatsApp Business API. Pengiriman harian memakai tautan wa.me yang dibuka kasir.');
        }
      } else if (kanal === 'email') {
        if (s['smtp_aktif'] !== 'true') throw tolak(409, 'Pengirim email (SMTP) belum aktif atau belum lengkap.');
        if (!s['smtp_host'] || !s['smtp_pengguna']) throw tolak(409, 'Isi host SMTP dan pengguna SMTP terlebih dahulu.');
      } else {
        throw tolak(400, 'Kanal tidak dikenal (wa / email).');
      }
      res.json({ pesan: 'Konfigurasi terlihat lengkap. Pengiriman tes dijalankan saat modul pengiriman aktif.' });
    }),
  );

  /* ======================== SISTEM: LOG AKTIVITAS ====================== */

  r.get(
    '/log/ekspor',
    wajibIzinTabInfo('log-aktivitas'),
    asyncHandler(async (req, res) => {
      const { baris } = await bacaLogAktivitas(req, 2000);
      const kepala = ['waktu', 'oleh', 'aksi', 'tab', 'sebelum', 'sesudah'];
      const esc = (v: unknown): string => {
        const t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `"${t.replace(/"/g, '""')}"`;
      };
      const isi = baris.map((x) =>
        [x.waktu, x.oleh, x.aksi, x.tab, x.sebelum, x.sesudah].map(esc).join(','),
      );
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ekspor', tabel: 'pengaturan',
        recordId: 'log-aktivitas', sesudah: { baris: baris.length },
      });
      // BOM UTF-8 agar Excel membuka huruf Indonesia dengan benar.
      const csv = `\uFEFF${[kepala.join(','), ...isi].join('\r\n')}\r\n`;
      res
        .set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="log-aktivitas.csv"' })
        .send(csv);
    }),
  );

  /* ==================== SISTEM: PENGGUNA & HAK AKSES =================== */

  r.get(
    '/pengguna/daftar',
    wajibIzinTabInfo('pengguna'),
    asyncHandler(async (_req, res) => {
      res.json({
        data: await all(
          `SELECT u.id, u.nama, u.username, u.email, u.aktif, r.nama AS peran
             FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.nama`,
        ),
        peran: await all('SELECT id, nama FROM roles ORDER BY nama'),
      });
    }),
  );

  r.get(
    '/pengguna/izin',
    wajibAdminAkses,
    asyncHandler(async (_req, res) => {
      const keluar: Record<string, string[]> = {};
      for (const t of TAB_PENGATURAN) {
        const mentah = await ((await get<{ nilai: string | null }>(
          'SELECT nilai FROM settings WHERE kunci = ?',
          `peng.akses.${t.kode}`,
        )))?.nilai;
        if (!mentah) {
          keluar[t.kode] = [];
          continue;
        }
        try {
          const daftar = JSON.parse(mentah) as unknown;
          keluar[t.kode] = Array.isArray(daftar) ? daftar.map((x) => String(x)) : [];
        } catch {
          keluar[t.kode] = [];
        }
      }
      res.json(keluar);
    }),
  );

  /* ------------------ Keamanan: perangkat & sesi aktif ------------------ */

  r.get(
    '/keamanan/sesi',
    wajibIzinTabInfo('keamanan'),
    asyncHandler(async (_req, res) => {
      // Modul Log In belum dijalankan: tidak ada token sesi yang tersimpan,
      // jadi tidak ada perangkat yang bisa dikeluarkan. Dikembalikan kosong
      // (bukan galat) agar panel bisa menjelaskan keadaannya dengan jujur.
      const adaSesi = (await get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sessions'`,
      ))?.n;
      if (adaSesi) {
        res.json({
          data: await all(
            `SELECT perangkat AS perangkat, ip, terakhir_aktif AS terakhir FROM sessions ORDER BY terakhir_aktif DESC LIMIT 50`,
          ),
        });
        return;
      }
      res.json({ data: [] });
    }),
  );

  r.put(
    '/pengguna/akses/:tab',
    wajibAdminAkses,
    asyncHandler(async (req, res) => {
      const kode = String(req.params.tab);
      if (!TAB_PENGATURAN.some((t) => t.kode === kode)) throw tolak(404, `Tab "${kode}" tidak ditemukan.`);
      const body = (req.body ?? {}) as { peran?: unknown };
      if (!Array.isArray(body.peran)) throw tolak(400, 'Daftar peran tidak valid.');
      const dikenal = new Set(await (await all<{ nama: string }>('SELECT nama FROM roles')).map((r) => r.nama.toLowerCase()));
      const dipilih = body.peran.filter((x) => dikenal.has(String(x).toLowerCase())).map((x) => String(x));
      const kunci = `peng.akses.${kode}`;
      const sebelum = await ((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', kunci)))?.nilai ?? '';
      await run(
        `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
         ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
        kunci,
        JSON.stringify(dipilih),
      );
      await catatAudit({
        userId: penggunaSaatIni(req).id, aksi: 'ubah', tabel: 'pengaturan', recordId: kunci,
        sebelum: { izin: sebelum }, sesudah: { izin: JSON.stringify(dipilih) },
      });
      res.json({ pesan: `Izin tab diperbarui untuk ${dipilih.length} peran.`, peran: dipilih });
    }),
  );

  return r;
}
