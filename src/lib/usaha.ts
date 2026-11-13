// Profil Usaha global frontend: nama, alamat, telepon, kota, email, logo
// dari Pengaturan ▸ Profil Usaha (sumber: /api/meta → tabel settings).
//
// - `useUsaha()` — hook untuk komponen yang menampilkan identitas usaha
//   (header kasir, struk, faktur, kop laporan) agar ikut berubah saat
//   pengaturan disimpan — TANPA reload.
// - `bacaUsaha()` — baca sinkron untuk fungsi non-React (strukDariSale).
// - `segarkanUsaha()` — dipanggil halaman Pengaturan setelah Simpan /
//   Kembalikan bawaan, agar perubahan menyebar ke seluruh UI aktif.

import { useEffect, useState } from 'react';
import { apiGet } from './api';

export interface Usaha {
  nama: string;
  alamat: string;
  telepon: string;
  kota: string;
  email: string;
  logo: string;
}

export const USAHA_BAWAN: Usaha = {
  nama: 'Toko Retail',
  alamat: '',
  telepon: '',
  kota: '',
  email: '',
  logo: '',
};

const KUNCI = 'nusapos.usaha';

function bacaLokal(): Usaha {
  try {
    const v = localStorage.getItem(KUNCI);
    if (!v) return { ...USAHA_BAWAN };
    const j = JSON.parse(v) as Partial<Usaha>;
    return {
      nama: j.nama?.trim() || USAHA_BAWAN.nama,
      alamat: j.alamat ?? '',
      telepon: j.telepon ?? '',
      kota: j.kota ?? '',
      email: j.email ?? '',
      logo: j.logo ?? '',
    };
  } catch {
    return { ...USAHA_BAWAN };
  }
}

function normalisasi(p: Record<string, string>): Usaha {
  return {
    nama: (p['nama_usaha'] ?? '').trim() || USAHA_BAWAN.nama,
    alamat: p['alamat_usaha'] ?? '',
    telepon: p['telepon_usaha'] ?? '',
    kota: p['kota_usaha'] ?? '',
    email: p['email_usaha'] ?? '',
    logo: p['logo_usaha'] ?? '',
  };
}

let cache: Usaha = bacaLokal();
let janji: Promise<Usaha> | null = null;

/** Baca sinkron — untuk fungsi non-React (mis. strukDariSale). */
export function bacaUsaha(): Usaha {
  return cache;
}

async function ambil(): Promise<Usaha> {
  const m = await apiGet<{ pengaturan: Record<string, string> }>('/api/meta');
  cache = normalisasi(m.pengaturan);
  try {
    localStorage.setItem(KUNCI, JSON.stringify(cache));
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
  window.dispatchEvent(new CustomEvent<Usaha>('usaha-berubah', { detail: cache }));
  return cache;
}

/** Muat profil usaha (sekali saja; gagal → pakai bawaan/terakhir). */
export function muatUsaha(): Promise<Usaha> {
  if (!janji) janji = ambil().catch(() => cache);
  return janji;
}

/** Paksa muat ulang dari server — dipakai setelah Simpan pengaturan. */
export async function segarkanUsaha(): Promise<Usaha> {
  janji = null;
  return muatUsaha();
}

/** Hook profil usaha — komponen me-render ulang saat pengaturan berubah. */
export function useUsaha(): Usaha {
  const [u, setU] = useState<Usaha>(cache);
  useEffect(() => {
    let hidup = true;
    void muatUsaha().then((v) => {
      if (hidup) setU(v);
    });
    const h = (e: Event) => {
      if (hidup) setU((e as CustomEvent<Usaha>).detail ?? cache);
    };
    window.addEventListener('usaha-berubah', h);
    return () => {
      hidup = false;
      window.removeEventListener('usaha-berubah', h);
    };
  }, []);
  return u;
}
