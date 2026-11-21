// Preferensi tampilan tambahan dari Pengaturan ▸ Tampilan:
// kepadatan (nyaman/padat/longgar), Ukuran Font (AH2), dan sidebar ciut otomatis.
// Disimpan di localStorage agar pemuatan tanpa kedip, dan di tabel settings
// lewat /api/pengaturan/tampilan agar mengikuti database.

import { apiGet } from './api';

const KUNCI = 'nusapos.tampilanBaru';

/**
 * Kepadatan tampilan (U2/AH2f). `nyaman` = bawaan; `padat` = baris & padding
 * lebih rapat; `longgar` = lebih lega. Kepadatan TIDAK mengubah ukuran font
 * lagi — ukuran font murni urusan `--font-scale`.
 * Nilai lama (`normal`, `ringkas`) tetap dibaca agar preferensi lama tidak
 * hilang — dipetakan ke nyaman/padat.
 */
export type Kepadatan = 'nyaman' | 'padat' | 'longgar';

/** Persentase yang didukung (AH2a) + mode kustom (slider 75–150%). */
export const OPSI_UKURAN_FONT = ['80', '87', '100', '112', '125', 'kustom'] as const;

export interface TampilanBaru {
  kepadatan: Kepadatan;
  /** '80' | '87' | '100' | '112' | '125' | 'kustom' */
  ukuran_font: string;
  /** Dipakai bila `ukuran_font === 'kustom'` — persen 75–150, langkah 1. */
  ukuran_font_kustom: number;
  sidebar_ciut: boolean;
}

const BAWAAN: TampilanBaru = {
  kepadatan: 'nyaman',
  ukuran_font: '100',
  ukuran_font_kustom: 100,
  sidebar_ciut: false,
};

/** Petakan nilai lama → nilai baru. */
function keKepadatan(v: unknown): Kepadatan {
  const s = String(v ?? '');
  if (s === 'padat' || s === 'longgar' || s === 'nyaman') return s;
  if (s === 'ringkas') return 'padat'; // nilai lama
  return 'nyaman'; // 'normal' dan apa pun yang tak dikenal
}

function keUkuranFont(v: unknown): string {
  const s = String(v ?? '');
  return (OPSI_UKURAN_FONT as readonly string[]).includes(s) ? s : '100';
}

function kustom(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.min(150, Math.max(75, Math.round(n)));
}

/** Persentase efektif (75–150) dari pilihan — dipakai skrip <head> juga. */
export function persenFont(p: TampilanBaru): number {
  if (p.ukuran_font === 'kustom') return p.ukuran_font_kustom;
  const n = Number(p.ukuran_font);
  return Number.isFinite(n) ? n : 100;
}

export function bacaTampilanBaru(): TampilanBaru {
  try {
    const v = localStorage.getItem(KUNCI);
    if (!v) return BAWAAN;
    const j = JSON.parse(v) as Partial<TampilanBaru>;
    return {
      kepadatan: keKepadatan(j.kepadatan),
      ukuran_font: keUkuranFont(j.ukuran_font),
      ukuran_font_kustom: kustom(j.ukuran_font_kustom),
      sidebar_ciut: j.sidebar_ciut === true,
    };
  } catch {
    return BAWAAN;
  }
}

/** Terapkan ke <html> sebagai atribut & variabel CSS. */
export function terapkanTampilanBaru(p: TampilanBaru = bacaTampilanBaru()): void {
  const el = document.documentElement;
  el.dataset.kepadatan = p.kepadatan;
  el.dataset.sidebarCiut = p.sidebar_ciut ? 'ya' : 'tidak';
  // AH2 — satu variabel --font-scale; styles.css: html { font-size: calc(16px * var(--font-scale)) }.
  el.style.setProperty('--font-scale', String(persenFont(p) / 100));
}

export function simpanTampilanBaru(p: TampilanBaru): void {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(p));
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
  terapkanTampilanBaru(p);
}

/**
 * Sinkron dari database saat aplikasi dibuka (perangkat baru / sesi bersih).
 * Lokal menang bila sudah ada pilihan — sama seperti preferensi tema.
 * (Server sudah mengaburkan cakupan: nilai "Hanya akun saya" menimpa global.)
 */
export async function sinkronTampilanBaru(): Promise<void> {
  try {
    if (localStorage.getItem(KUNCI)) return;
    const r = await apiGet<{ nilai: Record<string, unknown> }>('/api/pengaturan/tampilan');
    const n = r.nilai ?? {};
    simpanTampilanBaru({
      kepadatan: keKepadatan(n.kepadatan),
      ukuran_font: keUkuranFont(n.ukuran_font),
      ukuran_font_kustom: kustom(n.ukuran_font_kustom),
      sidebar_ciut: n.sidebar_ciut === true || n.sidebar_ciut === 1 || n.sidebar_ciut === '1',
    });
  } catch {
    /* server belum siap — pakai bawaan lokal */
  }
}
