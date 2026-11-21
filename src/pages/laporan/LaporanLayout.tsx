import { Outlet, useLocation } from 'react-router-dom';
import { FilterBar } from './FilterBar';
import { FilterProvider } from './filter';
import './laporan.css';

/**
 * Kerangka modul Laporan (N1/N2): satu FilterProvider untuk seluruh subtree,
 * sehingga filter & periode bertahan saat berpindah antar laporan dan selalu
 * tercermin di query URL.
 *
 * Halaman laporan (/laporan/l/:kode) menaruh tombol Filter di baris kartu
 * metrik (lihat HalamanLaporan), jadi bar atas tidak dirender di sana agar
 * tidak ada baris kosong di atas halaman.
 */
export function LaporanLayout() {
  const { pathname } = useLocation();
  const halamanLaporan = /^\/laporan\/l\/[^/]+/.test(pathname);
  return (
    <FilterProvider>
      <div className="halaman laporan-shell">
        {!halamanLaporan && <FilterBar />}
        <Outlet />
      </div>
    </FilterProvider>
  );
}
