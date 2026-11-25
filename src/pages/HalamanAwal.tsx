import { Navigate } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { TanpaAkses } from './TolakAkses';
import { useSesi } from '../lib/sesi';

/**
 * Rute indeks (/).
 *
 * AY — tujuan diambil dari sesi (server menyelesaikan menu awal peran +
 * fallback halaman pertama yang boleh dilihat). Bila peran tidak memiliki
 * halaman sama sekali, tampilkan halaman tanpa-akses (dengan tombol Keluar),
 * bukan halaman kosong atau galat.
 */
export function HalamanAwal() {
  const { status, info } = useSesi();

  if (status === 'memuat' || !info) return null;
  // AY2 — peran tanpa halaman yang boleh dilihat.
  if (!info.menuAwal) return <TanpaAkses />;
  if (info.menuAwal.rute !== '/') return <Navigate to={info.menuAwal.rute} replace />;
  return <Dashboard />;
}
