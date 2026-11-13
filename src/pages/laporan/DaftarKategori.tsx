import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bolehLaporan } from '../../config/menu';
import { apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { peranAktif } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
import { TolakAkses } from './kartu';
import type { DefRingkas } from './tipe';

const LABEL: Record<string, string> = {
  penjualan: 'Penjualan',
  pembelian: 'Pembelian',
  stok: 'Stok & Persediaan',
  opname: 'Opname',
  keuangan: 'Keuangan',
  pajak: 'Pajak',
  piutang: 'Piutang & Utang',
};

/**
 * N3 — Daftar laporan satu kategori (rute /laporan/:kategori): kartu judul +
 * deskripsi yang membuka halaman generik laporan (/laporan/l/:kode).
 */
export function DaftarKategoriLaporan() {
  const { kategori } = useParams();
  const peran = peranAktif();
  const hakLaporan = useSesi().info?.hak;
  const [daftar, setDaftar] = useState<DefRingkas[]>([]);
  const [galat, setGalat] = useState('');
  const [segarHitung, setSegarHitung] = useState(0);
  // Tombol Refresh global di topbar: muat ulang daftar laporan kategori ini.
  useSegarkanModul(() => setSegarHitung((n) => n + 1));

  useEffect(() => {
    void apiGet<{ data: DefRingkas[] }>('/api/laporan/daftar')
      .then((r) => setDaftar(r.data))
      .catch((e: Error) => setGalat(e.message));
  }, [segarHitung]);

  if (!kategori || !(kategori in LABEL)) {
    return <TolakAkses pesan="Kategori laporan tidak dikenal. Buka menu Laporan untuk memilih kategori." />;
  }
  if (!bolehLaporan(peran, kategori, hakLaporan)) {
    return <TolakAkses pesan="Peran ini tidak berhak melihat laporan kategori ini (N7)." />;
  }

  const laporan = daftar.filter((d) => d.kategori === kategori);

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <div>
          <h3>Laporan {LABEL[kategori]}</h3>
          <p className="teks-redup teks-kecil">
            Pilih laporan — seluruhnya memakai filter & periode global di atas.
          </p>
        </div>
        <Link className="tombol tombol--netral tombol--kecil" to="/laporan">
          Ringkasan
        </Link>
      </div>

      {galat && <p className="teks-redup">{galat}</p>}
      {!galat && laporan.length === 0 && <p className="teks-redup">Memuat daftar laporan…</p>}

      <div className="laporan-daftar-kartu">
        {laporan.map((d) => (
          <Link key={d.kode} className="laporan-kartu-link" to={`/laporan/l/${d.kode}?lap=${encodeURIComponent(d.kode)}`}>
            <strong>{d.judul}</strong>
            <span className="teks-redup teks-kecil">{d.deskripsi}</span>
            <span className="laporan-chip">{d.kode}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
