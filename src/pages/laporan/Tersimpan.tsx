import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconButton } from '../../components/IconButton';
import { beritahu } from '../../components/crud/Toast';
import { bolehLaporan } from '../../config/menu';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { useSegarkanModul } from '../../lib/segarkan';
import { formatTanggal } from '../../lib/format';
import { peranAktif } from '../../lib/pengguna';
import { useSesi } from '../../lib/sesi';
import { TolakAkses } from './kartu';
import type { DefRingkas } from './tipe';

/** Baris saved_reports & report_files dari GET /api/laporan/tersimpan. */
interface Tersimpan {
  id: number;
  nama: string;
  laporan: string;
  params_json: string;
  jadwal: string | null;
  aktif: number;
  terakhir_jalan: string | null;
  dibuat_pada: string;
}

interface Berkas {
  id: number;
  saved_report_id: number | null;
  laporan: string;
  nama: string;
  periode_dari: string;
  periode_sampai: string;
  dibuat_pada: string;
}

const JADWAL_TEKS: Record<string, string> = {
  harian: 'Harian',
  mingguan: 'Mingguan',
  bulanan: 'Bulanan',
};

/**
 * N5 — Laporan Tersimpan: jalankan sekarang (hasil → berkas laporan / Daftar
 * Dokumen), buka dengan parameter tersimpan, hapus, dan penjadwalan
 * harian/mingguan/bulanan yang dijalankan otomatis oleh server.
 */
export function TersimpanLaporan() {
  const navigasi = useNavigate();
  const peran = peranAktif();
  const hakLaporan = useSesi().info?.hak;
  const [data, setData] = useState<Tersimpan[]>([]);
  const [berkas, setBerkas] = useState<Berkas[]>([]);
  const [daftar, setDaftar] = useState<DefRingkas[]>([]);
  const [sibuk, setSibuk] = useState(true);
  const [sedangJalan, setSedangJalan] = useState<number | null>(null);

  const muat = useCallback(() => {
    setSibuk(true);
    void Promise.all([
      apiGet<{ data: Tersimpan[]; berkas: Berkas[] }>('/api/laporan/tersimpan'),
      apiGet<{ data: DefRingkas[] }>('/api/laporan/daftar'),
    ])
      .then(([t, d]) => {
        setData(t.data);
        setBerkas(t.berkas);
        setDaftar(d.data);
      })
      .catch((e: Error) => beritahu(e.message, 'galat'))
      .finally(() => setSibuk(false));
  }, []);

  useEffect(() => {
    if (bolehLaporan(peran, 'tersimpan', hakLaporan)) muat();
    else setSibuk(false);
  }, [muat, peran]);
  // Tombol Refresh global di topbar: muat ulang daftar tersimpan.
  useSegarkanModul(muat);

  if (!bolehLaporan(peran, 'tersimpan', hakLaporan)) {
    return <TolakAkses pesan="Peran ini tidak berhak mengelola laporan tersimpan (N7)." />;
  }

  const judulKode = (kode: string) => daftar.find((d) => d.kode === kode)?.judul ?? kode;

  const buka = (s: Tersimpan) => {
    let params: Record<string, string> = {};
    try {
      params = JSON.parse(s.params_json ?? '{}') as Record<string, string>;
    } catch {
      params = {};
    }
    const sp = new URLSearchParams(params);
    navigasi(`/laporan/l/${s.laporan}?${sp.toString()}`);
  };

  const jalankan = async (s: Tersimpan) => {
    setSedangJalan(s.id);
    try {
      const r = await apiPost<{ baris: number }>(`/api/laporan/tersimpan/${s.id}/jalankan`, {});
      beritahu(`Laporan "${s.nama}" dijalankan — ${r.baris} baris tersimpan.`, 'sukses');
      muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    } finally {
      setSedangJalan(null);
    }
  };

  const hapus = async (s: Tersimpan) => {
    if (!window.confirm(`Hapus laporan tersimpan "${s.nama}"?`)) return;
    try {
      await apiDelete(`/api/laporan/tersimpan/${s.id}`);
      beritahu('Laporan tersimpan dihapus.', 'sukses');
      muat();
    } catch (e) {
      beritahu((e as Error).message, 'galat');
    }
  };

  return (
    <>
      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Laporan Tersimpan</h3>
            <p className="teks-redup teks-kecil">
              Jalankan laporan berparameter kapan saja — hasilnya tercatat sebagai berkas laporan di halaman
              ini. Penjadwalan harian/mingguan/bulanan dijalankan otomatis oleh server.
            </p>
          </div>
          <button type="button" className="tombol tombol--netral tombol--kecil" onClick={muat} disabled={sibuk}>
            {sibuk ? 'Memuat…' : 'Muat ulang'}
          </button>
        </div>
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Daftar laporan</h3>
            <p className="teks-redup teks-kecil">Simpan kombinasi filter dari halaman laporan (ikon Simpan Laporan).</p>
          </div>
          <Link className="tombol tombol--kecil" to="/laporan">
            Buka Ringkasan
          </Link>
        </div>

        <div className="tabel-bungkus">
          <table className="tabel tabel--aksi">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Laporan</th>
                <th>Jadwal</th>
                <th>Terakhir jalan</th>
                <th className="rata-tengah">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.nama}</strong>
                  </td>
                  <td>{judulKode(s.laporan)}</td>
                  <td>
                    {s.jadwal ? (
                      <span className="laporan-chip laporan-chip--jadwal">{JADWAL_TEKS[s.jadwal] ?? s.jadwal}</span>
                    ) : (
                      <span className="teks-redup">Sekali jalan</span>
                    )}
                  </td>
                  <td>{s.terakhir_jalan ? formatTanggal(new Date(s.terakhir_jalan.replace(' ', 'T'))) : 'Belum pernah'}</td>
                  <td className="rata-tengah">
                    <span className="aksi-baris">
                      <IconButton
                        ikon="rotate-ccw"
                        label="Jalankan sekarang"
                        ukuran="baris"
                        disabled={sedangJalan === s.id}
                        onClick={() => void jalankan(s)}
                      />
                      <IconButton ikon="eye" label="Buka laporan" ukuran="baris" onClick={() => buka(s)} />
                      <IconButton ikon="trash" label="Hapus" ukuran="baris" onClick={() => void hapus(s)} />
                    </span>
                  </td>
                </tr>
              ))}
              {!sibuk && data.length === 0 && (
                <tr>
                  <td colSpan={5} className="teks-redup">
                    Belum ada laporan tersimpan. Buka sebuah laporan lalu klik ikon “Simpan Laporan”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kartu">
        <div className="kartu__kepala kartu__kepala--kompak">
          <div>
            <h3>Berkas laporan</h3>
            <p className="teks-redup teks-kecil">
              Hasil “Jalankan sekarang” & jadwal otomatis — ikhtisar nilai tiap laporan.
            </p>
          </div>
        </div>
        <div className="tabel-bungkus">
          <table className="tabel">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Laporan</th>
                <th>Periode</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {berkas.map((b) => (
                <tr key={b.id}>
                  <td>{b.nama}</td>
                  <td>{judulKode(b.laporan)}</td>
                  <td>
                    {b.periode_dari} s/d {b.periode_sampai}
                  </td>
                  <td>{formatTanggal(new Date(b.dibuat_pada.replace(' ', 'T')))}</td>
                </tr>
              ))}
              {!sibuk && berkas.length === 0 && (
                <tr>
                  <td colSpan={4} className="teks-redup">
                    Belum ada berkas — jalankan salah satu laporan di atas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
