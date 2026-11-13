import type { KeyboardEvent } from 'react';

/**
 * Navigasi keyboard tabel PO (Buat PO & Barang Datang):
 * - Tab / Shift+Tab : pindah antar kolom (bawaan browser, urutan DOM).
 * - ↑ / ↓ : pindah ke barang lain (baris atas/bawah) pada kolom yang sama.
 *
 * Setiap input sel memakai atribut data-po-baris (indeks baris) dan
 * data-po-kolom (nama kolom: 'kodi' | 'pcs' | 'harga' | 'ket').
 */
export function navigasiBarisPo(e: KeyboardEvent<HTMLElement>, baris: number, kolom: string): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const tabel = (e.currentTarget as HTMLElement).closest('table');
  if (!tabel) return;
  e.preventDefault();
  const tujuan = tabel.querySelector<HTMLInputElement>(
    `input[data-po-baris="${baris + (e.key === 'ArrowDown' ? 1 : -1)}"][data-po-kolom="${kolom}"]`,
  );
  if (tujuan) {
    tujuan.focus();
    tujuan.select();
  }
}
