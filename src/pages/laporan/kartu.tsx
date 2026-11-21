import type { ReactNode } from 'react';
import { formatRupiah } from '../../lib/format';
import type { KartuLaporan } from './tipe';

/** Format nilai kartu sesuai spesifikasi (rupiah/angka/persen). */
export function fmtNilai(v: number, f: KartuLaporan['format']): string {
  if (f === 'rupiah') return formatRupiah(v);
  if (f === 'persen') return `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

/**
 * Grid kartu ringkasan (N1): tiap kartu menampilkan nilai + delta persen
 * terhadap periode pembanding bila filter "Bandingkan" aktif.
 * `aksi` (mis. tombol Filter) dirender di ujung kanan baris metrik.
 */
export function KartuGrid({ kartu, aksi }: { kartu: KartuLaporan[]; aksi?: ReactNode }) {
  if (!kartu.length && !aksi) return null;
  return (
    <div className={`laporan-kartu${aksi ? ' laporan-kartu--baris' : ''}`}>
      {kartu.map((k) => {
        const lalu = k.lalu;
        const bisaDelta = lalu !== undefined && lalu !== null;
        const delta = bisaDelta && lalu !== 0 ? ((k.nilai - Math.abs(lalu)) / Math.abs(lalu)) * 100 : null;
        return (
          <div key={k.kunci} className="laporan-kartu__isi">
            <span className="laporan-kartu__label">{k.label}</span>
            <strong className={`laporan-kartu__nilai ${k.nilai < 0 ? 'laporan-kartu__nilai--minus' : ''}`}>
              {fmtNilai(k.nilai, k.format)}
            </strong>
            {bisaDelta && (
              <span
                className={`laporan-kartu__delta ${
                  delta === null ? '' : delta >= 0 ? 'laporan-kartu__delta--naik' : 'laporan-kartu__delta--turun'
                }`}
                title={`Sebelumnya: ${fmtNilai(lalu as number, k.format)}`}
              >
                {delta === null
                  ? `sebelumnya ${fmtNilai(lalu as number, k.format)}`
                  : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% vs periode sebelumnya`}
              </span>
            )}
          </div>
        );
      })}
      {aksi && <div className="laporan-kartu__aksi">{aksi}</div>}
    </div>
  );
}

/** Panel penolakan akses (N7) — dipakai saat URL diketik langsung oleh peran yang tidak berhak. */
export function TolakAkses({ pesan }: { pesan: string }) {
  return (
    <section className="kartu kartu--kosong">
      <h2>Akses ditolak</h2>
      <p className="teks-redup">{pesan}</p>
    </section>
  );
}
