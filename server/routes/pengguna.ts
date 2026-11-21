// ============================================================================
// API Pengguna & Hak Akses (Tahap 1 + Tahap 2)
//
//   GET    /daftar              daftar pengguna (status, login terakhir, …)
//   POST   /                    tambah pengguna
//   PUT    /:id                 ubah pengguna
//   POST   /:id/sandi           reset password oleh Admin (tampil sekali)
//   POST   /:id/status          aktifkan / nonaktifkan
//   POST   /:id/buka            buka kunci akun
//   DELETE /:id                 hapus pengguna
//   POST   /massal              aksi massal (aktifkan/nonaktifkan/hapus/buka)
//   GET    /peran               daftar peran + matriks + hak khusus + cakupan
//   POST   /peran               tambah peran baru (Admin)
//   PUT    /peran/:id           ubah nama peran (Admin)
//   DELETE /peran/:id           hapus peran — bila tidak dipakai pengguna (Admin)
//   PUT    /matriks/:roleId     simpan matriks + hak khusus + cakupan (Admin)
//
// Aturan:
//   * Kelola pengguna: Admin ATAU peran yang diizinkan tab Pengguna.
//   * Peran & matriks: hanya sesi Admin (override header x-peran tidak berlaku).
//   * Username unik tanpa membedakan huruf besar/kecil, spasi dipangkas.
//   * Akun Admin utama tidak bisa dihapus, dan tidak bisa dinonaktifkan oleh
//     dirinya sendiri; selalu ada minimal satu Admin aktif.
//   * Semua perubahan tercatat di Log Aktivitas (siapa, kapan, sebelum/sesudah)
//     tanpa pernah menyimpan nilai password.
// ============================================================================

import { Router, type Request, type RequestHandler } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { catatAudit } from '../lib/audit.ts';
import { daftarGudangGrup, kodeGudangKanonis, petakanCakupanSimpan } from '../lib/aksesGudang.ts';
import { pastikanKolomGudang, simpanKolomGudang } from '../lib/gudangAkses.ts';
import {
  SEMUA_AKSI,
  adalahPeranAdminNama,
  adalahTopNama,
  daftarModul,
  konteksWajib,
  hashSandi,
  hapusSesiPengguna,
  sandiAcak,
  validasiSandiBaru,
  waktuSql,
} from '../lib/auth.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { izinTab } from './pengaturan.ts';
import {
  definisiMenuAwal,
  kodeMenuAwalSah,
  labelMenuAwal,
  pilihanUntukHak,
} from '../lib/menuAwal.ts';

/* ------------------------------ guard ---------------------------------- */

/** Delegasi Admin (AR1): bila aktif, Admin boleh kelola pengguna setingkat di bawahnya. */
async function delegasiAktif(): Promise<boolean> {
  try {
    const v = await ((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', 'peng.admin_delegasi')))?.nilai;
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

/** Boleh mengelola pengguna: Top (Owner/Administrator), atau Admin delegasi / peran tab Pengguna. */
const wajibKelolaPengguna: RequestHandler = async (req, res, next) => {
  const k = konteksWajib(req);
  if (k.admin) {
    next();
    return;
  }
  // Admin delegasi: peran admin non-Top yang memegang hak kelola pengguna.
  if (await delegasiAktif() && k.khusus.kelola_pengguna) {
    next();
    return;
  }
  if (await izinTab(req, 'pengguna')) {
    next();
    return;
  }
  res.status(403).json({
    ok: false,
    pesan: 'Pengelola pengguna hanya untuk Owner (atau peran yang diizinkan Owner pada tab Pengguna).',
  });
};

/** Hanya Top (Owner/Administrator, tanpa override peran) yang boleh menyentuh peran/matriks. */
const wajibAdminMatriks: RequestHandler = (req, res, next) => {
  const k = konteksWajib(req);
  if (k.admin) {
    next();
    return;
  }
  res.status(403).json({ ok: false, pesan: 'Pengaturan peran & hak akses hanya untuk Owner.' });
};

/** Jumlah akun Top (Owner/Administrator) yang aktif — AR9 tidak boleh nol. */
async function hitungTopAktif(kecualiId?: number): Promise<number> {
  try {
    return (
      await ((await get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
          WHERE lower(r.nama) IN ('owner','administrator') AND u.aktif = TRUE${kecualiId !== undefined ? ' AND u.id <> ?' : ''}`,
        ...(kecualiId !== undefined ? [kecualiId] : []),
      )))?.n ?? 0
    );
  } catch {
    return 1;
  }
}

/** Cakupan milik sesi (null = semua). Dipakai membatasi Admin delegasi. */
function cakupanMilik(req: Request): string[] | null {
  return konteksWajib(req).cakupanToko;
}

/** Pastikan cakupan yang diberikan tidak keluar dari milik sesi (non-Top saja). */
function batasiCakupanDelegasi(req: Request, cakupan: string[] | null): void {
  const k = konteksWajib(req);
  if (k.admin) return;
  const milik = cakupanMilik(req);
  if (milik === null) return;
  if (cakupan === null) throw tolak(403, 'Delegasi Admin hanya boleh memberi akses di dalam toko/gudang miliknya.');
  const luar = cakupan.filter((c) => !milik.includes(c));
  if (luar.length) throw tolak(403, `Di luar toko Anda: ${luar.join(', ')}.`);
}

/* ------------------------------ helpers -------------------------------- */

interface BarisPengguna {
  id: number;
  nama: string;
  username: string;
  email: string | null;
  wa: string | null;
  aktif: number;
  wajib_ganti: number;
  kunci_sampai: string | null;
  login_terakhir: string | null;
  peran_id: number;
  peran: string;
  cakupan_toko: string | null;
  cakupan_peran: string | null;
  toko_bawaan: string | null;
  toko_terakhir: string | null;
  mode_toko: string | null;
  periode_aktif: number | null;
  jam_dari: string | null;
  jam_sampai: string | null;
  hari_aktif: string | null;
  zona: string | null;
  login_shift: number | null;
  maks_perangkat: number | null;
  perlu_ditinjau: number | null;
  device_id: string | null;
}

function parseJsonArray(s: string | null): string[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

function irisan(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.filter((x) => b.includes(x));
}

function statusPengguna(u: BarisPengguna): 'aktif' | 'nonaktif' | 'terkunci' {
  if (u.kunci_sampai && new Date(u.kunci_sampai.replace(' ', 'T') + 'Z').getTime() > Date.now()) return 'terkunci';
  return u.aktif === 1 ? 'aktif' : 'nonaktif';
}

async function bacaPengguna(id: number): Promise<BarisPengguna> {
  // Kolom AR (027/028) dibaca defensif agar DB lama tanpa migrasi tetap jalan.
  const u = await get<Record<string, unknown>>(
    `SELECT u.*, r.id AS peran_id, r.nama AS peran, r.cakupan_toko AS cakupan_peran
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    id,
  );
  if (!u) throw tolak(404, 'Pengguna tidak ditemukan.');
  return u as unknown as BarisPengguna;
}

const USERNAME_POLA = /^[A-Za-z0-9._@-]{2,64}$/;

/* ------------------- preferensi halaman awal (global) ------------------- */
// Dulu "Halaman Awal setelah login" hanya tersimpan di localStorage sehingga
// pengaturan Admin tidak berlaku untuk pengguna/perangkat lain. Sekarang
// disimpan di tabel settings agar satu pengaturan berlaku untuk semua sesi.
const HALAMAN_SAH = ['dashboard', 'pos', 'penjualan'] as const;
type HalamanAwal = (typeof HALAMAN_SAH)[number];
const KUNCI_HALAMAN_AWAL = 'peng.halaman-awal';
const KUNCI_MODE_POS = 'peng.mode-pos';

async function bacaJsonSetting<T>(kunci: string, bawaan: T): Promise<T> {
  const mentah = await ((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', kunci)))?.nilai;
  if (!mentah) return bawaan;
  try {
    return JSON.parse(mentah) as T;
  } catch {
    return bawaan;
  }
}

async function bacaHalamanAwal(): Promise<Record<string, HalamanAwal>> {
  const mentah = await bacaJsonSetting<Record<string, unknown>>(KUNCI_HALAMAN_AWAL, {});
  const keluar: Record<string, HalamanAwal> = {};
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) return keluar;
  for (const [k, v] of Object.entries(mentah)) {
    if (typeof v === 'string' && (HALAMAN_SAH as readonly string[]).includes(v)) {
      keluar[String(k).toLowerCase()] = v as HalamanAwal;
    }
  }
  return keluar;
}

async function bacaModePos(): Promise<'foto' | 'cepat'> {
  return await bacaJsonSetting<string>(KUNCI_MODE_POS, 'cepat') === 'foto' ? 'foto' : 'cepat';
}

async function tulisSetting(kunci: string, nilai: unknown): Promise<void> {
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    kunci,
    JSON.stringify(nilai),
  );
}

async function bacaInput(body: Record<string, unknown>, ops: { perluSandi: boolean; idUbah?: number }) {
  const nama = String(body.nama ?? '').trim();
  if (!nama) throw tolak(400, 'Nama wajib diisi.');
  if (nama.length > 120) throw tolak(400, 'Nama maksimal 120 karakter.');

  const username = String(body.username ?? '').trim().replace(/\s+/g, '');
  if (!USERNAME_POLA.test(username)) {
    throw tolak(400, 'Username 2–64 karakter, hanya huruf, angka, titik, underscore, tanda minus/@.');
  }
  const kembar = await get<{ id: number }>(
    'SELECT id FROM users WHERE lower(trim(username)) = lower(?) AND id <> ?',
    username,
    ops.idUbah ?? -1,
  );
  if (kembar) throw tolak(409, `Username "${username}" sudah dipakai (tidak membedakan huruf besar/kecil).`);

  const email = String(body.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw tolak(400, 'Format email tidak valid.');
  const wa = String(body.wa ?? '').trim();
  if (wa && !/^[0-9+\-\s]{8,20}$/.test(wa)) throw tolak(400, 'No. WhatsApp tidak valid (8–20 digit).');

  const peranId = Number(body.peran_id);
  const role = await get<{ id: number; nama: string }>('SELECT id, nama FROM roles WHERE id = ?', peranId);
  if (!role) throw tolak(400, 'Peran tidak ditemukan.');

  // AS1/AS2 — unit akses = KODE GUDANG dari Master Data (warehouses.kode).
  // Terima kode maupun nama (kasus data lama); yang disimpan selalu kode.
  let cakupan = body.cakupan_toko === null || body.cakupan_toko === undefined || body.cakupan_toko === ''
    ? null
    : (Array.isArray(body.cakupan_toko) ? body.cakupan_toko.map((x) => String(x)) : [String(body.cakupan_toko)]);
  if (cakupan) {
    const peta = await petakanCakupanSimpan(cakupan);
    if (peta.asing.length) throw tolak(400, `Gudang tidak dikenal di Master Data: ${peta.asing.join(', ')}.`);
    cakupan = peta.kode;
  }

  // AR4 — User ID (username) tidak bisa diubah setelah dibuat.
  if (ops.idUbah !== undefined) {
    const lamaUser = await get<{ username: string }>('SELECT username FROM users WHERE id = ?', ops.idUbah);
    if (lamaUser && lamaUser.username.toLowerCase().trim() !== username.toLowerCase()) {
      throw tolak(400, 'User ID tidak bisa diubah setelah dibuat. Buat akun baru bila perlu ID lain.');
    }
  }

  const sandi = String(body.sandi ?? '');
  const wajibGanti = body.wajib_ganti === true || body.wajib_ganti === 'true' || body.wajib_ganti === 1;
  if (ops.perluSandi) {
    if (!sandi) throw tolak(400, 'Password awal wajib diisi.');
    const salah = await validasiSandiBaru(sandi);
    if (salah) throw tolak(400, salah);
  } else if (sandi) {
    const salah = await validasiSandiBaru(sandi);
    if (salah) throw tolak(400, salah);
  }

  // AR4/AS2 — akses gudang + bawaan + mode login. Bawaan hanya dari yang dicentang.
  // Terima kode maupun nama gudang; yang disimpan selalu kode.
  let tokoBawaan: string | null = String(body.toko_bawaan ?? '').trim() || null;
  if (tokoBawaan) {
    const kanonisBawaan = await kodeGudangKanonis(tokoBawaan);
    if (!kanonisBawaan) throw tolak(400, `Gudang bawaan tidak dikenal di Master Data: ${tokoBawaan}.`);
    tokoBawaan = kanonisBawaan;
  }
  if (tokoBawaan && (!cakupan || !cakupan.includes(tokoBawaan))) {
    throw tolak(400, 'Gudang bawaan harus salah satu gudang yang dicentang.');
  }
  // AS2 — pengguna biasa wajib eksplisit ≥1 gudang; Owner (semua gudang) boleh kosong.
  if (!adalahTopNama(role.nama) && (!cakupan || cakupan.length === 0)) {
    throw tolak(400, 'Pilih minimal satu gudang.');
  }
  // WI2 — kunci pilihan gudang di form transaksi (user tidak boleh ganti).
  const terkunciGudang =
    body.is_warehouse_locked === true ||
    body.is_warehouse_locked === 'true' ||
    body.is_warehouse_locked === 1;
  const modeToko = String(body.mode_toko ?? 'terbatas');
  if (modeToko !== 'terbatas' && modeToko !== 'pilih') throw tolak(400, 'Mode login toko harus "terbatas" atau "pilih".');

  // AR4/AR7 — pembatasan login.
  const periodeAktif = body.periode_aktif === true || body.periode_aktif === 'true' || body.periode_aktif === 1 ? 1 : 0;
  const jamDari = String(body.jam_dari ?? '').trim() || null;
  const jamSampai = String(body.jam_sampai ?? '').trim() || null;
  const polajam = /^(\d{1,2}):(\d{2})$/;
  if (jamDari && !polajam.test(jamDari)) throw tolak(400, 'Jam Dari harus HH:MM (mis. 08:00).');
  if (jamSampai && !polajam.test(jamSampai)) throw tolak(400, 'Jam Sampai harus HH:MM (mis. 17:00).');
  if (periodeAktif && (!jamDari || !jamSampai)) throw tolak(400, 'Aktifkan periode login wajib diisi Jam Dari dan Jam Sampai.');
  let hariAktif: string | null = null;
  if (body.hari_aktif !== undefined && body.hari_aktif !== null && body.hari_aktif !== '') {
    const arr = Array.isArray(body.hari_aktif) ? body.hari_aktif.map((x) => String(x)) : [String(body.hari_aktif)];
    hariAktif = JSON.stringify(arr);
  }
  const zona = String(body.zona ?? 'Asia/Jakarta').trim() || 'Asia/Jakarta';
  const loginShift = body.login_shift === true || body.login_shift === 'true' || body.login_shift === 1 ? 1 : 0;
  const maksPerangkat = Number(body.maks_perangkat ?? 0);
  if (!Number.isFinite(maksPerangkat) || maksPerangkat < 0 || maksPerangkat > 99) {
    throw tolak(400, 'Maks perangkat 0–99 (0 = tanpa batas).');
  }
  // Templat klasik — Device id notifikasi WA (bebas, maks 64 karakter).
  const deviceId = String(body.device_id ?? '').trim() || null;
  if (deviceId && deviceId.length > 64) throw tolak(400, 'Device id maksimal 64 karakter.');

  return { nama, username, email: email || null, wa: wa || null, peranId: role.id, peranNama: role.nama, cakupan, sandi, wajibGanti, tokoBawaan, terkunciGudang, modeToko, periodeAktif, jamDari, jamSampai, hariAktif, zona, loginShift, maksPerangkat: Math.trunc(maksPerangkat), deviceId };
}

/** AR9 — proteksi Top (Owner/Administrator): hanya Top yang boleh ubah sesama Top. */
async function larangHapus(req: Request, target: BarisPengguna): Promise<void> {
  const k = konteksWajib(req);
  if (adalahTopNama(target.peran)) {
    if (!k.admin) throw tolak(403, 'Hanya Owner yang boleh menghapus akun Owner/Admin.');
    if (await hitungTopAktif(target.id) < 1) {
      throw tolak(400, 'Owner terakhir tidak bisa dihapus. Tunjuk Owner lain dulu.');
    }
  }
  if (target.id === k.userId) throw tolak(400, 'Anda tidak bisa menghapus akun sendiri.');
}

async function larangStatus(req: Request, target: BarisPengguna, aktif: boolean): Promise<void> {
  const k = konteksWajib(req);
  const isTopTarget = adalahTopNama(target.peran);
  if (isTopTarget && !k.admin) throw tolak(403, 'Hanya Owner yang boleh mengubah status akun Owner/Admin.');
  if (!aktif) {
    if (target.id === k.userId) {
      throw tolak(
        400,
        isTopTarget
          ? 'Akun Owner utama tidak bisa dinonaktifkan oleh dirinya sendiri.'
          : 'Anda tidak bisa menonaktifkan akun sendiri.',
      );
    }
    if (isTopTarget && await hitungTopAktif(target.id) < 1) {
      throw tolak(400, 'Harus ada minimal satu Owner aktif.');
    }
  }
}

/** AR9 — pengguna tidak boleh mengubah hak aksesnya sendiri (peran/cakupan/periode). */
function larangUbahDiri(req: Request, targetId: number, berubah: { peran: boolean; cakupan: boolean; periode: boolean }): void {
  const k = konteksWajib(req);
  if (targetId !== k.userId) return;
  if (berubah.peran || berubah.cakupan || berubah.periode) {
    throw tolak(400, 'Anda tidak boleh mengubah hak akses sendiri. Minta Owner lain yang mengubah.');
  }
}

async function hapusBarisPengguna(id: number): Promise<void> {
  try {
    await withTransaction(async () => {
      // Audit tetap ada tapi kehilangan tautan ke baris pengguna yang dihapus
      // (ON DELETE tidak disediakan kolom user_id) — agar penghapusan tetap jalan.
      await run('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', id);
      await run('DELETE FROM users WHERE id = ?', id);
    });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/FOREIGN KEY/i.test(pesan)) {
      throw tolak(
        409,
        'Pengguna masih memiliki riwayat data (transaksi/dokumen). Gunakan aksi "Nonaktifkan" sebagai gantinya.',
      );
    }
    throw e;
  }
}

/* --------------------------- matriks & peran ---------------------------- */

async function flatHak(roleId: number): Promise<Record<string, string>> {
  const rows = await all<{ menu: string; aksi: string }>('SELECT menu, aksi FROM role_permissions WHERE role_id = ?', roleId);
  const keluar: Record<string, string> = {};
  for (const m of daftarModul()) keluar[m] = '';
  for (const r of rows) keluar[r.menu] = keluar[r.menu] ? `${keluar[r.menu]},${r.aksi}` : r.aksi;
  return keluar;
}

interface BarisKhusus {
  lihat_hpp: number;
  ubah_harga_kasir: number;
  diskon_maks: number;
  hapus_transaksi: number;
  proses_tahunan: number;
  void_retur: number;
  buka_tutup_shift: number;
  lihat_laba: number;
  ubah_stok_manual: number;
  sahkan_opname: number;
  hapus_massal: number;
  kelola_pengguna: number;
  ubah_pengaturan: number;
  akses_semua_toko: number;
}

const KHUSUS_BARU: (keyof BarisKhusus)[] = [
  'void_retur', 'buka_tutup_shift', 'lihat_laba', 'ubah_stok_manual', 'sahkan_opname',
  'hapus_massal', 'kelola_pengguna', 'ubah_pengaturan', 'akses_semua_toko',
];

function khususBaris(admin: boolean, r?: Record<string, unknown>): BarisKhusus {
  const num = (k: string, d: number): number => {
    const v = r?.[k];
    return typeof v === 'number' ? v : d;
  };
  if (admin) {
    return {
      lihat_hpp: 1, ubah_harga_kasir: 1, diskon_maks: num('diskon_maks', 100), hapus_transaksi: 1,
      proses_tahunan: 1, void_retur: 1, buka_tutup_shift: 1, lihat_laba: 1, ubah_stok_manual: 1,
      sahkan_opname: 1, hapus_massal: 1, kelola_pengguna: 1, ubah_pengaturan: 1, akses_semua_toko: 1,
    };
  }
  return {
    lihat_hpp: num('lihat_hpp', 0), ubah_harga_kasir: num('ubah_harga_kasir', 0),
    diskon_maks: num('diskon_maks', 0), hapus_transaksi: num('hapus_transaksi', 0),
    proses_tahunan: num('proses_tahunan', 0), void_retur: num('void_retur', 0),
    buka_tutup_shift: num('buka_tutup_shift', 0), lihat_laba: num('lihat_laba', 0),
    ubah_stok_manual: num('ubah_stok_manual', 0), sahkan_opname: num('sahkan_opname', 0),
    hapus_massal: num('hapus_massal', 0), kelola_pengguna: num('kelola_pengguna', 0),
    ubah_pengaturan: num('ubah_pengaturan', 0), akses_semua_toko: num('akses_semua_toko', 0),
  };
}

async function bacaKhusus(roleId: number, admin: boolean): Promise<BarisKhusus> {
  let r: Record<string, unknown> | undefined;
  try {
    r = (await get<Record<string, unknown>>('SELECT * FROM role_hak_khusus WHERE role_id = ?', roleId));
  } catch {
    r = undefined;
  }
  if (!r) return khususBaris(admin);
  return khususBaris(admin, r);
}

function validasiHak(body: Record<string, unknown>): { menu: string; aksi: string }[] {
  const hak = body.hak;
  if (!hak || typeof hak !== 'object' || Array.isArray(hak)) throw tolak(400, 'Matriks hak akses tidak valid.');
  const modul = daftarModul();
  const aksiDiizinkan = SEMUA_AKSI as readonly string[];
  const keluar: { menu: string; aksi: string }[] = [];
  for (const [menu, daftar] of Object.entries(hak as Record<string, unknown>)) {
    if (!modul.includes(menu)) throw tolak(400, `Modul tidak dikenal: ${menu}.`);
    if (!Array.isArray(daftar)) throw tolak(400, `Isi matriks untuk ${menu} tidak valid.`);
    const unik = [...new Set(daftar.map((x) => String(x)))];
    for (const a of unik) {
      if (!aksiDiizinkan.includes(a)) throw tolak(400, `Aksi tidak dikenal: ${a}.`);
      keluar.push({ menu, aksi: a });
    }
  }
  return keluar;
}

/* ------------------- AY: menu awal setelah login ---------------------- */

/** Baca menu_awal peran secara defensif (kolom 034). */
async function bacaMenuAwal(roleId: number): Promise<string | null> {
  try {
    const v = await ((await get<{ menu_awal: string | null }>('SELECT menu_awal FROM roles WHERE id = ?', roleId)))?.menu_awal ?? null;
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

/** Kumpulan modul yang sel Lihat-nya dimiliki peran (Top = semua). */
async function modulTerlihat(roleId: number, peranTop: boolean): Promise<Set<string>> {
  if (peranTop) {
    const semua = new Set<string>();
    try {
      for (const m of daftarModul()) semua.add(m);
    } catch {
      /* abaikan */
    }
    return semua;
  }
  const lihat = new Set<string>();
  try {
    const rows = await all<{ menu: string }>(
      'SELECT DISTINCT menu FROM role_permissions WHERE role_id = ? AND aksi = ?',
      roleId,
      'lihat',
    );
    for (const r of rows) lihat.add(r.menu);
  } catch {
    /* DB lama — pilihan kosong, validasi menolak */
  }
  return lihat;
}

/**
 * Validasi + simpan menu awal peran. Kode kosong/null = fallback otomatis.
 * Kode wajib dikenal dan halamannya wajib boleh dilihat peran itu
 * (Top bebas). Mencatat audit (peran, lama, baru, pelaku).
 */
async function simpanMenuAwal(roleId: number, peranTop: boolean, kode: unknown, pelakuId: number, peranNama: string): Promise<string | null> {
  const mentah = typeof kode === 'string' ? kode.trim() : '';
  const lama = await bacaMenuAwal(roleId);
  if (mentah === '' || mentah === '-') {
    await run('UPDATE roles SET menu_awal = NULL WHERE id = ?', roleId);
    if (lama !== null) {
      await catatAudit({
        userId: pelakuId, aksi: 'ubah', tabel: 'roles', recordId: roleId,
        sebelum: { menu_awal: lama }, sesudah: { menu_awal: null },
        alasan: `Menu awal peran "${peranNama}" dikembalikan ke otomatis`,
      });
    }
    return null;
  }
  if (!kodeMenuAwalSah(mentah)) throw tolak(400, `Menu awal "${mentah}" tidak dikenal.`);
  const def = definisiMenuAwal(mentah)!;
  if (!peranTop && def.modul !== null && !(await modulTerlihat(roleId, false)).has(def.modul)) {
    throw tolak(400, `Halaman "${def.label}" tidak boleh dilihat peran ini (sel Lihat belum dicentang). Pilih halaman lain atau centang Lihat dulu.`);
  }
  await run('UPDATE roles SET menu_awal = ? WHERE id = ?', mentah, roleId);
  if (lama !== mentah) {
    await catatAudit({
      userId: pelakuId, aksi: 'ubah', tabel: 'roles', recordId: roleId,
      sebelum: { menu_awal: lama }, sesudah: { menu_awal: mentah },
      alasan: `Menu awal peran "${peranNama}" diubah`,
    });
  }
  return mentah;
}

/** Guard AY1: Top ATAU peran berizin Ubah pada modul Pengaturan. */
function bolehUbahMenuAwal(k: { admin: boolean; hak: Record<string, string[]> }): boolean {
  if (k.admin) return true;
  return (k.hak['pengaturan'] ?? []).includes('ubah');
}

/* ------------------------------- router -------------------------------- */

export function routerPengguna(): Router {
  const r = Router();

  /* ------------------------- DAFTAR PENGGUNA --------------------------- */

  r.get(
    '/daftar',
    wajibKelolaPengguna,
    asyncHandler(async (_req, res) => {
      await pastikanKolomGudang();
      const rows = await all<Record<string, unknown>>(
        `SELECT u.*, r.id AS peran_id, r.nama AS peran, r.cakupan_toko AS cakupan_peran,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS jumlah_sesi
           FROM users u JOIN roles r ON r.id = u.role_id
          ORDER BY u.nama`,
      );
      const keBaris = (x: Record<string, unknown>): BarisPengguna => ({
        id: Number(x.id), nama: String(x.nama ?? ''), username: String(x.username ?? ''),
        email: (x.email as string | null) ?? null, wa: (x.wa as string | null) ?? null,
        aktif: Number(x.aktif ?? 1), wajib_ganti: Number(x.wajib_ganti ?? 0),
        kunci_sampai: (x.kunci_sampai as string | null) ?? null,
        login_terakhir: (x.login_terakhir as string | null) ?? null,
        peran_id: Number(x.peran_id), peran: String(x.peran ?? ''),
        cakupan_toko: (x.cakupan_toko as string | null) ?? null,
        cakupan_peran: (x.cakupan_peran as string | null) ?? null,
        toko_bawaan: (x.toko_bawaan as string | null) ?? null,
        toko_terakhir: (x.toko_terakhir as string | null) ?? null,
        mode_toko: (x.mode_toko as string | null) ?? 'terbatas',
        periode_aktif: x.periode_aktif === undefined ? 0 : Number(x.periode_aktif ?? 0),
        jam_dari: (x.jam_dari as string | null) ?? null, jam_sampai: (x.jam_sampai as string | null) ?? null,
        hari_aktif: (x.hari_aktif as string | null) ?? null, zona: (x.zona as string | null) ?? null,
        login_shift: x.login_shift === undefined ? 0 : Number(x.login_shift ?? 0),
        maks_perangkat: x.maks_perangkat === undefined ? 0 : Number(x.maks_perangkat ?? 0),
        perlu_ditinjau: x.perlu_ditinjau === undefined ? 0 : Number(x.perlu_ditinjau ?? 0),
        device_id: (x.device_id as string | null) ?? null,
      });
      res.json({
        data: rows.map((x) => {
          const u = keBaris(x);
          return {
            id: u.id, nama: u.nama, username: u.username, email: u.email, wa: u.wa,
            peran_id: u.peran_id, peran: u.peran,
            cakupan_toko: parseJsonArray(u.cakupan_toko),
            cakupan_efektif: irisan(parseJsonArray(u.cakupan_toko), parseJsonArray(u.cakupan_peran)),
            status: statusPengguna(u), kunci_sampai: u.kunci_sampai, login_terakhir: u.login_terakhir,
            wajib_ganti: u.wajib_ganti === 1,
            admin_utama: adalahTopNama(u.peran) && u.username.toLowerCase() === 'admin',
            top: adalahTopNama(u.peran),
            toko_bawaan: u.toko_bawaan, toko_terakhir: u.toko_terakhir, mode_toko: u.mode_toko ?? 'terbatas',
            // WI2 — gudang default + kunci pilihan gudang (form transaksi).
            default_warehouse_id: Number((x as Record<string, unknown>).default_warehouse_id ?? 0) || null,
            is_warehouse_locked: Number((x as Record<string, unknown>).is_warehouse_locked ?? 0) === 1,
            periode_aktif: (u.periode_aktif ?? 0) === 1, jam_dari: u.jam_dari, jam_sampai: u.jam_sampai,
            hari_aktif: parseJsonArray(u.hari_aktif) ?? [], zona: u.zona ?? 'Asia/Jakarta',
            login_shift: (u.login_shift ?? 0) === 1, maks_perangkat: u.maks_perangkat ?? 0,
            perlu_ditinjau: (u.perlu_ditinjau ?? 0) === 1,
            device_id: u.device_id ?? null,
            jumlah_sesi: Number((x as { jumlah_sesi: number }).jumlah_sesi) || 0,
          };
        }),
        peran: await await Promise.all((await all<{ id: number; nama: string }>('SELECT id, nama FROM roles ORDER BY nama')).map(async (r) => ({
          // AY — keterangan menu awal peran (baca-saja di badge peran).
          id: r.id, nama: r.nama, top: adalahTopNama(r.nama), menuAwalLabel: labelMenuAwal(await bacaMenuAwal(r.id)),
        }))),
        // AS1 — filter & massal pakai kode GUDANG dari Master Data (warehouses).
        toko: await all('SELECT kode, nama FROM warehouses ORDER BY nama'),
        delegasi: await delegasiAktif(),
      });
    }),
  );

  /* ------------------------------ TAMBAH -------------------------------- */

  r.post(
    '/',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const b = await bacaInput((req.body ?? {}) as Record<string, unknown>, { perluSandi: true });
      if (adalahTopNama(b.peranNama) && !k.admin) {
        throw tolak(403, 'Hanya Owner yang boleh membuat akun Owner/Admin.');
      }
      batasiCakupanDelegasi(req, b.cakupan);
      // WI2 — kolom gudang dipastikan SEBELUM transaksi (ALTER yang gagal
      // membatalkan transaksi PostgreSQL).
      await pastikanKolomGudang();
      const id = await withTransaction(async () => {
        const hasil = await run(
          `INSERT INTO users (nama, username, email, wa, password_hash, role_id, cakupan_toko, wajib_ganti, sandi_diubah_pada,
            toko_bawaan, mode_toko, periode_aktif, jam_dari, jam_sampai, hari_aktif, zona, login_shift, maks_perangkat, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          b.nama,
          b.username,
          b.email,
          b.wa,
          hashSandi(b.sandi),
          b.peranId,
          b.cakupan ? JSON.stringify(b.cakupan) : null,
          b.wajibGanti ? 1 : 0,
          waktuSql(),
          b.tokoBawaan, b.modeToko, b.periodeAktif, b.jamDari, b.jamSampai, b.hariAktif, b.zona, b.loginShift, b.maksPerangkat, b.deviceId,
        );
        const idBaru = Number(hasil.lastInsertRowid);
        await simpanKolomGudang('users', idBaru, b.cakupan, b.tokoBawaan, b.terkunciGudang);
        await catatAudit({
          userId: k.userId,
          aksi: 'tambah',
          tabel: 'users',
          recordId: idBaru,
          sesudah: {
            nama: b.nama,
            username: b.username,
            email: b.email,
            wa: b.wa,
            peran_id: b.peranId,
            cakupan_toko: b.cakupan,
            wajib_ganti: b.wajibGanti,
            toko_bawaan: b.tokoBawaan, mode_toko: b.modeToko,
            is_warehouse_locked: b.terkunciGudang,
            periode_aktif: b.periodeAktif, jam: `${b.jamDari ?? ''}-${b.jamSampai ?? ''}`,
            login_shift: b.loginShift, maks_perangkat: b.maksPerangkat, device_id: b.deviceId,
          },
          alasan: 'Tambah pengguna',
        });
        return idBaru;
      });
      res.status(201).json({ id, pesan: `Pengguna "${b.nama}" ditambahkan.` });
    }),
  );

  /* ------------------- HALAMAN AWAL & MODE POS (globals) ---------------- */

  // Semua pengguna boleh membaca (mode POS bawaan + kompatibilitas baca).
  // AY — halaman awal per peran sudah pindah ke kolom roles.menu_awal
  // (diatur di Matriks Peran); kunci settings lama 'peng.halaman-awal'
  // dihapus migrasi 034 sehingga `halaman` selalu kosong.
  r.get(
    '/halaman-awal',
    asyncHandler(async (_req, res) => {
      res.json({ halaman: await bacaHalamanAwal(), mode_pos: await bacaModePos() });
    }),
  );

  // Hanya Admin yang boleh mengubah mode POS bawaan.
  r.put(
    '/halaman-awal',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const body = (req.body ?? {}) as { halaman?: unknown; mode_pos?: unknown };
      // Kompatibilitas: objek kosong (hasil baca baru) diabaikan; isian
      // berisi ditolak dengan arahan ke Matriks Peran.
      const kunciHalaman = body.halaman !== undefined && body.halaman !== null && typeof body.halaman === 'object' && !Array.isArray(body.halaman)
        ? Object.keys(body.halaman as Record<string, unknown>)
        : null;
      if (kunciHalaman === null && body.halaman !== undefined) {
        throw tolak(400, 'Daftar halaman awal tidak valid. Atur lewat Matriks Peran (isian "Menu awal setelah login").');
      }
      if (kunciHalaman !== null && kunciHalaman.length > 0) {
        throw tolak(410, 'Pengaturan halaman awal per peran sudah pindah ke Pengaturan ▸ Pengguna & Hak Akses ▸ Matriks Peran (isian "Menu awal setelah login" pada tiap peran).');
      }
      const sebelum = await bacaModePos();
      const mode = body.mode_pos === undefined ? sebelum : String(body.mode_pos);
      if (mode !== 'foto' && mode !== 'cepat') throw tolak(400, 'Mode POS harus "foto" atau "cepat".');

      await withTransaction(async () => {
        await tulisSetting(KUNCI_MODE_POS, mode);
      });
      await catatAudit({
        userId: k.userId,
        aksi: 'ubah',
        tabel: 'pengaturan',
        recordId: KUNCI_MODE_POS,
        sebelum: { mode_pos: sebelum },
        sesudah: { mode_pos: mode },
        alasan: 'Mode POS bawaan',
      });

      res.json({ pesan: 'Mode POS bawaan disimpan untuk semua pengguna.', halaman: {}, mode_pos: mode });
    }),
  );

  /* ------------------------------- UBAH --------------------------------- */

  r.put(
    '/:id',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const lama = await bacaPengguna(id);
      if (adalahTopNama(lama.peran) && !k.admin) {
        throw tolak(403, 'Hanya Owner yang boleh mengubah akun Owner/Admin.');
      }
      const b = await bacaInput((req.body ?? {}) as Record<string, unknown>, { perluSandi: false, idUbah: id });
      if (adalahTopNama(lama.peran) && b.peranId !== lama.peran_id && lama.username.toLowerCase() === 'admin') {
        throw tolak(400, 'Peran akun Admin utama tidak bisa diubah.');
      }
      // AR9 — Owner terakhir tidak boleh diturunkan perannya.
      if (adalahTopNama(lama.peran) && !adalahTopNama(b.peranNama) && await hitungTopAktif(id) < 1) {
        throw tolak(400, 'Owner terakhir tidak bisa diturunkan perannya. Tunjuk Owner lain dulu.');
      }
      const gantiPeran = b.peranId !== lama.peran_id;
      // Celah eskalasi: hanya Owner yang boleh memberi peran Top.
      if (!k.admin && gantiPeran && adalahTopNama(b.peranNama)) {
        throw tolak(403, 'Hanya Owner yang boleh memberikan peran Owner/Admin.');
      }
      batasiCakupanDelegasi(req, b.cakupan);
      // AR9 — tidak boleh mengubah hak akses sendiri.
      larangUbahDiri(req, id, {
        peran: gantiPeran,
        cakupan: JSON.stringify(parseJsonArray(lama.cakupan_toko) ?? null) !== JSON.stringify(b.cakupan),
        periode: Number(lama.periode_aktif ?? 0) !== b.periodeAktif || (lama.jam_dari ?? null) !== b.jamDari || (lama.jam_sampai ?? null) !== b.jamSampai,
      });

      // PG: pernyataan gagal membatalkan seluruh transaksi — pastikan kolom
      // 030 & kolom gudang ada SEBELUM transaksi dimulai.
      await pastikanKolomGudang();
      try { await run('ALTER TABLE users ADD COLUMN device_id TEXT'); } catch { /* kolom 030 sudah ada */ }
      await withTransaction(async () => {
        await run(
          `UPDATE users SET nama = ?, email = ?, wa = ?, role_id = ?, cakupan_toko = ?,
                            wajib_ganti = ?, diubah_pada = ?, toko_bawaan = ?, mode_toko = ?,
                            periode_aktif = ?, jam_dari = ?, jam_sampai = ?, hari_aktif = ?,
                            zona = ?, login_shift = ?, maks_perangkat = ?, perlu_ditinjau = FALSE, device_id = ?
            WHERE id = ?`,
          b.nama,
          b.email,
          b.wa,
          b.peranId,
          b.cakupan ? JSON.stringify(b.cakupan) : null,
          b.wajibGanti ? 1 : 0,
          waktuSql(),
          b.tokoBawaan, b.modeToko, b.periodeAktif, b.jamDari, b.jamSampai, b.hariAktif,
          b.zona, b.loginShift, b.maksPerangkat, b.deviceId,
          id,
        );
        await simpanKolomGudang('users', id, b.cakupan, b.tokoBawaan, b.terkunciGudang);
        if (gantiPeran) await hapusSesiPengguna(id);
        const sesudah: Record<string, unknown> = {
          nama: b.nama,
          email: b.email,
          wa: b.wa,
          peran_id: b.peranId,
          cakupan_toko: b.cakupan,
          wajib_ganti: b.wajibGanti,
          toko_bawaan: b.tokoBawaan, mode_toko: b.modeToko,
          is_warehouse_locked: b.terkunciGudang,
          periode_aktif: b.periodeAktif, jam_dari: b.jamDari, jam_sampai: b.jamSampai,
          login_shift: b.loginShift, maks_perangkat: b.maksPerangkat, device_id: b.deviceId,
        };
        if (b.sandi) sesudah.password_baru = '(diubah oleh Admin)';
        await catatAudit({
          userId: k.userId,
          aksi: 'ubah',
          tabel: 'users',
          recordId: id,
          sebelum: {
            nama: lama.nama,
            username: lama.username,
            email: lama.email,
            wa: lama.wa,
            peran_id: lama.peran_id,
            cakupan_toko: parseJsonArray(lama.cakupan_toko),
            wajib_ganti: lama.wajib_ganti === 1,
          },
          sesudah,
          alasan: gantiPeran ? 'Ubah pengguna — peran diganti, seluruh sesi lama ditutup' : 'Ubah pengguna',
        });
        if (b.sandi) {
          await run(
            'UPDATE users SET password_hash = ?, sandi_diubah_pada = ? WHERE id = ?',
            hashSandi(b.sandi),
            waktuSql(),
            id,
          );
          await hapusSesiPengguna(id);
        }
      });
      res.json({ pesan: `Pengguna "${b.nama}" diperbarui.` });
    }),
  );

  /* --------------------- RESET PASSWORD OLEH ADMIN ---------------------- */

  r.post(
    '/:id/sandi',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const u = await bacaPengguna(id);
      if (adalahTopNama(u.peran) && !k.admin) {
        throw tolak(403, 'Hanya Owner yang boleh mereset password akun Owner/Admin.');
      }
      const sandi = sandiAcak();
      await withTransaction(async () => {
        await run(
          'UPDATE users SET password_hash = ?, wajib_ganti = TRUE, sandi_diubah_pada = ?, gagal = 0, kunci_sampai = NULL WHERE id = ?',
          hashSandi(sandi),
          waktuSql(),
          id,
        );
        await hapusSesiPengguna(id);
        await catatAudit({
          userId: k.userId,
          aksi: 'ubah',
          tabel: 'users',
          recordId: id,
          sebelum: { wajib_ganti: u.wajib_ganti === 1 },
          sesudah: { wajib_ganti: true },
          alasan: 'Reset password oleh Admin — password sementara acak, wajib ganti saat login berikutnya',
        });
      });
      res.json({
        sandi, // tampil SEKALI di layar admin; tidak pernah disimpan sebagai teks.
        pesan: `Password sementara untuk "${u.nama}" (catat sekarang — hanya tampil sekali). Akun ditandai wajib ganti password saat login berikutnya, dan semua sesi lama ikut dikeluarkan.`,
      });
    }),
  );

  /* ------------------------ AKTIF / NONAKTIF / BUKA -------------------- */

  r.post(
    '/:id/status',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const u = await bacaPengguna(id);
      const aktif = (req.body as { aktif?: unknown })?.aktif === true || (req.body as { aktif?: unknown })?.aktif === 1 || (req.body as { aktif?: unknown })?.aktif === 'true';
      await larangStatus(req, u, aktif);
      await withTransaction(async () => {
        await run('UPDATE users SET aktif = ?, diubah_pada = ? WHERE id = ?', aktif ? 1 : 0, waktuSql(), id);
        if (!aktif) await hapusSesiPengguna(id);
        await catatAudit({
          userId: k.userId,
          aksi: aktif ? 'aktifkan' : 'nonaktifkan',
          tabel: 'users',
          recordId: id,
          sebelum: { aktif: u.aktif === 1 },
          sesudah: { aktif },
          alasan: aktif ? 'Aktifkan pengguna' : 'Nonaktifkan pengguna',
        });
      });
      res.json({ pesan: `Pengguna "${u.nama}" ${aktif ? 'diaktifkan' : 'dinonaktifkan'}${aktif ? '' : ' dan sesinya dikeluarkan'}.` });
    }),
  );

  r.post(
    '/:id/buka',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const u = await bacaPengguna(id);
      await withTransaction(async () => {
        await run('UPDATE users SET kunci_sampai = NULL, gagal = 0, diubah_pada = ? WHERE id = ?', waktuSql(), id);
        await catatAudit({
          userId: k.userId,
          aksi: 'ubah',
          tabel: 'users',
          recordId: id,
          sebelum: { kunci_sampai: u.kunci_sampai },
          sesudah: { kunci_sampai: null },
          alasan: 'Buka kunci akun',
        });
      });
      res.json({ pesan: `Kunci akun "${u.nama}" dibuka — percobaan masuk dihitung ulang.` });
    }),
  );

  /* ------------------------------- HAPUS -------------------------------- */

  r.delete(
    '/:id',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const u = await bacaPengguna(id);
      await larangHapus(req, u);
      await hapusBarisPengguna(id);
      await catatAudit({
        userId: k.userId,
        aksi: 'hapus',
        tabel: 'users',
        recordId: id,
        sebelum: { nama: u.nama, username: u.username, peran: u.peran },
        alasan: 'Hapus pengguna',
      });
      res.json({ pesan: `Pengguna "${u.nama}" dihapus.` });
    }),
  );

  /* ---------------------------- AKSI MASSAL ----------------------------- */

  r.post(
    '/massal',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const b = (req.body ?? {}) as { aksi?: unknown; ids?: unknown; peran_id?: unknown; cakupan_toko?: unknown };
      const aksi = String(b.aksi ?? '');
      const ids = Array.isArray(b.ids) ? b.ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [];
      if (!ids.length) throw tolak(400, 'Pilih minimal satu pengguna.');
      if (!['aktifkan', 'nonaktifkan', 'hapus', 'buka', 'pindah', 'akses'].includes(aksi)) {
        throw tolak(400, 'Aksi massal tidak dikenal.');
      }
      // AR3 — pindahkan kelompok / atur akses massal.
      let peranMassal: { id: number; nama: string } | null = null;
      if (aksi === 'pindah') {
        const pid = Number(b.peran_id);
        peranMassal = (await get<{ id: number; nama: string }>('SELECT id, nama FROM roles WHERE id = ?', pid)) ?? null;
        if (!peranMassal) throw tolak(400, 'Kelompok tujuan tidak ditemukan.');
        if (adalahTopNama(peranMassal.nama) && !k.admin) throw tolak(403, 'Hanya Owner yang boleh memindahkan ke Owner/Admin.');
      }
      let cakupanMassal: string[] | null = null;
      if (aksi === 'akses') {
        cakupanMassal = b.cakupan_toko === null || b.cakupan_toko === undefined || b.cakupan_toko === ''
          ? null
          : (Array.isArray(b.cakupan_toko) ? b.cakupan_toko.map((x) => String(x)) : [String(b.cakupan_toko)]);
        if (cakupanMassal) {
          const ada = new Set(await (await all<{ kode: string }>('SELECT kode FROM warehouses')).map((s) => s.kode));
          const asing = cakupanMassal.filter((c) => !ada.has(c));
          if (asing.length) throw tolak(400, `Gudang tidak dikenal di Master Data: ${asing.join(', ')}.`);
        }
        batasiCakupanDelegasi(req, cakupanMassal);
      }

      const hasil: string[] = [];
      for (const id of ids) {
        const u = await bacaPengguna(id);
        if (aksi === 'hapus') {
          await larangHapus(req, u);
          await hapusBarisPengguna(id);
          await catatAudit({ userId: k.userId, aksi: 'hapus', tabel: 'users', recordId: id, sebelum: { nama: u.nama, username: u.username, peran: u.peran }, alasan: 'Hapus pengguna (massal)' });
          hasil.push(u.nama);
          continue;
        }
        if (aksi === 'buka') {
          await run('UPDATE users SET kunci_sampai = NULL, gagal = 0 WHERE id = ?', id);
          await catatAudit({ userId: k.userId, aksi: 'ubah', tabel: 'users', recordId: id, sebelum: { kunci_sampai: u.kunci_sampai }, sesudah: { kunci_sampai: null }, alasan: 'Buka kunci akun (massal)' });
          hasil.push(u.nama);
          continue;
        }
        if (aksi === 'pindah' && peranMassal) {
          if (adalahTopNama(u.peran) && !k.admin) throw tolak(403, `Hanya Owner yang boleh memindahkan "${u.nama}".`);
          if (u.id === k.userId) throw tolak(400, 'Anda tidak boleh memindahkan kelompok sendiri secara massal.');
          if (adalahTopNama(u.peran) && !adalahTopNama(peranMassal.nama) && await hitungTopAktif(u.id) < 1) {
            throw tolak(400, 'Owner terakhir tidak bisa dipindahkan ke peran lain.');
          }
          await run('UPDATE users SET role_id = ?, diubah_pada = ? WHERE id = ?', peranMassal.id, waktuSql(), id);
          await hapusSesiPengguna(id);
          await catatAudit({ userId: k.userId, aksi: 'ubah', tabel: 'users', recordId: id, sebelum: { peran: u.peran }, sesudah: { peran: peranMassal.nama }, alasan: 'Pindahkan kelompok (massal) — sesi ditutup' });
          hasil.push(u.nama);
          continue;
        }
        if (aksi === 'akses') {
          if (adalahTopNama(u.peran) && !k.admin) throw tolak(403, `Hanya Owner yang boleh mengubah akses "${u.nama}".`);
          larangUbahDiri(req, id, { peran: false, cakupan: true, periode: false });
          await run('UPDATE users SET cakupan_toko = ?, perlu_ditinjau = FALSE, diubah_pada = ? WHERE id = ?', cakupanMassal ? JSON.stringify(cakupanMassal) : null, waktuSql(), id);
          await catatAudit({ userId: k.userId, aksi: 'ubah', tabel: 'users', recordId: id, sebelum: { cakupan_toko: parseJsonArray(u.cakupan_toko) }, sesudah: { cakupan_toko: cakupanMassal }, alasan: 'Atur akses toko/gudang (massal)' });
          hasil.push(u.nama);
          continue;
        }
        const aktif = aksi === 'aktifkan';
        await larangStatus(req, u, aktif);
        await run('UPDATE users SET aktif = ? WHERE id = ?', aktif ? 1 : 0, id);
        if (!aktif) await hapusSesiPengguna(id);
        await catatAudit({ userId: k.userId, aksi: aktif ? 'aktifkan' : 'nonaktifkan', tabel: 'users', recordId: id, sebelum: { aktif: u.aktif === 1 }, sesudah: { aktif }, alasan: `${aktif ? 'Aktifkan' : 'Nonaktifkan'} pengguna (massal)` });
        hasil.push(u.nama);
      }
      res.json({ pesan: `${hasil.length} pengguna diproses (${aksi}).`, nama: hasil });
    }),
  );

  /* ------------------------------- PERAN -------------------------------- */

  r.get(
    '/peran',
    wajibKelolaPengguna,
    asyncHandler(async (_req, res) => {
      await pastikanKolomGudang();
      const roles = await all<Record<string, unknown>>(
        // AY — menu_awal dibaca defensif (kolom 034 belum ada di DB lama).
        `SELECT id, nama, bawaan, cakupan_toko, default_warehouse_id, is_warehouse_locked
           FROM roles ORDER BY bawaan DESC, nama`,
      );
      const gudangMaster = await all<{ id: number; kode: string }>('SELECT id, kode FROM warehouses');
      const kodeDariId = new Map(gudangMaster.map((w) => [Number(w.id), String(w.kode)]));
      res.json({
        data: await Promise.all(roles.map(async (rl) => {
          const top = adalahTopNama(String(rl.nama));
          const menuAwal = await bacaMenuAwal(Number(rl.id));
          const lihat = await modulTerlihat(Number(rl.id), top);
          return {
            id: Number(rl.id),
            nama: String(rl.nama),
            bawaan: Number(rl.bawaan) === 1,
            cakupan_toko: parseJsonArray((rl.cakupan_toko as string | null) ?? null),
            // WI2 — gudang default/akses/kunci per peran (kode gudang kanonis).
            gudang_default: kodeDariId.get(Number(rl.default_warehouse_id)) ?? null,
            gudang_terkunci: Number(rl.is_warehouse_locked ?? 0) === 1,
            jumlah_pengguna: await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', rl.id)))?.n ?? 0,
            hak: await flatHak(Number(rl.id)),
            khusus: await bacaKhusus(Number(rl.id), top),
            top,
            // AY — menu awal setelah login (atribut peran, bukan izin).
            menu_awal: menuAwal,
            menuAwalLabel: labelMenuAwal(menuAwal),
            pilihanMenu: pilihanUntukHak((modul) => modul === null || lihat.has(modul)),
          };
        })),
        modul: daftarModul(),
        aksi: SEMUA_AKSI,
        // AS1 — cakupan peran memakai kode GUDANG (warehouses).
        toko: await all('SELECT kode, nama FROM warehouses ORDER BY nama'),
      });
    }),
  );

  r.post(
    '/peran',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const nama = String((req.body as { nama?: unknown })?.nama ?? '').trim();
      if (!nama) throw tolak(400, 'Nama peran wajib diisi.');
      if (nama.length > 60) throw tolak(400, 'Nama peran maksimal 60 karakter.');
      // ANTI-BYPASS — nama "Owner"/"Administrator"/"Admin" (tak peduli
      // huruf) otomatis dianggap Top/Admin di seluruh guard sesi. Peran baru
      // tidak boleh memakai nama itu agar peran kustom selalu terisolasi.
      if (['owner', 'administrator', 'admin'].includes(nama.toLowerCase())) {
        throw tolak(400, `Nama peran "${nama}" dicadangkan untuk peran sistem.`);
      }
      const kembar = await get<{ id: number }>('SELECT id FROM roles WHERE lower(nama) = lower(?)', nama);
      if (kembar) throw tolak(409, `Peran "${nama}" sudah ada.`);
      const salinDari = Number((req.body as { salin_dari?: unknown })?.salin_dari ?? NaN);
      const id = Number(
        await ((await run('INSERT INTO roles (nama, bawaan) VALUES (?, FALSE)', nama))).lastInsertRowid,
      );
      // AR2 — "Salin dari kelompok lain": duplikat matriks + hak khusus + cakupan + izin tab.
      let disalin = false;
      if (Number.isFinite(salinDari)) {
        // AY3 — isian menu awal ikut tersalin bersama matriks.
        const sumber = await get<{ id: number; cakupan_toko: string | null; menu_awal: string | null }>(
          'SELECT id, cakupan_toko, menu_awal FROM roles WHERE id = ?',
          salinDari,
        );
        if (sumber) {
          await withTransaction(async () => {
            await run(
              `INSERT INTO role_permissions (role_id, menu, aksi)
               SELECT ?, menu, aksi FROM role_permissions WHERE role_id = ?`,
              id, sumber.id,
            );
            await run(
              `INSERT INTO role_hak_khusus (role_id, lihat_hpp, ubah_harga_kasir, diskon_maks, hapus_transaksi, proses_tahunan,
                 void_retur, buka_tutup_shift, lihat_laba, ubah_stok_manual, sahkan_opname,
                 hapus_massal, kelola_pengguna, ubah_pengaturan, akses_semua_toko)
               SELECT ?, lihat_hpp, ubah_harga_kasir, diskon_maks, hapus_transaksi, FALSE,
                 void_retur, buka_tutup_shift, lihat_laba, ubah_stok_manual, sahkan_opname,
                 hapus_massal, kelola_pengguna, ubah_pengaturan, akses_semua_toko
                 FROM role_hak_khusus WHERE role_id = ?`,
              id, sumber.id,
            );
            await run('UPDATE roles SET cakupan_toko = ?, menu_awal = ? WHERE id = ?', sumber.cakupan_toko, sumber.menu_awal ?? null, id);
          });
          disalin = true;
        }
      }
      await catatAudit({ userId: k.userId, aksi: 'tambah', tabel: 'roles', recordId: id, sesudah: { nama, salin_dari: Number.isFinite(salinDari) ? salinDari : null }, alasan: 'Tambah peran' });
      res.status(201).json({ id, pesan: disalin ? `Peran "${nama}" ditambahkan (disalin dari kelompok lain).` : `Peran "${nama}" ditambahkan. Hak aksesnya masih kosong — isi matriks lalu Simpan.` });
    }),
  );

  r.put(
    '/peran/:id',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const lama = await get<{ id: number; nama: string }>('SELECT id, nama FROM roles WHERE id = ?', id);
      if (!lama) throw tolak(404, 'Peran tidak ditemukan.');
      const nama = String((req.body as { nama?: unknown })?.nama ?? '').trim();
      if (!nama) throw tolak(400, 'Nama peran wajib diisi.');
      if (nama.length > 60) throw tolak(400, 'Nama peran maksimal 60 karakter.');
      // Peran Top/Admin dikenali dari NAMANYA di seluruh guard sesi.
      // Mengganti nama bisa diam-diam mencabut — atau MEMBERI — hak penuh.
      if (adalahTopNama(lama.nama) && !adalahTopNama(nama)) {
        throw tolak(400, 'Peran Owner/Administrator tidak bisa diganti menjadi peran biasa.');
      }
      if (!adalahTopNama(lama.nama) && adalahTopNama(nama)) {
        throw tolak(400, 'Jangan membuat peran Top baru lewat ganti nama — buat peran "Owner" lewat migrasi/seed bila perlu.');
      }
      if (!adalahPeranAdminNama(lama.nama) && adalahPeranAdminNama(nama)) {
        throw tolak(400, `Nama peran "${nama}" dicadangkan untuk peran sistem.`);
      }
      const kembar = await get<{ id: number }>('SELECT id FROM roles WHERE lower(nama) = lower(?) AND id <> ?', nama, id);
      if (kembar) throw tolak(409, `Peran "${nama}" sudah ada.`);
      await run('UPDATE roles SET nama = ? WHERE id = ?', nama, id);
      await catatAudit({ userId: k.userId, aksi: 'ubah', tabel: 'roles', recordId: id, sebelum: { nama: lama.nama }, sesudah: { nama }, alasan: 'Ubah nama peran' });
      res.json({ pesan: `Peran menjadi "${nama}".` });
    }),
  );

  /*
   * AY1 — Ubah menu awal peran saja (tanpa menyentuh matriks).
   * Boleh: Admin tertinggi ATAU peran berizin Ubah pada modul Pengaturan.
   * Validasi: kode dikenal + halaman boleh dilihat peran itu.
   */
  r.put(
    '/peran/:id/menu-awal',
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      if (!bolehUbahMenuAwal(k)) {
        throw tolak(403, 'Hanya Admin atau peran berizin Ubah pada Pengaturan yang boleh mengubah menu awal peran.');
      }
      const id = Number(req.params.id);
      const role = await get<{ id: number; nama: string }>('SELECT id, nama FROM roles WHERE id = ?', id);
      if (!role) throw tolak(404, 'Peran tidak ditemukan.');
      const top = adalahTopNama(role.nama);
      const tersimpan = await simpanMenuAwal(id, top, (req.body as Record<string, unknown> | undefined)?.menu_awal, k.userId, role.nama);
      const def = definisiMenuAwal(tersimpan);
      res.json({
        pesan: tersimpan
          ? `Menu awal peran "${role.nama}" menjadi "${def?.label ?? tersimpan}".`
          : `Menu awal peran "${role.nama}" dikembalikan ke otomatis (halaman pertama yang boleh dilihat).`,
        menu_awal: tersimpan,
        menuAwalLabel: labelMenuAwal(tersimpan),
      });
    }),
  );

  r.delete(
    '/peran/:id',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const lama = await get<{ id: number; nama: string; bawaan: number }>('SELECT id, nama, bawaan FROM roles WHERE id = ?', id);
      if (!lama) throw tolak(404, 'Peran tidak ditemukan.');
      if (adalahTopNama(lama.nama)) {
        throw tolak(400, 'Peran Owner/Administrator tidak bisa dihapus — ini peran pengaman aplikasi.');
      }
      if (lama.bawaan === 1 && await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM roles WHERE bawaan = TRUE')))?.n === 1) {
        // Biarkan dihapus bila masih ada bawaan lain; pesan di bawah menjelaskan bila dipakai.
      }
      const dipakai = await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', id)))?.n ?? 0;
      if (dipakai > 0) throw tolak(409, `Peran "${lama.nama}" masih dipakai ${dipakai} pengguna — pindahkan mereka ke peran lain dulu.`);
      await withTransaction(async () => {
        await run('DELETE FROM role_permissions WHERE role_id = ?', id);
        await run('DELETE FROM role_hak_khusus WHERE role_id = ?', id);
        await run('DELETE FROM roles WHERE id = ?', id);
      });
      await catatAudit({ userId: k.userId, aksi: 'hapus', tabel: 'roles', recordId: id, sebelum: { nama: lama.nama }, alasan: 'Hapus peran' });
      res.json({ pesan: `Peran "${lama.nama}" dihapus.` });
    }),
  );

  /* ---------------------- MATRIKS + HAK KHUSUS + TOKO ------------------- */

  r.put(
    '/matriks/:roleId',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const roleId = Number(req.params.roleId);
      const role = await get<{ id: number; nama: string; cakupan_toko: string | null }>(
        'SELECT id, nama, cakupan_toko FROM roles WHERE id = ?',
        roleId,
      );
      if (!role) throw tolak(404, 'Peran tidak ditemukan.');

      const body = (req.body ?? {}) as Record<string, unknown>;
      const pasang = validasiHak(body);
      const khususIn = (body.khusus ?? {}) as Record<string, unknown>;
      const khususLama = await bacaKhusus(roleId, false);
      const diskon = Number(khususIn.diskon_maks ?? khususLama.diskon_maks);
      if (!Number.isFinite(diskon) || diskon < 0 || diskon > 100) {
        throw tolak(400, 'Batas diskon harus antara 0–100%.');
      }
      const bool = (v: unknown, d: number): number => (typeof v === 'boolean' ? (v ? 1 : 0) : d);
      const boolBaru = (kunci: keyof BarisKhusus): number => bool(khususIn[kunci], khususLama[kunci]);
      const khususBaru: BarisKhusus = {
        lihat_hpp: boolBaru('lihat_hpp'),
        ubah_harga_kasir: boolBaru('ubah_harga_kasir'),
        diskon_maks: diskon,
        hapus_transaksi: boolBaru('hapus_transaksi'),
        // Proses Tahunan: HANYA Top — nilai peran non-Top selalu dipaksa 0.
        proses_tahunan: adalahTopNama(role.nama) ? 1 : 0,
        void_retur: boolBaru('void_retur'),
        buka_tutup_shift: boolBaru('buka_tutup_shift'),
        lihat_laba: boolBaru('lihat_laba'),
        ubah_stok_manual: boolBaru('ubah_stok_manual'),
        sahkan_opname: boolBaru('sahkan_opname'),
        hapus_massal: boolBaru('hapus_massal'),
        kelola_pengguna: boolBaru('kelola_pengguna'),
        ubah_pengaturan: boolBaru('ubah_pengaturan'),
        akses_semua_toko: boolBaru('akses_semua_toko'),
      };

      // Matriks peran HANYA menyimpan izin menu + hak khusus. Cakupan gudang
      // TIDAK disentuh di sini (tetap apa adanya di roles.cakupan_toko) karena
      // "Pilih minimal satu gudang" adalah validasi level PENGGUNA — form
      // peran tidak punya pilihan gudang sehingga validasi itu selalu gagal
      // (false positive) untuk peran bercakupan null seperti Kasir.
      // Abaikan cakupan_toko bila klien lama masih mengirimnya.
      const sebelum: Record<string, unknown> = {
        ...await flatHak(roleId),
        ...Object.fromEntries(Object.entries(khususLama).map(([kk, vv]) => [`khusus.${kk}`, vv])),
      };

      // AY — menu awal ikut tersimpan bersama matriks. Validasi memakai sel
      // Lihat BARU yang sedang disimpan (bukan state lama di DB) agar Admin
      // bisa mencentang Lihat + memilih menu awal dalam sekali Simpan.
      const peranTop = adalahTopNama(role.nama);
      const menuAwalLama = await bacaMenuAwal(roleId);
      const adaMenuAwal = body.menu_awal !== undefined;
      let menuAwalBaru: string | null = menuAwalLama;
      if (adaMenuAwal) {
        const mentah = typeof body.menu_awal === 'string' ? body.menu_awal.trim() : '';
        if (mentah !== '' && mentah !== '-') {
          if (!kodeMenuAwalSah(mentah)) throw tolak(400, `Menu awal "${mentah}" tidak dikenal.`);
          const butuh = definisiMenuAwal(mentah)!;
          if (!peranTop && butuh.modul !== null) {
            const lihatBaru = new Set(pasang.filter((p) => p.aksi === 'lihat').map((p) => p.menu));
            if (!lihatBaru.has(butuh.modul)) {
              throw tolak(400, `Halaman "${butuh.label}" tidak boleh dilihat peran ini (sel Lihat belum dicentang). Pilih halaman lain atau centang Lihat dulu.`);
            }
          }
          menuAwalBaru = mentah;
        } else {
          menuAwalBaru = null;
        }
      }

      await withTransaction(async () => {
        await run('DELETE FROM role_permissions WHERE role_id = ?', roleId);
        for (const p of pasang) {
          await run('INSERT INTO role_permissions (role_id, menu, aksi) VALUES (?, ?, ?)', roleId, p.menu, p.aksi);
        }
        const kolomKhusus = [
          'lihat_hpp', 'ubah_harga_kasir', 'diskon_maks', 'hapus_transaksi', 'proses_tahunan',
          ...KHUSUS_BARU,
        ];
        const nilaiKhusus = kolomKhusus.map((c) => khususBaru[c as keyof BarisKhusus]);
        const setKhusus = kolomKhusus.map((c) => `${c} = excluded.${c}`).join(',\n             ');
        await run(
          `INSERT INTO role_hak_khusus (role_id, ${kolomKhusus.join(', ')})
           VALUES (?, ${kolomKhusus.map(() => '?').join(', ')})
           ON CONFLICT(role_id) DO UPDATE SET ${setKhusus}`,
          roleId,
          ...nilaiKhusus,
        );
        if (adaMenuAwal && menuAwalBaru !== menuAwalLama) {
          await run('UPDATE roles SET menu_awal = ? WHERE id = ?', menuAwalBaru, roleId);
        }
      });

      const sesudah: Record<string, unknown> = {
        ...await flatHak(roleId),
        ...Object.fromEntries(Object.entries(khususBaru).map(([kk, vv]) => [`khusus.${kk}`, vv])),
      };
      await catatAudit({
        userId: k.userId,
        aksi: 'ubah',
        tabel: 'role_permissions',
        recordId: roleId,
        sebelum: adaMenuAwal ? { ...sebelum, menu_awal: menuAwalLama } : sebelum,
        sesudah: adaMenuAwal ? { ...sesudah, menu_awal: menuAwalBaru } : sesudah,
        alasan: `Simpan Hak Akses peran "${role.nama}" — langsung berlaku tanpa login ulang`,
      });

      res.json({
        pesan: `Hak akses peran "${role.nama}" disimpan — langsung berlaku untuk seluruh penggunanya.`,
        hak: await flatHak(roleId),
        khusus: khususBaru,
        // Cakupan gudang peran tidak diubah di sini — kembalikan nilai
        // tersimpan agar klien tetap sinkron (gudang diatur per pengguna).
        cakupan_toko: await ((await get<{ cakupan_toko: string | null }>('SELECT cakupan_toko FROM roles WHERE id = ?', roleId)))?.cakupan_toko ?? null,
        menu_awal: await bacaMenuAwal(roleId),
      });
    }),
  );

  /* -------- WI2 — Gudang default, akses & kunci gudang per PERAN -------- */

  /**
   * Atur gudang sebuah peran: daftar gudang yang diizinkan, gudang default
   * transaksi, dan kunci pilihan gudang. Disimpan sebagai kode gudang
   * (roles.cakupan_toko) + kolom id/cermin (roles.default_warehouse_id,
   * roles.accessible_warehouse_ids, roles.is_warehouse_locked).
   */
  r.put(
    '/peran/:id/gudang',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const role = await get<{ id: number; nama: string; cakupan_toko: string | null }>(
        'SELECT id, nama, cakupan_toko FROM roles WHERE id = ?',
        id,
      );
      if (!role) throw tolak(404, 'Peran tidak ditemukan.');
      if (adalahTopNama(role.nama)) {
        throw tolak(400, 'Peran Owner/Administrator otomatis memiliki seluruh gudang tanpa kunci.');
      }
      await pastikanKolomGudang();
      const body = (req.body ?? {}) as Record<string, unknown>;
      const mentah = body.gudang_akses;
      let kode: string[] | null = null;
      if (Array.isArray(mentah)) {
        const peta = await petakanCakupanSimpan(mentah.map((x) => String(x)));
        if (peta.asing.length) {
          throw tolak(400, `Gudang tidak dikenal di Master Data: ${peta.asing.join(', ')}.`);
        }
        kode = peta.kode;
      } else if (mentah !== null && mentah !== undefined && mentah !== '') {
        throw tolak(400, 'Daftar akses gudang tidak valid.');
      }
      let bawaan: string | null = String(body.gudang_default ?? '').trim() || null;
      if (bawaan) {
        const kanonis = await kodeGudangKanonis(bawaan);
        if (!kanonis) throw tolak(400, `Gudang default tidak dikenal: ${bawaan}.`);
        bawaan = kanonis;
      }
      if (bawaan && (!kode || !kode.includes(bawaan))) {
        throw tolak(400, 'Gudang default harus salah satu gudang yang diizinkan.');
      }
      const terkunci =
        body.gudang_terkunci === true ||
        body.gudang_terkunci === 'true' ||
        body.gudang_terkunci === 1;
      if (terkunci && !bawaan) {
        throw tolak(400, 'Pilih gudang default dulu sebelum mengunci pilihan gudang.');
      }

      await withTransaction(async () => {
        await run(
          'UPDATE roles SET cakupan_toko = ? WHERE id = ?',
          kode === null ? null : JSON.stringify(kode),
          id,
        );
        await simpanKolomGudang('roles', id, kode, bawaan, terkunci);
      });
      await catatAudit({
        userId: k.userId,
        aksi: 'ubah',
        tabel: 'roles',
        recordId: id,
        sebelum: { cakupan_toko: parseJsonArray(role.cakupan_toko) },
        sesudah: { cakupan_toko: kode, gudang_default: bawaan, gudang_terkunci: terkunci },
        alasan: `Pengaturan gudang peran "${role.nama}"`,
      });
      res.json({
        pesan: `Gudang peran "${role.nama}" disimpan${terkunci ? ' — pilihan gudang dikunci.' : '.'}`,
        gudang_akses: kode,
        gudang_default: bawaan,
        gudang_terkunci: terkunci,
      });
    }),
  );

  /* ---------------- AR5/AS4 — Akses Gudang (matriks cepat) ---------------- */

  // AS1 — daftar gudang grup per toko untuk form & matriks (tanpa paginasi).
  r.get(
    '/gudang',
    wajibKelolaPengguna,
    asyncHandler(async (_req, res) => {
      res.json({ grup: await daftarGudangGrup() });
    }),
  );

  r.get(
    '/akses-matriks',
    wajibKelolaPengguna,
    asyncHandler(async (_req, res) => {
      const toko = await all<{ kode: string; nama: string }>('SELECT kode, nama FROM warehouses ORDER BY nama');
      const pengguna = await (await all<Record<string, unknown>>(
        `SELECT u.id, u.nama, u.username, u.cakupan_toko, r.nama AS peran, r.cakupan_toko AS cakupan_peran
           FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.nama`,
      )).map((x) => ({
        id: Number(x.id), nama: String(x.nama ?? ''), username: String(x.username ?? ''), peran: String(x.peran ?? ''),
        cakupan_toko: parseJsonArray((x.cakupan_toko as string | null) ?? null),
        cakupan_efektif: irisan(parseJsonArray((x.cakupan_toko as string | null) ?? null), parseJsonArray((x.cakupan_peran as string | null) ?? null)),
      }));
      res.json({ toko, pengguna });
    }),
  );

  r.put(
    '/akses-matriks',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const body = (req.body ?? {}) as { akses?: unknown };
      if (!body.akses || typeof body.akses !== 'object' || Array.isArray(body.akses)) {
        throw tolak(400, 'Format akses tidak valid.');
      }
      const toko = await (await all<{ kode: string }>('SELECT kode FROM warehouses')).map((s) => s.kode);
      const ringkasan: string[] = [];
      await withTransaction(async () => {
        for (const [idStr, daftar] of Object.entries(body.akses as Record<string, unknown>)) {
          const id = Number(idStr);
          if (!Number.isFinite(id)) continue;
          const u = await bacaPengguna(id);
          if (adalahTopNama(u.peran) && !k.admin) continue;
          let baru: string[] | null = Array.isArray(daftar) && daftar.length > 0 ? (daftar as unknown[]).map((x) => String(x)) : null;
          if (baru) {
            // Terima kode maupun nama; yang disimpan selalu kode gudang.
            const peta = await petakanCakupanSimpan(baru);
            if (peta.asing.length) throw tolak(400, `Toko/gudang tidak dikenal: ${peta.asing.join(', ')}.`);
            baru = peta.kode;
          }
          // AS2 — pengguna biasa tidak boleh dikosongkan cakupannya lewat
          // matriks (null = mengikuti peran; peran kustom bercakupan null
          // berarti TANPA BATAS). Minimal 1 gudang, sama seperti form pengguna.
          if (!adalahTopNama(u.peran) && (!baru || baru.length === 0)) {
            throw tolak(400, `Pilih minimal satu gudang untuk "${u.nama}" — mengosongkan berarti tanpa batas.`);
          }
          const lamaEfektif = irisan(parseJsonArray(u.cakupan_toko), parseJsonArray(u.cakupan_peran)) ?? toko;
          const baruEfektif = irisan(baru, parseJsonArray(u.cakupan_peran)) ?? toko;
          const hilang = lamaEfektif.filter((c) => !baruEfektif.includes(c));
          await run('UPDATE users SET cakupan_toko = ?, perlu_ditinjau = FALSE, diubah_pada = ? WHERE id = ?', baru ? JSON.stringify(baru) : null, waktuSql(), id);
          if (hilang.length) ringkasan.push(`${u.nama} kehilangan akses ke ${hilang.join(', ')}`);
          await catatAudit({
            userId: k.userId, aksi: 'ubah', tabel: 'users', recordId: id,
            sebelum: { cakupan_toko: parseJsonArray(u.cakupan_toko) }, sesudah: { cakupan_toko: baru },
            alasan: 'Matriks akses toko & gudang',
          });
        }
      });
      res.json({
        pesan: ringkasan.length ? `Akses disimpan. ${ringkasan.length} perubahan pencabutan.` : 'Akses toko & gudang disimpan.',
        ringkasan,
      });
    }),
  );

  r.get(
    '/tanpa-akses',
    wajibKelolaPengguna,
    asyncHandler(async (_req, res) => {
      const rows = await all<Record<string, unknown>>(
        `SELECT u.id, u.nama, u.username, u.cakupan_toko, r.nama AS peran, r.cakupan_toko AS cakupan_peran
           FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.nama`,
      );
      const kosong = rows
        .map((x) => ({
          id: Number(x.id), nama: String(x.nama ?? ''), username: String(x.username ?? ''), peran: String(x.peran ?? ''),
          efektif: irisan(parseJsonArray((x.cakupan_toko as string | null) ?? null), parseJsonArray((x.cakupan_peran as string | null) ?? null)),
        }))
        .filter((u) => u.efektif !== null && u.efektif.length === 0);
      res.json({ data: kosong, jumlah: kosong.length });
    }),
  );

  /* ------------------- AR8 — Sesi aktif & keluarkan paksa ---------------- */

  r.get(
    '/sesi',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      let rows: Record<string, unknown>[] = [];
      try {
        rows = (await all<Record<string, unknown>>(
          `SELECT s.id, s.user_id, s.perangkat, s.ip, s.dibuat_pada, s.terakhir_aktif, s.toko_kode,
                  u.nama, u.username, r.nama AS peran
             FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
            ORDER BY s.terakhir_aktif DESC LIMIT 200`,
        ));
      } catch {
        rows = (await all<Record<string, unknown>>(
          `SELECT s.id, s.user_id, s.perangkat, s.ip, s.dibuat_pada, s.terakhir_aktif,
                  u.nama, u.username, r.nama AS peran
             FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
            ORDER BY s.terakhir_aktif DESC LIMIT 200`,
        ));
      }
      const milik = k.cakupanToko;
      res.json({
        data: rows.map((s) => ({
          id: Number(s.id), user_id: Number(s.user_id), nama: String(s.nama ?? ''),
          username: String(s.username ?? ''), peran: String(s.peran ?? ''),
          perangkat: String(s.perangkat ?? '-'), ip: String(s.ip ?? '-'),
          toko: (s.toko_kode as string | null) ?? null,
          mulai: String(s.dibuat_pada ?? ''), terakhir_aktif: String(s.terakhir_aktif ?? ''),
          sesi_ini: Number(s.id) === k.sesiId,
        })).filter(() => {
          if (k.admin || milik === null) return true;
          return true;
        }),
        sesi_ini: k.sesiId,
      });
    }),
  );

  r.post(
    '/sesi/:id/kick',
    wajibKelolaPengguna,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const id = Number(req.params.id);
      const s = await get<{ id: number; user_id: number }>('SELECT id, user_id FROM sessions WHERE id = ?', id);
      if (!s) throw tolak(404, 'Sesi tidak ditemukan.');
      if (s.user_id === k.userId && id === k.sesiId) throw tolak(400, 'Tidak bisa mengeluarkan sesi sendiri yang sedang dipakai.');
      const target = await bacaPengguna(s.user_id);
      if (adalahTopNama(target.peran) && !k.admin) throw tolak(403, 'Hanya Owner yang boleh mengeluarkan sesi Owner/Admin.');
      await run('DELETE FROM sessions WHERE id = ?', id);
      await catatAudit({ userId: k.userId, aksi: 'logout', tabel: 'sessions', recordId: id, alasan: `Keluarkan paksa sesi "${target.nama}"` });
      res.json({ pesan: `Sesi "${target.nama}" dikeluarkan paksa.` });
    }),
  );

  /* ------------------- AR1 — Delegasi Admin (Owner saja) ------------------ */

  r.get(
    '/delegasi',
    wajibAdminMatriks,
    asyncHandler(async (_req, res) => {
      res.json({ aktif: await delegasiAktif() });
    }),
  );

  r.put(
    '/delegasi',
    wajibAdminMatriks,
    asyncHandler(async (req, res) => {
      const k = konteksWajib(req);
      const aktif = (req.body as { aktif?: unknown })?.aktif === true;
      const sebelum = await delegasiAktif();
      await run(
        `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES ('peng.admin_delegasi', ?, now())
         ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
        aktif ? 'true' : 'false',
      );
      await catatAudit({
        userId: k.userId, aksi: 'ubah', tabel: 'pengaturan', recordId: 'peng.admin_delegasi',
        sebelum: { aktif: sebelum }, sesudah: { aktif },
        alasan: 'Delegasi Admin mengelola pengguna',
      });
      res.json({ aktif, pesan: aktif ? 'Delegasi aktif: Admin dengan hak kelola pengguna bisa mengelola tokonya.' : 'Delegasi mati: hanya Owner yang mengelola pengguna.' });
    }),
  );

  return r;
}
