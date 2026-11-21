import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../lib/api';
import { formatAngka, formatTanggal } from '../../lib/format';
import type { Arah } from './tipe';

type Sesi = Record<string, any>;

/**
 * O4 — Sesi opname yang sudah disahkan muncul di riwayat Item Masuk/Keluar
 * sebagai mutasi "Penyesuaian Opname" (dengan nomor OPN), tanpa input manual:
 * penyesuaian stoknya terjadi otomatis lewat kartu stok & jurnal saat pengesahan.
 * Arah mengikuti netto selisih: lebih (> 0) → Item Masuk, kurang (< 0) → Item Keluar.
 * Isolasi gudang mengikuti API (hanya gudang yang diizinkan peran ini).
 *
 * Kontainer SELALU dirender (tak disembunyikan saat kosong) agar pengguna
 * tahu tidak ada sesi disahkan di gudang ini, bukan karena gagal muat.
 */
export function PenyesuaianOpnameRiwayat({ arah, dalamKartu }: { arah: Arah; dalamKartu?: boolean }) {
  const [data, setData] = useState<Sesi[]>([]);
  const [sibuk, setSibuk] = useState(true);

  useEffect(() => {
    let hidup = true;
    setSibuk(true);
    void apiGet<{ data: Sesi[] }>('/api/opname?per=100&tahap=selesai')
      .then((r) => {
        if (!hidup) return;
        const netto = (s: Sesi) => Number(s.netto_selisih ?? 0);
        setData(r.data.filter((s) => (arah === 'masuk' ? netto(s) > 0 : netto(s) < 0)));
      })
      .catch(() => {
        if (hidup) setData([]);
      })
      .finally(() => {
        if (hidup) setSibuk(false);
      });
    return () => {
      hidup = false;
    };
  }, [arah]);

  const judul = (
    <>
      Penyesuaian Opname <span className="teks-redup">· {formatAngka(data.length)} sesi disahkan</span>
    </>
  );
  const deskripsi = (
    <>
      Sesi opname yang sudah disahkan — penyesuaian stok terjadi otomatis lewat kartu stok &amp; jurnal
      (arah mengikuti netto selisih: {arah === 'masuk' ? 'lebih → masuk' : 'kurang → keluar'}).
    </>
  );

  const isi =
    data.length === 0 ? (
      <p className="teks-redup teks-kecil">
        {sibuk
          ? 'Memuat sesi opname disahkan…'
          : `Belum ada sesi opname disahkan dengan selisih ${arah === 'masuk' ? 'penambahan (+)' : 'pengurangan (−)'} stok di gudang ini.`}
      </p>
    ) : (
      <div className="tabel-bungkus">
        <table className="tabel tabel--kompak-opname">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>No. Opname</th>
              <th>Gudang</th>
              <th className="rata-kanan">Netto Selisih</th>
              <th className="rata-tengah">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap teks-kecil">{formatTanggal(s.tanggal)}</td>
                <td>
                  <code>{s.no_dokumen}</code>
                </td>
                <td className="whitespace-nowrap">{s.gudang_kode}</td>
                <td className="rata-kanan nowrap">
                  {Number(s.netto_selisih ?? 0) >= 0 ? '+' : '−'}
                  {formatAngka(Math.abs(Number(s.netto_selisih ?? 0)))} unit
                </td>
                <td className="rata-tengah">
                  <Link className="tombol tombol--kecil tombol--netral" to={`/stok/opname/${s.id}`}>
                    Lihat Sesi
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  // Dalam kartu riwayat (tampilan token terpisah): tanpa section sendiri agar
  // tabel menjadi anak langsung kartu--daftar (satu-satunya area gulir).
  if (dalamKartu) {
    return (
      <>
        <div className="sub-opname__kepala">
          <h4 className="bagian-judul">{judul}</h4>
          <p className="teks-redup teks-kecil">{deskripsi}</p>
        </div>
        {isi}
      </>
    );
  }

  return (
    <section className="kartu">
      <div className="kartu__kepala kartu__kepala--kompak">
        <div>
          <h3>{judul}</h3>
          <p className="teks-redup teks-kecil">{deskripsi}</p>
        </div>
      </div>
      {isi}
    </section>
  );
}
