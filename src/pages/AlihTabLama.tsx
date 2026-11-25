import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Z2 — pengalih rute lama yang memakai tab.
 *
 * Sebelum ribon tab dihapus, sebagian tautan/bookmark lama memilih sub-halaman
 * lewat query `?tab=kategori` atau hash `#kategori`. Kini tiap sub-menu punya
 * rute mandiri, jadi alamat lama dialihkan ke rute baru supaya tidak rusak.
 *
 * Pakai: <AlihTabLama peta={{ kategori: '/master/kategori', ... }} selain={<ProdukPage />} />
 * Nilai `tab`/hash yang tidak dikenal jatuh ke `selain` (indeks modul).
 */
export function AlihTabLama({ peta, selain }: { peta: Record<string, string>; selain: ReactNode }) {
  const lok = useLocation();
  const nilai =
    new URLSearchParams(lok.search).get('tab') ?? decodeURIComponent(lok.hash.replace(/^#/, ''));

  const tujuan = nilai ? peta[nilai] : undefined;
  if (tujuan) return <Navigate to={tujuan} replace />;
  return <>{selain}</>;
}
