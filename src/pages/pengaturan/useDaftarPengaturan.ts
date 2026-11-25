import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { peranAktif } from '../../lib/pengguna';
import { saatSegarkanModul } from '../../lib/segarkan';
import type { DaftarPengaturan } from './tipePengaturan';

// Cache dibuat per peran: daftar tab membawa `boleh` (izin per tab untuk peran
// aktif), jadi ganti peran harus memuat ulang supaya navigasi kiri ikut benar.
let cache: DaftarPengaturan | null = null;
let cachePeran: string | null = null;
let janji: Promise<DaftarPengaturan> | null = null;

function ambil(): Promise<DaftarPengaturan> {
  const peran = peranAktif();
  if (!janji || cachePeran !== peran) {
    cachePeran = peran;
    janji = apiGet<DaftarPengaturan>('/api/pengaturan/daftar').then((r) => {
      cache = r;
      return r;
    });
    janji.catch(() => {
      /* galat — lepas cache agar percobaan berikutnya mengulang */
      janji = null;
    });
  }
  return janji;
}

/**
 * Daftar tab pengaturan dari server (registry). Dimuat sekali lalu dipakai
 * oleh navigasi kiri dan halaman tab — dimuat ulang bila peran aktif berganti.
 */
export function useDaftarPengaturan(): { daftar: DaftarPengaturan | null; galat: string | null } {
  const [daftar, setDaftar] = useState<DaftarPengaturan | null>(() =>
    cache && cachePeran === peranAktif() ? cache : null,
  );
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    if (cache && cachePeran === peranAktif()) {
      setDaftar(cache);
      return;
    }
    let batal = false;
    void ambil()
      .then((r) => {
        if (!batal) setDaftar(r);
      })
      .catch((e: unknown) => {
        if (!batal) setGalat(e instanceof Error ? e.message : 'Gagal memuat daftar pengaturan.');
      });
    return () => {
      batal = true;
    };
  }, []);

  // Tombol Refresh global di topbar: lepas cache registry lalu muat ulang daftar tab.
  useEffect(() => {
    let batal = false;
    return saatSegarkanModul(() => {
      janji = null;
      void ambil()
        .then((r) => {
          if (!batal) setDaftar(r);
        })
        .catch(() => {
          /* biarkan daftar lama saat refresh gagal */
        });
    });
  }, []);

  return { daftar, galat };
}
