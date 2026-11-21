// Sistem tema (P2/P3): Terang | Gelap | Ikuti Sistem — plus varian aksen dan
// sidebar terang. Preferensi disimpan di localStorage (cepat, tanpa kedip)
// dan di tabel settings lewat /api/tampilan (per pengguna, mengikuti database).
//
// Skrip inline di index.html menyetel atribut <html data-theme/data-aksen/
// data-sidebar> SEBELUM render agar tema tampil sejak paint pertama;
// modul ini mengambil alih setelah aplikasi dimuat.

import { apiGet, apiPut } from './api';
import { aksenAplikasi } from './identitas';
import { perbaruiAksenSalinan, perbaruiTemaSalinan } from './salinanIdentitas';

export type Tema = 'terang' | 'gelap' | 'sistem';
export type Aksen = '' | 'biru' | 'indigo' | 'hijau' | 'oranye';
export type SidebarTampilan = 'gelap' | 'terang';

export interface PreferensiTema {
  tema: Tema;
  aksen: Aksen;
  sidebar: SidebarTampilan;
}

const KUNCI_TEMA = 'nusapos.tema';
const KUNCI_AKSEN = 'nusapos.aksen';
const KUNCI_SIDEBAR = 'nusapos.sidebar';

const TEMA: Tema[] = ['terang', 'gelap', 'sistem'];
const AKSEN: Aksen[] = ['', 'biru', 'indigo', 'hijau', 'oranye'];

const sistemGelap = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function baca<T extends string>(kunci: string, daftar: T[], awal: T): T {
  try {
    const v = localStorage.getItem(kunci);
    return (daftar as string[]).includes(v ?? '') ? (v as T) : awal;
  } catch {
    return awal;
  }
}

function tulis(kunci: string, nilai: string): void {
  try {
    localStorage.setItem(kunci, nilai);
  } catch {
    /* penyimpanan nonaktif — abaikan */
  }
}

/** Baca preferensi dari localStorage (dipakai skrip head & aplikasi). */
export function bacaPreferensi(): PreferensiTema {
  return {
    tema: baca<Tema>(KUNCI_TEMA, TEMA, 'sistem'),
    aksen: baca<Aksen>(KUNCI_AKSEN, AKSEN, ''),
    sidebar: baca<SidebarTampilan>('nusapos.sidebar', ['gelap', 'terang'], 'gelap'),
  };
}

/** Tema efektif untuk atribut data-theme: 'sistem' → ikuti prefers-color-scheme. */
export function temaEfektif(tema: Tema): 'dark' | 'light' {
  if (tema === 'sistem') return sistemGelap() ? 'dark' : 'light';
  return tema === 'gelap' ? 'dark' : 'light';
}

/** Terapkan preferensi ke <html> (dipanggil skrip head & setiap perubahan). */
export function terapkanPreferensi(p: PreferensiTema = bacaPreferensi()): void {
  const el = document.documentElement;
  const efektif = temaEfektif(p.tema);
  el.dataset.theme = efektif;
  // colorScheme mengatur kontrol bawaan browser (scrollbar, date picker).
  el.style.colorScheme = efektif;
  // Y2.1 — aksen per pengguna mengalahkan aksen aplikasi (Identitas Aplikasi).
  const aksen = p.aksen || aksenAplikasi();
  if (aksen) el.dataset.aksen = aksen;
  else delete el.dataset.aksen;
  el.dataset.sidebar = p.sidebar;
  // AI1/AI3 — salinan layar muat ikut tema & aksen terakhir (tanpa kedip).
  perbaruiTemaSalinan(efektif === 'dark' ? 'malam' : 'siang');
  perbaruiAksenSalinan(aksen);
}

/** Transisi warna halus 150 ms hanya saat ganti tema (P3). */
export function transisiTema(jalankan: () => void): void {
  const el = document.documentElement;
  el.classList.add('ganti-tema');
  jalankan();
  window.setTimeout(() => el.classList.remove('ganti-tema'), 220);
}

/** Gilir tema: Terang → Gelap → Ikuti Sistem → Terang. */
export function gantiTema(): PreferensiTema {
  const p = bacaPreferensi();
  const urut: Tema[] = ['terang', 'gelap', 'sistem'];
  const next: Tema = urut[(urut.indexOf(p.tema) + 1) % urut.length];
  const baru = { ...p, tema: next };
  tulis(KUNCI_TEMA, next);
  transisiTema(() => terapkanPreferensi(baru));
  void simpanKeServer(baru);
  return baru;
}

export function labelTema(tema: Tema): string {
  return tema === 'terang' ? 'Tema: Terang' : tema === 'gelap' ? 'Tema: Gelap' : 'Tema: Ikuti Sistem';
}

/** Simpan ke localStorage + database (tabel settings). Gagal server → abaikan. */
export function simpanPreferensi(p: PreferensiTema): void {
  tulis(KUNCI_TEMA, p.tema);
  tulis(KUNCI_AKSEN, p.aksen);
  tulis(KUNCI_SIDEBAR, p.sidebar);
  transisiTema(() => terapkanPreferensi(p));
  void simpanKeServer(p);
}

async function simpanKeServer(p: PreferensiTema): Promise<void> {
  try {
    await apiPut('/api/tampilan', { tema: p.tema, aksen: p.aksen, sidebar: p.sidebar });
  } catch {
    /* offline / server belum siap — preferensi lokal tetap berlaku */
  }
}

/** Ambil dari database bila localStorage belum punya (perangkat baru). */
export async function sinkronTemaDariServer(): Promise<void> {
  try {
    const r = await apiGet<{ tema?: string; aksen?: string; sidebar?: string }>('/api/tampilan');
    const lokal = bacaPreferensi();
    const server: PreferensiTema = {
      tema: (TEMA as string[]).includes(r.tema ?? '') ? (r.tema as Tema) : lokal.tema,
      aksen: (AKSEN as string[]).includes(r.aksen ?? '') ? (r.aksen as Aksen) : lokal.aksen,
      sidebar: (['gelap', 'terang'] as string[]).includes(r.sidebar ?? '')
        ? (r.sidebar as SidebarTampilan)
        : lokal.sidebar,
    };
    // Server menang hanya bila berbeda dari lokal dan lokal masih bawaan
    // (sistem) — supaya ganti tema di perangkat ini tetap instan.
    const lokalKosong = !localStorage.getItem(KUNCI_TEMA);
    if (lokalKosong) {
      tulis(KUNCI_TEMA, server.tema);
      tulis(KUNCI_AKSEN, server.aksen);
      tulis(KUNCI_SIDEBAR, server.sidebar);
      terapkanPreferensi(server);
    }
  } catch {
    /* server belum siap — pakai preferensi lokal */
  }
}

/** Dengarkan perubahan preferensi sistem saat tema = Ikuti Sistem. */
export function pasangPantauSistem(): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const on = () => {
    if (bacaPreferensi().tema === 'sistem') terapkanPreferensi();
  };
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
