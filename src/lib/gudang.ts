import type { InfoSesi } from './sesi';

export type OpsiGudang = { id: number; label: string };

/**
 * WI/WI2 — gudang yang MENGUNCI form transaksi.
 *
 * Sumber kebenaran akses ada di server: `users.cakupan_toko` × `roles.cakupan_toko`
 * (kode gudang, diiris di `/api/auth/sesi`) + kolom `default_warehouse_id`,
 * `accessible_warehouse_ids`, `is_warehouse_locked`. Endpoint opsi gudang
 * (`/api/master/gudang/opsi`) hanya mengembalikan gudang yang boleh dipakai.
 *
 * Kunci berlaku bila:
 *   * server menandai `is_warehouse_locked` TRUE (dropdown tidak bisa diganti), atau
 *   * sesi non-Administrator hanya punya SATU gudang.
 *
 * null = tidak terkunci (Administrator/Top, atau cakupan lebih dari satu
 * gudang sehingga pengguna bebas memilih di antara yang boleh).
 */
export function idGudangTerkunci(info: InfoSesi | null, opsi: OpsiGudang[]): number | null {
  if (!info || info.pengguna.admin) return null;
  const g = info.gudang;
  if (g?.locked) {
    if (g.defaultId !== null && opsi.some((o) => o.id === g.defaultId)) return g.defaultId;
    if (opsi.length === 1) return opsi[0].id;
    return null;
  }
  if (!Array.isArray(info.cakupanToko)) return null; // tanpa pembatasan
  if (opsi.length !== 1) return null;
  return opsi[0].id;
}

/**
 * Gudang default transaksi milik pengguna (otomatis terpilih saat form
 * dibuka). null = belum diatur / tidak termasuk gudang yang boleh dipakai.
 */
export function idGudangBawaan(info: InfoSesi | null, opsi: OpsiGudang[]): number | null {
  if (!info || info.pengguna.admin) return null;
  const d = info.gudang?.defaultId ?? null;
  if (d !== null && opsi.some((o) => o.id === d)) return d;
  return null;
}

/** Judul/petunjuk seragam untuk pilihan gudang yang terkunci. */
export const TIP_GUDANG_TERKUNCI =
  'Gudang dikunci sesuai hak akses akun Anda. Minta Administrator menambah cakupan gudang bila perlu memakai gudang lain.';
