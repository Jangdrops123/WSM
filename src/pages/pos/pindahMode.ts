// M5 — pemindahan mode POS (Foto ↔ Tanpa Foto) TANPA kehilangan isi keranjang.
//
// Payload disimpan di sessionStorage (sekali pakai) lalu dikonsumsi halaman
// tujuan saat dimuat. Diskon selalu diserahkan dalam format halaman tujuan:
//   foto  → cepat : diskon kasir disebarkan ke diskon tiap baris (total tetap);
//   cepat → foto  : seluruh diskon baris digabung jadi satu diskon kasir.
// Jadi subtotal − diskon selalu sama di kedua mode (juga di server).

import type { ModePos } from '../../lib/pengguna';
import type { BarisKeranjang } from './tipe';

const KUNCI = 'nusapos.pindah-mode';

export interface CangkangMode {
  dari: ModePos;
  items: BarisKeranjang[];
  /** Diskon kasir global (Rp) — hanya dipakai tujuan mode Foto. */
  diskon: number;
  gudangId: number;
}

export function simpanPindahMode(c: CangkangMode): void {
  try {
    sessionStorage.setItem(KUNCI, JSON.stringify(c));
  } catch {
    /* sessionStorage tidak tersedia — abaikan */
  }
}

/**
 * Baca payload tanpa membuangnya — dipakai sebagai lazy initializer state
 * (aman dipanggil dua kali oleh StrictMode). Payload dibuang di effect mount.
 */
export function peekPindahMode(): CangkangMode | null {
  try {
    const t = sessionStorage.getItem(KUNCI);
    if (!t) return null;
    const o = JSON.parse(t) as Partial<CangkangMode>;
    if (!o || !Array.isArray(o.items)) return null;
    return {
      dari: o.dari === 'foto' ? 'foto' : 'cepat',
      items: o.items as BarisKeranjang[],
      diskon: Number(o.diskon) || 0,
      gudangId: Number(o.gudangId) || 0,
    };
  } catch {
    return null;
  }
}

/** Buang payload setelah halaman tujuan selesai memakainya. */
export function buangPindahMode(): void {
  try {
    sessionStorage.removeItem(KUNCI);
  } catch {
    /* abaikan */
  }
}

/** Mode Foto → Tanpa Foto: sebarkan diskon kasir ke tiap baris (total tetap). */
export function sebarDiskonKeBaris(items: BarisKeranjang[], diskon: number): BarisKeranjang[] {
  let sisa = Math.max(0, diskon);
  if (sisa <= 0) return items;
  return items.map((b) => {
    const maks = Math.max(0, b.qty * b.harga - (b.diskon ?? 0));
    const tambah = Math.min(maks, sisa);
    sisa -= tambah;
    return tambah > 0 ? { ...b, diskon: (b.diskon ?? 0) + tambah } : b;
  });
}

/** Mode Tanpa Foto → Foto: gabung diskon baris jadi satu diskon kasir. */
export function gabungDiskonBaris(items: BarisKeranjang[]): { items: BarisKeranjang[]; diskon: number } {
  const total = items.reduce((a, b) => a + (b.diskon ?? 0), 0);
  return { items: items.map((b) => ({ ...b, diskon: 0 })), diskon: total };
}
