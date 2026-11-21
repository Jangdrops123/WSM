import { Link, useNavigate } from 'react-router-dom';
import { useSesi } from '../lib/sesi';

/**
 * TAHAP 2 — Halaman "Tidak punya akses".
 *
 * Ditampilkan saat sebuah URL langsung dibuka namun peran/pengguna tidak
 * memiliki izin modul tersebut (sidebar sudah menyembunyikan menunya).
 */
export function TolakAkses({ pesan }: { pesan?: string }) {
  const info = useSesi().info;
  // AY — kembali ke menu awal peran dari sesi (bukan tebakan lokal).
  const kembali = info?.menuAwal?.rute ?? '/';
  return (
    <section className="kartu tolak-akses">
      <div className="kartu__kepala">
        <h3>Tidak punya akses</h3>
      </div>
      <p className="teks-redup">
        {pesan ??
          'Peran ini tidak memiliki izin untuk membuka halaman tersebut. Menu yang tidak diizinkan tidak muncul di sidebar, dan alamat langsung tetap diblokir.'}
      </p>
      <p className="teks-redup">
        Minta Admin mengubah Hak Akses di Pengaturan ▸ Pengguna &amp; Hak Akses ▸ Peran &amp; Hak Akses, atau
        hubungi Admin untuk penyesuaian peran Anda.
      </p>
      <div className="tombol-baris">
        <Link to={kembali} className="tombol tombol--primer">
          Kembali ke Halaman Awal
        </Link>
      </div>
    </section>
  );
}

/**
 * AY2 — Halaman "Akun belum memiliki akses": peran tidak boleh melihat satu
 * pun halaman (menu awal kosong + tidak ada fallback). Jangan tampilkan
 * halaman kosong atau galat — beri tombol Keluar yang jelas.
 */
export function TanpaAkses() {
  const sesi = useSesi();
  const navigate = useNavigate();
  const keluar = async () => {
    await sesi.keluar();
    navigate('/login', { replace: true });
  };
  return (
    <section className="kartu tolak-akses">
      <div className="kartu__kepala">
        <h3>Akun belum memiliki akses</h3>
      </div>
      <p className="teks-redup">
        Peran Anda belum diizinkan membuka halaman mana pun. Hubungi Admin agar Admin mencentang
        sel Lihat untuk peran Anda di Pengaturan ▸ Pengguna &amp; Hak Akses ▸ Matriks Peran.
      </p>
      <div className="tombol-baris">
        <button type="button" className="tombol tombol--primer" onClick={() => void keluar()}>
          Keluar
        </button>
      </div>
    </section>
  );
}
