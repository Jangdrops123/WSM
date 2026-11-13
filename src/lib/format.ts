// Utilitas format sesuai standar Indonesia + Pengaturan ▸ Umum & Regional:
// Rupiah "Rp 1.250.000", tanggal mengikuti `format_tanggal`
// (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, MM/DD/YYYY) dan jam mengikuti
// `format_jam` (24 / 12) pada zona waktu terpilih (WIB/WITA/WIT).
//
// SUMBER WAKTU SERVER: adapter DB mengembalikan timestamp UTC sebagai
// string 'YYYY-MM-DD HH:MM:SS.sss' — selalu dibaca sebagai UTC lalu
// ditampilkan dalam zona toko. String ISO berawalan 'T' TANPA offset
// (mis. dari rincian JSON laporan) adalah wall-clock yang SUDAH dikonversi
// server — ditampilkan apa adanya, hanya formatnya disesuaikan.

import { regionalAktif } from './regional';

const RUPIAH = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ANGKA = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Rp 1.250.000 */
export function formatRupiah(nilai: number | null | undefined): string {
  return RUPIAH.format(nilai ?? 0);
}

/** 1.250.000 */
export function formatAngka(nilai: number | null | undefined): string {
  return ANGKA.format(nilai ?? 0);
}

interface Bagian {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
}

type Masukan = Date | string | number | null | undefined;

const pad = (n: number): string => String(n).padStart(2, '0');

const angka2 = (s: string | undefined, dflt: number): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Uraikan nilai menjadi momen absolut (perlu konversi zona) atau
 * bagian wall-clock (sudah dalam zona toko — tampil apa adanya).
 */
function keMomen(value: Masukan): { d: Date } | { p: Bagian } | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { d: value };
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : { d };
  }
  const s = value.trim();
  // 'YYYY-MM-DD HH:MM:SS(.sss)' dari adapter PG = UTC.
  let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
  if (m) {
    return {
      d: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), angka2(m[6], 0))),
    };
  }
  // ISO dengan Z / offset eksplisit = momen absolut.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : { d };
  }
  // 'YYYY-MM-DDTHH:MM:SS' tanpa zona = wall-clock zona toko.
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
  if (m) {
    return { p: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), H: Number(m[4]), M: Number(m[5]) } };
  }
  // 'YYYY-MM-DD' = tanggal kalender.
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    return { p: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), H: 0, M: 0 } };
  }
  // Fallback: serahkan ke parser bawaan (dianggap momen absolut).
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { d };
}

/** Bagian kalender suatu momen absolut DALAM zona toko. */
function bagianDiZona(d: Date, zona: string): Bagian {
  const b: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)) {
    if (p.type !== 'literal') b[p.type] = p.value;
  }
  return {
    y: Number(b.year),
    m: Number(b.month),
    d: Number(b.day),
    H: b.hour === '24' ? 0 : Number(b.hour),
    M: Number(b.minute),
  };
}

function tanggalDariBagian(b: Bagian, fmt: string): string {
  const dd = pad(b.d);
  const mm = pad(b.m);
  const yyyy = String(b.y);
  switch (fmt) {
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD-MM-YYYY':
      return `${dd}-${mm}-${yyyy}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

function jamDariBagian(b: Bagian, fj: string): string {
  if (fj === '12') {
    const h = b.H % 12 || 12;
    return `${h}:${pad(b.M)} ${b.H < 12 ? 'AM' : 'PM'}`;
  }
  return `${pad(b.H)}:${pad(b.M)}`;
}

function bagian(value: Masukan): Bagian | null {
  const k = keMomen(value);
  if (!k) return null;
  if ('p' in k) return k.p;
  return bagianDiZona(k.d, regionalAktif().zona);
}

/** Tanggal sesuai Format Tanggal pengaturan (zona toko). */
export function formatTanggal(value: Masukan): string {
  const b = bagian(value);
  if (!b) return '—';
  return tanggalDariBagian(b, regionalAktif().formatTanggal);
}

/** Tanggal + jam sesuai Format Tanggal & Format Jam pengaturan (zona toko). */
export function formatTanggalWaktu(value: Masukan): string {
  const b = bagian(value);
  if (!b) return '—';
  const r = regionalAktif();
  return `${tanggalDariBagian(b, r.formatTanggal)} ${jamDariBagian(b, r.formatJam)}`;
}

/** Senin, 8 Oktober 2026 (zona toko). */
export function formatTanggalPanjang(value: Masukan): string {
  const k = keMomen(value);
  if (!k) return '—';
  if ('p' in k) {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(k.p.y, k.p.m - 1, k.p.d));
  }
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: regionalAktif().zona,
  }).format(k.d);
}
