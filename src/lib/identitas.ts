// BAGIAN X1/Y2 — Identitas aplikasi (nama, tagline, judul tab, favicon,
// aksen, warna latar ikon, logo varian Siang/Malam/Ikon) sebagai SATU SUMBER
// DATA: diambil dari /api/tampilan/identitas, di-cache per perangkat dengan
// nomor versi (logo memakai ?v=versi agar tidak menampilkan logo lama), dan
// dipakai sidebar, favicon, judul tab, layar muat, serta kop cetak.
import { useEffect, useState } from 'react';
import { apiGet } from './api';
import { bacaSalinan, simpanSalinan } from './salinanIdentitas';

export type CakupanIdentitas = 'semua' | 'per-toko';

export interface Identitas {
  nama: string;
  tagline: string;
  /** Judul tab browser — kosong = ikuti nama aplikasi (Y2.1). */
  judulTab: string;
  /** Favicon khusus — kosong = ikon kecil / favicon bawaan. */
  favicon: string;
  /** Warna aksen aplikasi ('' = aksen bawaan). */
  aksen: string;
  /** Token warna latar ikon logo ('' = otomatis). */
  latar: string;
  /** Warna latar kartu aplikasi ('' = bawaan putih, atau heks #rrggbb). */
  kartu: string;
  logoSiang: string;
  logoMalam: string;
  ikon: string;
  /** Pakai logo & nama ini juga untuk faktur dan struk (Y2.2). */
  pakaiFaktur: boolean;
  cakupan: CakupanIdentitas;
  toko: string | null;
  versi: string;
}

const KUNCI = 'nusapos.identitas';

export const IDENTITAS_BAWAAN: Identitas = {
  nama: 'NusaSuite',
  tagline: 'POS · WMS · Akuntansi',
  judulTab: '',
  favicon: '',
  aksen: '',
  latar: '',
  kartu: '',
  logoSiang: '',
  logoMalam: '',
  ikon: '',
  pakaiFaktur: false,
  cakupan: 'semua',
  toko: null,
  versi: '0',
};

/** Kode toko aktif (dipilih di Pengaturan ▸ Data Toko & Gudang / halaman toko). */
export function tokoAktif(): string {
  try {
    return localStorage.getItem('nusapos.tokoAktif') ?? '';
  } catch {
    return '';
  }
}

let data: Identitas = bacaLokal();
const pendengar = new Set<() => void>();
/**
 * AI2 — apakah identitas sudah benar-benar diketahui (cache lama atau jawaban
 * server)? Selama belum, favicon TIDAK diisi merek bawaan supaya layar muat
 * tidak pernah menampilkan merek lama walau sekejap. Judul tab selalu
 * memakai fallback nama aplikasi dasar (tidak pernah "Memuat…").
 */
let dikenal = (() => {
  try {
    // Cache identitas lama ATAU salinan layar muat (perangkat yang baru pertama
    // kali memuat aplikasi setelah layar muat mengambil identitas publik).
    return localStorage.getItem(KUNCI) !== null || bacaSalinan() !== null;
  } catch {
    return false;
  }
})();

function bacaLokal(): Identitas {
  try {
    const v = localStorage.getItem(KUNCI);
    if (!v) {
      // Belum ada cache identitas, tetapi layar muat mungkin sudah menulis
      // salinan perangkat — pakai itu agar judul & logo langsung benar.
      const s = bacaSalinan();
      if (s && s.nama.trim()) {
        return {
          ...IDENTITAS_BAWAAN,
          nama: s.nama,
          tagline: s.tagline,
          judulTab: s.judulTab,
          favicon: s.favicon,
          aksen: s.aksen,
          logoSiang: s.logoSiang,
          logoMalam: s.logoMalam,
          ikon: s.ikon,
        };
      }
      return { ...IDENTITAS_BAWAAN };
    }
    const j = JSON.parse(v) as Partial<Identitas>;
    return {
      nama: j.nama?.trim() || IDENTITAS_BAWAAN.nama,
      tagline: j.tagline ?? IDENTITAS_BAWAAN.tagline,
      judulTab: j.judulTab ?? '',
      favicon: j.favicon ?? '',
      aksen: j.aksen ?? '',
      latar: j.latar ?? '',
      kartu: typeof j.kartu === 'string' && (j.kartu === '' || /^#[0-9a-fA-F]{6}$/.test(j.kartu)) ? j.kartu : '',
      logoSiang: j.logoSiang ?? '',
      logoMalam: j.logoMalam ?? '',
      ikon: j.ikon ?? '',
      pakaiFaktur: Boolean(j.pakaiFaktur),
      cakupan: j.cakupan === 'per-toko' ? 'per-toko' : 'semua',
      toko: j.toko ?? null,
      versi: j.versi ?? '0',
    };
  } catch {
    return { ...IDENTITAS_BAWAAN };
  }
}

function umumkan(next: Identitas) {
  data = next;
  dikenal = true;
  try {
    localStorage.setItem(KUNCI, JSON.stringify(next));
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
  // AI1 — salinan ringkas untuk layar muat pembukaan berikutnya.
  simpanSalinan(next);
  terapkan(next);
  for (const f of pendengar) f();
}

/** Judul tab = judul khusus, atau nama aplikasi bila belum diisi (Y2.1). */
export function judulTab(i: Identitas = data): string {
  return i.judulTab.trim() || i.nama;
}

/** URL favicon efektif (favicon khusus → ikon kecil → bawaan aplikasi). */
export function faviconEfektif(i: Identitas = data): string {
  return i.favicon || i.ikon || '/favicon.svg';
}

/** Warna aksen efektif: preferensi per pengguna menang atas aksen aplikasi. */
export function aksenEfektif(): string {
  let pengguna = '';
  try {
    pengguna = localStorage.getItem('nusapos.aksen') ?? '';
  } catch {
    /* penyimpanan nonaktif */
  }
  return pengguna || data.aksen;
}

/** Aksen aplikasi dari identitas (dipakai modul tema sebagai nilai dasar). */
export function aksenAplikasi(): string {
  return data.aksen;
}

/**
 * Terapkan warna latar kartu ke variabel CSS global. Hanya tema terang yang
 * memakai pilihan pengguna; tema gelap memakai nilai gelapnya sendiri agar
 * kartu tetap terbaca (properti inline dihapus saat gelap).
 */
export function terapkanWarnaKartu(kartu = data.kartu): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (el.dataset.theme !== 'dark' && kartu) el.style.setProperty('--card-bg-color', kartu);
  else el.style.removeProperty('--card-bg-color');
}

/**
 * Terapkan identitas ke judul tab, favicon, dan warna aksen — dipanggil saat
 * modul dimuat (cache) dan setiap identitas berubah supaya perubahan langsung
 * tampil tanpa muat ulang. Layar muat di index.html mengurus dirinya sendiri
 * lewat salinan `app_identity` (AI1/AI2).
 */
export function terapkanIdentitasDokumen(i: Identitas = data): void {
  terapkan(i);
}

function terapkan(i: Identitas) {
  if (typeof document === 'undefined') return;

  // Aksen: preferensi per pengguna (Pengaturan ▸ Tampilan) bila ada, selain
  // itu ikuti aksen aplikasi (Y2.1). Berlaku juga sebelum identitas diketahui.
  const aksen = aksenEfektif();
  const el = document.documentElement;
  if (aksen) el.dataset.aksen = aksen;
  else delete el.dataset.aksen;

  // Judul tab selalu terisi — fallback nama aplikasi dasar bila identitas
  // belum diketahui (jangan pernah menampilkan "Memuat…" di tab browser).
  document.title = judulTab(i);
  terapkanWarnaKartu(i.kartu);

  // Favicon khusus hanya dari identitas yang benar-benar diketahui
  // (AI2 — jangan pernah menampilkan merek bawaan pada perangkat baru).
  if (!dikenal) return;

  const href = faviconEfektif(i);
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/**
 * Ambil identitas terbaru dari server (tanpa memaksa UI menunggu).
 *
 * Memakai endpoint PUBLIK (AI4) — sama dengan yang dibaca layar muat — supaya
 * halaman Log In juga menampilkan nama/logo yang benar sebelum pengguna masuk
 * (endpoint admin akan menjawab 401 dan memicu pemberitau "sesi berakhir").
 */
let janjiMuat: Promise<Identitas> | null = null;

export async function muatIdentitas(): Promise<Identitas> {
  // Satu permintaan untuk semua pemanggil serentak (main.tsx + hook useIdentitas).
  if (!janjiMuat) {
    janjiMuat = ambilIdentitas().finally(() => {
      janjiMuat = null;
    });
  }
  return janjiMuat;
}

async function ambilIdentitas(): Promise<Identitas> {
  const toko = tokoAktif();
  const r = await apiGet<Identitas>(
    `/api/tampilan/identitas-publik${toko ? `?toko=${encodeURIComponent(toko)}` : ''}`,
  );
  const next: Identitas = {
    nama: r.nama?.trim() || IDENTITAS_BAWAAN.nama,
    tagline: r.tagline ?? '',
    judulTab: r.judulTab ?? '',
    favicon: r.favicon ?? '',
    aksen: r.aksen ?? '',
    latar: r.latar ?? '',
    kartu: typeof r.kartu === 'string' && (r.kartu === '' || /^#[0-9a-fA-F]{6}$/.test(r.kartu)) ? r.kartu : '',
    logoSiang: r.logoSiang ?? '',
    logoMalam: r.logoMalam ?? '',
    ikon: r.ikon ?? '',
    pakaiFaktur: Boolean(r.pakaiFaktur),
    cakupan: r.cakupan === 'per-toko' ? 'per-toko' : 'semua',
    toko: r.toko ?? null,
    versi: r.versi ?? '1',
  };
  if (JSON.stringify(next) !== JSON.stringify(data)) umumkan(next);
  // AI1(2) — perbarui salinan setiap sesi, termasuk saat pindah toko/database
  // (nama bisa sama tetapi id penyimpanan berubah).
  else simpanSalinan(next);
  return next;
}

/**
 * Simpan identitas (hasil PUT dari Pengaturan) & sebarkan tanpa muat ulang.
 * `simpan: false` dipakai "Kembalikan bawaan" — salinan perangkat dihapus agar
 * layar muat berikutnya netral sampai identitas dimuat lagi.
 */
export function setIdentitas(next: Identitas, opsi: { simpan?: boolean } = {}) {
  if (opsi.simpan === false) {
    data = next;
    dikenal = true;
    try {
      localStorage.setItem(KUNCI, JSON.stringify(next));
    } catch {
      /* abaikan */
    }
    terapkan(next);
    for (const f of pendengar) f();
    return;
  }
  umumkan(next);
}

export function bacaIdentitas(): Identitas {
  return data;
}

/**
 * Apakah identitas sudah diketahui (cache/server) — bukan nama bawaan semata.
 * Dipakai layar muat sesi supaya perangkat baru tidak menampilkan merek lama.
 */
export function identitasDikenal(): boolean {
  return dikenal;
}

/** React hook: identitas terkini + muat ulang sekali saat mount. */
export function useIdentitas(): Identitas {
  const [, paksa] = useState(0);
  useEffect(() => {
    const f = () => paksa((n) => n + 1);
    pendengar.add(f);
    void muatIdentitas().catch(() => {
      /* offline / server belum siap — pakai cache lokal */
    });
    return () => {
      pendengar.delete(f);
    };
  }, []);
  return data;
}

/** Logo yang dipakai untuk tema aktif sekarang (X1.1 — varian siang/malam). */
export function logoUntukTema(i: Identitas = data): string {
  const gelap = document.documentElement.dataset.theme === 'dark';
  const utama = gelap ? i.logoMalam || i.logoSiang : i.logoSiang || i.logoMalam;
  return utama || i.ikon;
}

/** Logo untuk sebuah tema tertentu (dipakai pratinjau Halaman Identitas). */
export function logoUntukTemaTertentu(i: Identitas, tema: 'siang' | 'malam'): string {
  const utama = tema === 'malam' ? i.logoMalam || i.logoSiang : i.logoSiang || i.logoMalam;
  return utama || i.ikon;
}

// Terapkan SEGERA dari cache localStorage: judul tab & favicon memakai
// identitas terakhir tanpa menunggu jawaban server (layar muat mengurus
// dirinya sendiri lewat salinan `app_identity` di index.html).
terapkan(data);
