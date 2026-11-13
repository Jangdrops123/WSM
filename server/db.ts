import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DB_FILE = process.env.DB_FILE ?? path.join(DATA_DIR, 'app.db');
export const MIGRATIONS_DIR = path.join(here, 'migrations');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);

// Pragma dasar: foreign key aktif, mode WAL agar aman untuk banyak koneksi,
// dan busy_timeout agar transaksi atomik tidak langsung gagal saat bersaing.
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

/** Waktu sekarang dalam format ISO lokal (UTC disimpan apa adanya oleh SQLite). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Tipe baris generik untuk hasil query. */
export type Row = Record<string, unknown>;

/** Semua baris. */
export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

/** Satu baris (atau undefined). */
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

/** Jalankan statement tulis; mengembalikan perubahan baris. */
export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  const res = db.prepare(sql).run(...(params as never[]));
  return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
}

/**
 * Transaksi atomik: semua operasi di dalam `fn` berhasil bersama
 * atau batal bersama (gagal sebagian = batal semua).
 *
 * Aman dipanggil berulang (bersarang): panggilan terdalam memakai SAVEPOINT,
 * sehingga layanan seperti `ubahStok()` bisa disusun dalam satu transaksi besar.
 *
 * Penggunaan:
 *   const id = withTransaction(() => {
 *     ... update stok + tulis kartu stok + buat jurnal ...
 *     return idBaru;
 *   });
 */
let kedalamanTransaksi = 0;

export function withTransaction<T>(fn: () => T): T {
  const tingkat = kedalamanTransaksi;
  const savepoint = `sp_tx_${tingkat}`;
  if (tingkat === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);
  kedalamanTransaksi++;

  try {
    const hasil = fn();
    kedalamanTransaksi--;
    if (tingkat === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${savepoint}`);
    return hasil;
  } catch (err) {
    kedalamanTransaksi--;
    try {
      if (tingkat === 0) db.exec('ROLLBACK');
      else {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      }
    } catch {
      /* rollback gagal hanya jika transaksi sudah berakhir sendiri */
    }
    throw err;
  }
}

/**
 * Penomoran dokumen otomatis per kunci per periode.
 * Contoh kunci: 'penjualan-2026', 'pembelian-2026-10'.
 * Mengembalikan nomor urut berikutnya (integer) dalam transaksi atomik.
 */
export function nextDocumentSequence(kunci: string): number {
  return withTransaction(() => {
    run('INSERT INTO document_counters (kunci, terakhir) VALUES (?, 1) ON CONFLICT(kunci) DO UPDATE SET terakhir = terakhir + 1', kunci);
    const row = get<{ terakhir: number }>('SELECT terakhir FROM document_counters WHERE kunci = ?', kunci);
    return row?.terakhir ?? 1;
  });
}

/** Format nomor dokumen: PREFIX-2026-0001 */
export function formatDocumentNumber(prefix: string, periode: string, urut: number): string {
  return `${prefix}-${periode}-${String(urut).padStart(4, '0')}`;
}

/** Ambil pengaturan aplikasi sebagai object (kunci -> nilai). */
export function getSettings(): Record<string, string> {
  const rows = all<{ kunci: string; nilai: string | null }>('SELECT kunci, nilai FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.kunci] = r.nilai ?? '';
  return out;
}
