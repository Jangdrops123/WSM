import { useEffect, useState } from 'react';

type Jenis = 'sukses' | 'galat' | 'info';

interface Toast {
  id: number;
  pesan: string;
  jenis: Jenis;
}

let daftar: Toast[] = [];
let dengar: ((t: Toast[]) => void) | null = null;
let berikutnya = 1;

function ubah(fn: (t: Toast[]) => Toast[]): void {
  daftar = fn(daftar);
  dengar?.(daftar);
}

/**
 * Pola penolakan hak akses (403 matriks Peran & Hak Akses) — tidak pernah
 * ditampilkan sebagai toast. Halaman yang tidak diizinkan sudah ditangani
 * diam-diam (redirect ke halaman awal / pesan inline / menu disembunyikan),
 * sehingga popup "Anda tidak punya akses…" hanya mengganggu (dan ganda
 * saat StrictMode/effect berjalan dua kali).
 */
const POLA_AKSES_DITOLAK = /tidak punya akses|tidak memiliki izin|tidak berhak/i;

/** Tampilkan notifikasi. */
export function beritahu(pesan: string, jenis: Jenis = 'sukses', lamaMs = 4500): void {
  if (POLA_AKSES_DITOLAK.test(pesan)) return;
  // De-duplikasi: pemanggilan paralel (mis. banyak widget Dashboard gagal
  // bersamaan) hanya menampilkan SATU toast per isi pesan.
  if (daftar.some((t) => t.pesan === pesan && t.jenis === jenis)) return;
  const id = berikutnya++;
  ubah((t) => [...t, { id, pesan, jenis }]);
  window.setTimeout(() => ubah((t) => t.filter((x) => x.id !== id)), lamaMs);
}

/** Rak notifikasi — pasang sekali di dekat root aplikasi. */
export function ToastRak() {
  const [t, setT] = useState<Toast[]>(daftar);
  useEffect(() => {
    dengar = setT;
    return () => {
      dengar = null;
    };
  }, []);

  if (t.length === 0) return null;
  return (
    <div className="toast-rak" role="status" aria-live="polite">
      {t.map((x) => (
        <div key={x.id} className={`toast toast--${x.jenis}`}>
          {x.pesan}
        </div>
      ))}
    </div>
  );
}
