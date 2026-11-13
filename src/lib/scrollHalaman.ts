/**
 * Kontrol scroll area luar per halaman (Pengaturan ▸ Tampilan).
 *
 * Rangka aplikasi SELALU setinggi layar (`.app-shell` 100dvh). Yang diatur di
 * sini adalah apakah area konten boleh menggulir mengikuti jendela
 * (`.app-utama` overflow-y:auto) atau dikunci sehingga gulir hanya terjadi di
 * dalam area/tabel internal halaman tersebut.
 *
 * Preferensi disimpan di localStorage agar langsung berlaku setelah muat ulang
 * tanpa menunggu permintaan jaringan (pola sama dengan `tampilanBaru`).
 */

export const EVENT_SCROLL_HALAMAN = 'nusapos:scroll-halaman';
const KUNCI = 'nusapos.scrollHalaman';

export interface HalamanScroll {
  /** Kode stabil untuk penyimpanan (jangan diubah). */
  kode: string;
  label: string;
  /** Awalan rute yang dicakup (dicocokkan pada awal pathname). */
  awalan: string[];
  /** Bawaan: true = boleh scroll luar (window overflow). */
  bawaan: boolean;
}

/** Daftar halaman yang bisa diatur — urut sesuai kebutuhan operasional. */
export const HALAMAN_SCROLL: HalamanScroll[] = [
  {
    kode: 'po-buat',
    label: 'Halaman Buat Purchase Order (/po/buat)',
    awalan: ['/po/buat'],
    bawaan: false,
  },
  {
    kode: 'pos',
    label: 'Halaman Kasir / POS (/pos)',
    awalan: ['/pos'],
    bawaan: false,
  },
  {
    kode: 'pembelian',
    label: 'Halaman Pembelian (/pembelian)',
    awalan: ['/pembelian'],
    bawaan: false,
  },
  {
    kode: 'stok',
    label: 'Halaman Item Masuk & Keluar (/stok/item-masuk, /stok/item-keluar)',
    awalan: ['/stok'],
    bawaan: false,
  },
  {
    kode: 'laporan-master',
    label: 'Halaman Laporan & Master Data (/laporan, /master)',
    awalan: ['/laporan', '/master'],
    bawaan: true,
  },
];

export interface PreferensiScroll {
  /** Toggle utama. false = kontrol dimatikan, semua halaman boleh scroll luar. */
  aktif: boolean;
  /** kode halaman → boleh scroll luar. */
  halaman: Record<string, boolean>;
}

function bawaan(): PreferensiScroll {
  const halaman: Record<string, boolean> = {};
  for (const h of HALAMAN_SCROLL) halaman[h.kode] = h.bawaan;
  return { aktif: true, halaman };
}

/** Baca preferensi; nilai yang hilang/rusak jatuh ke bawaan per halaman. */
export function bacaScrollHalaman(): PreferensiScroll {
  const dasar = bawaan();
  try {
    const mentah = localStorage.getItem(KUNCI);
    if (!mentah) return dasar;
    const j = JSON.parse(mentah) as Partial<PreferensiScroll>;
    const halaman = { ...dasar.halaman };
    for (const h of HALAMAN_SCROLL) {
      const v = j.halaman?.[h.kode];
      if (typeof v === 'boolean') halaman[h.kode] = v;
    }
    return { aktif: j.aktif !== false, halaman };
  } catch {
    return dasar;
  }
}

/** Simpan + beri tahu AppLayout agar halaman aktif langsung menyesuaikan. */
export function simpanScrollHalaman(p: PreferensiScroll): void {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(p));
  } catch {
    /* localStorage penuh/diblokir: preferensi tetap berlaku untuk sesi ini. */
  }
  window.dispatchEvent(new Event(EVENT_SCROLL_HALAMAN));
}

/** Kode halaman untuk sebuah pathname (awalan terpanjang menang), atau null. */
export function kodeHalamanScroll(pathname: string): string | null {
  let cocok: HalamanScroll | null = null;
  for (const h of HALAMAN_SCROLL) {
    const kena = h.awalan.some((a) => pathname === a || pathname.startsWith(`${a}/`));
    if (kena && (!cocok || h.awalan.join().length > cocok.awalan.join().length)) cocok = h;
  }
  return cocok?.kode ?? null;
}

/** Apakah halaman ini boleh memakai scroll area luar. */
export function izinkanScrollLuar(pathname: string): boolean {
  const p = bacaScrollHalaman();
  if (!p.aktif) return true;
  const kode = kodeHalamanScroll(pathname);
  if (!kode) return true; // halaman di luar daftar: perilaku bawaan (boleh)
  return p.halaman[kode] ?? true;
}

/**
 * Terapkan status ke <html data-scroll-luar>. CSS memakai atribut ini untuk
 * mengunci `.app-utama` dan memindahkan gulir ke `.konten`.
 */
export function terapkanScrollLuar(izinkan: boolean): void {
  document.documentElement.dataset.scrollLuar = izinkan ? 'bebas' : 'kunci';
}
