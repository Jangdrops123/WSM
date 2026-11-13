// AI — Satu tabel warna aksen: dipakai pratinjau Identitas Aplikasi, layar muat
// (skrip head di index.html memakai nilai yang sama, disalin manual karena
// harus jalan sebelum bundel), dan tombol Putar layar muat.
export type KodeAksen = '' | 'teal' | 'biru' | 'indigo' | 'hijau' | 'oranye';

export interface PaletAksen {
  /** Warna utama (kotak pilihan & sorotan). */
  utama: string;
  /** Gradasi tema Siang: [awal, akhir]. */
  siang: [string, string];
  /** Gradasi tema Malam: [awal, akhir]. */
  malam: [string, string];
}

export const PALET_AKSEN: Record<KodeAksen, PaletAksen> = {
  '': { utama: '#267454', siang: ['#267454', '#a9c46a'], malam: ['#8fd6a8', '#c9e6a3'] },
  teal: { utama: '#147a75', siang: ['#147a75', '#5bb8ad'], malam: ['#5ccabc', '#9adfd4'] },
  biru: { utama: '#3f6f9e', siang: ['#3f6f9e', '#8fb6dc'], malam: ['#8fb6dc', '#c3ddf4'] },
  indigo: { utama: '#5b5aa6', siang: ['#5b5aa6', '#a5a4e8'], malam: ['#a5a4e8', '#cfcef5'] },
  hijau: { utama: '#3f8a4e', siang: ['#3f8a4e', '#9ccf6a'], malam: ['#9adfa6', '#cbe89a'] },
  oranye: { utama: '#b76a23', siang: ['#b76a23', '#f0a96a'], malam: ['#f0a96a', '#f7cf9a'] },
};

/** Urutan tampil swatch di Pengaturan (Deep Teal terbaru selalu pertama). */
export const URUTAN_AKSEN: KodeAksen[] = ['teal', '', 'biru', 'indigo', 'hijau', 'oranye'];

/** Nama tampil tiap aksen (dipakai aria-label & tooltip). */
export const LABEL_AKSEN: Record<KodeAksen, string> = {
  '': 'Bawaan',
  teal: 'Deep Teal / Cyan',
  biru: 'Biru',
  indigo: 'Indigo',
  hijau: 'Hijau',
  oranye: 'Oranye',
};

/** Gradasi aksen untuk tema tertentu (aman untuk kode aksen tak dikenal). */
export function gradasiAksen(kode: string, tema: 'siang' | 'malam'): [string, string] {
  const palet = PALET_AKSEN[(kode || '') as KodeAksen] ?? PALET_AKSEN[''];
  return tema === 'malam' ? palet.malam : palet.siang;
}
