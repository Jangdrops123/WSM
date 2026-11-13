import type { ReactNode } from 'react';

/**
 * PageLayout (U6) — SATU kerangka halaman untuk semua daftar/form:
 * kepala (judul + subjudul satu baris + aksi) → toolbar (satu baris,
 * flex-wrap) → isi (tabel lebar penuh, menggulir di dalam) → kaki paginasi
 * (satu baris di kanan bawah, menempel pada kartu).
 *
 * Jarak & lebar seragam di seluruh aplikasi karena semua halaman melewati
 * komponen ini (spasi mengikuti token `--gap-kartu` / `--padding-kartu`).
 */
export function PageLayout({
  judul,
  deskripsi,
  jumlah,
  aksi,
  alat,
  isi,
  paginasi,
  kelas,
}: {
  /** Judul halaman (h3). */
  judul: ReactNode;
  /** Subjudul/keterangan — satu baris, elipsis bila panjang. */
  deskripsi?: ReactNode;
  /** Ringkasan jumlah di kanan kepala (mis. "12 data") — pola Gambar 1. */
  jumlah?: ReactNode;
  /** Tombol aksi di kanan kepala (ikon + Tambah). */
  aksi?: ReactNode;
  /** Toolbar: pencarian, filter, ringkasan. Satu baris dengan wrap. */
  alat?: ReactNode;
  /** Isi halaman: tabel, grid kartu, formulir. */
  isi: ReactNode;
  /** Kaki: paginasi (ringkasan + kontrol) — satu baris di kanan bawah. */
  paginasi?: ReactNode;
  kelas?: string;
}) {
  return (
    <div className={`halaman halaman--fit ${kelas ?? ''}`.trim()}>
      <section className="kartu kartu--daftar">
        {(judul || aksi) && (
          <div className="kartu__kepala kartu__kepala--kompak">
            <div>
              <h3>{judul}</h3>
              {deskripsi && <p className="teks-redup teks-kecil">{deskripsi}</p>}
            </div>
            {jumlah && <span className="kartu__jumlah">{jumlah}</span>}
            {aksi && <div className="tombol-baris">{aksi}</div>}
          </div>
        )}
        {alat && <div className="alat-tabel toolbar-kompak">{alat}</div>}
        {isi}
        {paginasi && <div className="paginasi">{paginasi}</div>}
      </section>
    </div>
  );
}
