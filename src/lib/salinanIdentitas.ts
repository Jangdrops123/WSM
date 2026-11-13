// BAGIAN AI1 — Salinan identitas di perangkat (`app_identity`).
//
// Layar muat (splash) di index.html berjalan SEBELUM bundel aplikasi, jadi ia
// tidak bisa menunggu /api. Salinan ini membuat layar muat langsung tahu nama,
// tagline, logo, aksen, dan tema terakhir tanpa teks merek tetap.
//
// Bentuk penyimpanan: kunci "app_identity" (salinan yang terakhir dipakai),
// "app_identity:<id>" per database/toko, dan penunjuk "app_identity_active" =
// id terakhir. Logo besar TIDAK disimpan utuh — hanya URL (cache browser) dan
// versi ikon kecil (data URL, maks 64 KB). Semua operasi dibungkus try/catch:
// kuota penuh atau mode privat tidak boleh memecah aplikasi.
import type { Identitas } from './identitas';

export interface SalinanIdentitas {
  /** Versi format — naikkan bila bentuknya berubah. */
  v: 1;
  nama: string;
  tagline: string;
  judulTab: string;
  favicon: string;
  logoSiang: string;
  logoMalam: string;
  ikon: string;
  /** Ikon kecil (maks 64 KB) sebagai data URL — dipakai layar muat lebih dulu. */
  ikonData: string;
  /** Aksen efektif (preferensi pengguna menang atas aksen aplikasi). */
  aksen: string;
  tema: 'siang' | 'malam';
  /** Id database/toko terakhir yang dipakai ('' → "utama"). */
  db: string;
  /** Waktu pembaruan (epoch ms). */
  waktu: number;
}

const KUNCI = 'app_identity';
const KUNCI_AKTIF = 'app_identity_active';
const ID_UTAMA = 'utama';
const MAKS_IKON_BYTES = 64 * 1024;
/** Batas panjang data URL ikon (base64 ≈ 1,37× byte). */
const MAKS_IKON_TEKS = 92 * 1024;

/** Id database/toko aktif — dibaca langsung agar tidak ada impor melingkar. */
function idSalinan(): string {
  try {
    return localStorage.getItem('nusapos.tokoAktif')?.trim() || ID_UTAMA;
  } catch {
    return ID_UTAMA;
  }
}

/** Tema efektif yang sedang tampil (Siang/Malam). */
export function temaLayarAktif(): 'siang' | 'malam' {
  if (typeof document === 'undefined') return 'siang';
  const tema = document.documentElement.dataset.theme;
  if (tema === 'dark') return 'malam';
  if (tema === 'light') return 'siang';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'malam' : 'siang';
  } catch {
    return 'siang';
  }
}

/** Aksen efektif: preferensi pengguna (Tampilan) menang atas aksen aplikasi. */
export function aksenLayarAktif(aksenAplikasi: string): string {
  try {
    return localStorage.getItem('nusapos.aksen') || aksenAplikasi || '';
  } catch {
    return aksenAplikasi || '';
  }
}

function bacaMentah(db: string): SalinanIdentitas | null {
  try {
    const s = localStorage.getItem(`${KUNCI}:${db}`) ?? localStorage.getItem(KUNCI);
    if (!s) return null;
    const j = JSON.parse(s) as Partial<SalinanIdentitas>;
    return j && j.v === 1 && typeof j.nama === 'string' ? (j as SalinanIdentitas) : null;
  } catch {
    return null;
  }
}

/** Salinan yang terakhir dipakai (atau null bila belum ada / tak terbaca). */
export function bacaSalinan(): SalinanIdentitas | null {
  try {
    const aktif = localStorage.getItem(KUNCI_AKTIF) ?? '';
    const daftar = aktif ? [`${KUNCI}:${aktif}`, KUNCI] : [KUNCI];
    for (const kunci of daftar) {
      const s = localStorage.getItem(kunci);
      if (!s) continue;
      const j = JSON.parse(s) as Partial<SalinanIdentitas>;
      if (j && j.v === 1 && typeof j.nama === 'string' && j.nama.trim()) return j as SalinanIdentitas;
    }
  } catch {
    /* penyimpanan nonaktif / isi rusak */
  }
  return null;
}

function tulis(s: SalinanIdentitas): boolean {
  const simpan = (nilai: SalinanIdentitas) => {
    const teks = JSON.stringify(nilai);
    localStorage.setItem(`${KUNCI}:${nilai.db}`, teks);
    localStorage.setItem(KUNCI_AKTIF, nilai.db);
    localStorage.setItem(KUNCI, teks);
  };
  try {
    simpan(s);
    return true;
  } catch {
    // Kuota penuh — ulangi tanpa ikon kecil (yang paling besar).
    try {
      if (!s.ikonData) return false;
      simpan({ ...s, ikonData: '' });
      return true;
    } catch {
      return false;
    }
  }
}

/** Ambil ikon kecil sebagai data URL bila ≤ 64 KB (selain itu string kosong). */
async function ikonKecil(url: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) {
    return url.startsWith('data:image/') && url.length <= MAKS_IKON_TEKS ? url : '';
  }
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) return '';
    const blob = await r.blob();
    if (!blob.type.startsWith('image/') || blob.size > MAKS_IKON_BYTES) return '';
    return await new Promise<string>((selesai, gagal) => {
      const f = new FileReader();
      f.onload = () => selesai(String(f.result ?? ''));
      f.onerror = () => gagal(new Error('Gagal membaca ikon.'));
      f.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

/** Versi ikon kecil dari logo — disimpan bila ukurannya wajar. */
async function lengkapiIkon(s: SalinanIdentitas): Promise<void> {
  const sumber = s.ikon || s.logoSiang || s.logoMalam;
  if (!sumber) return;
  const data = await ikonKecil(sumber);
  if (!data) return;
  const kini = bacaMentah(s.db);
  if (!kini || kini.ikon !== s.ikon || kini.ikonData) return;
  tulis({ ...kini, ikonData: data });
}

/**
 * Tulis/perbarui salinan perangkat. Dipanggil saat simpan Identitas, setelah
 * identitas berhasil dimuat dari database, saat pindah toko, dan setelah
 * layar muat berhasil mengambil identitas publik.
 */
export function simpanSalinan(i: Identitas): void {
  const nama = (i.nama ?? '').trim().slice(0, 60);
  if (!nama) return; // AI6 — nama kosong tidak boleh menjadi salinan
  const db = idSalinan();
  const lama = bacaMentah(db);
  const dasar: SalinanIdentitas = {
    v: 1,
    nama,
    tagline: (i.tagline ?? '').trim().slice(0, 80),
    judulTab: (i.judulTab ?? '').trim().slice(0, 80),
    favicon: i.favicon ?? '',
    logoSiang: i.logoSiang ?? '',
    logoMalam: i.logoMalam ?? '',
    ikon: i.ikon ?? '',
    ikonData: '',
    aksen: aksenLayarAktif(i.aksen ?? ''),
    tema: temaLayarAktif(),
    db,
    waktu: Date.now(),
  };
  // Logo tidak berubah → pertahankan ikon kecil yang sudah dibuat.
  if (lama && lama.ikon === dasar.ikon && lama.ikonData) dasar.ikonData = lama.ikonData;
  if (!tulis(dasar)) return;
  void lengkapiIkon(dasar);
}

/** Perbarui hanya tema pada salinan (dipanggil saat pengguna mengganti tema). */
export function perbaruiTemaSalinan(tema: 'siang' | 'malam'): void {
  const s = bacaSalinan();
  if (!s || s.tema === tema) return;
  tulis({ ...s, tema, waktu: Date.now() });
}

/** Perbarui hanya aksen pada salinan (nilai aksen efektif yang sedang tampil). */
export function perbaruiAksenSalinan(aksen: string): void {
  const s = bacaSalinan();
  if (!s || s.aksen === aksen) return;
  tulis({ ...s, aksen, waktu: Date.now() });
}

/** Hapus semua salinan (Kembalikan bawaan / data situs dibersihkan). */
export function hapusSalinan(): void {
  try {
    const hapus: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const kunci = localStorage.key(i);
      if (kunci === KUNCI || kunci === KUNCI_AKTIF || kunci?.startsWith(`${KUNCI}:`)) hapus.push(kunci);
    }
    for (const kunci of hapus) localStorage.removeItem(kunci);
  } catch {
    /* mode privat — tidak ada yang perlu dihapus */
  }
}
