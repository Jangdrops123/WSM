import { Link } from 'react-router-dom';

export function TidakDitemukan() {
  return (
    <div className="halaman">
      <section className="kartu kartu--kosong">
        <h2>404 — Halaman tidak ditemukan</h2>
        <p className="teks-redup">Halaman yang Anda tuju tidak tersedia.</p>
        <div className="aksi-kosong">
          <Link className="tombol tombol--primer" to="/">
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
