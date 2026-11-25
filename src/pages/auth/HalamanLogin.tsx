import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { apiGet } from '../../lib/api';
import { logoUntukTema, useIdentitas } from '../../lib/identitas';
import { useSesi } from '../../lib/sesi';
import { simpanKebijakan } from './kebijakanSandi';
import './login.css';

const KUNCI_INGAT = 'nusapos.ingat-saya';

/**
 * TAHAP 1 — Halaman Log In penuh layar, tampil SEBELUM aplikasi.
 *
 * - Kolom Username/Email + Password (ikon lihat/sembunyikan).
 * - Enter di kolom Password = Masuk (form bawaan peramban).
 * - Centang "Ingat saya" (diingat per peramban).
 * - Tautan "Lupa password?" aktif sejak Tahap 2 (alur mandiri / Hubungi Admin).
 * - Keadaan keluar (mis. sesi habis) ditampilkan sebagai pesan informatif.
 */
export function HalamanLogin() {
  const sesi = useSesi();
  const identitas = useIdentitas();
  const logo = logoUntukTema(identitas);
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [sandi, setSandi] = useState('');
  const [lihat, setLihat] = useState(false);
  const [ingat, setIngat] = useState(() => {
    try {
      return localStorage.getItem(KUNCI_INGAT) === '1';
    } catch {
      return false;
    }
  });
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  // Ambil kebijakan password (untuk indikator kekuatan) + status kanal reset.
  useEffect(() => {
    let batal = false;
    void apiGet<{ kebijakan?: { panjang?: number; hurufAngka?: boolean; simbol?: boolean } }>('/api/auth/info')
      .then((r) => {
        if (!batal && r.kebijakan) simpanKebijakan(r.kebijakan);
      })
      .catch(() => {
        /* memakai kebijakan bawaan */
      });
    return () => {
      batal = true;
    };
  }, []);

  useEffect(() => {
    if (sesi.pesan) setGalat(sesi.pesan);
    else if (sesi.status === 'keluar' && !galat) setGalat(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesi.pesan]);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setGalat(null);
    setSibuk(true);
    try {
      const info = await sesi.masuk(username, sandi, ingat);
      try {
        localStorage.setItem(KUNCI_INGAT, ingat ? '1' : '0');
      } catch {
        /* abaikan */
      }
      // Halaman setelah login selalu mengikuti menu_awal peran yang sudah
      // divalidasi server terhadap sel Lihat pada Matriks Peran.
      navigate(info.menuAwal?.rute ?? '/tanpa-akses', { replace: true });
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal masuk. Coba lagi.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="login-layar">
      <main className="login-kartu" aria-labelledby="login-judul">
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
          <h1 id="login-judul">{identitas.nama}</h1>
          {identitas.tagline !== '' && <p className="login-tagline">{identitas.tagline}</p>}
        </div>

        <form className="login-form" onSubmit={(e) => void kirim(e)} autoComplete="on">
          <label className="bidang" htmlFor="login-username">
            <span>Username / Email</span>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={sibuk}
            />
          </label>

          <label className="bidang" htmlFor="login-sandi">
            <span>Password</span>
            <div className="login-sandi-kotak">
              <input
                id="login-sandi"
                name="password"
                type={lihat ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={sandi}
                onChange={(e) => setSandi(e.target.value)}
                disabled={sibuk}
              />
              <button
                type="button"
                className="login-mata"
                aria-label={lihat ? 'Sembunyikan password' : 'Lihat password'}
                title={lihat ? 'Sembunyikan password' : 'Lihat password'}
                onClick={() => setLihat((v) => !v)}
                tabIndex={0}
              >
                <Icon nama={lihat ? 'eye-off' : 'eye'} size={17} />
              </button>
            </div>
          </label>

          <label className="login-ingat">
            <input
              type="checkbox"
              checked={ingat}
              onChange={(e) => setIngat(e.target.checked)}
              disabled={sibuk}
            />
            <span>Ingat saya</span>
          </label>

          {galat && (
            <p className="login-pesan login-pesan--galat" role="alert">
              {galat}
            </p>
          )}

          <button type="submit" className="tombol tombol--primer login-masuk" disabled={sibuk}>
            {sibuk ? 'Memeriksa…' : 'Masuk'}
          </button>
        </form>

        <div className="login-kaki">
          <Link to="/lupa-sandi">Lupa password?</Link>
        </div>
      </main>

      <p className="login-kaki-bawah">
        {identitas.nama} · Masuk untuk melanjutkan — sesi terlindungi &amp; kata sandi disimpan ter-hash.
      </p>
    </div>
  );
}
