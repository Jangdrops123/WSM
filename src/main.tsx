import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { PenangkapGalat } from './components/PenangkapGalat';
import { pulihkanAplikasi } from './lib/pulihkan';
import { PenyediaSesi } from './lib/sesi';
import { PenyediaIdentitas } from './lib/PenyediaIdentitas';
import { muatIdentitas } from './lib/identitas';
import { selesaikanLayarMuat } from './lib/layarMuat';
import { terapkanTampilanBaru } from './lib/tampilanBaru';
import { muatPreferensiScan } from './lib/umpanBalikScan';
import './styles.css';
import './crud.css';
// Tema gelap "glassmorphism" — dimuat setelah gaya lama (murni tampilan).
import './theme-gelap.css';
// FRAMEWORK TAMPILAN baru (RuangRapi) — dimuat PALING AKHIR sebagai lapisan
// tampilan: token warna, bentuk komponen, sidebar, tabel. Tanpa logika.
import './tampilan-framework.css';
// Tutorial per modul — popup 1x per modul, selaras tema aplikasi.
import './tutorial.css';

// U2 — kepadatan tampilan (Nyaman/Padat/Longgar) & ukuran font dari preferensi
// pengguna, diterapkan sebelum render supaya tidak ada kedip.
terapkanTampilanBaru();

// X1.2 — judul tab & favicon mengikuti identitas aplikasi (cache + versi).
// Dijalankan berbarengan dengan render; layar muat di index.html ditutup oleh
// PenutupLayarMuat setelah tampilan pertama React terpasang.
void muatIdentitas().catch(() => {
  /* offline — pakai identitas bawaan / cache lokal */
});

// WI3 — preferensi suara & getar scan dimuat sekali saat aplikasi dibuka agar
// scan pertama sudah memakai pilihan pengguna (cache lokal sebagai cadangan).
void muatPreferensiScan().catch(() => undefined);

// PWA — daftarkan service worker minimal (tanpa cache) agar aplikasi bisa
// "Tambahkan ke Layar Utama" dan terbuka mode standalone. Hanya pada build
// produksi supaya hot reload Vite di pengembangan tidak terganggu.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* pendaftaran gagal (bukan HTTPS / browser lama) — aplikasi tetap jalan */
    });
  });
}

const el = document.getElementById('root');
if (!el) throw new Error('Elemen #root tidak ditemukan');

/**
 * AI3 — layar muat (di luar #root, index.html) memudar setelah tampilan
 * pertama React benar-benar terpasang, jadi pengguna tidak melihat layar
 * kosong di antara splash dan aplikasi.
 */
function PenutupLayarMuat() {
  useEffect(() => {
    window.__aplikasiSiap = true;
    selesaikanLayarMuat();
  }, []);
  return null;
}

declare global {
  interface Window {
    __aplikasiSiap?: boolean;
    __tampilkanGalatBoot?: (pesan: string) => void;
    __pulihkanAplikasi?: () => void;
  }
}

/** Tampilkan layar pemulihan bila boot gagal (fallback index.html bila ada). */
function galatBoot(pesan: string): void {
  try {
    if (typeof window.__tampilkanGalatBoot === 'function') {
      window.__tampilkanGalatBoot(pesan);
      return;
    }
  } catch {
    /* lanjut ke fallback darurat */
  }
  try {
    const layar = document.getElementById('layar-muat');
    if (layar) layar.remove();
  } catch {
    /* abaikan */
  }
  window.__pulihkanAplikasi = pulihkanAplikasi;
  const wadah = document.getElementById('root');
  if (!wadah) return;
  wadah.innerHTML =
    '<div role="alert" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font-family:system-ui,sans-serif">' +
    '<div style="font-size:40px">⚠️</div>' +
    '<h2 style="margin:0">Aplikasi Gagal Dimuat</h2>' +
    '<p style="margin:0;max-width:26rem">' +
    String(pesan).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c) +
    '</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">' +
    '<button type="button" onclick="window.location.reload()" style="padding:10px 18px;border:0;border-radius:12px;font-weight:700;cursor:pointer">Muat Ulang Aplikasi</button>' +
    '<button type="button" onclick="window.__pulihkanAplikasi()" style="padding:10px 18px;border-radius:12px;font-weight:700;cursor:pointer">Hapus Data Lokal &amp; Muat Ulang</button>' +
    '</div></div>';
}

// Galat pra-boot (gagal unduh bundel / crash inisialisasi modul): hanya
// sebelum React menandai siap — sesudahnya PenangkapGalat yang menangani.
window.addEventListener('error', (e) => {
  if (!window.__aplikasiSiap) galatBoot(e.message || 'Gagal memuat aplikasi.');
});
window.addEventListener('unhandledrejection', (e) => {
  if (window.__aplikasiSiap) return;
  const alasan = e.reason as { message?: string } | null;
  galatBoot(alasan?.message || 'Gagal menyiapkan aplikasi.');
});

try {
  createRoot(el).render(
    <StrictMode>
      <PenangkapGalat>
        <BrowserRouter>
          <PenyediaSesi>
            <PenyediaIdentitas>
              <App />
              <PenutupLayarMuat />
            </PenyediaIdentitas>
          </PenyediaSesi>
        </BrowserRouter>
      </PenangkapGalat>
    </StrictMode>,
  );
} catch (err) {
  console.error('Boot React gagal:', err);
  galatBoot(err instanceof Error ? err.message : 'Gagal menjalankan aplikasi.');
}
