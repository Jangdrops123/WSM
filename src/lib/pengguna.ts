// Preferensi pengguna per peramban (localStorage).
//
// Modul login belum tersedia, jadi peran aktif dipilih manual di Pengaturan
// (berfungsi sebagai pengganti "setelah login"). Semua nilai disimpan lokal —
// tidak dikirim ke server, tidak menyangkut kredensial.

export type Peran = 'admin' | 'manajer' | 'akuntan' | 'kasir' | 'gudang' | 'lainnya';
export type ModePos = 'foto' | 'cepat';
export type HalamanAwal = 'dashboard' | 'pos' | 'penjualan';

const KUNCI_PERAN = 'nusapos.peran';
const KUNCI_MODE = 'nusapos.mode-pos';
/** Bawaan global dari server (Pengaturan ▸ Pengguna & Hak Akses). */
const KUNCI_MODE_BAWAAN = 'nusapos.mode-pos-bawaan';
const KUNCI_HALAMAN = 'nusapos.halaman-awal';
const KUNCI_GRUP = 'nusapos.menu-grup';

function bacaTeks(kunci: string, awal: string): string {
  try {
    return localStorage.getItem(kunci) ?? awal;
  } catch {
    return awal;
  }
}

function tulisTeks(kunci: string, nilai: string): void {
  try {
    localStorage.setItem(kunci, nilai);
  } catch {
    /* penyimpanan penuh/di-nonaktifkan — abaikan */
  }
}

/* ------------------------------- peran aktif ---------------------------- */

const PERAN: Peran[] = ['admin', 'manajer', 'akuntan', 'kasir', 'gudang', 'lainnya'];

export function peranAktif(): Peran {
  const t = bacaTeks(KUNCI_PERAN, 'admin');
  return (PERAN as string[]).includes(t) ? (t as Peran) : 'admin';
}

export function setPeranAktif(p: Peran): void {
  tulisTeks(KUNCI_PERAN, p);
}

export function namaPeran(p: Peran): string {
  return p === 'admin'
    ? 'Admin (Owner)'
    : p === 'manajer'
      ? 'Manajer'
      : p === 'akuntan'
        ? 'Akuntan'
        : p === 'gudang'
          ? 'Staf Gudang'
          : p === 'kasir'
            ? 'Kasir'
            : 'Peran khusus';
}

/* --------------------------- mode POS terakhir -------------------------- */

/** Bawaan global yang diatur Admin (semua pengguna). */
export function modePosBawaan(): ModePos {
  const t = bacaTeks(KUNCI_MODE_BAWAAN, '');
  return t === 'foto' || t === 'cepat' ? t : 'cepat';
}

/** Pilihan perangkat ini (bila sudah pernah membuka POS) atau bawaan global. */
export function modePosTerakhir(): ModePos {
  const t = bacaTeks(KUNCI_MODE, '');
  if (t === 'foto' || t === 'cepat') return t;
  return modePosBawaan();
}

export function setModePosTerakhir(m: ModePos): void {
  tulisTeks(KUNCI_MODE, m);
}

export function setModePosBawaan(m: ModePos): void {
  tulisTeks(KUNCI_MODE_BAWAAN, m);
}

/** Rute POS untuk sebuah mode (M2). */
export function rutePos(m: ModePos = modePosTerakhir()): string {
  return m === 'foto' ? '/penjualan/pos/foto' : '/penjualan/pos/tanpa-foto';
}

/* --------------------------- halaman awal login ------------------------- */

const HALAMAN_AWAL_BAWAAN: Record<string, HalamanAwal> = {
  admin: 'dashboard',
  manajer: 'dashboard',
  akuntan: 'dashboard',
  kasir: 'pos',
  gudang: 'dashboard',
  lainnya: 'dashboard',
};

const HALAMAN: HalamanAwal[] = ['dashboard', 'pos', 'penjualan'];

/**
 * Kunci penyimpanan halaman awal dari NAMA peran.
 * Peran bawaan memakai kunci pendek (kompatibel dengan nilai lama); peran
 * kustom memakai namanya sendiri sehingga tiap peran bisa diatur terpisah.
 */
export function kunciHalaman(namaPeran: string): string {
  const n = namaPeran.toLowerCase().trim();
  const bawaan: Record<string, string> = {
    administrator: 'admin',
    owner: 'admin',
    admin: 'admin',
    manager: 'manajer',
    manajer: 'manajer',
    akuntan: 'akuntan',
    kasir: 'kasir',
    gudang: 'gudang',
  };
  return bawaan[n] ?? (n || 'admin');
}

export function halamanAwalSemua(): Record<string, HalamanAwal> {
  const hasil: Record<string, HalamanAwal> = { ...HALAMAN_AWAL_BAWAAN };
  try {
    const mentah = JSON.parse(bacaTeks(KUNCI_HALAMAN, '{}')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(mentah)) {
      if (typeof v === 'string' && (HALAMAN as string[]).includes(v)) {
        hasil[kunciHalaman(k)] = v as HalamanAwal;
      }
    }
  } catch {
    /* JSON rusak — pakai bawaan */
  }
  return hasil;
}

export function setHalamanAwal(kunci: string, halaman: HalamanAwal): void {
  tulisTeks(KUNCI_HALAMAN, JSON.stringify({ ...halamanAwalSemua(), [kunciHalaman(kunci)]: halaman }));
}

/**
 * Simpan preferensi global dari server ke cache perangkat.
 * Dipanggil setiap sesi dimuat — jadi pengaturan Admin langsung berlaku untuk
 * perangkat yang belum pernah memilih sendiri, dan tetap sinkron setelah
 * pengaturan diubah.
 */
export function simpanPreferensiServer(halaman: Record<string, string>, modePos: string): void {
  const bersih: Record<string, HalamanAwal> = {};
  for (const [k, v] of Object.entries(halaman ?? {})) {
    if ((HALAMAN as string[]).includes(v)) bersih[kunciHalaman(k)] = v as HalamanAwal;
  }
  tulisTeks(KUNCI_HALAMAN, JSON.stringify(bersih));
  setModePosBawaan(modePos === 'foto' ? 'foto' : 'cepat');
}

/** Tujuan rute untuk halaman awal sebuah peran (kunci peran / nama peran). */
export function tujuanHalamanAwal(peran: string = peranAktif()): string {
  const h = halamanAwalSemua()[kunciHalaman(peran)] ?? 'dashboard';
  if (h === 'pos') return rutePos();
  if (h === 'penjualan') return '/penjualan';
  return '/';
}

/* ------------------------ status buka-tutup grup ------------------------ */

export function grupSidebar(): Record<string, boolean> {
  try {
    const mentah = JSON.parse(bacaTeks(KUNCI_GRUP, '{}')) as Record<string, unknown>;
    const hasil: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(mentah)) if (typeof v === 'boolean') hasil[k] = v;
    return hasil;
  } catch {
    return {};
  }
}

export function setGrupSidebar(map: Record<string, boolean>): void {
  tulisTeks(KUNCI_GRUP, JSON.stringify(map));
}

/* --------------------------- keadaan sidebar (R3) ------------------------ */

/**
 * Keadaan sidebar per pengguna: expanded (260px), collapsed (72px), hidden (0).
 * `null` = belum pernah dipilih → ikuti lebar layar (R4: ≥1280 expanded,
 * 768–1279 collapsed, <768 tersembunyi/laci).
 */
export type KeadaanSidebar = 'expanded' | 'collapsed' | 'hidden';

const KUNCI_SB = 'nusapos.sidebar-keadaan';
const KEADAAN: KeadaanSidebar[] = ['expanded', 'collapsed', 'hidden'];

/** Dibaca sekali saat komponen pertama dirender — tanpa kedip. */
export function keadaanSidebar(): KeadaanSidebar | null {
  const t = bacaTeks(KUNCI_SB, '');
  return (KEADAAN as string[]).includes(t) ? (t as KeadaanSidebar) : null;
}

export function setKeadaanSidebar(k: KeadaanSidebar | null): void {
  tulisTeks(KUNCI_SB, k ?? '');
}

/* ---------------------------- Mode Fokus (U1) ---------------------------- */

/**
 * Mode Fokus — menyembunyikan sidebar dan merampingkan header supaya konten
 * memenuhi seluruh lebar layar. Pintasan Ctrl+Shift+F. Disimpan per pengguna.
 */
const KUNCI_FOKUS = 'nusapos.mode-fokus';

export function modeFokus(): boolean {
  return bacaTeks(KUNCI_FOKUS, '') === '1';
}

export function setModeFokus(v: boolean): void {
  tulisTeks(KUNCI_FOKUS, v ? '1' : '');
}
