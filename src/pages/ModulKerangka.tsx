import { Link } from 'react-router-dom';
import { MENU_BY_KODE, type MenuItem } from '../config/menu';
import { Icon } from '../components/Icon';

/**
 * Halaman kerangka tiap modul: judul, deskripsi, dan daftar fitur yang
 * akan dibangun pada tahap berikutnya (bukan fitur yang sudah berjalan).
 */
export function ModulKerangka({ kode }: { kode: string }) {
  const menu: MenuItem | undefined = MENU_BY_KODE.get(kode);
  if (!menu) return null;

  return (
    <div className="halaman">
      <section className="kartu kartu--kosong">
        <span className="kartu--kosong__ikon">
          <Icon nama={menu.icon} size={30} />
        </span>
        <h2>Modul {menu.label}</h2>
        <p className="teks-redup">{menu.deskripsi}</p>

        <div className="pita">Kerangka aplikasi — modul ini akan diimplementasikan pada tahap berikutnya.</div>

        <div className="aksi-kosong">
          <Link className="tombol" to="/">
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
