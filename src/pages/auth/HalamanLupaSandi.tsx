import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../lib/api';
import { useIdentitas } from '../../lib/identitas';
import { IndikatorSandi } from './IndikatorSandi';
import './login.css';

interface InfoAuth {
  aplikasi: string;
  lupaTersedia: boolean;
  kodePemulihan: number;
}

/**
 * TAHAP 2 — "Lupa password?".
 *
 * a. Kanal (email/WhatsApp) terkonfigurasi → alur mandiri: isi Username/Email,
 *    balasan SELALU netral, maksimal 3x per jam, tombol "Kirim ulang".
 * b. Kanal belum dikonfigurasi → alur mandiri disembunyikan dan ditampilkan
 *    petunjuk "Hubungi Admin untuk reset password".
 * Kode Pemulihan Admin utama (10 kode, sekali pakai) tetap tersedia di sini.
 */
export function HalamanLupaSandi() {
  const navigate = useNavigate();
  const identitas = useIdentitas();
  const [info, setInfo] = useState<InfoAuth | null>(null);
  const [identitasInput, setIdentitasInput] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [terkirim, setTerkirim] = useState<string | null>(null);

  // Kode Pemulihan (khusus akun Admin utama)
  const [kode, setKode] = useState('');
  const [sandiBaru, setSandiBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [hasilPulih, setHasilPulih] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<InfoAuth>('/api/auth/info')
      .then(setInfo)
      .catch(() => setInfo({ aplikasi: 'NusaSuite', lupaTersedia: false, kodePemulihan: 0 }));
  }, []);

  async function mintaReset(e: FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiPost<{ pesan: string }>('/api/auth/lupa', { identitas: identitasInput });
      setTerkirim(r.pesan);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal meminta reset. Coba lagi.');
    } finally {
      setSibuk(false);
    }
  }

  async function kirimUlang() {
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiPost<{ pesan: string }>('/api/auth/kirim-ulang', { identitas: identitasInput });
      setTerkirim(r.pesan);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal mengirim ulang.');
    } finally {
      setSibuk(false);
    }
  }

  async function pulihkan(e: FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);
    try {
      const r = await apiPost<{ pesan: string }>('/api/auth/pulihkan', {
        identitas: identitasInput,
        kode,
        baru: sandiBaru,
        konfirmasi,
      });
      setHasilPulih(r.pesan);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal memakai Kode Pemulihan.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="login-layar">
      <main className="login-kartu login-kartu--lebar" aria-labelledby="lupa-judul">
        <div className="login-merek">
          <h1 id="lupa-judul">Lupa password?</h1>
          <p className="login-tagline">{identitas.nama}</p>
        </div>

        {hasilPulih ? (
          <div className="login-blok">
            <p className="login-pesan login-pesan--sukses" role="status">
              {hasilPulih}
            </p>
            <div className="login-aksi login-aksi--kanan">
              <button type="button" className="tombol tombol--primer" onClick={() => navigate('/login', { replace: true })}>
                Buka Halaman Log In
              </button>
            </div>
          </div>
        ) : terkirim ? (
          <div className="login-blok">
            <p className="login-pesan login-pesan--info" role="status">
              {terkirim}
            </p>
            <p className="login-rincian">
              Periksa kotak masuk email / WhatsApp terdaftar. Tautan berlaku 30 menit dan hanya bisa dipakai sekali.
            </p>
            {galat && (
              <p className="login-pesan login-pesan--galat" role="alert">
                {galat}
              </p>
            )}
            <div className="login-aksi">
              <button type="button" className="tombol" onClick={() => void kirimUlang()} disabled={sibuk}>
                {sibuk ? 'Mengirim…' : 'Kirim ulang'}
              </button>
              <button
                type="button"
                className="tombol tombol--netral"
                onClick={() => {
                  setTerkirim(null);
                  setGalat(null);
                }}
              >
                Coba akun lain
              </button>
              <Link to="/login" className="login-rincian">
                Kembali ke Log In
              </Link>
            </div>
          </div>
        ) : (
          <>
            {info && !info.lupaTersedia && (
              <div className="login-blok">
                <h3>Hubungi Admin untuk reset password</h3>
                <p className="login-rincian">
                  Layanan pengiriman email/WhatsApp belum dikonfigurasi, jadi alur reset mandiri belum tersedia.
                  Minta Admin menyetel ulang password Anda dari Pengaturan ▸ Pengguna, atau minta Admin
                  mengaktifkan kanal notifikasi agar tautan reset bisa dikirim otomatis.
                </p>
              </div>
            )}

            {info?.lupaTersedia && !galat && !terkirim && (
              <form className="login-form" onSubmit={(e) => void mintaReset(e)}>
                <label className="bidang" htmlFor="lupa-identitas">
                  <span>Username / Email</span>
                  <input
                    id="lupa-identitas"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    required
                    value={identitasInput}
                    onChange={(e) => setIdentitasInput(e.target.value)}
                    disabled={sibuk}
                  />
                </label>
                <p className="login-rincian">
                  Kami akan mengirim tautan setel ulang ke {info.lupaTersedia ? 'email / WhatsApp' : ''} terdaftar.
                  Permintaan dibatasi 3x per jam.
                </p>
                <button type="submit" className="tombol tombol--primer" disabled={sibuk}>
                  {sibuk ? 'Mengirim…' : 'Kirim tautan reset'}
                </button>
              </form>
            )}

            {info?.lupaTersedia && galat && (
              <>
                <p className="login-pesan login-pesan--galat" role="alert">
                  {galat}
                </p>
                <div className="login-aksi">
                  <button type="button" className="tombol" onClick={() => void kirimUlang()} disabled={sibuk}>
                    {sibuk ? 'Mengirim…' : 'Kirim ulang'}
                  </button>
                  <button
                    type="button"
                    className="tombol tombol--netral"
                    onClick={() => {
                      setGalat(null);
                      setIdentitasInput('');
                    }}
                  >
                    Coba lagi
                  </button>
                </div>
              </>
            )}

            {!hasilPulih && (
              <form className="login-form" onSubmit={(e) => void pulihkan(e)}>
                <div className="login-blok">
                  <h3>Kode Pemulihan (khusus Akun Admin utama)</h3>
                  <p className="login-rincian">
                    Punya Kode Pemulihan dari Pengaturan ▸ Keamanan? Masukkan satu kode untuk membuat password
                    baru. {info && info.kodePemulihan === 0 && 'Belum ada kode yang dibuat — minta Admin membuatnya lebih dulu.'}
                  </p>
                  <label className="bidang" htmlFor="pulih-identitas">
                    <span>Username Admin</span>
                    <input
                      id="pulih-identitas"
                      type="text"
                      autoComplete="username"
                      required
                      value={identitasInput}
                      onChange={(e) => setIdentitasInput(e.target.value)}
                      disabled={sibuk}
                    />
                  </label>
                  <label className="bidang" htmlFor="pulih-kode">
                    <span>Kode Pemulihan</span>
                    <input
                      id="pulih-kode"
                      type="text"
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      required
                      value={kode}
                      onChange={(e) => setKode(e.target.value.toUpperCase())}
                      disabled={sibuk}
                      style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.06em' }}
                    />
                  </label>
                  <label className="bidang" htmlFor="pulih-baru">
                    <span>Password baru</span>
                    <input
                      id="pulih-baru"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={sandiBaru}
                      onChange={(e) => setSandiBaru(e.target.value)}
                      disabled={sibuk}
                    />
                  </label>
                  <label className="bidang" htmlFor="pulih-konfirmasi">
                    <span>Ulangi password baru</span>
                    <input
                      id="pulih-konfirmasi"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={konfirmasi}
                      onChange={(e) => setKonfirmasi(e.target.value)}
                      disabled={sibuk}
                    />
                  </label>
                  <IndikatorSandi sandi={sandiBaru} />
                  <button type="submit" className="tombol tombol--primer" disabled={sibuk}>
                    {sibuk ? 'Memeriksa…' : 'Buat password baru'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        <div className="login-kaki">
          <Link to="/login">Kembali ke halaman Log In</Link>
        </div>
      </main>
    </div>
  );
}
