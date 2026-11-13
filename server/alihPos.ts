// Peta rute lama → rute baru. Dipakai server Express (produksi) dan middleware
// Vite (mode dev) untuk mengirim redirect HTTP 301, supaya bookmark & tautan
// lama tetap bekerja.
//
// M2 — rute POS lama → modul Penjualan.
// R1 — rute "Persediaan Sub" lama → grup Stok (Item Masuk/Keluar & Opname).

export const ALIH_POS: Record<string, string> = {
  '/pos': '/penjualan',
  '/pos/foto': '/penjualan/pos/foto',
  '/pos/cepat': '/penjualan/pos/tanpa-foto',
  '/pos/tanpa-foto': '/penjualan/pos/tanpa-foto',
};

/** R1 — rute lama grup Persediaan Sub → grup Stok. */
export const ALIH_STOK: Record<string, string> = {
  '/persediaan-sub': '/stok/masuk',
  '/persediaan-sub/masuk': '/stok/masuk',
  '/persediaan-sub/keluar': '/stok/keluar',
  '/persediaan/opname': '/stok/opname',
};

/**
 * O2 — Rute Opname lama (/opname, /opname/:id) → grup Stok.
 * Mengembalikan tujuan baru, atau null bila bukan rute Opname lama.
 */
export function alihOpname(url: string): string | null {
  const [path, kueri] = url.split('?');
  const bersih = path.replace(/\/+$/, '') || '/';
  const akhir = kueri ? `?${kueri}` : '';
  if (bersih === '/opname') return `/stok/opname${akhir}`;
  if (bersih.startsWith('/opname/')) return `/stok/opname${bersih.slice('/opname'.length)}${akhir}`;
  return null;
}

/**
 * Semua pengalihan rute lama dalam satu pintu.
 * Mengembalikan tujuan (dengan query string terbawa) atau null bila bukan
 * rute lama — pemanggil boleh lanjut ke handler berikutnya.
 */
export function alihRuteLama(url: string): string | null {
  const [path, kueri] = url.split('?');
  const bersih = path.replace(/\/+$/, '') || '/';
  const akhir = kueri ? `?${kueri}` : '';

  const persis = ALIH_POS[bersih] ?? ALIH_STOK[bersih];
  if (persis) return `${persis}${akhir}`;

  const opname = alihOpname(url);
  if (opname) return opname;

  // /persediaan/opname/:id → /stok/opname/:id
  if (bersih.startsWith('/persediaan/opname/')) {
    return `/stok/opname${bersih.slice('/persediaan/opname'.length)}${akhir}`;
  }
  return null;
}
