import { useCallback, useRef } from 'react';

/**
 * Mendeteksi Enter dari keyboard fisik maupun virtual.
 * Browser HP kadang mengirim key/code yang berbeda, atau hanya keyCode/which
 * lama. Semua variasi diperlakukan sebagai satu perintah cari.
 */
export function adalahEnter(e: {
  key?: string;
  code?: string;
  keyCode?: number;
  which?: number;
}): boolean {
  return (
    e.key === 'Enter' ||
    e.code === 'Enter' ||
    e.code === 'NumpadEnter' ||
    e.keyCode === 13 ||
    e.which === 13
  );
}

/** Layar ponsel: dipakai hanya untuk menutup keyboard virtual saat modal muncul. */
export function diLayarPonsel(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches;
}

export type SumberEnter = 'keydown' | 'keyup' | 'submit';

/**
 * Satu aksi pencarian untuk keydown, keyup, dan submit form.
 *
 * Keyboard virtual dapat memicu lebih dari satu sinyal untuk satu tekanan
 * (keydown/keyup/submit). Keydown selalu dijalankan agar pemindaian barcode
 * beruntun tetap cepat; keyup dan submit yang menyusul dari tekanan yang sama
 * diabaikan. Jika browser HP tidak mengirim keydown yang dikenali, keyup
 * menjadi jalur cadangan dan submit sesudahnya tidak mengulang pencarian.
 */
export function useEnterSekali(aksi: () => void): (sumber?: SumberEnter) => void {
  const aksiRef = useRef(aksi);
  aksiRef.current = aksi;
  const keydownTerakhir = useRef(0);
  const fallbackTerakhir = useRef(0);

  return useCallback((sumber: SumberEnter = 'submit') => {
    const sekarang = Date.now();
    if (sumber === 'keydown') {
      keydownTerakhir.current = sekarang;
      fallbackTerakhir.current = 0;
      aksiRef.current();
      return;
    }
    // Keyup/submit setelah keydown adalah sinyal kedua dari tekanan yang sama.
    if (sekarang - keydownTerakhir.current < 700) return;
    if (sumber === 'keyup') {
      fallbackTerakhir.current = sekarang;
      aksiRef.current();
      return;
    }
    // Submit setelah keyup cadangan juga bukan pencarian baru.
    if (sekarang - fallbackTerakhir.current < 700) return;
    aksiRef.current();
  }, []);
}
