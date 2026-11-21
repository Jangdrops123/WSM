import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import {
  sudahDilihat,
  tandaiDilihat,
  tutorialUntukPath,
  type TutorialModul,
} from '../lib/tutorial';

/** Event untuk membuka ulang tutorial halaman aktif secara manual. */
export const EVENT_BUKA_TUTORIAL = 'tutorial:buka';

/** Minta popup tutorial halaman aktif terbuka (dipakai tombol Panduan). */
export function mintaBukaTutorial(): void {
  window.dispatchEvent(new CustomEvent(EVENT_BUKA_TUTORIAL));
}

/**
 * Popup tutorial per modul — tampil OTOMATIS hanya 1x saat modul pertama
 * kali dibuka (flag localStorage per kunci tutorial). Bisa dibuka ulang
 * kapan saja lewat tombol Panduan (TombolTutorial).
 */
export function PopupTutorial() {
  const lokasi = useLocation();
  const [tutorial, setTutorial] = useState<TutorialModul | null>(null);
  const [buka, setBuka] = useState(false);
  const [indeks, setIndeks] = useState(0);
  const kunciAktif = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const tutup = useCallback(
    (tandai = true) => {
      if (tandai && kunciAktif.current) tandaiDilihat(kunciAktif.current);
      setBuka(false);
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    },
    [],
  );

  // Ganti modul → reset; auto-tampilkan 1x bila belum pernah dilihat.
  useEffect(() => {
    const t = tutorialUntukPath(lokasi.pathname) ?? null;
    setTutorial(t);
    setIndeks(0);
    kunciAktif.current = t?.kunci ?? null;
    setBuka(false);
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (t && !sudahDilihat(t.kunci)) {
      timer.current = window.setTimeout(() => setBuka(true), 700);
    }
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [lokasi.pathname]);

  // Tombol Panduan → buka manual (tidak mengubah flag sampai ditutup).
  useEffect(() => {
    const onBuka = () => {
      const t = tutorialUntukPath(window.location.pathname) ?? tutorial;
      if (!t) return;
      setTutorial(t);
      kunciAktif.current = t.kunci;
      setIndeks(0);
      setBuka(true);
    };
    window.addEventListener(EVENT_BUKA_TUTORIAL, onBuka);
    return () => window.removeEventListener(EVENT_BUKA_TUTORIAL, onBuka);
  }, [tutorial]);

  // Esc = tutup (tetap dihitung "sudah dilihat" agar tidak mengganggu).
  useEffect(() => {
    if (!buka) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tutup(true);
      if (e.key === 'ArrowRight') setIndeks((i) => Math.min(i + 1, (tutorial?.langkah.length ?? 1) - 1));
      if (e.key === 'ArrowLeft') setIndeks((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [buka, tutorial, tutup]);

  if (!tutorial || !buka) return null;

  const total = tutorial.langkah.length;
  const langkah = tutorial.langkah[Math.min(indeks, total - 1)];
  const pertama = indeks === 0;
  const terakhir = indeks === total - 1;

  return (
    <div
      className="tutorial-latar"
      role="dialog"
      aria-modal="true"
      aria-label={tutorial.judul}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) tutup(true);
      }}
    >
      <div className="tutorial-popup">
        <div className="tutorial-kepala">
          <span className="tutorial-ikon" aria-hidden="true">
            <Icon nama="message-circle" size={20} />
          </span>
          <div className="tutorial-judul-wrap">
            <strong>{tutorial.judul}</strong>
            <small>
              Langkah {Math.min(indeks + 1, total)} dari {total}
            </small>
          </div>
          <button
            type="button"
            className="tutorial-tutup"
            aria-label="Tutup tutorial"
            onClick={() => tutup(true)}
          >
            ✕
          </button>
        </div>

        <p className="tutorial-ringkasan">{tutorial.ringkasan}</p>

        <div className="tutorial-kemajuan" aria-hidden="true">
          {tutorial.langkah.map((_, i) => (
            <span key={i} className={i <= indeks ? 'isi' : ''} />
          ))}
        </div>

        <div className="tutorial-isi">
          <h4>
            {indeks + 1}. {langkah.judul}
          </h4>
          <p>{langkah.isi}</p>
        </div>

        <div className="tutorial-kaki">
          <button
            type="button"
            className="tombol"
            disabled={pertama}
            onClick={() => setIndeks((i) => Math.max(0, i - 1))}
          >
            Kembali
          </button>
          <button type="button" className="tombol tombol--netral" onClick={() => tutup(true)}>
            {terakhir ? 'Tutup' : 'Lewati'}
          </button>
          {terakhir ? (
            <button
              type="button"
              className="tombol tombol--primer"
              onClick={() => tutup(true)}
            >
              Selesai
            </button>
          ) : (
            <button
              type="button"
              className="tombol tombol--primer"
              onClick={() => setIndeks((i) => Math.min(total - 1, i + 1))}
            >
              Lanjut ({indeks + 1} dari {total})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tombol "Panduan" — membuka ulang tutorial halaman aktif.
 * Varian "bar" untuk topbar (dalam shell), "apit" mengambang untuk POS.
 */
export function TombolTutorial({ mode = 'bar' }: { mode?: 'bar' | 'apit' }) {
  const lokasi = useLocation();
  if (!tutorialUntukPath(lokasi.pathname)) {
    // POS di luar shell memakai pathname window — tetap tampilkan.
    if (mode !== 'apit') return null;
  }

  if (mode === 'apit') {
    return (
      <button
        type="button"
        className="tutorial-apit"
        onClick={mintaBukaTutorial}
        title="Panduan halaman ini"
      >
        <Icon nama="message-circle" size={17} />
        <span>Panduan</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="topbar__panduan"
      onClick={mintaBukaTutorial}
      title="Panduan halaman ini"
    >
      <Icon nama="message-circle" size={17} />
      <span className="topbar__panduan-teks">Panduan</span>
    </button>
  );
}
