// Fasilitas sistem untuk Pengaturan ▸ Keamanan & Sistem:
// info database, backup manual/terjadwal, pemulihan, dan pemeriksaan pembaruan.
//
// Backup memakai `pg_dump` format custom (.dump) sehingga menghasilkan
// cadangan konsisten tanpa mengunci tulis (aman dipakai saat aplikasi aktif).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { all, DATABASE_URL, get, lupakanCacheTabel, ROOT_DIR, run } from '../db.pg.ts';
import { kosongkanIndeksCocok } from './cocok.ts';
import { kosongkanCacheLaporan } from './laporanDasar.ts';
import { kosongkanCacheRegional } from './zonaWaktu.ts';
import { tolak } from './http.ts';

const execFileAsync = promisify(execFile);

/** Folder cadangan — dibuat saat dibutuhkan, tidak ikut disalin sebagai aset. */
export const LOKASI_BACKUP = path.join(ROOT_DIR, 'data', 'backups');
/** Ekstensi warisan: cadangan format custom pg_dump (masih bisa dibaca/dipulihkan). */
export const EKSTENSI_CADANGAN = '.dump';
/** Format cadangan utama: SQL polos pg_dump yang dikompresi gzip. */
export const EKSTENSI_SQL_GZ = '.sql.gz';
/** Awalan penamaan otomatis: nusa_backup_v<versi>_YYYYMMDD_HHMMSS.sql.gz */
export const AWALAN_BACKUP = 'nusa_backup_';
/** Checkpoint pengaman otomatis — dibuat SEBELUM setiap restore, dikecualikan
 * dari rotasi/penghapusan otomatis. */
export const NAMA_CHECKPOINT = 'pre_restore_checkpoint.sql.gz';
/** Tipe pencatatan asal cadangan pada tabel riwayat. */
export type TipeBackup = 'manual' | 'otomatis' | 'pengaman';

/* ------------------------- Mode Maintenance ------------------------- */
// Saat restore berjalan, tulis dari pengguna lain dikunci: middleware
// memblokir /api non-backup dengan 503 + kode 'maintenance' dan klien
// menampilkan layar maintenance sampai restore selesai.
let maintenanceAktif = false;

export function aktifkanMaintenance(): void {
  maintenanceAktif = true;
}
export function nonaktifkanMaintenance(): void {
  maintenanceAktif = false;
}
export function sedangMaintenance(): boolean {
  return maintenanceAktif;
}

/**
 * Cari biner perkakas PostgreSQL (pg_dump/pg_restore/psql).
 * Urutan: env PG_BIN_DIR → PATH → lokasi baku instalasi Windows.
 */
function cariBiner(nama: string): string {
  const dariEnv = process.env.PG_BIN_DIR?.trim();
  if (dariEnv) {
    const p = path.join(dariEnv, process.platform === 'win32' ? `${nama}.exe` : nama);
    if (fs.existsSync(p)) return p;
  }
  const bakuWin = String.raw`C:\Program Files\PostgreSQL\18\bin`;
  const calonWin = path.join(bakuWin, `${nama}.exe`);
  if (process.platform === 'win32' && fs.existsSync(calonWin)) return calonWin;
  return nama; // andalkan PATH
}

function pastikanDatabaseUrl(): string {
  if (!DATABASE_URL) throw tolak(500, 'DATABASE_URL belum disetel — cadangan PostgreSQL tidak dapat dibuat.');
  return DATABASE_URL;
}

/** Versi aplikasi (diambil dari package.json — satu sumber kebenaran). */
export function versiAplikasi(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface InfoSistem {
  versi: string;
  namaDatabase: string;
  ukuranDb: number;
  waktuDatabase: string;
  migrasi: number;
  ringkasan: { nama: string; jumlah: number }[];
}

function ukuranBerkas(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** Informasi database aktif + ringkasan jumlah data penting. */
export async  function infoSistem(): Promise<InfoSistem> {
  const hitung = async (sql: string): Promise<number> => {
    try {
      return Number((await get<{ n: number }>(sql))?.n ?? 0);
    } catch {
      return 0;
    }
  };
  // PostgreSQL tidak memakai tabel schema_migrations SQLite — jumlah berkas
  // migrasi PG (pg-migrations/*.sql) dipakai sebagai angka pembanding.
  let migrasi = 0;
  try {
    migrasi = fs.readdirSync(path.join(ROOT_DIR, 'pg-migrations')).filter((f) => f.endsWith('.sql')).length;
  } catch {
    migrasi = 0;
  }
  // Ukuran database aktif langsung dari PostgreSQL.
  let namaDb = '';
  let ukuranDb = 0;
  try {
    const info = await get<{ nama: string; ukuran: number }>(`SELECT current_database() AS nama, pg_database_size(current_database()) AS ukuran`);
    namaDb = info?.nama ?? '';
    ukuranDb = Number(info?.ukuran ?? 0);
  } catch {
    /* database tak terjangkau — laporkan nol */
  }
  return {
    versi: versiAplikasi(),
    namaDatabase: namaDb ? `${namaDb} (PostgreSQL)` : 'PostgreSQL',
    ukuranDb,
    waktuDatabase: new Date().toISOString(),
    migrasi,
    ringkasan: [
      { nama: 'Produk', jumlah: await hitung('SELECT COUNT(*) AS n FROM products') },
      { nama: 'Toko', jumlah: await hitung('SELECT COUNT(*) AS n FROM stores') },
      { nama: 'Gudang', jumlah: await hitung('SELECT COUNT(*) AS n FROM warehouses') },
      { nama: 'Pelanggan', jumlah: await hitung('SELECT COUNT(*) AS n FROM customers') },
      { nama: 'Pemasok', jumlah: await hitung('SELECT COUNT(*) AS n FROM suppliers') },
      { nama: 'Penjualan (faktur)', jumlah: await hitung(`SELECT COUNT(*) AS n FROM invoices WHERE jenis = 'penjualan'`) },
      { nama: 'Pembelian', jumlah: await hitung('SELECT COUNT(*) AS n FROM purchases') },
      { nama: 'Jurnal', jumlah: await hitung('SELECT COUNT(*) AS n FROM journals') },
      { nama: 'Akun (COA)', jumlah: await hitung('SELECT COUNT(*) AS n FROM accounts') },
      { nama: 'Pengguna', jumlah: await hitung('SELECT COUNT(*) AS n FROM users') },
      { nama: 'Baris Log Aktivitas', jumlah: await hitung('SELECT COUNT(*) AS n FROM audit_logs') },
    ],
  };
}

export interface BarisBackup {
  nama: string;
  ukuran: number;
  waktu: string;
}

/** true bila nama berkas adalah format cadangan yang dikenal aplikasi. */
export function berkasCadanganDikenal(nama: string): boolean {
  // .dump (custom lama), .sql.gz (utama), .tar (pg_dump tar yang diunggah/ditempatkan manual).
  return nama.endsWith(EKSTENSI_CADANGAN) || nama.endsWith(EKSTENSI_SQL_GZ) || nama.endsWith('.tar');
}

/** Daftar berkas cadangan, terbaru lebih dulu. Format lama (.dump) dan baru
 * (.sql.gz) sama-sama tampil; berkas sementara validasi/unggah disembunyikan. */
export function daftarBackup(): BarisBackup[] {
  try {
    if (!fs.existsSync(LOKASI_BACKUP)) return [];
    return fs
      .readdirSync(LOKASI_BACKUP)
      .filter((f) => berkasCadanganDikenal(f))
      .map((f) => {
        const p = path.join(LOKASI_BACKUP, f);
        const st = fs.statSync(p);
        return { nama: f, ukuran: st.size, waktu: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.waktu < b.waktu ? 1 : -1));
  } catch {
    return [];
  }
}

const AMAN = /^[A-Za-z0-9._-]+\.(dump|sql\.gz|tar)$/;

/** Stempel lokal: YYYYMMDD_HHMMSS (waktu server) untuk penamaan berkas. */
function stempelLokal(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface OpsiBackup {
  /** Asal cadangan (tercatat di audit & tampil di kolom Tipe). */
  tipe?: TipeBackup;
  /** Nama berkas tetap (dipakai checkpoint pengaman — menimpa yang lama). */
  namaTetap?: string;
  /** true = lewati rotasi/retensi (dipakai checkpoint & cadangan darurat). */
  lewatiRetensi?: boolean;
  /** id pengguna pembuat (null untuk backup terjadwal). */
  pembuat?: number | null;
}

/* ---------------------- Riwayat di tabel system_backups ------------------ */
let tabelBackupSiap = false;

/** Pastikan tabel riwayat backup ada (idempoten, aman bila migrasi belum jalan). */
async function pastikanTabelBackup(): Promise<void> {
  if (tabelBackupSiap) return;
  try {
    await run(`CREATE TABLE IF NOT EXISTS system_backups (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      nama TEXT NOT NULL UNIQUE,
      ukuran BIGINT NOT NULL DEFAULT 0,
      tipe TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'sukses',
      galat TEXT,
      dibuat_oleh BIGINT REFERENCES users(id) ON DELETE SET NULL,
      dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now())`);
    tabelBackupSiap = true;
  } catch (e) {
    // Tabel opsional: kegagalan di sini tidak boleh menggagalkan backup.
    console.warn('[backup] tabel system_backups tidak siap:', pesanGalat(e));
  }
}

/** Catat satu hasil backup (sukses/gagal) ke system_backups. */
async function catatBarisBackup(data: {
  nama: string;
  ukuran: number;
  tipe: TipeBackup;
  status: 'sukses' | 'gagal';
  galat?: string | null;
  pembuat?: number | null;
}): Promise<void> {
  await pastikanTabelBackup();
  try {
    await run(
      `INSERT INTO system_backups (nama, ukuran, tipe, status, galat, dibuat_oleh, dibuat_pada)
       VALUES (?, ?, ?, ?, ?, ?, now())
       ON CONFLICT (nama) DO UPDATE SET
         ukuran = excluded.ukuran, tipe = excluded.tipe, status = excluded.status,
         galat = excluded.galat, dibuat_oleh = COALESCE(excluded.dibuat_oleh, system_backups.dibuat_oleh)`,
      data.nama,
      Math.max(0, Math.round(data.ukuran)),
      data.tipe,
      data.status,
      data.galat ?? null,
      data.pembuat ?? null,
    );
  } catch (e) {
    console.warn('[backup] gagal mencatat system_backups:', pesanGalat(e));
  }
}

/**
 * Buat satu cadangan `nusa_backup_v<versi>_YYYYMMDD_HHMMSS.sql.gz`.
 * pg_dump SQL polos (--clean agar bisa dipulihkan menimpa) yang dikompresi
 * gzip via Node — tanpa mengunci tulis, aman dipakai saat aplikasi aktif.
 * Mengembalikan nama berkas hasil cadangan.
 */
export async  function buatBackup(alasan: string, opsi: OpsiBackup = {}): Promise<string> {
  const url = pastikanDatabaseUrl();
  fs.mkdirSync(LOKASI_BACKUP, { recursive: true });
  // Nama harus unik: dua cadangan bisa dibuat dalam detik yang sama
  // (mis. cadangan pengaman saat pemulihan langsung mengikuti cadangan manual).
  // Nama memuat timestamp + versi aplikasi: nusa_backup_v0.1.0_YYYYMMDD_HHMMSS.
  const stempel = stempelLokal();
  const namaDasar = `${AWALAN_BACKUP}v${versiAplikasi()}_${stempel}`;
  let nama = opsi.namaTetap ?? `${namaDasar}${EKSTENSI_SQL_GZ}`;
  if (!opsi.namaTetap) {
    let urut = 1;
    while (fs.existsSync(path.join(LOKASI_BACKUP, nama))) {
      nama = `${namaDasar}-${urut++}${EKSTENSI_SQL_GZ}`;
    }
  }
  const tujuan = path.join(LOKASI_BACKUP, nama);
  const tempSql = `${tujuan}.${process.pid}.tmp.sql`;
  try {
    await execFileAsync(cariBiner('pg_dump'), [
      '--dbname=' + url, '--format=plain', '--no-owner',
      '--clean', '--if-exists', '--file=' + tempSql,
    ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    await pipeline(fs.createReadStream(tempSql), zlib.createGzip({ level: 6 }), fs.createWriteStream(tujuan));
  } catch (e) {
    for (const f of [tujuan, tempSql]) { try { fs.unlinkSync(f); } catch { /* abaikan */ } }
    await catatBarisBackup({
      nama, ukuran: 0, tipe: opsi.tipe ?? 'manual', status: 'gagal',
      galat: pesanGalat(e), pembuat: opsi.pembuat ?? null,
    });
    throw tolak(500, `Cadangan gagal dibuat — pastikan perkakas PostgreSQL (pg_dump) terpasang. (${pesanGalat(e)})`);
  } finally {
    try { fs.unlinkSync(tempSql); } catch { /* abaikan */ }
  }
  if (!fs.existsSync(tujuan) || ukuranBerkas(tujuan) === 0) {
    await catatBarisBackup({
      nama, ukuran: 0, tipe: opsi.tipe ?? 'manual', status: 'gagal',
      galat: 'Berkas cadangan kosong', pembuat: opsi.pembuat ?? null,
    });
    throw tolak(500, 'Cadangan gagal dibuat — periksa izin folder data/backups.');
  }
  await catatBarisBackup({
    nama, ukuran: ukuranBerkas(tujuan), tipe: opsi.tipe ?? 'manual', status: 'sukses',
    pembuat: opsi.pembuat ?? null,
  });
  if (!opsi.lewatiRetensi) await bersihkanCadanganLama();
  // Hook penyimpanan luar (opsional): bila BACKUP_CLOUD_CMD disetel, jalankan
  // perintah itu dengan path berkas sebagai argumen. Kegagalan hook hanya
  // dicatat — tidak menggagalkan cadangan lokal yang sudah jadi.
  if (!opsi.namaTetap) void unggahKeEksternal(tujuan);
  void alasan;
  return nama;
}

/** Hook/cloud storage luar: BACKUP_CLOUD_CMD="/jalur/skrip.sh" (menerima path berkas). */
export async function unggahKeEksternal(lokasiBerkas: string): Promise<void> {
  const cmd = process.env.BACKUP_CLOUD_CMD?.trim();
  if (!cmd) return;
  try {
    await execFileAsync(cmd, [lokasiBerkas], { timeout: 300_000 });
  } catch (e) {
    console.warn(`[backup] hook cloud gagal untuk ${path.basename(lokasiBerkas)}: ${pesanGalat(e)}`);
  }
}

function pesanGalat(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message).slice(0, 200);
  return String(e).slice(0, 200);
}

/**
 * Retensi ganda: simpan maksimal N cadangan terbaru (pengaturan jumlah
 * backup) DAN hapus cadangan lokal berumur > retensi_hari (bawaan 30).
 * Checkpoint pengaman tidak pernah dihapus otomatis.
 */
export async  function bersihkanCadanganLama(): Promise<void> {
  const batas = Math.max(1, Math.min(100, await bacaJumlahCadangan()));
  const umurMaksMs = Math.max(1, Math.min(365, await bacaRetensiHari())) * 24 * 3600 * 1000;
  const kini = Date.now();
  const biasa = daftarBackup().filter((b) => b.nama !== NAMA_CHECKPOINT);
  for (const [i, b] of biasa.entries()) {
    const terlaluBanyak = i >= batas;
    let terlaluTua = false;
    try {
      terlaluTua = kini - fs.statSync(path.join(LOKASI_BACKUP, b.nama)).mtimeMs > umurMaksMs;
    } catch {
      terlaluTua = false;
    }
    if (!terlaluBanyak && !terlaluTua) continue;
    try {
      fs.unlinkSync(path.join(LOKASI_BACKUP, b.nama));
    } catch {
      /* berkas terkunci — biarkan */
    }
  }
  // Bersihkan sisa sementara validasi/unggah yang yatim (>1 hari).
  try {
    for (const f of fs.readdirSync(LOKASI_BACKUP)) {
      if (!/\.(tmp\.sql|tmp)$/.test(f) && !f.startsWith('unggah-')) continue;
      const p = path.join(LOKASI_BACKUP, f);
      try {
        if (kini - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(p);
      } catch { /* abaikan */ }
    }
  } catch { /* abaikan */ }
}

/** Batas umur cadangan lokal (hari) — pengaturan `retensi_hari`, bawaan 30. */
export async function bacaRetensiHari(): Promise<number> {
  const v = await ((await all<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'peng.database.retensi_hari'`)))[0]?.nilai;
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(365, n) : 30;
}

export async function bacaJumlahCadangan(): Promise<number> {
  const v = await ((await all<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'peng.database.jumlah_backup'`)))[0]?.nilai;
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/** Path berkas cadangan — hanya nama aman yang boleh diminta. */
export function pathBackup(nama: string): string {
  if (!AMAN.test(nama)) throw tolak(400, 'Nama berkas cadangan tidak valid.');
  const p = path.join(LOKASI_BACKUP, nama);
  if (!fs.existsSync(p)) throw tolak(404, `Cadangan "${nama}" tidak ditemukan.`);
  return p;
}

/**
 * Pulihkan database dari cadangan.
 *
 * PERINGATAN: menimpa seluruh isi database aktif dengan isi cadangan.
 *
 * Isi disalin TABEL PER TABEL di dalam satu transaksi, bukan dengan menimpa
 * berkas database. Menimpa berkas di bawah koneksi SQLite yang sedang terbuka
 * membuat koneksi terus menulis ke berkas lama dan merusak disk image —
 * jadi salinan dilakukan lewat SQLite sendiri agar aman saat aplikasi berjalan.
 */
export async  function pulihkanBackup(nama: string): Promise<string> {
  return pulihkanDariBerkas(pathBackup(nama));
}

/** Awalan ajaib berkas pg_dump format custom ("PGDMP") — validasi isi, bukan sekadar ekstensi. */
const SULAP_PGDMP = Buffer.from('PGDMP', 'ascii');

/** Format cadangan yang dikenali — dideteksi dari ISI berkas, bukan ekstensi. */
export type FormatCadangan = 'sqldump-gzip' | 'sqldump-plain' | 'pgdump-custom' | 'pgdump-tar';

/** Tabel inti yang wajib ada agar cadangan dianggap utuh. */
const TABEL_INTI = ['users', 'products', 'stores', 'invoices', 'journals', 'settings'];

/**
 * Validasi integritas berkas cadangan SEBELUM data ditimpa:
 *  1. deteksi format dari ISI (gzip / PGDMP / arsip tar / SQL polos),
 *  2. ukuran minimum wajar,
 *  3. untuk SQL (termasuk isi .sql.gz): header dump PostgreSQL + tabel inti.
 * Mengembalikan format yang terdeteksi; melempar 409 bila tidak valid.
 */
/** Baca potongan awal berkas tanpa memuat seluruh isi backup yang besar. */
function bacaAwal(sumber: string, jumlah: number): Buffer {
  const fd = fs.openSync(sumber, 'r');
  try {
    const buf = Buffer.alloc(Math.max(1, jumlah));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

export function validasiBerkasCadangan(sumber: string): FormatCadangan {
  try {
    const st = fs.statSync(sumber);
    if (!st.isFile() || st.size < 16) {
      throw tolak(409, 'Berkas cadangan rusak atau kosong. Pulihkan dari cadangan lain.');
    }
    const awal = bacaAwal(sumber, 512);
    if (awal.length >= 2 && awal[0] === 0x1f && awal[1] === 0x8b) {
      validasiIsiSqlGz(sumber);
      return 'sqldump-gzip';
    }
    if (awal.length >= 5 && awal.subarray(0, 5).equals(SULAP_PGDMP)) return 'pgdump-custom';
    // Arsip tar pg_dump: header "ustar" + entri toc.dat di blok pertama.
    if (awal.length >= 262 && awal.subarray(257, 262).toString('ascii') === 'ustar') {
      const potongan = bacaAwal(sumber, Math.min(st.size, 4 * 1024 * 1024));
      if (!potongan.includes('toc.dat')) {
        throw tolak(409, 'Arsip tar bukan cadangan pg_dump yang valid (toc.dat tidak ditemukan).');
      }
      return 'pgdump-tar';
    }
    // SQL polos (mis. hasil pg_dump tanpa kompresi) — validasi teksnya.
    const teks = bacaAwal(sumber, Math.min(st.size, 8 * 1024 * 1024)).toString('utf8');
    validasiIsiSql(teks);
    return 'sqldump-plain';
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw tolak(409, 'Berkas cadangan tidak dapat dibaca. Pulihkan dari cadangan lain.');
  }
}

/** Validasi teks dump SQL: header pg_dump + tabel inti harus lengkap. */
function validasiIsiSql(teks: string): void {
  if (!teks.includes('PostgreSQL database dump') && !/CREATE TABLE/i.test(teks)) {
    throw tolak(409, 'Isi berkas bukan dump PostgreSQL yang valid.');
  }
  const hilang = TABEL_INTI.filter((t) => !new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?(public\\.)?"?${t}\\b`, 'i').test(teks));
  if (hilang.length > 0) {
    throw tolak(409, `Struktur cadangan tidak lengkap — tabel hilang: ${hilang.join(', ')}. Batalkan: berkas corrupt.`);
  }
}

function validasiIsiSqlGz(sumber: string): void {
  const temp = `${sumber}.${process.pid}.validasi.tmp.sql`;
  try {
    const data = fs.readFileSync(sumber);
    const teks = zlib.gunzipSync(data).toString('utf8');
    fs.writeFileSync(temp, teks.slice(0, 4 * 1024 * 1024), 'utf8');
    validasiIsiSql(teks);
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw tolak(409, 'Berkas .sql.gz rusak atau bukan gzip valid. Pulihkan dari cadangan lain.');
  } finally {
    try { fs.unlinkSync(temp); } catch { /* abaikan */ }
  }
}

/** Kata konfirmasi restore yang sah (UI memakai "RESTORE"). */
export function konfirmasiRestoreBenar(konfirmasi: unknown): boolean {
  return konfirmasi === 'RESTORE' || konfirmasi === 'PULIHKAN';
}

/**
 * Pulihkan database aktif dari BERKAS cadangan apa pun (folder cadangan
 * maupun unggahan) — dengan protokol keamanan penuh:
 *  1. validasi integritas berkas (signature + skema) SEBELUM menyentuh data,
 *  2. auto-safety checkpoint: cadangan penuh keadaan sekarang,
 *  3. mode maintenance: kunci tulis pengguna lain selama proses,
 *  4. restore atomik satu-transaksi: gagal di tengah = tergulung otomatis
 *     (auto-rollback) — database lama utuh + checkpoint tersedia.
 * Mengembalikan nama checkpoint pengaman.
 */
export async function pulihkanDariBerkas(sumber: string): Promise<string> {
  const url = pastikanDatabaseUrl();
  const format = validasiBerkasCadangan(sumber);
  const pengaman = await buatBackup('pengaman-otomatis-sebelum-restore', {
    namaTetap: NAMA_CHECKPOINT, lewatiRetensi: true, tipe: 'pengaman',
  });
  aktifkanMaintenance();
  try {
    // Putuskan sesi lain (psql/pgAdmin/dll) agar tidak menahan lock saat restore.
    await putuskanKoneksiAktif();
    if (format === 'pgdump-custom' || format === 'pgdump-tar') {
      await execFileAsync(cariBiner('pg_restore'), [
        '--dbname=' + url, '--clean', '--if-exists', '--no-owner', '--single-transaction', sumber,
      ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    } else if (format === 'sqldump-gzip') {
      const tempSql = `${sumber}.${process.pid}.restore.tmp.sql`;
      try {
        await pipeline(fs.createReadStream(sumber), zlib.createGunzip(), fs.createWriteStream(tempSql));
        await jalankanPsql(url, tempSql);
      } finally {
        try { fs.unlinkSync(tempSql); } catch { /* abaikan */ }
      }
    } else {
      // SQL polos: langsung dipulihkan dari berkas sumber.
      await jalankanPsql(url, sumber);
    }
    await verifikasiIntegritasDasar();
    // Perbarui metadata planner (statistik) setelah data diganti.
    try {
      await run('ANALYZE');
    } catch (e) {
      console.warn('[restore] ANALYZE gagal (tidak fatal):', pesanGalat(e));
    }
    // Segarkan cache server agar permintaan berikutnya membaca data pasca-restore.
    kosongkanIndeksCocok();
    kosongkanCacheLaporan();
    kosongkanCacheRegional();
    lupakanCacheTabel();
    // Backup lama mungkin belum memuat system_backups — pastikan dibuat lagi
    // saat riwayat berikutnya dicatat.
    tabelBackupSiap = false;
  } catch (e) {
    throw tolak(409, `Pemulihan gagal — database TIDAK diubah (transaksi dibatalkan otomatis). Cadangan pengaman: ${pengaman}. (${pesanGalat(e)})`);
  } finally {
    nonaktifkanMaintenance();
  }
  return pengaman;
}

/** Jalankan psql satu transaksi dengan ON_ERROR_STOP (gagal = rollback). */
async function jalankanPsql(url: string, berkasSql: string): Promise<void> {
  await execFileAsync(cariBiner('psql'), [
    '--dbname=' + url, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--quiet', '--file=' + berkasSql,
  ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Putuskan koneksi/sesi lain ke database aktif sebelum restore.
 * Sesi milik proses ini (pg_backend_pid) dikecualikan; pool adapter akan
 * membuat koneksi baru pada permintaan berikutnya.
 */
async function putuskanKoneksiAktif(): Promise<void> {
  try {
    const db = await get<{ nama: string }>('SELECT current_database() AS nama');
    const nama = String(db?.nama ?? '');
    if (!nama) return;
    await run(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = ? AND pid <> pg_backend_pid()`,
      nama,
    );
    // Beri waktu singkat agar lock sesi yang diputus benar-benar dilepas.
    await tunggu(300);
  } catch (e) {
    // Kegagalan pemutusan sesi tidak menghentikan restore (bukan pemeriksaan izin).
    console.warn('[restore] gagal memutus koneksi aktif:', pesanGalat(e));
  }
}

/** tidur singkat untuk memberi waktu pool melepas koneksi yang terputus. */
const tunggu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pemeriksaan pasca-restore: tabel inti harus ada & bisa dibaca.
 * Koneksi yang terputus oleh pg_terminate_backend dicoba ulang sekali-dua kali.
 */
async function verifikasiIntegritasDasar(): Promise<void> {
  for (const t of TABEL_INTI) {
    const nama = t.replace(/"/g, '""');
    let terakhir: unknown = null;
    let ok = false;
    for (let coba = 0; coba < 3 && !ok; coba += 1) {
      try {
        await get(`SELECT 1 AS ok FROM "${nama}" LIMIT 1`);
        ok = true;
      } catch (e) {
        terakhir = e;
        await tunggu(250 * (coba + 1));
      }
    }
    if (!ok) {
      console.warn('[restore] verifikasi gagal:', pesanGalat(terakhir));
      throw tolak(409, 'Verifikasi pasca-restore gagal — struktur database tidak lengkap.');
    }
  }
}


/**
 * Restore database dari berkas yang DIUNGGAH pengguna (alur tombol "Restore
 * Database"). Terisolasi dari alur backup/vacuum/reindex: memakai inti
 * yang sama dengan pulihkanBackup sehingga perilaku transaksional identik.
 *
 * Langkah: validasi isi pg_dump (.dump) → tulis berkas sementara →
 * cadangan pengaman otomatis dari database aktif → pulihkan
 * (satu transaksi; gagal = tergulung otomatis, database lama utuh) →
 * hapus berkas sementara.
 * Mengembalikan nama cadangan pengaman (untuk audit/pesan).
 */
export async  function pulihkanDariUnggahan(isi: Buffer, namaAsli: string): Promise<string> {
  const namaBawah = String(namaAsli ?? '').toLowerCase();
  if (/\.(db|sqlite|sqlite3)$/.test(namaBawah)) {
    throw tolak(400, 'Berkas SQLite (.db/.sqlite) tidak berlaku untuk database PostgreSQL. Unggah dump PostgreSQL: .sql, .sql.gz, .dump, atau .tar.');
  }
  if (!/\.(sql|sql\.gz|dump|tar)$/.test(namaBawah)) {
    throw tolak(400, 'Ekstensi berkas tidak didukung. Unggah cadangan aplikasi (.sql, .sql.gz, .dump, atau .tar).');
  }
  if (!isi || isi.length < 16) {
    throw tolak(400, 'Berkas unggahan kosong atau terlalu kecil untuk cadangan valid.');
  }
  // Format asli dideteksi dari ISI berkas (bukan ekstensi) saat validasi
  // di pulihkanDariBerkas; ekstensi temp hanya penanda berkas.
  const ekstensi = namaBawah.endsWith('.sql.gz') ? '.sql.gz' : namaBawah.endsWith('.tar') ? '.tar' : namaBawah.endsWith('.dump') ? '.dump' : '.sql';
  fs.mkdirSync(LOKASI_BACKUP, { recursive: true });
  const temp = path.join(LOKASI_BACKUP, `unggah-${stempelLokal()}${ekstensi}`);
  try {
    fs.writeFileSync(temp, isi);
    return await pulihkanDariBerkas(temp);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* berkas sementara — abaikan */ }
  }
}

/* ------------------------- Hapus / riwayat / jadwal ------------------------- */

/**
 * Hapus satu berkas cadangan dari server. Checkpoint pengaman tidak boleh
 * dihapus (ditimpa otomatis tiap restore).
 */
export async function hapusBackup(nama: string): Promise<void> {
  if (nama === NAMA_CHECKPOINT) {
    throw tolak(400, 'Checkpoint pengaman tidak boleh dihapus — ditimpa otomatis setiap restore.');
  }
  const p = pathBackup(nama);
  try {
    fs.unlinkSync(p);
  } catch {
    throw tolak(500, `Gagal menghapus "${nama}" — berkas mungkin sedang dipakai.`);
  }
}

export interface RiwayatBackup extends BarisBackup {
  /** Asal cadangan: manual / otomatis / pengaman. */
  tipe: TipeBackup;
  /** File di disk = sukses. Gagal hanya muncul dari audit (ukuran 0). */
  status: 'sukses' | 'gagal';
  /** Pesan galat untuk status gagal. */
  galat?: string;
}

/**
 * Riwayat backup: berkas di disk (status sukses, tipe dari audit terakhir)
 * + kegagalan tercatat di audit 30 hari terakhir (status gagal).
 */
export async function riwayatBackup(): Promise<RiwayatBackup[]> {
  const berkas = daftarBackup();
  const tipeDariAudit = new Map<string, { tipe: TipeBackup; waktu: string }>();
  const gagal: RiwayatBackup[] = [];
  try {
    const baris = await all<{ waktu: string; data_sesudah: string | null }>(`
      SELECT waktu, data_sesudah FROM audit_logs
      WHERE tabel = 'pengaturan' AND record_id = 'database' AND aksi IN ('tambah', 'ubah')
      ORDER BY id DESC LIMIT 300`);
    for (const b of baris) {
      let s: Record<string, unknown> = {};
      try { s = JSON.parse(String(b.data_sesudah ?? '{}')) as Record<string, unknown>; } catch { continue; }
      const waktuAudit = (() => {
        try { return new Date(String(b.waktu)).toISOString(); } catch { return new Date(0).toISOString(); }
      })();
      const namaOk = typeof s.cadangan === 'string' ? s.cadangan : '';
      if (namaOk && !tipeDariAudit.has(namaOk)) {
        const t = s.tipe === 'otomatis' ? 'otomatis' : s.tipe === 'pengaman' ? 'pengaman' : 'manual';
        tipeDariAudit.set(namaOk, { tipe: t, waktu: waktuAudit });
      }
      const namaGagal = typeof s.cadangan_gagal === 'string' ? s.cadangan_gagal : '';
      if (namaGagal && Date.now() - Date.parse(waktuAudit) < 30 * 24 * 3600 * 1000) {
        gagal.push({
          nama: namaGagal, ukuran: 0, waktu: waktuAudit,
          tipe: s.tipe === 'otomatis' ? 'otomatis' : 'manual',
          status: 'gagal', galat: typeof s.galat === 'string' ? s.galat : undefined,
        });
      }
    }
  } catch {
    /* audit tak terbaca — tipe bawaan manual */
  }
  // Kegagalan yang tercatat di system_backups (mis. backup manual gagal) tetap
  // tampil walau audit tidak sempat ditulis.
  try {
    await pastikanTabelBackup();
    const gagalDb = await all<{ nama: string; tipe: string; galat: string | null; dibuat_pada: string }>(
      `SELECT nama, tipe, galat, dibuat_pada FROM system_backups
        WHERE status = 'gagal' AND dibuat_pada > now() - interval '30 days'
        ORDER BY id DESC LIMIT 200`,
    );
    const adaGagal = new Set(gagal.map((g) => g.nama));
    for (const g of gagalDb) {
      if (adaGagal.has(g.nama)) continue;
      const waktu = (() => {
        try { return new Date(String(g.dibuat_pada)).toISOString(); } catch { return new Date().toISOString(); }
      })();
      gagal.push({
        nama: g.nama, ukuran: 0, waktu,
        tipe: g.tipe === 'otomatis' ? 'otomatis' : g.tipe === 'pengaman' ? 'pengaman' : 'manual',
        status: 'gagal', galat: g.galat ?? undefined,
      });
      adaGagal.add(g.nama);
    }
  } catch {
    /* tabel riwayat opsional — abaikan */
  }
  const ok: RiwayatBackup[] = berkas.map((b) => ({
    ...b,
    tipe: b.nama === NAMA_CHECKPOINT ? 'pengaman' : (tipeDariAudit.get(b.nama)?.tipe ?? 'manual'),
    status: 'sukses' as const,
  }));
  const ada = new Set(berkas.map((b) => b.nama));
  return [...ok, ...gagal.filter((g) => !ada.has(g.nama))].sort((a, b) => (a.waktu < b.waktu ? 1 : -1));
}

/** Mode jadwal backup: interval tetap, kalender, atau interval kustom. */
export type ModeJadwal = 'mati' | '4jam' | '6jam' | '12jam' | 'harian' | 'mingguan' | 'bulanan' | 'kustom';
export type SatuanInterval = 'menit' | 'jam';

export interface StatusJadwal {
  mode: ModeJadwal;
  jam: string;
  jumlah: number;
  retensi_hari: number;
  /** Nilai input interval kustom (mis. 4). */
  interval_nilai: number;
  /** Satuan interval kustom: menit / jam. */
  interval_satuan: SatuanInterval;
  terakhir_otomatis: string | null;
  berikutnya: string | null;
  maintenance: boolean;
}

/** Interval tetap untuk mode 4/6/12 jam (dalam menit). */
const INTERVAL_TETAP: Record<string, number> = { '4jam': 240, '6jam': 360, '12jam': 720 };

/** Interval efektif (menit) untuk mode interval/kustom. */
async function menitInterval(mode: ModeJadwal): Promise<number> {
  if (INTERVAL_TETAP[mode]) return INTERVAL_TETAP[mode];
  if (mode !== 'kustom') return 0;
  const satuan: SatuanInterval = (await bacaPengaturanBackup('interval_satuan')) === 'menit' ? 'menit' : 'jam';
  const mentah = Number.parseInt((await bacaPengaturanBackup('interval_nilai')) ?? '', 10);
  const nilai = Number.isFinite(mentah) && mentah > 0 ? mentah : 4;
  return (satuan === 'jam' ? Math.min(168, nilai) : Math.min(1440, nilai)) * (satuan === 'jam' ? 60 : 1);
}

async function bacaPengaturanBackup(kunci: string): Promise<string | null> {
  try {
    return ((await all<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'peng.database.${kunci}'`)))[0]?.nilai ?? null;
  } catch {
    return null;
  }
}

async function tulisPengaturanBackup(kunci: string, nilai: string): Promise<void> {
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES ('peng.database.${kunci}', ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    nilai,
  );
}

/** Slot jadwal terakhir yang sudah lewat untuk mode+jam (waktu server lokal). */
function slotTerakhir(mode: string, jam: string): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(jam);
  if (!m) return null;
  const kini = new Date();
  const pada = (d: Date): Date => { const x = new Date(d); x.setHours(Number(m[1]), Number(m[2]), 0, 0); return x; };
  if (mode === 'harian') {
    const hariIni = pada(kini);
    return kini >= hariIni ? hariIni : new Date(hariIni.getTime() - 24 * 3600 * 1000);
  }
  if (mode === 'mingguan') {
    // Mingguan = tiap Senin jam terjadwal.
    const x = pada(kini);
    const mundur = (x.getDay() + 6) % 7; // hari sejak Senin
    x.setDate(x.getDate() - mundur);
    if (x > kini) x.setDate(x.getDate() - 7);
    return x;
  }
  if (mode === 'bulanan') {
    // Bulanan = tanggal 1 jam terjadwal.
    const x = pada(kini);
    x.setDate(1);
    if (x > kini) x.setMonth(x.getMonth() - 1);
    return x;
  }
  return null;
}

/** Status jadwal + maintenance untuk dashboard & polling klien. */
const MODE_SAH: ModeJadwal[] = ['4jam', '6jam', '12jam', 'harian', 'mingguan', 'bulanan', 'kustom'];

export async function statusBackup(): Promise<StatusJadwal> {
  const modeMentah = (await bacaPengaturanBackup('backup_otomatis')) ?? 'mati';
  const mode: ModeJadwal = (MODE_SAH as string[]).includes(modeMentah) ? (modeMentah as ModeJadwal) : 'mati';
  const jam = (await bacaPengaturanBackup('backup_jam')) ?? '02:00';
  const intervalMentah = Number.parseInt((await bacaPengaturanBackup('interval_nilai')) ?? '', 10);
  const interval_nilai = Number.isFinite(intervalMentah) && intervalMentah > 0 ? intervalMentah : 4;
  const interval_satuan: SatuanInterval = (await bacaPengaturanBackup('interval_satuan')) === 'menit' ? 'menit' : 'jam';
  const terakhir = await bacaPengaturanBackup('backup_terakhir_otomatis');
  let berikutnya: string | null = null;
  if (mode !== 'mati') {
    const jalan = terakhir ? Date.parse(terakhir) : NaN;
    if (INTERVAL_TETAP[mode] || mode === 'kustom') {
      // Mode interval: jatuh tempo bila selang sejak backup otomatis terakhir
      // sudah terlampaui (atau belum pernah jalan sama sekali).
      const ms = (await menitInterval(mode)) * 60_000;
      if (ms > 0 && (!Number.isFinite(jalan) || Date.now() - jalan >= ms)) {
        berikutnya = new Date(Number.isFinite(jalan) ? jalan + ms : Date.now()).toISOString();
      }
    } else {
      const slot = slotTerakhir(mode, jam);
      if (slot && (!Number.isFinite(jalan) || jalan < slot.getTime() - 60_000)) berikutnya = slot.toISOString();
    }
  }
  return {
    mode, jam, jumlah: Math.max(1, Math.min(100, await bacaJumlahCadangan())),
    retensi_hari: await bacaRetensiHari(), interval_nilai, interval_satuan,
    terakhir_otomatis: terakhir, berikutnya, maintenance: sedangMaintenance(),
  };
}

let timerJadwal: ReturnType<typeof setInterval> | null = null;
let jadwalBerjalan = false;

/** Cek sekali: bila slot terjadwal lewat & belum dijalankan → buat backup otomatis. */
export async function cekBackupTerjadwal(): Promise<void> {
  if (jadwalBerjalan) return;
  const st = await statusBackup();
  if (st.mode === 'mati' || !st.berikutnya) return;
  jadwalBerjalan = true;
  try {
    const nama = await buatBackup(`otomatis (${st.mode} ${st.jam})`, { tipe: 'otomatis' });
    try {
      const { catatAudit } = await import('./audit.ts');
      await catatAudit({
        userId: null, aksi: 'tambah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { cadangan: nama, tipe: 'otomatis', alasan: `Backup terjadwal ${st.mode}` },
        alasan: `Backup otomatis terjadwal (${st.mode} ${st.jam})`,
      });
    } catch { /* audit opsional */ }
    await tulisPengaturanBackup('backup_terakhir_otomatis', new Date().toISOString());
  } catch (e) {
    // Kegagalan terjadwal TERCATAT (kolom Status = Gagal) lalu slot ditandai
    // selesai agar tidak retry-storm tiap menit.
    try {
      const { catatAudit } = await import('./audit.ts');
      await catatAudit({
        userId: null, aksi: 'tambah', tabel: 'pengaturan', recordId: 'database',
        sesudah: { cadangan_gagal: `terjadwal-${stempelLokal()}`, tipe: 'otomatis', galat: pesanGalat(e) },
        alasan: 'Backup otomatis terjadwal gagal',
      });
    } catch { /* abaikan */ }
    await tulisPengaturanBackup('backup_terakhir_otomatis', new Date().toISOString());
  } finally {
    jadwalBerjalan = false;
  }
}

/**
 * Penjadwal backup otomatis (cron ringan): cek tiap 60 detik + catch-up
 * sekali saat server naik (bila aplikasi mati pada jam terjadwal, backup
 * dibuat saat server dijalankan kembali — sesuai catatan pengaturan).
 */
export function mulaiBackupTerjadwal(): void {
  if (timerJadwal) return;
  void cekBackupTerjadwal().catch((e) => console.warn('[backup] cek awal gagal:', pesanGalat(e)));
  timerJadwal = setInterval(() => {
    void cekBackupTerjadwal().catch((e) => console.warn('[backup] cek terjadwal gagal:', pesanGalat(e)));
  }, 60_000);
  timerJadwal.unref?.();
}

/* ------------------------- Pemeriksaan pembaruan ------------------------- */

/**
 * Pemeriksaan pembaruan.
 *
 * Aplikasi belum memiliki endpoint pembaruan resmi, jadi jawabannya jujur:
 * `tersedia: false` dengan petunjuk cara memeriksa manual. Tidak ada panggilan
 * jaringan yang dibuat (tidak ada izin & tidak ada endpoint yang diketahui).
 */
/* ---------------- Perawatan database (Vacuum & Re Index) ---------------- */

export type ModeRawat = 'standar' | 'penuh' | 'reindex';

const LABEL_RAWAT: Record<ModeRawat, string> = {
  standar: 'Vacuum Standard',
  penuh: 'Vacuum Full',
  reindex: 'Re Index',
};

/**
 * Perawatan database PostgreSQL sesuai templat Pengaturan Database:
 * - standar: VACUUM (ANALYZE) — cepat, merampingkan + perbarui statistik.
 * - penuh: VACUUM (FULL) — membangun ulang seluruh tabel (lebih lama, kunci tulis).
 * - reindex: REINDEX per tabel pengguna — membangun ulang seluruh indeks.
 * Ukuran sebelum/sesudah = pg_database_size. Lakukan saat tidak ada
 * transaksi berjalan / tutup toko.
 */
export async function rawatDatabase(mode: ModeRawat): Promise<{ sebelum: number; sesudah: number; durasiMs: number }> {
  const label = LABEL_RAWAT[mode];
  if (!label) throw tolak(400, 'Mode perawatan tidak dikenal.');
  const ukuranDb = async (): Promise<number> => {
    try {
      return Number((await get<{ ukuran: number }>(`SELECT pg_database_size(current_database()) AS ukuran`))?.ukuran ?? 0);
    } catch {
      return 0;
    }
  };
  const sebelum = await ukuranDb();
  const mulai = Date.now();
  // VACUUM / REINDEX tidak boleh di dalam transaksi — run() memakai koneksi
  // autocommit sehingga aman dipanggil langsung (sama seperti semula).
  if (mode === 'standar') {
    await run('VACUUM (ANALYZE)');
  } else if (mode === 'penuh') {
    await run('VACUUM (FULL, ANALYZE)');
  } else {
    // REINDEX DATABASE membangun ulang SELURUH indeks database dalam satu
    // perintah. Bila peran DB tidak berhak (bukan pemilik database), jatuh ke
    // REINDEX per tabel public agar fungsi tetap berjalan tanpa galat.
    let selesai = false;
    try {
      const db = await get<{ nama: string }>('SELECT current_database() AS nama');
      const namaDb = String(db?.nama ?? '').replace(/"/g, '""');
      if (namaDb) {
        await run(`REINDEX DATABASE "${namaDb}"`);
        selesai = true;
      }
    } catch (e) {
      console.warn('[rawat] REINDEX DATABASE tidak diizinkan, memakai REINDEX per tabel:', pesanGalat(e));
    }
    if (!selesai) {
      const tabel = await all<{ nama: string }>(
        `SELECT tablename AS nama FROM pg_tables WHERE schemaname = 'public'`,
      );
      for (const t of tabel) {
        await run(`REINDEX TABLE "${t.nama.replace(/"/g, '""')}"`);
      }
    }
  }
  return { sebelum, sesudah: await ukuranDb(), durasiMs: Date.now() - mulai };
}

export function periksaPembaruan(): { versi: string; tersedia: boolean; pesan: string } {
  const versi = versiAplikasi();
  return {
    versi,
    tersedia: false,
    pesan: `Versi terpasang ${versi}. Aplikasi ini belum memiliki kanal pembaruan otomatis — periksa repositori atau distributor resmi Anda untuk versi terbaru.`,
  };
}
