// Regional global frontend: zona waktu + format tanggal/jam dari
// Pengaturan ▸ Umum & Regional (sumber: /api/meta → tabel settings).
//
// - `useRegional()` — hook untuk komponen yang harus ikut berubah saat
//   pengaturan disimpan (jam header, tabel laporan).
// - `regionalAktif()` — baca sinkron untuk fungsi format murni.
// - `segarkanRegional()` — dipanggil halaman Pengaturan setelah Simpan,
//   agar jam header & laporan ter-update TANPA reload / restart.

import { useEffect, useState } from 'react';
import { apiGet } from './api';

export interface Regional {
  zona: string;
  formatTanggal: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'MM/DD/YYYY';
  formatJam: '24' | '12';
}

export const REGIONAL_BAWAN: Regional = {
  zona: 'Asia/Jakarta',
  formatTanggal: 'DD/MM/YYYY',
  formatJam: '24',
};

const FORMAT_VALID = new Set(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY']);
const ZONA_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_\-+]+)+$/;

function zonaAman(z: unknown): string {
  if (typeof z !== 'string' || !ZONA_RE.test(z)) return REGIONAL_BAWAN.zona;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return REGIONAL_BAWAN.zona;
  }
}

function normalisasi(p: Record<string, string>): Regional {
  const ft = (p['format_tanggal'] ?? '').trim().toUpperCase();
  const fj = (p['peng.umum-regional.format_jam'] ?? '').trim();
  return {
    zona: zonaAman(p['peng.umum-regional.zona_waktu']),
    formatTanggal: FORMAT_VALID.has(ft) ? (ft as Regional['formatTanggal']) : REGIONAL_BAWAN.formatTanggal,
    formatJam: fj === '12' || fj === '24' ? fj : REGIONAL_BAWAN.formatJam,
  };
}

let cache: Regional = REGIONAL_BAWAN;
let janji: Promise<Regional> | null = null;

/** Baca sinkron — untuk fungsi format murni di luar render React. */
export function regionalAktif(): Regional {
  return cache;
}

/** Singkatan label zona: WIB / WITA / WIT, atau GMT±n untuk zona lain. */
export function labelZona(zona: string): string {
  if (zona === 'Asia/Jakarta') return 'WIB';
  if (zona === 'Asia/Makassar') return 'WITA';
  if (zona === 'Asia/Jayapura') return 'WIT';
  return zona.replace('Asia/', '').replace(/_/g, ' ');
}

async function ambil(): Promise<Regional> {
  const m = await apiGet<{ pengaturan: Record<string, string> }>('/api/meta');
  cache = normalisasi(m.pengaturan);
  window.dispatchEvent(new CustomEvent<Regional>('regional-berubah', { detail: cache }));
  return cache;
}

/** Muat regional (sekali saja; gagal → pakai bawaan/terakhir). */
export function muatRegional(): Promise<Regional> {
  if (!janji) janji = ambil().catch(() => cache);
  return janji;
}

/** Paksa muat ulang dari server — dipakai setelah Simpan pengaturan. */
export async function segarkanRegional(): Promise<Regional> {
  janji = null;
  return muatRegional();
}

/** Hook regional — komponen me-render ulang saat pengaturan berubah. */
export function useRegional(): Regional {
  const [r, setR] = useState<Regional>(cache);
  useEffect(() => {
    let hidup = true;
    void muatRegional().then((v) => {
      if (hidup) setR(v);
    });
    const h = (e: Event) => {
      if (hidup) setR((e as CustomEvent<Regional>).detail ?? cache);
    };
    window.addEventListener('regional-berubah', h);
    return () => {
      hidup = false;
      window.removeEventListener('regional-berubah', h);
    };
  }, []);
  return r;
}
