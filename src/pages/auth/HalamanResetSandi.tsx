import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiPost } from '../../lib/api';
import { useIdentitas } from '../../lib/identitas';
import { IndikatorSandi } from './IndikatorSandi';
import './login.css';

/**
 * TAHAP 2 — Halaman "Buat password baru" dari tautan reset.
 * Token diverifikasi server: berlaku 30 menit, sekali pakai, dan seluruh
 * sesi lama pengguna ikut dikeluarkan setelah password diganti.
 */
export function HalamanResetSandi() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const identitas = useIdentitas();

  const [sandiBaru, setSandiBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [hasil, setHasil] = useState<string | null>(null);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiPost<{ pesan: string }>('/api/auth/reset', { token, baru: sandiBaru, konfirmasi });
      setHasil(r.pesan);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal menyetel password baru.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="login-layar">
      <main className="login-kartu login-kartu--lebar" aria-labelledby="reset-judul">
        <div className="login-merek">
          <h1 id="reset-judul">Buat password baru</h1>
          <p className="login-tagline">{identitas.nama}</p>
        </div>

        {!token ? (
          <p className="login-pesan login-pesan--galat" role="alert">
            Tautan reset tidak ditemukan. Minta tautan baru lewat halaman Lupa password.
          </p>
        ) : hasil ? (
          <div className="login-blok">
            <p className="login-pesan login-pesan--sukses" role="status">
              {hasil}
            </p>
            <p className="login-rincian">
              Seluruh sesi lama Anda telah dikeluarkan dari perangkat lain. Gunakan password baru saat masuk.
            </p>
            <div className="login-aksi login-aksi--kanan">
              <button type="button" className="tombol tombol--primer" onClick={() => navigate('/login', { replace: true })}>
                Buka Halaman Log In
              </button>
            </div>
          </div>
        ) : (
          <form className="login-form" onSubmit={(e) => void kirim(e)}>
            {galat && (
              <p className="login-pesan login-pesan--galat" role="alert">
                {galat}
              </p>
            )}
            <label className="bidang" htmlFor="reset-baru">
              <span>Password baru</span>
              <input
                id="reset-baru"
                type="password"
                autoComplete="new-password"
                autoFocus
                required
                value={sandiBaru}
                onChange={(e) => setSandiBaru(e.target.value)}
                disabled={sibuk}
              />
            </label>
            <label className="bidang" htmlFor="reset-konfirmasi">
              <span>Ulangi password baru</span>
              <input
                id="reset-konfirmasi"
                type="password"
                autoComplete="new-password"
                required
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(e.target.value)}
                disabled={sibuk}
              />
            </label>
            <IndikatorSandi sandi={sandiBaru} />
            {galat && galat.toLowerCase().includes('kedaluwarsa') && (
              <div className="login-aksi">
                <button
                  type="button"
                  className="tombol"
                  onClick={() => navigate('/lupa-sandi', { state: { identitas: '' } })}
                >
                  Minta tautan baru (Kirim ulang)
                </button>
              </div>
            )}
            <button type="submit" className="tombol tombol--primer" disabled={sibuk}>
              {sibuk ? 'Menyimpan…' : 'Simpan password baru'}
            </button>
          </form>
        )}

        <div className="login-kaki">
          <Link to="/login">Kembali ke halaman Log In</Link>
        </div>
      </main>
    </div>
  );
}
