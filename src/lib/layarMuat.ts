// BAGIAN AI2/AI5 — Jembatan ke layar muat di index.html.
//
// `selesaikanLayarMuat()` dipanggil setelah React merender tampilan pertama:
// layar muat menunggu minimal 400 ms lalu memudar 200 ms. `putarLayarMuat()`
// memperlihatkan layar muat dengan data formulir Identitas Aplikasi yang
// sedang diisi (tanpa memuat ulang aplikasi) — memakai CSS yang sama dengan
// layar muat asli agar pratinjaunya jujur.
import { PALET_AKSEN, type KodeAksen } from './aksen';

interface GlobalLayarMuat {
  __layarMuatSelesai?: () => void;
}

/* ------------------------- Ukuran logo layar muat ------------------------- */

/** Kunci localStorage — dibaca juga skrip <head> di index.html sebelum render. */
export const KUNCI_UKURAN_LOGO_MUAT = 'loading_logo_size';

/** Bawaan 120 px; batas bawah 40 px; TANPA batas atas (pengguna bebas). */
export const UKURAN_LOGO_MUAT_BAWAAN = 120;
export const UKURAN_LOGO_MUAT_MIN = 40;

/** Normalkan nilai: angka bulat, minimal 40, tanpa batas atas. */
export function normalUkuranLogoMuat(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return UKURAN_LOGO_MUAT_BAWAAN;
  return Math.max(UKURAN_LOGO_MUAT_MIN, n);
}

/** Baca preferensi ukuran logo dari localStorage (bawaan 120 px). */
export function bacaUkuranLogoMuat(): number {
  try {
    const mentah = localStorage.getItem(KUNCI_UKURAN_LOGO_MUAT);
    if (mentah === null || mentah.trim() === '') return UKURAN_LOGO_MUAT_BAWAAN;
    return normalUkuranLogoMuat(mentah);
  } catch {
    return UKURAN_LOGO_MUAT_BAWAAN;
  }
}

/** Terapkan sebagai variabel CSS global — dipakai layar muat & pratinjaunya. */
export function terapkanUkuranLogoMuat(px: number = bacaUkuranLogoMuat()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--lm-logo-size', `${normalUkuranLogoMuat(px)}px`);
}

/** Simpan ke localStorage dan langsung terapkan (berlaku di pembukaan berikutnya). */
export function simpanUkuranLogoMuat(px: unknown): number {
  const n = normalUkuranLogoMuat(px);
  try {
    localStorage.setItem(KUNCI_UKURAN_LOGO_MUAT, String(n));
  } catch {
    /* penyimpanan nonaktif — tetap terapkan untuk sesi ini */
  }
  terapkanUkuranLogoMuat(n);
  return n;
}

/** Gaya dinamis layar muat: logo, judul, dan bilah skala mengikuti ukuran logo. */
export function gayaLayarMuat(px: number): {
  logo: { width: string; height: string };
  judul: { fontSize: string };
  bilah: { width: string };
} {
  const n = normalUkuranLogoMuat(px);
  return {
    logo: { width: `${n}px`, height: `${n}px` },
    judul: { fontSize: `${Math.max(14, n * 0.16)}px` },
    bilah: { width: `${Math.max(100, n * 1.5)}px` },
  };
}

/** Tutup layar muat asli (idempoten — aman dipanggil StrictMode dua kali). */
export function selesaikanLayarMuat(): void {
  if (typeof window === 'undefined') return;
  const f = (window as unknown as GlobalLayarMuat).__layarMuatSelesai;
  if (typeof f === 'function') f();
}

export interface DataLayarMuat {
  nama: string;
  tagline: string;
  logo: string;
  aksen: string;
  tema: 'siang' | 'malam';
  /** Ukuran logo (px) — bawaan mengikuti preferensi tersimpan. */
  logoSize?: number;
}

/** URL logo yang aman: data URL gambar atau path internal. */
export function logoAman(url: string | null | undefined): string {
  const u = (url ?? '').trim();
  if (!u) return '';
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(u)) return u.length <= 100000 ? u : '';
  if (u.length > 4096) return '';
  if (u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\')) return u;
  return '';
}

/**
 * Pratinjau layar muat (tombol ikon "Putar layar muat"): tampil 1,6 detik di
 * atas aplikasi lalu memudar. Hanya satu pratinjau pada satu waktu.
 */
export function putarLayarMuat(data: DataLayarMuat): void {
  if (typeof document === 'undefined') return;
  document.querySelector('.layar-muat--putar')?.remove();

  const nama = (data.nama || '').trim().slice(0, 60) || 'Aplikasi';
  const tagline = (data.tagline || '').trim().slice(0, 80);
  const palet = PALET_AKSEN[(data.aksen || '') as KodeAksen] ?? PALET_AKSEN[''];
  const [awal, akhir] = data.tema === 'malam' ? palet.malam : palet.siang;
  const inisial = nama.charAt(0).toUpperCase();

  const wadah = document.createElement('div');
  wadah.className = 'layar-muat layar-muat--putar layar-muat--pudar';
  wadah.dataset.tema = data.tema;
  wadah.setAttribute('role', 'status');
  wadah.setAttribute('aria-busy', 'true');
  wadah.setAttribute('aria-label', `Pratinjau layar muat: ${nama}`);
  wadah.style.setProperty('--lm-aksen', awal);
  wadah.style.setProperty('--lm-aksen-2', akhir);

  const logo = document.createElement('div');
  logo.className = 'layar-muat__logo';
  const sumber = logoAman(data.logo);
  if (sumber) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = sumber;
    img.addEventListener('error', () => {
      img.remove();
      logo.classList.remove('layar-muat__logo--gambar');
      logo.textContent = inisial;
    });
    logo.appendChild(img);
    logo.classList.add('layar-muat__logo--gambar');
  } else {
    logo.textContent = inisial;
  }

  const isi = document.createElement('div');
  isi.className = 'layar-muat__isi';
  const elNama = document.createElement('div');
  elNama.className = 'layar-muat__nama';
  elNama.textContent = nama;
  elNama.title = nama;
  isi.appendChild(elNama);
  if (tagline) {
    const elTagline = document.createElement('div');
    elTagline.className = 'layar-muat__tagline';
    elTagline.textContent = tagline;
    elTagline.title = tagline;
    isi.appendChild(elTagline);
  }

  const bilah = document.createElement('div');
  bilah.className = 'layar-muat__bilah';
  bilah.setAttribute('aria-hidden', 'true');

  // Skala dinamis: logo, judul, dan bilah ikut ukuran logo (transition 0.3s).
  const gaya = gayaLayarMuat(data.logoSize ?? bacaUkuranLogoMuat());
  logo.style.width = gaya.logo.width;
  logo.style.height = gaya.logo.height;
  const elJudul = isi.querySelector('.layar-muat__nama') as HTMLElement | null;
  if (elJudul) elJudul.style.fontSize = gaya.judul.fontSize;
  bilah.style.width = gaya.bilah.width;

  wadah.append(logo, isi, bilah);
  document.body.appendChild(wadah);

  // Fade masuk → tahan → fade keluar (CSS: 200 ms, hormati reduced-motion).
  requestAnimationFrame(() => wadah.classList.remove('layar-muat--pudar'));
  window.setTimeout(() => {
    wadah.classList.add('layar-muat--pudar');
    window.setTimeout(() => wadah.remove(), 260);
  }, 1600);
}
