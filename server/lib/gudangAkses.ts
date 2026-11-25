// ============================================================================
// PENGATURAN GUDANG DEFAULT & HAK AKSES GUDANG PER PERAN/PENGGUNA
// ============================================================================
// Sumber kebenaran akses TETAP `users.cakupan_toko` / `roles.cakupan_toko`
// (JSON kode gudang, diiris antara pengguna × peran oleh server/lib/auth.ts)
// karena seluruh penyaringan daftar, kartu stok, dan validasi 403 sudah
// memakainya. Tiga kolom baru di bawah melengkapi:
//
//   default_warehouse_id       gudang yang otomatis terpilih di form transaksi
//   accessible_warehouse_ids   cermin id (JSON) dari cakupan kode gudang
//   is_warehouse_locked        TRUE = dropdown gudang dikunci (tidak bisa ganti)
//
// Semuanya ditulis oleh satu fungsi (simpanKolomGudang) agar id & kode tidak
// pernah berbeda pendapat. Kolom ditambahkan malas + idempoten supaya DB lama
// (SQLite/PostgreSQL tanpa migrasi baru) tetap jalan.
// ============================================================================
import { all, get, run } from '../db.pg.ts';

export interface GudangSesi {
  /** Id gudang yang boleh dipakai; null = tanpa pembatasan; [] = tanpa akses. */
  ids: number[] | null;
  /** Gudang default yang harus terpilih di form transaksi. */
  defaultId: number | null;
  /** TRUE = pilihan gudang di form transaksi dikunci. */
  locked: boolean;
}

let kolomSiap = false;

/**
 * Pastikan kolom pengaturan gudang ada di users & roles. WAJIB dipanggil di
 * luar transaksi (PostgreSQL membatalkan transaksi bila ALTER gagal).
 */
export async function pastikanKolomGudang(): Promise<void> {
  if (kolomSiap) return;
  const kolom: [string, string][] = [
    ['default_warehouse_id', 'INTEGER'],
    ['accessible_warehouse_ids', 'TEXT'],
    ['is_warehouse_locked', 'BOOLEAN DEFAULT FALSE'],
  ];
  for (const tabel of ['users', 'roles']) {
    for (const [nama, tipe] of kolom) {
      try {
        await run(`ALTER TABLE ${tabel} ADD COLUMN ${nama} ${tipe}`);
      } catch {
        /* kolom sudah ada */
      }
    }
  }
  kolomSiap = true;
}

/** JSON array id → number[]; menerima juga "1,2,3" (data lama). */
export function bacaIdJson(nilai: unknown): number[] | null {
  if (nilai === null || nilai === undefined) return null;
  const teks = String(nilai).trim();
  if (!teks) return null;
  try {
    const v = JSON.parse(teks) as unknown;
    if (Array.isArray(v)) {
      return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    }
  } catch {
    /* bukan JSON — coba daftar dipisah koma */
  }
  return teks
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

async function petaKodeId(): Promise<Map<string, number>> {
  const rows = await all<{ id: number; kode: string }>('SELECT id, kode FROM warehouses');
  return new Map(rows.map((r) => [String(r.kode), Number(r.id)]));
}

/**
 * Gudang efektif sebuah sesi: id yang boleh dipakai, gudang default, dan
 * status kunci. `cakupan` = irisan kode gudang pengguna × peran (null = semua).
 */
export async function aksesGudangSesi(
  userId: number,
  roleId: number,
  admin: boolean,
  cakupan: string[] | null,
): Promise<GudangSesi> {
  // Owner/Administrator selalu bebas memilih gudang mana pun (tanpa kunci).
  if (admin) return { ids: null, defaultId: null, locked: false };
  let u: Record<string, unknown> | undefined;
  let r: Record<string, unknown> | undefined;
  try {
    u = await get<Record<string, unknown>>(
      `SELECT default_warehouse_id, accessible_warehouse_ids, is_warehouse_locked, toko_bawaan
         FROM users WHERE id = ?`,
      userId,
    );
    r = await get<Record<string, unknown>>(
      `SELECT default_warehouse_id, accessible_warehouse_ids, is_warehouse_locked
         FROM roles WHERE id = ?`,
      roleId,
    );
  } catch {
    // Kolom baru belum ada — perilaku lama (cakupan kode saja) tetap berlaku.
    u = undefined;
    r = undefined;
  }
  const peta = await petaKodeId();

  let ids: number[] | null;
  if (cakupan !== null) {
    ids = cakupan
      .map((k) => peta.get(String(k)))
      .filter((n): n is number => typeof n === 'number');
  } else {
    ids = bacaIdJson(u?.accessible_warehouse_ids);
  }

  const kandidat = [
    Number(u?.default_warehouse_id ?? 0),
    Number(r?.default_warehouse_id ?? 0),
    u?.toko_bawaan ? peta.get(String(u.toko_bawaan)) ?? 0 : 0,
  ];
  let defaultId: number | null = null;
  for (const c of kandidat) {
    if (!Number.isInteger(c) || c <= 0) continue;
    if (ids === null || ids.includes(c)) {
      defaultId = c;
      break;
    }
  }
  if (defaultId === null && ids !== null && ids.length === 1) defaultId = ids[0];

  const locked =
    Number(u?.is_warehouse_locked ?? 0) === 1 || Number(r?.is_warehouse_locked ?? 0) === 1;

  return { ids, defaultId, locked };
}

/**
 * Tulis tiga kolom baru dari data kanonis (kode gudang cakupan + kode default).
 * Dipanggil SETELAH pastikanKolomGudang() dan di dalam transaksi pemanggil.
 */
export async function simpanKolomGudang(
  tabel: 'users' | 'roles',
  id: number,
  kode: string[] | null,
  kodeBawaan: string | null,
  terkunci: boolean,
): Promise<void> {
  const peta = await petaKodeId();
  const ids =
    kode === null
      ? null
      : kode.map((k) => peta.get(String(k))).filter((n): n is number => typeof n === 'number');
  const defaultId = kodeBawaan ? peta.get(String(kodeBawaan)) ?? null : null;
  await run(
    `UPDATE ${tabel} SET accessible_warehouse_ids = ?, default_warehouse_id = ?, is_warehouse_locked = ?
      WHERE id = ?`,
    ids === null ? null : JSON.stringify(ids),
    defaultId,
    terkunci ? 1 : 0,
    id,
  );
}

/** Cek satu gudang termasuk daftar yang boleh dipakai sesi (403 bila tidak). */
export function gudangDiizinkan(gudang: GudangSesi, warehouseId: number): boolean {
  if (gudang.ids === null) return true;
  return gudang.ids.includes(warehouseId);
}
