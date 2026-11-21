/**
 * Adapter PostgreSQL — API kompatibel dengan server/db.ts (SQLite).
 *
 * TUJUAN: migrasi SQLite -> PostgreSQL TANPA mengubah logika bisnis.
 * Caranya: normalisasi hasil baca PG kembali ke "bentuk SQLite" yang
 * sudah dikenal seluruh route/lib:
 *   - BOOLEAN      -> 1 / 0 (number), seperti INTEGER 0/1 di SQLite.
 *                      Tulis tetap boleh 0/1/true/false — PG menerimanya.
 *   - TIMESTAMPTZ  -> string 'YYYY-MM-DD HH:MM:SS.sss' (bentuk waktuSql()),
 *                      agar msDariSql()/perbandingan string/order tetap sama.
 *   - DATE         -> string 'YYYY-MM-DD'.
 *   - JSONB        -> string JSON (seperti TEXT JSON di SQLite, tetap JSON.parse).
 *   - NUMERIC      -> number (bukan string), agar aritmetika sama.
 *   - BIGINT id   -> number (aman hingga 2^53; id aplikasi jauh di bawah itu).
 *
 * Perbedaan WAJIB yang bersifat mekanis (bukan logika):
 *   1. Semua fungsi ini async -> tambah `await` di call-site.
 *   2. Placeholder `?` -> otomatis jadi `$1, $2, ...` (diurus kePg()).
 *   3. `run()` tanpa RETURNING tetap mengembalikan lastInsertRowid:
 *      adapter menambahkan `RETURNING id` bila statement INSERT dan tabel
 *      punya kolom id. Untuk UPDATE/DELETE, lastInsertRowid = 0.
 *   4. withTransaction() butuh SATU klien dari pool selama transaksi
 *      (SQLite sinkron satu koneksi; PG pool banyak koneksi).
 *
 * Env: DATABASE_URL=postgresql://user:sandi@host:5432/db
 * Zona waktu: pool dipaksa UTC agar string waktu konsisten dengan SQLite.
 */
import { Pool, type PoolClient } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const herePg = path.dirname(fileURLToPath(import.meta.url));
/** Akar proyek (sama seperti ROOT_DIR di db.ts) — murni path, tanpa DB. */
export const ROOT_DIR = path.resolve(herePg, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL belum disetel (lihat .env.pg.contoh).');
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  // Zona toko WIB baku dipakai untuk CURRENT_DATE dan nilai tanggal bawaan.
  // Timestamp yang dibaca tetap dinormalisasi ke UTC oleh adapter.
  options: `-c TimeZone=${process.env.TZ || 'Asia/Jakarta'}`,
});

pool.on('error', (err) => {
  const kode = (err as { code?: string }).code;
  // 57P01/57P02/57P03 = koneksi dihentikan server. Ini normal saat restore
  // memanggil pg_terminate_backend(); pool akan membuka koneksi baru.
  if (kode === '57P01' || kode === '57P02' || kode === '57P03') {
    console.warn('[PG] koneksi lama dihentikan server (diharapkan saat restore).');
    return;
  }
  console.error('[PG pool error]', err);
});

/** Tipe baris generik untuk hasil query. */
export type Row = Record<string, unknown>;

/** `?` -> `$1, $2, ...` (abaikan `?` di dalam literal string). */
function terjemahSql(sql: string): string {
  const ubahPanggilan = (sumber: string, nama: string, ubah: (argumen: string[]) => string): string => {
    let hasil = '';
    let i = 0;
    while (i < sumber.length) {
      const cocok = sumber.slice(i).match(new RegExp(`^${nama}\\s*\\(`, 'i'));
      if (!cocok) { hasil += sumber[i++]; continue; }
      const awal = i + cocok[0].length;
      let kedalaman = 1;
      let kutip: string | null = null;
      let j = awal;
      let batas: number[] = [];
      for (; j < sumber.length && kedalaman > 0; j++) {
        const c = sumber[j];
        if (kutip) {
          if (c === kutip && sumber[j + 1] === kutip) { j++; continue; }
          if (c === kutip) kutip = null;
          continue;
        }
        if (c === '\'' || c === '"') { kutip = c; continue; }
        if (c === '(') kedalaman++;
        else if (c === ')') kedalaman--;
        else if (c === ',' && kedalaman === 1) batas.push(j);
      }
      if (kedalaman !== 0) { hasil += sumber[i++]; continue; }
      const isi = sumber.slice(awal, j - 1);
      const args: string[] = [];
      let dari = 0;
      for (const k of batas) { args.push(isi.slice(dari, k - awal)); dari = k - awal + 1; }
      args.push(isi.slice(dari));
      hasil += ubah(args);
      i = j;
    }
    return hasil;
  };

  let hasil = ubahPanggilan(sql, 'GROUP_CONCAT', (args) => {
    const nilai = args[0]?.trim() ?? '';
    const pemisah = args.length > 1 ? args[1].trim() : "','";
    return `STRING_AGG(${nilai}, ${pemisah})`;
  });
  hasil = ubahPanggilan(hasil, 'SUBSTR', (args) => {
    if (args.length < 2) return `SUBSTRING(${args.join(', ')})`;
    const nilai = `(${args[0].trim()})::text`;
    return args.length > 2
      ? `SUBSTRING(${nilai} FROM ${args[1].trim()} FOR ${args[2].trim()})`
      : `SUBSTRING(${nilai} FROM ${args[1].trim()})`;
  });
  return hasil;
}

function kePg(sql: string): string {
  sql = terjemahSql(sql);
  let i = 0;
  let keluar = '';
  let kutip: string | null = null;
  for (let n = 0; n < sql.length; n++) {
    const ch = sql[n];
    if (kutip) {
      keluar += ch;
      if (ch === kutip) {
        // '' lolos di dalam literal '...'
        if (sql[n + 1] === kutip) { keluar += sql[n + 1]; n++; }
        else kutip = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { kutip = ch; keluar += ch; continue; }
    if (ch === '?') { i++; keluar += `$${i}`; continue; }
    keluar += ch;
  }
  return keluar;
}

/** OID tipe numerik PG yang node-pg kembalikan sebagai string. */
const OID_NUMERIK = new Set([20 /* INT8 */, 21 /* INT2 */, 23 /* INT4 */, 1700 /* NUMERIC */]);

/** Normalisasi SATU nilai PG -> bentuk SQLite. */
function normalisasiNilai(v: unknown, oid?: number): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) {
    if (oid === 1082) {
      // DATE PG: tanggal kalender tanpa zona (server menulis 'YYYY-MM-DD').
      // node-pg mengembalikan Date tengah-malam LOKAL → format bagian lokal
      // agar tidak bergeser (toISOString memakai UTC).
      const t = (n: number) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${t(v.getMonth() + 1)}-${t(v.getDate())}`;
    }
    // Bentuk waktuSql(): 'YYYY-MM-DD HH:MM:SS.sss' (UTC, tanpa T/Z)
    return v.toISOString().replace('T', ' ').replace('Z', '');
  }
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && oid !== undefined && OID_NUMERIK.has(oid)) {
    // INT/NUMERIC sebagai string (mis. BIGINT "5", SUM "15.0000") -> number
    // agar `===`, Number.isInteger, dan `+` tidak berubah arti.
    // Di luar safe-integer biarkan string (presisi > perilaku SQLite tak terdefinisi).
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return n;
    return v;
  }
  if (typeof v === 'object') {
    // JSONB -> string JSON (kode lama selalu JSON.parse dari TEXT)
    try { return JSON.stringify(v); } catch { return v; }
  }
  return v;
}

function normalisasiBaris<T>(baris: Record<string, unknown>, oids?: (number | undefined)[]): T {
  const keluar: Record<string, unknown> = {};
  const kunci = Object.keys(baris);
  for (let i = 0; i < kunci.length; i++) keluar[kunci[i]] = normalisasiNilai(baris[kunci[i]], oids?.[i]);
  return keluar as T;
}

/** Ambil OID tipe tiap kolom hasil query (sejajar urutan kolom). */
function oidKolom(r: { fields?: { dataTypeID?: number }[] }): (number | undefined)[] | undefined {
  if (!r.fields) return undefined;
  return r.fields.map((f) => f?.dataTypeID);
}

/** Klien transaksi aktif (satu koneksi selama withTransaction). */
let klienTx: PoolClient | null = null;
let kedalamanTx = 0;

function pelaksana(): Pool | PoolClient {
  return klienTx ?? pool;
}

/** Semua baris. */
export async function all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await pelaksana().query(kePg(sql), params as unknown[]);
  const mentah = (Array.isArray(r) ? r[r.length - 1] : r) as typeof r & { fields?: { dataTypeID?: number }[] };
  const oids = oidKolom(mentah);
  return (mentah.rows as Record<string, unknown>[]).map((b) => normalisasiBaris(b, oids)) as T[];
}

/** Satu baris (atau undefined). */
export async function get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const r = await pelaksana().query(kePg(sql), params as unknown[]);
  const mentah = (Array.isArray(r) ? r[r.length - 1] : r) as typeof r & { fields?: { dataTypeID?: number }[] };
  const baris = mentah.rows[0] as Record<string, unknown> | undefined;
  return baris === undefined ? undefined : normalisasiBaris<T>(baris, oidKolom(mentah));
}

/** Cache nama tabel yang punya kolom `id` (untuk RETURNING id yang aman). */
let cacheTabelBerId: Set<string> | null = null;

/** Buang cache skema (dipakai setelah restore database). */
export function lupakanCacheTabel(): void {
  cacheTabelBerId = null;
}
async function tabelBerId(): Promise<Set<string>> {
  if (!cacheTabelBerId) {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id'`,
    );
    cacheTabelBerId = new Set((r.rows as { table_name: string }[]).map((x) => x.table_name));
  }
  return cacheTabelBerId;
}

/**
 * Statement tulis; mengembalikan { changes, lastInsertRowid } seperti db.ts.
 * Untuk INSERT tanpa RETURNING, adapter menambahkan `RETURNING id` HANYA bila
 * tabel target memang punya kolom id (cek information_schema sekali, di-cache).
 * Menebak buta berbahaya di dalam transaksi: gagal sekali = seluruh tx abort.
 */
export async function run(
  sql: string,
  ...params: unknown[]
): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
  const adalahInsert = /^\s*(INSERT|REPLACE)\b/i.test(sql);
  const punyaReturning = /returning\b/i.test(sql);
  let tambahReturning = false;
  if (adalahInsert && !punyaReturning) {
    const m = /INSERT\s+INTO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(sql);
    tambahReturning = !!m && (await tabelBerId()).has(m[1].toLowerCase());
  }
  const akhir = tambahReturning ? `${kePg(sql)} RETURNING id` : kePg(sql);
  const r = await pelaksana().query(akhir, params as unknown[]);
  const id = ((Array.isArray(r) ? r[r.length - 1] : r).rows[0] as { id?: unknown } | undefined)?.id;
  return {
    changes: (Array.isArray(r) ? r[r.length - 1] : r).rowCount ?? 0,
    lastInsertRowid: typeof id === 'bigint' ? Number(id) : typeof id === 'number' ? id : Number(id ?? 0),
  };
}

/**
 * Statement tulis "boleh gagal" (best effort) yang TIDAK merusak transaksi.
 *
 * PostgreSQL menandai SELURUH transaksi sebagai aborted begitu satu statement
 * gagal (SQLSTATE 25P02: "current transaction is aborted, commands ignored
 * until end of transaction block"). Menangkap error di JavaScript saja tidak
 * cukup: statement berikutnya di transaksi yang sama tetap ditolak.
 * Karena itu operasi opsional (hapus tabel lama yang mungkin tak ada,
 * pembersihan FK best-effort) dibungkus SAVEPOINT: gagal = rollback ke
 * savepoint itu saja, transaksi induk tetap sehat dan bisa COMMIT.
 */
let urutSavepointLunak = 0;

export async function runOpsional(
  sql: string,
  ...params: unknown[]
): Promise<{ ok: boolean; changes: number }> {
  const jalankan = async () => {
    const r = await pelaksana().query(kePg(sql), params as unknown[]);
    const hasil = (Array.isArray(r) ? r[r.length - 1] : r) as { rowCount?: number | null };
    return { ok: true, changes: hasil.rowCount ?? 0 };
  };
  const c = klienTx;
  if (!c) {
    try {
      return await jalankan();
    } catch {
      return { ok: false, changes: 0 };
    }
  }
  const sp = `sp_lunak_${++urutSavepointLunak}`;
  try {
    await c.query(`SAVEPOINT ${sp}`);
  } catch {
    // Transaksi sudah tidak bisa dipakai — jangan jalankan statement apa pun.
    return { ok: false, changes: 0 };
  }
  try {
    const hasil = await jalankan();
    await c.query(`RELEASE ${sp}`);
    return hasil;
  } catch {
    try {
      await c.query(`ROLLBACK TO ${sp}`);
      await c.query(`RELEASE ${sp}`);
    } catch {
      /* koneksi putus: withTransaction yang akan membereskan */
    }
    return { ok: false, changes: 0 };
  }
}

/**
 * Transaksi atomik — semantik SAMA dengan db.ts (boleh bersarang via SAVEPOINT).
 * Versi PG harus async karena pinjam satu klien dari pool.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (klienTx) {
    const sp = `sp_tx_${kedalamanTx++}`;
    await klienTx.query(`SAVEPOINT ${sp}`);
    try {
      const hasil = await fn();
      await klienTx.query(`RELEASE ${sp}`);
      return hasil;
    } catch (err) {
      try {
        await klienTx.query(`ROLLBACK TO ${sp}`);
        await klienTx.query(`RELEASE ${sp}`);
      } catch { /* abaikan bila koneksi sudah putus */ }
      throw err;
    }
  }
  const c = await pool.connect();
  klienTx = c;
  await c.query('BEGIN');
  try {
    const hasil = await fn();
    // PostgreSQL menjawab COMMIT pada transaksi yang sudah aborted dengan
    // ROLLBACK diam-diam. Tanpa cek ini API akan melapor "sukses" padahal
    // tak satu pun perubahan tersimpan.
    const commit = await c.query('COMMIT');
    if (commit.command === 'ROLLBACK') {
      throw new Error(
        'Transaksi database dibatalkan karena satu langkah gagal (current transaction is aborted). Tidak ada data yang tersimpan.',
      );
    }
    return hasil;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* abaikan */ }
    throw err;
  } finally {
    klienTx = null;
    c.release();
  }
}

/**
 * Penomoran dokumen otomatis per kunci per periode.
 * Sama seperti SQLite (UPSERT atomik); FOR UPDATE implisit via transaksi.
 */
export async function nextDocumentSequence(kunci: string): Promise<number> {
  return withTransaction(async () => {
    await run(
      'INSERT INTO document_counters (kunci, terakhir) VALUES (?, 1) ON CONFLICT(kunci) DO UPDATE SET terakhir = document_counters.terakhir + 1',
      kunci,
    );
    const row = await get<{ terakhir: number }>('SELECT terakhir FROM document_counters WHERE kunci = ?', kunci);
    return row?.terakhir ?? 1;
  });
}

/** Format nomor dokumen: PREFIX-2026-0001 */
export function formatDocumentNumber(prefix: string, periode: string, urut: number): string {
  return `${prefix}-${periode}-${String(urut).padStart(4, '0')}`;
}

/** Waktu sekarang format SQL (UTC, spasi) — sama persis dengan versi SQLite. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Pengaturan aplikasi sebagai object (kunci -> nilai). */
export async function getSettings(): Promise<Record<string, string>> {
  const rows = await all<{ kunci: string; nilai: string | null }>('SELECT kunci, nilai FROM settings');
  const keluar: Record<string, string> = {};
  for (const r of rows) keluar[r.kunci] = r.nilai ?? '';
  return keluar;
}
