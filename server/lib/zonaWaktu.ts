// Zona waktu & format regional global (Pengaturan ▸ Umum & Regional).
//
// Satu-satunya sumber kebenaran zona untuk SELURUH backend:
//  - `zona_waktu`  (mis. Asia/Jakarta, Asia/Makassar, Asia/Jayapura)
//  - `format_tanggal` (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, MM/DD/YYYY)
//  - `peng.umum-regional.format_jam` (24 / 12)
//
// Nilai dibaca dari tabel settings dan di-cache 30 detik agar tiap query
// laporan tidak menambah round-trip DB; `resetRegional()` dipanggil setiap
// tab Umum & Regional disimpan sehingga perubahan berlaku TANPA restart.

import { getSettings } from '../db.pg.ts';

export interface Regional {
  zona: string;
  formatTanggal: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'MM/DD/YYYY';
  formatJam: '24' | '12';
  /** Offset zona (ms) saat ini — untuk batas hari agar transaksi malam tak tergeser. */
  offsetMs: number;
}

const ZONA_BAWAN = 'Asia/Jakarta';
const ZONA_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_\-+]+)+$/;
const FORMAT_VALID = new Set(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY']);

/** True bila string adalah nama zona IANA yang dikenali runtime. */
export function zonaValid(zona: string): boolean {
  if (!ZONA_RE.test(zona)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset zona (ms) pada suatu momen, dihitung dari dinding jam zona itu
 * sendiri — tepat untuk zona Indonesia (+7/+8/+9) maupun zona ber-DST.
 */
export function offsetZonaMs(zona: string, saat = Date.now()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const b: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(saat))) {
      if (p.type !== 'literal') b[p.type] = p.value;
    }
    const detik = saat - (saat % 1000);
    const dinding = Date.UTC(
      Number(b.year),
      Number(b.month) - 1,
      Number(b.day),
      b.hour === '24' ? 0 : Number(b.hour),
      Number(b.minute),
      Number(b.second),
    );
    return dinding - detik;
  } catch {
    return 7 * 3600_000;
  }
}

/** Singkatan label zona: WIB / WITA / WIT, atau GMT±n untuk zona lain. */
export function labelZona(zona: string, offsetMs?: number): string {
  if (zona === 'Asia/Jakarta') return 'WIB';
  if (zona === 'Asia/Makassar') return 'WITA';
  if (zona === 'Asia/Jayapura') return 'WIT';
  const jam = (offsetMs ?? offsetZonaMs(zona)) / 3600_000;
  const bulat = Math.round(jam * 10) / 10;
  return `GMT${bulat >= 0 ? '+' : ''}${bulat}`;
}

let cache: { isi: Regional; waktu: number } | null = null;
const TTL_MS = 30_000;

/** Buang cache regional (dipakai setelah restore database). */
export function kosongkanCacheRegional(): void {
  cache = null;
}

async function bacaRegional(): Promise<Regional> {
  let zona = ZONA_BAWAN;
  let formatTanggal: Regional['formatTanggal'] = 'DD/MM/YYYY';
  let formatJam: Regional['formatJam'] = '24';
  try {
    const s = await getSettings();
    const z = (s['peng.umum-regional.zona_waktu'] ?? '').trim();
    if (z && zonaValid(z)) zona = z;
    const ft = (s['format_tanggal'] ?? '').trim().toUpperCase();
    if (FORMAT_VALID.has(ft)) formatTanggal = ft as Regional['formatTanggal'];
    const fj = (s['peng.umum-regional.format_jam'] ?? '').trim();
    if (fj === '12' || fj === '24') formatJam = fj;
  } catch {
    // settings belum siap — pakai bawaan.
  }
  return { zona, formatTanggal, formatJam, offsetMs: offsetZonaMs(zona) };
}

/** Regional aktif (cache 30 dtk). Dipakai query laporan & dashboard. */
export async function regional(): Promise<Regional> {
  if (cache && Date.now() - cache.waktu < TTL_MS) return cache.isi;
  const isi = await bacaRegional();
  cache = { isi, waktu: Date.now() };
  return isi;
}

/** Nama zona IANA aktif. */
export async function zonaToko(): Promise<string> {
  return (await regional()).zona;
}

/** Buang cache — dipanggil tiap tab Umum & Regional disimpan. */
export function resetRegional(): void {
  cache = null;
}
