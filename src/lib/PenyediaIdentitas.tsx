// Root-level identitas aplikasi (nama, tagline, logo, favicon, aksen).
//
// Satu provider di atas seluruh aplikasi:
//  * memuat identitas dari server saat aplikasi pertama dibuka — termasuk
//    halaman Log In, memakai endpoint publik;
//  * memuat ulang saat sesi berganti akun/peran dan saat toko aktif berubah;
//  * menyimpan hasilnya di store global `lib/identitas` sehingga sidebar,
//    topbar, layar muat, dan judul/favicon tab memakai data yang sama;
//  * menerapkan `<title>` dan `<link rel="icon">` secara dinamis.
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { apiGet } from './api';
import { useSesi } from './sesi';
import {
  IDENTITAS_BAWAAN,
  muatIdentitas,
  terapkanIdentitasDokumen,
  tokoAktif,
  useIdentitas,
  type Identitas,
} from './identitas';

const KonteksIdentitas = createContext<Identitas | null>(null);

/** Identitas global terkini; wajib dipakai di dalam <PenyediaIdentitas>. */
export function useIdentitasAplikasi(): Identitas {
  const v = useContext(KonteksIdentitas);
  if (!v) throw new Error('useIdentitasAplikasi harus dipakai di dalam <PenyediaIdentitas>.');
  return v;
}

interface TokoPilihan {
  toko: { kode: string; nama: string }[];
  terakhir: string | null;
}

/**
 * Sesi baru di perangkat baru belum punya `nusapos.tokoAktif`. Tanpa kode toko,
 * endpoint identitas mengembalikan identitas umum, bukan identitas toko yang
 * dikonfigurasi — inilah sebab nama/logo baru benar setelah membuka Pengaturan.
 * Ambil toko terakhir milik pengguna dari server (dalam cakupannya) sekali.
 */
async function pastikanTokoAktif(): Promise<void> {
  const aktif = tokoAktif();
  if (aktif) {
    // Toko lokal bisa berasal dari akun sebelumnya dan di luar cakupan akun ini.
    try {
      const t = await apiGet<TokoPilihan>('/api/auth/toko-pilihan');
      if (t.toko.some((x) => x.kode === aktif)) return;
      const ganti = t.terakhir ?? t.toko[0]?.kode ?? '';
      if (ganti) localStorage.setItem('nusapos.tokoAktif', ganti);
    } catch {
      /* tetap pakai toko lokal bila server tidak dapat dihubungi */
    }
    return;
  }
  try {
    const t = await apiGet<TokoPilihan>('/api/auth/toko-pilihan');
    const awal = t.terakhir ?? t.toko[0]?.kode ?? '';
    if (awal) localStorage.setItem('nusapos.tokoAktif', awal);
  } catch {
    /* tamu / belum punya akses gudang — identitas umum tetap dipakai */
  }
}

export function PenyediaIdentitas({ children }: { children: ReactNode }) {
  const identitas = useIdentitas();
  const sesi = useSesi();
  const idPengguna = sesi.info?.pengguna.id ?? null;
  const peran = sesi.info?.pengguna.peran ?? null;
  const status = sesi.status;

  // Initial fetch + invalidasi saat ganti akun/peran. Untuk sesi yang sudah
  // masuk, toko aktif diselaraskan dulu agar identitas per-toko ikut termuat.
  useEffect(() => {
    let hidup = true;
    const muat = async () => {
      if (status === 'masuk') await pastikanTokoAktif();
      if (hidup) await muatIdentitas().catch(() => {});
    };
    void muat();
    return () => {
      hidup = false;
    };
  }, [status, idPengguna, peran]);

  // Perubahan pilihan toko dari tab lain / jendela lain.
  useEffect(() => {
    const ubah = (e: StorageEvent) => {
      if (e.key !== 'nusapos.tokoAktif') return;
      void muatIdentitas().catch(() => {});
    };
    window.addEventListener('storage', ubah);
    return () => window.removeEventListener('storage', ubah);
  }, []);

  // Judul tab & favicon dinamis mengikuti identitas global.
  useEffect(() => {
    terapkanIdentitasDokumen(identitas);
  }, [identitas]);

  return <KonteksIdentitas.Provider value={identitas}>{children}</KonteksIdentitas.Provider>;
}

/** Identitas bawaan untuk pemakaian di luar provider (mis. uji komponen). */
export { IDENTITAS_BAWAAN };
