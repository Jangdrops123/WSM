// ============================================================================
// Inti modul Log In (Tahap 1) — hash password, sesi cookie httpOnly, konteks
// pengguna per permintaan, dan middleware `wajibLogin`.
//
// Kebijakan:
//   * Password selalu di-hash bcrypt ($2b$10$…); teks biasa tidak pernah
//     disimpan maupun dikembalikan ke klien.
//   * 5x salah = terkunci (angka & durasi dari Pengaturan ▸ Keamanan).
//   * Sesi berakhir otomatis bila tidak aktif melewati `sesi_menit`
//     (dapat diatur Admin) — dihitung ulang tiap permintaan.
//   * "Ingat saya" membuat cookie & sesi berlaku 30 hari; tanpa centang,
//     cookie hanya berlaku selama jendela peramban tetap terbuka.
// ============================================================================

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { all, get, getSettings, run } from '../db.pg.ts';
import { normalisasiCakupan } from './aksesGudang.ts';
import { aksesGudangSesi, type GudangSesi } from './gudangAkses.ts';
import { tolak } from './http.ts';

export const NAMA_KUKI = 'ns_sesi';
const HARGA_BCRYPT = 10;
const HARI_INGAT = 30;
/** Password awal akun Admin yang dibuat otomatis saat pertama dijalankan. */
export const SANDI_ADMIN_AWAL = 'admin123';

declare global {
  namespace Express {
    interface Request {
      konteks?: Konteks;
    }
  }
}

export type KunciPeran = 'admin' | 'manajer' | 'akuntan' | 'kasir' | 'gudang' | 'lainnya';

// AX — satu-satunya sel matriks yang sah (8 kolom). Tanpa terima/batal/
// batal_disahkan: Terima→Ubah, Batal draft/GRN→Hapus, Batal disahkan→
// Hapus+Sahkan, Sahkan→Sahkan (lihat PETA di server/lib/hak.ts).
export const SEMUA_AKSI = [
  'lihat',
  'tambah',
  'ubah',
  'hapus',
  'sahkan',
  'impor',
  'ekspor',
  'cetak',
] as const;

export interface HakKhusus {
  lihat_hpp: boolean;
  ubah_harga_kasir: boolean;
  diskon_maks: number;
  hapus_transaksi: boolean;
  proses_tahunan: boolean;
  /** AR2 — izin khusus tambahan (default ketat untuk peran non-Top). */
  void_retur: boolean;
  buka_tutup_shift: boolean;
  lihat_laba: boolean;
  ubah_stok_manual: boolean;
  sahkan_opname: boolean;
  hapus_massal: boolean;
  kelola_pengguna: boolean;
  ubah_pengaturan: boolean;
  akses_semua_toko: boolean;
}

/** AR9 — peran tertinggi: Owner dan Administrator (alias lama) diperlakukan setara. */
export const NAMA_TOP = new Set(['owner', 'administrator']);
export function adalahTopNama(nama: string): boolean {
  return NAMA_TOP.has(nama.toLowerCase().trim());
}

export interface Konteks {
  userId: number;
  nama: string;
  username: string;
  email: string | null;
  wa: string | null;
  roleNama: string;
  /** id peran efektif (dapat berbeda dari peran asli bila ada override x-peran). */
  roleId: number;
  peranKunci: KunciPeran;
  admin: boolean;
  adminUtama: boolean;
  wajibGanti: boolean;
  sesiId: number;
  token: string;
  /** Matriks modul → daftar aksi yang diizinkan untuk peran efektif. */
  hak: Record<string, string[]>;
  khusus: HakKhusus;
  cakupanToko: string[] | null;
  /** Pengaturan gudang efektif sesi (default, akses, kunci) — WI2. */
  gudang: GudangSesi;
  /**
   * Identitas & hak PEMILIK SESI apa adanya (tanpa override `x-peran`).
   * Payload /auth/masuk & /auth/sesi memakai ini: header `x-peran` dari
   * klien (bisa sisa pengguna sebelumnya saat ganti akun di peramban yang
   * sama) tidak boleh mengubah "siapa yang masuk" — kalau tidak, peran
   * lokal klien (peranAktif) mewarisi peran akun sebelumnya dan seluruh
   * permintaan berikutnya dikirim dengan peran yang salah.
   */
  asli: {
    roleNama: string;
    roleId: number;
    peranKunci: KunciPeran;
    admin: boolean;
    hak: Record<string, string[]>;
    khusus: HakKhusus;
    cakupanToko: string[] | null;
    gudang: GudangSesi;
  };
}

/* ------------------------------- hash ---------------------------------- */

export function hashSandi(sandi: string): string {
  return bcrypt.hashSync(sandi, HARGA_BCRYPT);
}

export function cocokSandi(sandi: string, hash: string | null | undefined): boolean {
  if (!hash || hash === '!' || !hash.startsWith('$2')) return false;
  try {
    return bcrypt.compareSync(sandi, hash);
  } catch {
    return false;
  }
}

/** Hash SHA-256 (hex) — untuk token reset & kode pemulihan (bukan password). */
export function hashToken(teks: string): string {
  return crypto.createHash('sha256').update(teks).digest('hex');
}

/* --------------------------- generator acak ----------------------------- */

/** Alfabet tanpa karakter menyesatkan (0/O, 1/l/I). */
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const ALFA_BESAR = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function acakTeks(n: number, alfabet: string): string {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += alfabet[b[i] % alfabet.length];
  return s;
}

/** Password acak 12 karakter — selalu memuat huruf besar, kecil, dan angka. */
export function sandiAcak(): string {
  const besar = acakTeks(1, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  const kecil = acakTeks(1, 'abcdefghijkmnpqrstuvwxyz');
  const angka = acakTeks(1, '23456789');
  const sisa = acakTeks(9, ALFA);
  const campur = `${besar}${kecil}${angka}${sisa}`.split('');
  // Acak urutan tanpa modul kripto khusus (cukup untuk password sementara).
  for (let i = campur.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [campur[i], campur[j]] = [campur[j], campur[i]];
  }
  return campur.join('');
}

/** Kode pemulihan Admin: 4 grup × 4 karakter (ABCDEFGH…23456789). */
export function kodePemulihanAcak(): string {
  return [0, 1, 2, 3].map(() => acakTeks(4, ALFA_BESAR)).join('-');
}

export interface KebijakanSandi {
  panjang: number;
  hurufAngka: boolean;
  simbol: boolean;
}

export async function kebijakanSandi(): Promise<KebijakanSandi> {
  const s = await getSettings();
  const panjang = Number(s.sandi_min_panjang);
  return {
    panjang: Number.isFinite(panjang) && panjang >= 6 ? panjang : 8,
    hurufAngka: s.sandi_wajib_huruf_angka !== 'false',
    simbol: s.sandi_wajib_simbol === 'true',
  };
}

/** Validasi password baru; null = lolos. */
export async  function validasiSandiBaru(sandi: string): Promise<string | null> {
  const k = await kebijakanSandi();
  if (typeof sandi !== 'string' || sandi.length < k.panjang) {
    return `Password minimal ${k.panjang} karakter.`;
  }
  if (sandi.length > 200) return 'Password maksimal 200 karakter.';
  if (k.hurufAngka && !(/[A-Za-z]/.test(sandi) && /\d/.test(sandi))) {
    return 'Password harus memuat huruf dan angka.';
  }
  if (k.simbol && !/[^\w\s]/.test(sandi)) return 'Password harus memuat simbol.';
  if (sandi.trim() !== sandi) return 'Password tidak boleh diawali/akhir spasi.';
  return null;
}

/** Kekuatan password untuk indikator UI (bukan penolakan). */
export function skorSandi(sandi: string): 0 | 1 | 2 | 3 {
  if (!sandi) return 0;
  const panjangOk = sandi.length >= 8;
  const campuran = /[A-Za-z]/.test(sandi) && /\d/.test(sandi);
  const kuat = sandi.length >= 12 && campuran && /[^\w\s]/.test(sandi);
  if (kuat) return 3;
  if (panjangOk && campuran) return 2;
  if (sandi.length >= 6) return 1;
  return 0;
}

/* ------------------------------ waktu ---------------------------------- */
/** Waktu sekarang format SQL SQLite (UTC, spasi) — konsisten dengan DEFAULT. */
export function waktuSql(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

/** Ubah format SQL menjadi milidetik (menangani format lama ber-T/Z). */
export function msDariSql(s: string | null | undefined): number {
  if (!s) return Number.NaN;
  const t = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(t.endsWith('Z') ? t : `${t}Z`);
}

async function menitSesi(): Promise<number> {
  const v = Number(await ((await getSettings()))['sesi_menit']);
  return Number.isFinite(v) && v > 0 ? v : 480;
}

/* ------------------------------- kuki ---------------------------------- */

export function pasangKuki(res: Response, token: string, ingat: boolean): void {
  const bagian = [`${NAMA_KUKI}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (ingat) bagian.push(`Expires=${new Date(Date.now() + HARI_INGAT * 86_400_000).toUTCString()}`);
  res.setHeader('Set-Cookie', bagian.join('; '));
}

export function lepasKuki(res: Response): void {
  res.setHeader('Set-Cookie', `${NAMA_KUKI}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function bacaToken(req: Request): string | null {
  const kuki = req.headers.cookie;
  if (kuki) {
    for (const bagian of kuki.split(';')) {
      const i = bagian.indexOf('=');
      if (i < 0) continue;
      if (bagian.slice(0, i).trim() === NAMA_KUKI) return decodeURIComponent(bagian.slice(i + 1).trim());
    }
  }
  // Cadangan untuk skrip/uji: header `x-sesi` memuat token yang sama.
  const h = req.headers['x-sesi'];
  return typeof h === 'string' && h ? h : null;
}

/* ------------------------------- peran --------------------------------- */

const PERSIS_KEY: [string, KunciPeran][] = [
  ['administrator', 'admin'],
  ['admin', 'admin'],
  ['owner', 'admin'],
  ['manajer', 'manajer'],
  ['manager', 'manajer'],
  ['akuntan', 'akuntan'],
  ['kasir', 'kasir'],
  ['gudang', 'gudang'],
  ['staf gudang', 'gudang'],
  ['warehouse', 'gudang'],
];

/** Nama peran → kunci klien. Peran buatan → 'manajer' (matriks tetap penentu). */
export function kunciDariNamaPeran(nama: string): KunciPeran {
  const n = nama.toLowerCase().trim();
  for (const [pola, key] of PERSIS_KEY) if (n === pola) return key;
  for (const [pola, key] of PERSIS_KEY) if (n.includes(pola)) return key;
  // Peran kustom (dibuat di Pengguna & Hak Akses) TIDAK boleh menyamar jadi
  // Manajer/R1 — seluruh menunya ditentukan matriks Hak Akses peran itu.
  return 'lainnya';
}

/** Nama peran bawaan → nama peran di database (override header x-peran). */
const NAMA_ROLE_HEADER: Record<string, string> = {
  admin: 'Administrator',
  owner: 'Administrator',
  administrator: 'Administrator',
  manajer: 'Manajer',
  manager: 'Manajer',
  akuntan: 'Akuntan',
  kasir: 'Kasir',
  gudang: 'Gudang',
};

const NAMA_ADMIN = new Set(['administrator', 'admin', 'owner']);

export function adalahPeranAdminNama(nama: string): boolean {
  return NAMA_ADMIN.has(nama.toLowerCase().trim());
}

/* ------------------------- pembatasan login (AR7) ------------------------ */

export interface BatasLogin {
  periode_aktif: number;
  jam_dari: string | null;
  jam_sampai: string | null;
  hari_aktif: string | null;
}

function wibKini(): { menit: number; hari: number } {
  const wib = new Date(Date.now() + 7 * 3_600_000);
  return { menit: wib.getUTCHours() * 60 + wib.getUTCMinutes(), hari: wib.getUTCDay() };
}

function menitDariJam(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const j = Number(m[1]);
  const n = Number(m[2]);
  if (j < 0 || j > 23 || n < 0 || n > 59) return null;
  return j * 60 + n;
}

/** null = boleh masuk; string = pesan penolakan AR7. */
export function alasanPeriodeLogin(u: BatasLogin): string | null {
  if (!u.periode_aktif) return null;
  const kini = wibKini();
  if (u.hari_aktif) {
    try {
      const daftar = JSON.parse(u.hari_aktif) as unknown;
      if (Array.isArray(daftar) && daftar.length > 0) {
        const cocok = daftar.some((h) => {
          const s = String(h).toLowerCase();
          const angka =
            s === 'min' || s === 'minggu' || s === '0' || s === '7' ? 0
            : s === 'sen' || s === 'senin' || s === '1' ? 1
            : s === 'sel' || s === 'selasa' || s === '2' ? 2
            : s === 'rab' || s === 'rabu' || s === '3' ? 3
            : s === 'kam' || s === 'kamis' || s === '4' ? 4
            : s === 'jum' || s === "jumat" || s === '5' ? 5
            : s === 'sab' || s === 'sabtu' || s === '6' ? 6
            : -1;
          return angka === kini.hari;
        });
      if (!cocok) return 'Akun hanya dapat masuk pada hari yang diizinkan. Hubungi Owner untuk pengecualian.';
      }
    } catch {
      /* hari rusak = abaikan, jam tetap dicek */
    }
  }
  const dari = menitDariJam(u.jam_dari);
  const sampai = menitDariJam(u.jam_sampai);
  if (dari === null || sampai === null) return null;
  const dalam =
    dari <= sampai
      ? kini.menit >= dari && kini.menit <= sampai
      : kini.menit >= dari || kini.menit <= sampai;
  if (!dalam) {
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
    return `Akun hanya dapat masuk pukul ${fmt(dari)}–${fmt(sampai)} WIB.`;
  }
  return null;
}

export async function bacaBatasLogin(userId: number): Promise<BatasLogin | null> {
  try {
    return (
      (await get<BatasLogin>(
        'SELECT periode_aktif, jam_dari, jam_sampai, hari_aktif FROM users WHERE id = ?',
        userId,
      )) ?? null
    );
  } catch {
    return null;
  }
}

/* ------------------------------- konteks -------------------------------- */

interface BarisSesi {
  id: number;
  token: string;
  user_id: number;
  terakhir_aktif: string;
  kadaluarsa: string | null;
  nama: string;
  username: string;
  email: string | null;
  wa: string | null;
  aktif: number;
  wajib_ganti: number;
  role_id: number;
  role_nama: string;
  cakupan_user: string | null;
  cakupan_role: string | null;
}

/**
 * Bangun konteks dari token sesi. Mengembalikan null bila sesi tidak ada,
 * kedaluwarsa, idle-timeout, atau akun sudah nonaktif — sesi bermasalah
 * langsung dihapus agar tidak dipakai ulang.
 *
 * Diekspor agar rute /auth/masuk bisa membangun payload sesi langsung
 * setelah token baru dibuat (sebelum request berikutnya).
 */
export async function konteksDariToken(req: Request, res: Response, token: string): Promise<Konteks | null> {
  const baris = await get<BarisSesi>(
    `SELECT s.id, s.token, s.user_id, s.terakhir_aktif, s.kadaluarsa,
            u.nama, u.username, u.email, u.wa, u.aktif, u.wajib_ganti,
            u.role_id, u.cakupan_toko AS cakupan_user,
            r.nama AS role_nama, r.cakupan_toko AS cakupan_role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.token = ?`,
    token,
  );
  if (!baris) return null;

  const buang = async () => {
    await run('DELETE FROM sessions WHERE token = ?', token);
    lepasKuki(res);
  };

  const kini = Date.now();
  if (baris.kadaluarsa && msDariSql(baris.kadaluarsa) < kini) {
    await buang();
    return null;
  }
  const batas = await menitSesi() * 60_000;
  if (kini - msDariSql(baris.terakhir_aktif) > batas) {
    await buang();
    return null;
  }
  if (!baris.aktif) {
    await buang();
    return null;
  }
  // AR7/AR12 — sesi otomatis mati bila jam login sudah habis.
  const batasLogin = await bacaBatasLogin(baris.user_id);
  if (batasLogin && alasanPeriodeLogin(batasLogin)) {
    await buang();
    return null;
  }
  // Perbarui aktivitas (hemat tulis: cukup bila jeda > 30 detik).
  if (kini - msDariSql(baris.terakhir_aktif) > 30_000) {
    await run('UPDATE sessions SET terakhir_aktif = ? WHERE id = ?', waktuSql(), baris.id);
  }

  const admin = adalahPeranAdminNama(baris.role_nama);
  // Override `x-peran` HANYA dari sesi Admin (dipakai skrip uji & simulasi peran);
  // sesi non-Admin tidak bisa menaikkan/menurunkan peran lewat header.
  const headerPeran = String(req.headers['x-peran'] ?? '').toLowerCase().trim();
  let roleNama = baris.role_nama;
  let roleId = baris.role_id;
  if (admin && headerPeran && NAMA_ROLE_HEADER[headerPeran]) {
    // lower(?) di kedua sisi — pembanding literal 'Manajer' tidak cocok dengan
    // lower(nama) tanpa di-lower-kan (matriks izin per peran jadi tidak teruji).
    const roleHeader = await get<{ id: number; nama: string }>(
      'SELECT id, nama FROM roles WHERE lower(nama) = lower(?)',
      NAMA_ROLE_HEADER[headerPeran],
    );
    if (roleHeader) {
      roleId = roleHeader.id;
      roleNama = roleHeader.nama;
    }
  }

  const adminEfektif = admin && roleId === baris.role_id;
  const cakupan = await irisanCakupan(baris.cakupan_user, baris.cakupan_role);
  // WI2 — gudang default/akses/kunci mengikuti peran efektif; identitas sesi
  // (asli) memakai peran pemilik sesi apa adanya.
  const gudang = await aksesGudangSesi(baris.user_id, roleId, adminEfektif, cakupan);
  const gudangAsli = await aksesGudangSesi(baris.user_id, baris.role_id, admin, cakupan);
  return {
    userId: baris.user_id,
    nama: baris.nama,
    username: baris.username,
    email: baris.email,
    wa: baris.wa,
    roleNama,
    peranKunci: kunciDariNamaPeran(roleNama),
    admin: adminEfektif,
    adminUtama: admin && baris.username.toLowerCase() === 'admin',
    wajibGanti: baris.wajib_ganti === 1,
    sesiId: baris.id,
    token,
    hak: await bacaHak(roleId, adminEfektif),
    roleId,
    khusus: await bacaHakKhusus(roleId, adminEfektif),
    cakupanToko: cakupan,
    gudang,
    // Pemilik sesi apa adanya — untuk payload identitas (/masuk, /sesi).
    asli: {
      roleNama: baris.role_nama,
      roleId: baris.role_id,
      peranKunci: kunciDariNamaPeran(baris.role_nama),
      admin,
      hak: await bacaHak(baris.role_id, admin),
      khusus: await bacaHakKhusus(baris.role_id, admin),
      cakupanToko: cakupan,
      gudang: gudangAsli,
    },
  };
}

/**
 * Cakupan efektif = irisan cakupan pengguna dan peran (null = tanpa
 * pembatasan; [] = tidak boleh memilih toko mana pun).
 */
function parseCakupan(s: string | null): string[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

export async  function irisanCakupan(a: string | null, b: string | null): Promise<string[] | null> {
  // Normalisasi dulu ke kode gudang kanonis: data lama bisa menyimpan NAMA
  // gudang/toko (mis. "Tempuny Group" bukan "GD-2") sehingga irisan mentah
  // menghasilkan [] dan pengguna difitnah "tidak memiliki akses gudang".
  const pa = await normalisasiCakupan(parseCakupan(a));
  const pb = await normalisasiCakupan(parseCakupan(b));
  if (pa === null) return pb;
  if (pb === null) return pa;
  return pa.filter((x) => pb.includes(x));
}

/* ------------------------- matriks hak akses ---------------------------- */

/* Templat klasik Kelompok Akses — baris izin per tab (modul inti + rincian). */
export const MODUL_INTU = [
  'dashboard',
  'penjualan',
  'pos',
  'pembelian',
  'purchase-order',
  'stok',
  'opname',
  'persediaan-sub',
  'akuntansi',
  'laporan',
  'master',
  'pengaturan',
  'proses-tahunan',
] as const;

export const MODUL_RINCIAN = [
  'master-item', 'master-supplier', 'master-pelanggan', 'master-sales',
  'master-gudang', 'master-datasheet', 'master-kartu-stok', 'master-hpp-item',
  'master-hpp-avg', 'master-hpp-datasheet', 'master-harga-item', 'master-harga-cari',
  'master-harga-info', 'master-sku-barcode', 'master-point', 'master-satuan',
  'beli-transaksi', 'beli-retur', 'beli-persetujuan',
  'jual-transaksi', 'jual-retur', 'jual-piutang',
  'rakit-produksi', 'rakit-bom',
  'sedia-saldo', 'sedia-masuk', 'sedia-keluar', 'sedia-opname', 'sedia-transfer',
  'akun-jurnal', 'akun-kasbank', 'akun-biaya', 'akun-laporan',
  'lap-penjualan', 'lap-stok', 'lap-keuangan',
  'tampil-dashboard', 'tampil-pos', 'tampil-riwayat',
  'lain-pengaturan', 'lain-proses-tahunan', 'lain-pengguna',
  'ecom-toko', 'ecom-sinkron',
  'notif-stok', 'notif-jatuh-tempo',
] as const;

export function daftarModul(): string[] {
  return [...MODUL_INTU, ...MODUL_RINCIAN];
}

export async function bacaHak(roleId: number, admin: boolean): Promise<Record<string, string[]>> {
  const semua = Object.fromEntries(daftarModul().map((m) => [m, [...SEMUA_AKSI]]));
  if (admin) return semua;
  const rows = await all<{ menu: string; aksi: string }>(
    'SELECT menu, aksi FROM role_permissions WHERE role_id = ?',
    roleId,
  );
  const keluar: Record<string, string[]> = {};
  for (const m of daftarModul()) keluar[m] = [];
  for (const r of rows) {
    if (!keluar[r.menu]) keluar[r.menu] = [];
    if (!keluar[r.menu].includes(r.aksi)) keluar[r.menu].push(r.aksi);
  }
  return keluar;
}

const KOLOM_KHUSUS_LAMA = ['lihat_hpp', 'ubah_harga_kasir', 'diskon_maks', 'hapus_transaksi', 'proses_tahunan'] as const;

function khususPenuh(): HakKhusus {
  return {
    lihat_hpp: true, ubah_harga_kasir: true, diskon_maks: 100, hapus_transaksi: true, proses_tahunan: true,
    void_retur: true, buka_tutup_shift: true, lihat_laba: true, ubah_stok_manual: true,
    sahkan_opname: true, hapus_massal: true, kelola_pengguna: true, ubah_pengaturan: true,
    akses_semua_toko: true,
  };
}

function khususKosong(): HakKhusus {
  return {
    lihat_hpp: false, ubah_harga_kasir: false, diskon_maks: 0, hapus_transaksi: false, proses_tahunan: false,
    void_retur: false, buka_tutup_shift: false, lihat_laba: false, ubah_stok_manual: false,
    sahkan_opname: false, hapus_massal: false, kelola_pengguna: false, ubah_pengaturan: false,
    akses_semua_toko: false,
  };
}

export async function bacaHakKhusus(roleId: number, admin: boolean): Promise<HakKhusus> {
  if (admin) return khususPenuh();
  let r: Record<string, unknown> | undefined;
  try {
    r = (await get<Record<string, unknown>>('SELECT * FROM role_hak_khusus WHERE role_id = ?', roleId));
  } catch {
    r = undefined;
  }
  if (!r) {
    // Peran buatan tanpa baris → default ketat (Owner menyalakan per izin).
    return khususKosong();
  }
  const ya = (k: string): boolean => (r as Record<string, unknown>)[k] === 1;
  const ada = (k: string): boolean => Object.prototype.hasOwnProperty.call(r, k);
  const keluar = khususKosong();
  // Kolom lama selalu ada; kolom AR2 dibaca bila migrasi 027 sudah jalan.
  keluar.lihat_hpp = ya('lihat_hpp');
  keluar.ubah_harga_kasir = ya('ubah_harga_kasir');
  keluar.diskon_maks = Number((r as Record<string, unknown>).diskon_maks) || 0;
  keluar.hapus_transaksi = ya('hapus_transaksi');
  keluar.proses_tahunan = ada('proses_tahunan') ? ya('proses_tahunan') : ya('hapus_transaksi');
  if (ada('void_retur')) keluar.void_retur = ya('void_retur');
  if (ada('buka_tutup_shift')) keluar.buka_tutup_shift = ya('buka_tutup_shift');
  if (ada('lihat_laba')) keluar.lihat_laba = ya('lihat_laba');
  if (ada('ubah_stok_manual')) keluar.ubah_stok_manual = ya('ubah_stok_manual');
  if (ada('sahkan_opname')) keluar.sahkan_opname = ya('sahkan_opname');
  if (ada('hapus_massal')) keluar.hapus_massal = ya('hapus_massal');
  if (ada('kelola_pengguna')) keluar.kelola_pengguna = ya('kelola_pengguna');
  if (ada('ubah_pengaturan')) keluar.ubah_pengaturan = ya('ubah_pengaturan');
  if (ada('akses_semua_toko')) keluar.akses_semua_toko = ya('akses_semua_toko');
  void KOLOM_KHUSUS_LAMA;
  return keluar;
}

/* -------------------------- endpoint sesi/autorisasi -------------------- */

const PUBLIK = new Set([
  '/health',
  '/meta',
  // AI4 — layar muat membaca identitas (nama, tagline, logo, aksen) tanpa
  // login; endpoint ini tidak mengembalikan data bisnis apa pun.
  '/tampilan/identitas-publik',
  '/auth/info',
  '/auth/masuk',
  '/auth/lupa',
  '/auth/lupa/kanal',
  '/auth/kirim-ulang',
  '/auth/reset',
  '/auth/pulihkan',
]);

/** Wajib sesi login untuk seluruh /api kecuali endpoint publik. */
export const wajibLogin: RequestHandler = async (req, res, next) => {
  if (PUBLIK.has(req.path)) return next();
  const token = bacaToken(req);
  const konteks = token ? await konteksDariToken(req, res, token) : null;
  if (!konteks) {
    res.status(401).json({ ok: false, pesan: 'Anda belum masuk atau sesi sudah berakhir. Silakan masuk kembali.' });
    return;
  }
  req.konteks = konteks;
  next();
};

/** Ambil konteks; melempar 401 bila tidak ada (dipakai handler API). */
export function konteksWajib(req: Request): Konteks {
  if (!req.konteks) throw tolak(401, 'Sesi berakhir. Silakan masuk kembali.');
  return req.konteks;
}

/* ------------------------------ sesi CRUD ------------------------------ */

export async function buatSesi(userId: number, ops: { ingat: boolean; perangkat: string; ip: string }): Promise<{ token: string; id: number }> {
  // Bersihkan sesi kedaluwarsa milik pengguna ini agar tidak menumpuk.
  await run('DELETE FROM sessions WHERE kadaluarsa IS NOT NULL AND kadaluarsa < ?', waktuSql());
  const token = crypto.randomBytes(32).toString('base64url');
  const res = await run(
    `INSERT INTO sessions (token, user_id, perangkat, ip, kadaluarsa, diingat, terakhir_aktif)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    token,
    userId,
    ops.perangkat,
    ops.ip,
    ops.ingat ? waktuSql(new Date(Date.now() + HARI_INGAT * 86_400_000)) : null,
    ops.ingat ? 1 : 0,
    waktuSql(),
  );
  return { token, id: res.lastInsertRowid as number };
}

export async function hapusSesi(token: string): Promise<void> {
  await run('DELETE FROM sessions WHERE token = ?', token);
}

export async function hapusSesiPengguna(userId: number, kecualiToken?: string): Promise<number> {
  const r = kecualiToken
    ? await run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', userId, kecualiToken)
    : await run('DELETE FROM sessions WHERE user_id = ?', userId);
  return r.changes;
}

/** Perangkat singkat dari User-Agent (untuk daftar sesi di Keamanan). */
export function perangkatDariUA(ua: string | undefined): string {
  if (!ua) return 'Perangkat tidak dikenal';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Peramban';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export function ipDariReq(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? '').replace('::ffff:', '') || '-';
}

/* --------------------------- akun Admin awal ---------------------------- */

/**
 * Dijalankan sekali saat server naik: memastikan ada akun `admin`
 * (dibuat otomatis pada jalannya pertama) dengan password awal bcrypt dan
 * tanda "wajib ganti password saat login pertama".
 */
export async function pastikanAdminAwal(): Promise<void> {
  const role = await get<{ id: number }>("SELECT id FROM roles WHERE lower(nama) = 'administrator' LIMIT 1");
  let roleId = role?.id;
  if (!roleId) {
    roleId = await ((await run("INSERT INTO roles (nama, bawaan) VALUES ('Administrator', TRUE)"))).lastInsertRowid as number;
  }

  const ada = await get<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE lower(trim(username)) = 'admin' LIMIT 1",
  );
  if (ada) return;

  // Nama login Administrator dapat diganti oleh pemilik akun. Jangan membuat
  // akun bawaan kedua bila role Administrator sudah memiliki akun aktif.
  const akunAdministrator = await get<{ id: number }>(
    "SELECT id FROM users WHERE role_id = ? AND aktif = TRUE ORDER BY id LIMIT 1",
    roleId,
  );
  if (akunAdministrator) {
    console.warn('[LOGIN] Akun Administrator sudah ada dengan username kustom; tidak membuat akun admin bawaan baru.');
    return;
  }

  await run(
    `INSERT INTO users (nama, username, password_hash, role_id, wajib_ganti, sandi_diubah_pada)
     VALUES ('Administrator', 'admin', ?, ?, TRUE, ?)`,
    hashSandi(SANDI_ADMIN_AWAL),
    roleId,
    waktuSql(),
  );
  console.log('[LOGIN] Akun Administrator awal dibuat; password wajib diganti saat login pertama.');
}
