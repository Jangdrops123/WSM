import { useEffect, useRef } from 'react';

/**
 * Bus "Segarkan modul" — tombol Refresh global di topbar (kiri tombol
 * Panduan) memberi tahu halaman/modul yang sedang tampil untuk memuat ulang
 * datanya (fetch ulang) TANPA reload seluruh halaman (SPA friendly).
 *
 * Pola pakai di halaman data (cukup 1 baris setelah `muat` didefinisikan):
 *   useSegarkanModul(muat);
 * `muat` harus stabil (useCallback) agar langganan tidak dipasang ulang.
 * Halaman form (input/draft) hanya me-refresh daftar opsi, bukan isi form.
 */
export const EVENT_SEGARKAN_MODUL = 'nusapos:segarkan-modul';

/** Pemicu: dipanggil tombol Refresh global. */
export function mintaSegarkanModul(): void {
  window.dispatchEvent(new CustomEvent(EVENT_SEGARKAN_MODUL));
}

/** Langganan: jalankan `muat` setiap tombol Refresh global ditekan. */
export function saatSegarkanModul(fn: () => void): () => void {
  window.addEventListener(EVENT_SEGARKAN_MODUL, fn);
  return () => window.removeEventListener(EVENT_SEGARKAN_MODUL, fn);
}

/** Hook ringkas — pasang langganan sekali, selalu memanggil `muat` terbaru. */
export function useSegarkanModul(muat: () => void): void {
  const ref = useRef(muat);
  ref.current = muat;
  useEffect(() => saatSegarkanModul(() => ref.current()), []);
}
