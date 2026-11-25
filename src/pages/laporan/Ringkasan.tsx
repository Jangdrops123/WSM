import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { TombolScan } from '../../components/ScanKamera';
import { bolehLaporan, type IconName } from '../../config/menu';
import { apiGet } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatRupiah } from '../../lib/format';
import { peranAktif } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
import { useFilterLaporan } from './filter';
import { KartuGrid, TolakAkses } from './kartu';
import type { DefRingkas, ResponsRingkasan } from './tipe';

/**
 * N1 — Halaman Ringkasan: kartu KPI (dengan % vs periode sebelumnya bila
 * "Bandingkan" aktif), 5 barang terlaris, pencarian cepat laporan,
 * dan pintasan ke tiap kategori.
 */

const KATEGORI: { kode: string; label: string; ikon: IconName; teks: string }[] = [
  { kode: 'penjualan', label: 'Penjualan', ikon: 'penjualan', teks: 'Rekap, kasir, pelanggan, barang, retur' },
  { kode: 'pembelian', label: 'Pembelian', ikon: 'pembelian', teks: 'Rekap, pemasok, barang, status dokumen' },
  { kode: 'stok', label: 'Stok & Persediaan', ikon: 'stok', teks: 'Stok, kartu, mutasi, nilai, perputaran' },
  { kode: 'opname', label: 'Opname', ikon: 'opname', teks: 'Riwayat & selisih opname' },
  { kode: 'keuangan', label: 'Keuangan', ikon: 'akuntansi', teks: 'Laba rugi, neraca, arus kas, buku besar' },
  { kode: 'pajak', label: 'Pajak', ikon: 'faktur', teks: 'Pajak keluaran & masukan' },
  { kode: 'piutang', label: 'Piutang & Utang', ikon: 'laporan', teks: 'Aging, jatuh tempo, pelunasan' },
];

export function RingkasanLaporan() {
  const peran = peranAktif();
  const hakLaporan = useSesi().info?.hak;
  const { ser } = useFilterLaporan();
  const [isi, setIsi] = useState<ResponsRingkasan | null>(null);
  const [daftar, setDaftar] = useState<DefRingkas[]>([]);
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(true);
  const [cari, setCari] = useState('');
  const [segarHitung, setSegarHitung] = useState(0);
  // Tombol Refresh global di topbar: muat ulang ringkasan (tanpa mengubah filter/pencarian).
  useSegarkanModul(() => setSegarHitung((n) => n + 1));

  useEffect(() => {
    if (!bolehLaporan(peran, 'ringkasan', hakLaporan)) {
      setSibuk(false);
      return;
    }
    let hidup = true;
    setSibuk(true);
    setGalat('');
    void apiGet<ResponsRingkasan>(`/api/laporan/ringkasan?${ser}`)
      .then((r) => {
        if (hidup) setIsi(r);
      })
      .catch((e: Error) => {
        if (hidup) setGalat(e.message);
      })
      .finally(() => {
        if (hidup) setSibuk(false);
      });
    return () => {
      hidup = false;
    };
  }, [ser, peran, segarHitung]);

  useEffect(() => {
    void apiGet<{ data: DefRingkas[] }>('/api/laporan/daftar')
      .then((r) => setDaftar(r.data))
      .catch(() => undefined);
  }, []);

  const hasilCari = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return null;
    return daftar.filter(
      (d) => d.judul.toLowerCase().includes(q) || d.deskripsi.toLowerCase().includes(q) || d.kategori.includes(q),
    );
  }, [cari, daftar]);

  if (!bolehLaporan(peran, 'ringkasan', hakLaporan)) {
    return (
      <TolakAkses pesan="Peran ini hanya boleh melihat laporan penjualan. Buka menu Laporan › Penjualan." />
    );
  }

  return (
    <>
      <section className="kartu laporan-kepala">
        <div>
          <h3>Ringkasan</h3>
          <p className="teks-redup teks-kecil">
            Ikhtisar bisnis pada periode terpilih{isi ? ` · ${isi.periode.dari} s/d ${isi.periode.sampai}` : ''}
            {isi ? ` · ${isi.durasi_ms} ms` : ''}
          </p>
        </div>
        <div className="cari-scan">
        <label className="laporan-cari">
          <input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari laporan… (mis. laba rugi, kartu stok)"
            aria-label="Cari laporan"
          />
        </label>
        <TombolScan onHasil={setCari} />
        </div>
      </section>

      {hasilCari ? (
        <section className="kartu">
          <div className="kartu__kepala kartu__kepala--kompak">
            <div>
              <h3>Pencarian: “{cari}”</h3>
              <p className="teks-redup teks-kecil">{hasilCari.length} laporan cocok.</p>
            </div>
          </div>
          {hasilCari.length === 0 ? (
            <p className="teks-redup">Tidak ada laporan yang cocok. Coba kata kunci lain.</p>
          ) : (
            <div className="laporan-daftar-kartu">
              {hasilCari.map((d) => (
                <Link key={d.kode} className="laporan-kartu-link" to={`/laporan/l/${d.kode}?lap=${encodeURIComponent(d.kode)}`}>
                  <strong>{d.judul}</strong>
                  <span className="teks-redup teks-kecil">{d.deskripsi}</span>
                  <span className="laporan-chip">{d.kategori}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {galat && <div className="pita pita--galat">{galat}</div>}
          {sibuk && !isi ? (
            <p className="teks-redup">Memuat ringkasan…</p>
          ) : (
            isi && (
              <>
                <KartuGrid kartu={isi.kartu} />

                <section className="kartu">
                    <div className="kartu__kepala kartu__kepala--kompak">
                      <div>
                        <h3>5 barang terlaris</h3>
                        <p className="teks-redup teks-kecil">Berdasarkan qty terjual.</p>
                      </div>
                    </div>
                    <ol className="laporan-terlaris">
                      {isi.terlaris.map((t, i) => (
                        <li key={i}>
                          <span className="laporan-terlaris__peringkat">{i + 1}</span>
                          <span className="laporan-terlaris__nama">{t.nama}</span>
                          <span className="teks-redup">{Number(t.qty).toLocaleString('id-ID')} pcs</span>
                          <strong>{formatRupiah(t.omzet)}</strong>
                        </li>
                      ))}
                      {isi.terlaris.length === 0 && <li className="teks-redup">Belum ada penjualan pada periode ini.</li>}
                    </ol>
                  </section>

                  <section className="kartu laporan-pintasan">
                    <div className="kartu__kepala kartu__kepala--kompak">
                      <div>
                        <h3>Pintasan laporan</h3>
                        <p className="teks-redup teks-kecil">Klik kategori untuk melihat daftar laporannya.</p>
                      </div>
                    </div>
                    <div className="laporan-daftar-kartu laporan-daftar-kartu--horizontal">
                      {KATEGORI.filter((k) => bolehLaporan(peran, k.kode, hakLaporan)).map((k) => (
                        <Link key={k.kode} className="laporan-kartu-link" to={`/laporan/${k.kode}`}>
                          <Icon nama={k.ikon} size={20} />
                          <strong>{k.label}</strong>
                          <span className="teks-redup teks-kecil">{k.teks}</span>
                        </Link>
                      ))}
                      <Link className="laporan-kartu-link" to="/laporan/tersimpan">
                        <Icon nama="laporan" size={20} />
                        <strong>Laporan Tersimpan</strong>
                        <span className="teks-redup teks-kecil">Simpan, jalankan, & penjadwalan otomatis</span>
                      </Link>
                    </div>
                  </section>
              </>
            )
          )}
        </>
      )}
    </>
  );
}
