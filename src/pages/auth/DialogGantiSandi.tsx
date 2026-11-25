import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/crud/Modal';
import { beritahu } from '../../components/crud/Toast';
import { apiPost } from '../../lib/api';
import { useSesi } from '../../lib/sesi';
import { IndikatorSandi } from './IndikatorSandi';
import './login.css';

/**
 * TAHAP 1 — "Klik nama di header ▸ Ubah Password":
 * password lama + baru + konfirmasi, dengan indikator kekuatan
 * (min. 8 karakter, huruf + angka). Sesuaikan kebijakan Pengaturan ▸ Keamanan.
 */
export function DialogGantiSandi({ onTutup }: { onTutup: () => void }) {
  const sesi = useSesi();
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
      await sesi.muat(); // perbarui tanda wajibGanti bila ada
      onTutup();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Gagal mengganti password.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Modal
      judul="Ubah Password"
      lebar="kecil"
      onTutup={onTutup}
      sedangKirim={sibuk}
      aksi={
        <>
          <button type="button" className="tombol tombol--netral" onClick={onTutup} disabled={sibuk}>
            Batal
          </button>
          <button type="submit" form="form-ganti-sandi" className="tombol tombol--primer" disabled={sibuk}>
            {sibuk ? 'Menyimpan…' : 'Simpan password'}
          </button>
        </>
      }
    >
      <form id="form-ganti-sandi" className="login-form" onSubmit={(e) => void kirim(e)}>
        <label className="bidang" htmlFor="gs-lama">
          <span>Password lama</span>
          <input
            id="gs-lama"
            data-fokus-awal
            type="password"
            autoComplete="current-password"
            required
            value={lama}
            onChange={(e) => setLama(e.target.value)}
            disabled={sibuk}
          />
        </label>
        <label className="bidang" htmlFor="gs-baru">
          <span>Password baru</span>
          <input
            id="gs-baru"
            type="password"
            autoComplete="new-password"
            required
            value={baru}
            onChange={(e) => setBaru(e.target.value)}
            disabled={sibuk}
          />
        </label>
        <label className="bidang" htmlFor="gs-konfirmasi">
          <span>Ulangi password baru</span>
          <input
            id="gs-konfirmasi"
            type="password"
            autoComplete="new-password"
            required
            value={konfirmasi}
            onChange={(e) => setKonfirmasi(e.target.value)}
            disabled={sibuk}
          />
        </label>
        <IndikatorSandi sandi={baru} />
        <p className="login-rincian">
          Setelah disimpan, sesi lama di perangkat lain ikut dikeluarkan (kecuali perangkat ini).
        </p>
        {galat && (
          <p className="login-pesan login-pesan--galat" role="alert">
            {galat}
          </p>
        )}
      </form>
    </Modal>
  );
}
