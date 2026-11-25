import { useState, type FormEvent } from 'react';
import { beritahu } from '../../components/crud/Toast';
import { apiPost } from '../../lib/api';
import { logoUntukTema, useIdentitas } from '../../lib/identitas';
import { useSesi } from '../../lib/sesi';
import { Icon } from '../../components/Icon';
import { IndikatorSandi } from './IndikatorSandi';
import './login.css';

/**
 * TAHAP 1 — Layar "Wajib ganti password saat login pertama".
 * Tampil SEBELUM aplikasi selama sesi menandai `wajibGanti`; setelah berhasil,
 * konteks sesi dimuat ulang dan pengguna masuk seperti biasa.
 */
export function HalamanWajibGantiSandi() {
  const sesi = useSesi();
  const identitas = useIdentitas();
  const logo = logoUntukTema(identitas);

  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiPost<{ pesan: string }>('/api/auth/ganti-sandi', { lama, baru, konfirmasi });
      beritahu(r.pesan, 'sukses');
      await sesi.muat(); // tanda wajibGanti kini false → aplikasi terbuka
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal mengganti password.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="login-layar">
      <main className="login-kartu login-kartu--lebar" aria-labelledby="wajib-judul">
        <div className="login-merek">
          {logo ? (
            <span className="login-logo">
              <img src={logo} alt="" />
            </span>
          ) : (
            <span className="login-logo login-logo--huruf">
              <Icon nama="database" size={26} />
            </span>
          )}
          <h1 id="wajib-judul">Ganti password Anda</h1>
          <p className="login-tagline">
            {sesi.info?.pengguna.nama ?? ''} — password harus diganti sebelum melanjutkan.
          </p>
        </div>

        <form className="login-form" onSubmit={(e) => void kirim(e)}>
          <p className="login-rincian">
            Akun ini ditandai <strong>Wajib ganti password saat login berikutnya</strong> (akun awal Admin atau
            hasil reset oleh Admin). Gunakan password sementara Anda saat ini, lalu buat password baru.
          </p>

          <label className="bidang" htmlFor="wajib-lama">
            <span>Password saat ini</span>
            <input
              id="wajib-lama"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={lama}
              onChange={(e) => setLama(e.target.value)}
              disabled={sibuk}
            />
          </label>

          <label className="bidang" htmlFor="wajib-baru">
            <span>Password baru</span>
            <input
              id="wajib-baru"
              type="password"
              autoComplete="new-password"
              required
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              disabled={sibuk}
            />
          </label>

          <label className="bidang" htmlFor="wajib-konfirmasi">
            <span>Ulangi password baru</span>
            <input
              id="wajib-konfirmasi"
              type="password"
              autoComplete="new-password"
              required
              value={konfirmasi}
              onChange={(e) => setKonfirmasi(e.target.value)}
              disabled={sibuk}
            />
          </label>

          <IndikatorSandi sandi={baru} />

          {galat && (
            <p className="login-pesan login-pesan--galat" role="alert">
              {galat}
            </p>
          )}

          <div className="login-aksi">
            <button type="submit" className="tombol tombol--primer" disabled={sibuk}>
              {sibuk ? 'Menyimpan…' : 'Simpan & lanjutkan'}
            </button>
            <button
              type="button"
              className="tombol tombol--netral"
              disabled={sibuk}
              onClick={() => void sesi.keluar()}
            >
              Keluar
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
