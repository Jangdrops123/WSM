// Konfigurasi navigasi sidebar — sumber kebenaran menu aplikasi.
// `kode` dipakai juga sebagai nilai kolom role_permissions.menu
// sehingga hak akses per menu bisa disambungkan nanti tanpa mengubah nama.
//
// R1 — urutan menu (persis): Dashboard, Master Data, Stok, Pembelian,
// Penjualan, Akuntansi, Laporan, Pengaturan. Grup "Persediaan
// Sub" dihapus; isinya (Item Masuk, Item Keluar, Opname) masuk ke grup Stok.
// Menu tanpa sub adalah tautan langsung; menu dengan sub memakai panah.

import type { Peran } from '../lib/pengguna';

export type IconName =
  | 'dashboard'
  | 'pos'
  | 'pembelian'
  | 'stok'
  | 'opname'
  | 'penjualan'
  | 'faktur'
  | 'akuntansi'
  | 'laporan'
  | 'master'
  | 'pengaturan';

export interface MenuItem {
  kode: string;
  label: string;
  path: string;
  /** Path tambahan yang ikut dianggap "dalam modul ini" (mis. /opname → Stok). */
  pathCocok?: string[];
  icon: IconName;
  deskripsi: string;
  /** Sub-menu di sidebar (induk tetap bisa dibuka → rute indeks). */
  anak?: SubMenu[];
  /** true = induk dirender sebagai tautan langsung + tombol panah akordeon
      terpisah (mis. Penjualan: klik label buka modul, panah buka Retur/Piutang). */
  tautanInduk?: boolean;
}

export interface SubMenu {
  kode: string;
  label: string;
  path: string;
  /** true = sub-menu tetap tersorot untuk rute turunan (mis. /stok/opname/:id). */
  lebar?: boolean;
  deskripsi: string;
}

export const MENU: MenuItem[] = [
  {
    // 1 — tautan langsung (tanpa sub).
    kode: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    deskripsi: 'Ringkasan penjualan, stok, dan keuangan hari ini',
  },
  {
    // 2 — Master Data dengan sub-modul (rute /master/* tidak berubah).
    kode: 'master',
    label: 'Master Data',
    path: '/master',
    icon: 'master',
    deskripsi: 'Produk, satuan, pelanggan, supplier, gudang',
    anak: [
      { kode: 'master-produk', label: 'Produk', path: '/master/produk', deskripsi: 'Katalog produk, harga, foto, barcode' },
      { kode: 'master-konversi', label: 'Konversi Satuan', path: '/master/konversi', deskripsi: 'Konversi satuan (pcs, lusin, kodi, box)' },
      { kode: 'master-paket', label: 'Paket / Box', path: '/master/paket', deskripsi: 'Produk bundling & paket harga' },
      { kode: 'master-kategori', label: 'Kategori', path: '/master/kategori', deskripsi: 'Kategori produk' },
      { kode: 'master-merek', label: 'Merek', path: '/master/merek', deskripsi: 'Merek / brand produk' },
      { kode: 'master-satuan', label: 'Satuan', path: '/master/satuan', deskripsi: 'Daftar satuan dasar' },
      { kode: 'master-pelanggan', label: 'Pelanggan', path: '/master/pelanggan', deskripsi: 'Pelanggan & limit piutang' },
      { kode: 'master-pemasok', label: 'Pemasok', path: '/master/pemasok', deskripsi: 'Supplier / pemasok barang' },
      { kode: 'master-gudang', label: 'Gudang & Lokasi', path: '/master/gudang', deskripsi: 'Gudang, lokasi, dan rak penyimpanan' },
    ],
  },
  {
    // 3 — Stok (bekas grup "Persediaan Sub" dilebur ke sini; rute lama
    //     /persediaan-sub/* dan /persediaan/opname dialihkan 301).
    kode: 'stok',
    label: 'Stok',
    path: '/stok',
    pathCocok: ['/persediaan', '/persediaan-sub'],
    icon: 'stok',
    deskripsi: 'Saldo stok per gudang/lokasi, mutasi, dan transfer',
    anak: [
      {
        // Stok Persediaan: modul terpadu (3 Token: Saldo, Kartu Stok, Pengaturan).
        // Sub-menu "Kartu Stok" dihapus — fiturnya jadi token di modul ini.
        kode: 'stok-saldo',
        label: 'Stok Persediaan',
        path: '/stok',
        deskripsi: 'Saldo stok, kartu mutasi & pengaturan per gudang/lokasi',
      },
      // Z1 — "Transfer Antar Gudang" dulunya tab di ribon Stok.
      // Kini menjadi sub-menu sidebar biasa supaya halamannya tetap terjangkau
      // (Z6: satu sumber menu menggerakkan sidebar DAN rute).
      {
        kode: 'stok-transfer',
        label: 'Transfer Antar Gudang',
        path: '/stok/transfer',
        deskripsi: 'Pemindahan stok antar gudang',
      },
      {
        kode: 'stok-masuk',
        label: 'Item Masuk',
        path: '/stok/masuk',
        deskripsi: 'Tambah stok barang: stok awal, temuan, koreksi (+)',
      },
      {
        kode: 'stok-keluar',
        label: 'Item Keluar',
        path: '/stok/keluar',
        deskripsi: 'Kurangi stok barang: rusak, hilang, sampel, koreksi (-)',
      },
      {
        kode: 'stok-opname',
        label: 'Opname',
        path: '/stok/opname',
        lebar: true,
        deskripsi: 'Penghitungan stok fisik & penyesuaian selisih',
      },
    ],
  },
  {
    // 4 — Pembelian: satu modul terpadu (3 Token Switcher di dalam halaman:
    // Input / Riwayat / Dokumen) — tanpa submenu agar tidak redundan.
    kode: 'pembelian',
    label: 'Pembelian',
    path: '/pembelian',
    icon: 'pembelian',
    deskripsi: 'Input pembelian & riwayat dokumen (PO, GRN, faktur)',
    tautanInduk: true,
    anak: [
      { kode: 'pembelian-input', label: 'Transaksi Baru', path: '/pembelian', deskripsi: 'Input pembelian / penerimaan barang' },
      { kode: 'pembelian-riwayat', label: 'Riwayat', path: '/pembelian/riwayat', deskripsi: 'Riwayat transaksi & dokumen faktur' },
    ],
  },
  {
    // 4b — Purchase Order: grup Purchase (pesan ke pemasok + terima bertahap +
    // laporan selisih). Izin memakai baris matriks tersendiri
    // ('purchase-order') sehingga bisa diatur terpisah dari Pembelian.
    kode: 'purchase',
    label: 'Purchase',
    path: '/po',
    icon: 'pembelian',
    deskripsi: 'Purchase order, barang datang, dan laporan selisih',
    anak: [
      { kode: 'purchase-daftar', label: 'Daftar PO', path: '/po', deskripsi: 'Daftar & buat purchase order (filter status, pemasok, tanggal)' },
      { kode: 'purchase-terima', label: 'Barang Datang', path: '/po/terima', lebar: true, deskripsi: 'Penerimaan barang bertahap (tambah stok)' },
      { kode: 'purchase-laporan', label: 'Laporan PO', path: '/po/laporan', deskripsi: 'Selisih kurang/lebih & riwayat pembelian' },
    ],
  },
  {
    // 5 — Penjualan: modul terpadu (3 Token Switcher di halaman: Input/POS,
    // Riwayat, Dokumen). POS & Riwayat bukan submenu lagi — induknya tautan
    // langsung; Retur & Piutang tetap anak (halaman mandiri).
    kode: 'penjualan',
    label: 'Penjualan',
    path: '/penjualan',
    icon: 'penjualan',
    deskripsi: 'Riwayat, dokumen, retur, dan piutang penjualan',
    tautanInduk: true,
    anak: [
      { kode: 'penjualan-retur', label: 'Retur', path: '/penjualan/retur', deskripsi: 'Daftar retur penjualan' },
      { kode: 'penjualan-piutang', label: 'Piutang', path: '/penjualan/piutang', deskripsi: 'Piutang penjualan (kredit)' },
    ],
  },
  {
    // 7 — AKUNTANSI DASAR (tanpa COA/jurnal/buku besar; sub-menu baru).
    kode: 'akuntansi',
    label: 'Akuntansi',
    path: '/akuntansi',
    icon: 'akuntansi',
    deskripsi: 'Kas & bank, pengeluaran, pemasukan lain, piutang/hutang, laporan dasar',
    anak: [
      { kode: 'akuntansi-kas', label: 'Kas & Bank', path: '/akuntansi/kas', deskripsi: 'Daftar rekening kas/bank, kas masuk/keluar/transfer' },
      { kode: 'akuntansi-pengeluaran', label: 'Pengeluaran / Biaya', path: '/akuntansi/pengeluaran', deskripsi: 'Catat biaya operasional per kategori & rekening kas' },
      { kode: 'akuntansi-pemasukan', label: 'Pemasukan Lain', path: '/akuntansi/pemasukan', deskripsi: 'Catat pendapatan di luar penjualan' },
      { kode: 'akuntansi-piutang', label: 'Piutang', path: '/akuntansi/piutang', deskripsi: 'Piutang per pelanggan, jatuh tempo, bayar sebagian/lunas' },
      { kode: 'akuntansi-hutang', label: 'Hutang', path: '/akuntansi/hutang', deskripsi: 'Hutang per supplier, jatuh tempo, bayar sebagian/lunas' },
      { kode: 'akuntansi-laporan', label: 'Laporan Dasar', path: '/akuntansi/laporan', deskripsi: 'Kas & bank, laba rugi sederhana, rekap piutang/hutang' },
    ],
  },
  {
    // 8 — Laporan (sub-menu mengikuti kategori registri laporan).
    kode: 'laporan',
    label: 'Laporan',
    path: '/laporan',
    icon: 'laporan',
    deskripsi: 'Laporan penjualan, stok, laba rugi, dan pajak',
    anak: [
      { kode: 'laporan-ringkasan', label: 'Ringkasan', path: '/laporan', deskripsi: 'KPI, barang terlaris, dan pintasan laporan' },
      { kode: 'laporan-penjualan', label: 'Penjualan', path: '/laporan/penjualan', deskripsi: 'Rekap, kasir, pelanggan, barang, retur, piutang' },
      { kode: 'laporan-pembelian', label: 'Pembelian', path: '/laporan/pembelian', deskripsi: 'Rekap pembelian per pemasok, barang, dan status' },
      { kode: 'laporan-stok', label: 'Stok & Persediaan', path: '/laporan/stok', deskripsi: 'Stok, kartu, mutasi, nilai, dan perputaran' },
      { kode: 'laporan-opname', label: 'Opname', path: '/laporan/opname', deskripsi: 'Riwayat & selisih opname' },
      { kode: 'laporan-keuangan', label: 'Keuangan', path: '/laporan/keuangan', deskripsi: 'Laba rugi, neraca, arus kas, buku besar' },
      { kode: 'laporan-dasar', label: 'Laporan Dasar', path: '/akuntansi/laporan', deskripsi: 'Kas & bank, laba rugi sederhana, rekap piutang/hutang' },
      { kode: 'laporan-pajak', label: 'Pajak', path: '/laporan/pajak', deskripsi: 'Pajak keluaran & masukan' },
      { kode: 'laporan-piutang', label: 'Piutang & Utang', path: '/laporan/piutang', deskripsi: 'Aging piutang, utang, dan riwayat pelunasan' },
      { kode: 'laporan-tersimpan', label: 'Laporan Tersimpan', path: '/laporan/tersimpan', deskripsi: 'Laporan tersimpan & penjadwalan otomatis' },
    ],
  },
  {
    // 9 — tautan langsung.
    kode: 'pengaturan',
    label: 'Pengaturan',
    path: '/pengaturan',
    icon: 'pengaturan',
    deskripsi: 'Template faktur & ukuran kertas, aturan kodi, pajak, dan impor massal',
  },
];

export const MENU_BY_KODE = new Map(MENU.map((m) => [m.kode, m]));

/* -------------------- TAHAP 2 — gerbang matriks hak --------------------- */

/**
 * Pemetaan menu (grup) → modul `role_permissions.menu`.
 * `null` = selalu terlihat (Dashboard/beranda tidak pernah disembunyikan).
 */
const MODUL_ATAS: Record<string, string | null> = {
  dashboard: null,
  master: 'master',
  stok: 'stok',
  pembelian: 'pembelian',
  purchase: 'purchase-order',
  penjualan: 'penjualan',
  akuntansi: 'akuntansi',
  laporan: 'laporan',
  pengaturan: 'pengaturan',
};

/** Sub-menu yang modulnya terpisah dari induknya (dikunci per modul). */
const MODUL_ANAK: Record<string, string> = {
  'stok-opname': 'opname',
  'penjualan-pos-foto': 'pos',
  'penjualan-pos-cepat': 'pos',
};

/**
 * Modul terlihat bila matriks (sesi login) memberi aksi `lihat`.
 * Tanpa matriks (pemanggilan lama) → perilaku lama dipertahankan.
 */
function bolehModul(hak: Record<string, string[]> | undefined, modul: string | null): boolean {
  if (!modul || !hak) return true;
  return (hak[modul] ?? []).includes('lihat');
}

function modulAnak(kodeAnak: string, modulInduk: string | null): string | null {
  return MODUL_ANAK[kodeAnak] ?? modulInduk;
}

/** Menu (grup) yang memuat sebuah path — dipakai akordeon untuk auto-buka. */
export function grupPemilik(pathname: string): MenuItem | undefined {
  if (pathname === '/') return MENU_BY_KODE.get('dashboard');
  return MENU.find(
    (m) =>
      m.path !== '/' &&
      (pathname === m.path ||
        pathname.startsWith(`${m.path}/`) ||
        m.pathCocok?.some((x) => pathname === x || pathname.startsWith(`${x}/`))),
  );
}

/**
 * Akar modul untuk tombol Kembali (<) di topbar — TERISOLASI per modul.
 *
 * Aturan:
 *  - Sub-halaman/detail → akar = halaman utama (landing) modul/sub-menu-nya.
 *  - Sudah di akar → fungsi mengembalikan path yang sama, sehingga tombol
 *    Kembali disembunyikan (tidak pernah melempar pengguna ke modul lain).
 *  - Path di luar menu (mis. halaman login) → null.
 *
 * Contoh: /laporan/l/penjualan-pelanggan → /laporan/penjualan (hub kategori),
 *         /po/16 → /po, /stok/opname/9 → /stok/opname,
 *         /laporan/penjualan → /laporan/penjualan (tombol disembunyikan).
 */
export function jalurAkarModul(pathname: string): string | null {
  if (pathname === '/') return null;
  const induk = grupPemilik(pathname);
  if (!induk) return null;

  // Laporan detail (/laporan/l/<kode>) kembali ke hub KATEGORI-nya, bukan ke
  // Ringkasan. Kode laporan selalu berprefix kategori (penjualan-pelanggan,
  // pembelian-pemasok, stok-kartu, keuangan-neraca, piutang-umur, …), jadi
  // kategori diturunkan dari segmen sebelum '-' lalu divalidasi terhadap menu.
  if (induk.kode === 'laporan') {
    const detail = pathname.match(/^\/laporan\/l\/([^/]+)/);
    if (detail) {
      const kode = decodeURIComponent(detail[1]);
      const awalan = kode.split('-')[0];
      // Kode "utang-*" bukan nama kategori (kategorinya piutang) — satu-
      // satunya pengecualian konvensi prefix di registry laporan.
      const kategori = awalan === 'utang' ? 'piutang' : awalan;
      const kandidat = [kategori, awalan, kode].map((k) => `/laporan/${k}`);
      const hub = kandidat.find((p) => induk.anak?.some((a) => a.path === p));
      return hub ?? '/laporan';
    }
  }

  // Sub-menu terdalam yang menjadi prefix path saat ini (detail di bawahnya
  // ikut sub-menu tersebut, mis. /stok/opname/:id → /stok/opname).
  const anak = [...(induk.anak ?? [])]
    .sort((a, b) => b.path.length - a.path.length)
    .find((a) =>
      a.path === induk.path
        ? pathname === a.path
        : pathname === a.path || pathname.startsWith(`${a.path}/`),
    );
  return anak?.path ?? induk.path;
}

/** Cocokkan lokasi saat ini dengan menu (sub-menu menang atas induknya). */
export function menuAktif(pathname: string): Pick<MenuItem, 'label' | 'deskripsi'> | undefined {
  const induk = grupPemilik(pathname);
  if (!induk) return undefined;
  // Sub-menu hanya cocok persis: /penjualan/retur tidak boleh jatuh ke
  // "Riwayat Penjualan" yang path-nya berprefix sama — kecuali sub ber-flag
  // `lebar` (mis. Opname: /stok/opname/:id ikut aktif).
  const anak = induk.anak?.find(
    (a) => pathname === a.path || (a.lebar && pathname.startsWith(`${a.path}/`)),
  );
  return anak ?? induk;
}

/**
 * N7 — Hak akses laporan per peran:
 *  - Admin   : semua kategori laporan,
 *  - Manajer : semua kecuali Keuangan & Pajak,
 *  - Kasir   : hanya laporan Penjualan (miliknya sendiri di filter server).
 */
export const KATEGORI_KEUANGAN_PAJAK = ['keuangan', 'pajak'];

export function bolehLaporan(peran: Peran, kategori: string, hak?: Record<string, string[]>): boolean {
  // AX — bila matriks tersedia, sel Lihat pada Laporan menentukan semuanya.
  if (hak) return (hak['laporan'] ?? []).includes('lihat');
  if (peran === 'admin' || peran === 'akuntan') return true;
  if (peran === 'manajer') return !KATEGORI_KEUANGAN_PAJAK.includes(kategori);
  if (peran === 'gudang') return ['stok', 'opname', 'pembelian'].includes(kategori);
  // Peran kustom: kategori ditentukan matriks Hak Akses (server hanya
  // memeriksa izin modul Laporan), bukan aturan bawaan lima peran.
  if (peran === 'lainnya') return true;
  return kategori === 'penjualan';
}

/** Kategori kode sub-menu laporan ("laporan-stok" → "stok"). */
function kategoriSubLaporan(kode: string): string {
  return kode.replace(/^laporan-/, '');
}

/**
 * Z6 — Gerbang rute per peran: sidebar menyembunyikan menu yang tidak boleh
 * dibuka, dan rutenya ikut diblokir (dialihkan ke halaman awal peran).
 * Satu sumber data (`menuUntukPeran`) menggerakkan keduanya sehingga tidak
 * ada lagi tab/halaman yang "kehilangan" pasangannya.
 *
 * Pengecualian yang selalu diizinkan:
 *  - `/` (beranda/redirect halaman awal peran),
 *  - `/pengaturan/halaman-awal` (alamat lama — dialihkan ke halaman
 *    Pengguna & Hak Akses; peran kini datang dari sesi Log In).
 */
export function ruteDiizinkan(peran: Peran, pathname: string, hak?: Record<string, string[]>): boolean {
  if (pathname === '/') return true;
  if (pathname === '/pengaturan/halaman-awal') return true;

  const induk = grupPemilik(pathname);
  // Bukan grup mana pun (mis. /pos/* yang di luar shell) → biarkan halaman
  // sendiri yang menentukan (termasuk rute 404).
  if (!induk) return true;

  // TAHAP 2 — modul yang dicabut lewat matriks Hak Akses ikut diblokir di sini
  // (sidebar sudah menyembunyikannya; URL langsung tetap ditolak).
  const modulInduk = MODUL_ATAS[induk.kode] ?? null;
  if (!bolehModul(hak, modulInduk)) return false;

  const menu = menuUntukPeran(peran, hak);
  const tampil = menu.find((m) => m.kode === induk.kode);
  if (!tampil) return false;

  if (!induk.anak?.length) return true;

  // Sub-halaman spesifik: harus termasuk sub-menu yang tampil untuk peran ini.
  const anak = induk.anak.find(
    (a) => pathname === a.path || (a.lebar && pathname.startsWith(`${a.path}/`)),
  );
  // Turunan tanpa sub-menu eksplisit (mis. /laporan/l/:kode) → ikut grup.
  if (!anak) return true;
  if (!bolehModul(hak, modulAnak(anak.kode, modulInduk))) return false;
  return (tampil.anak ?? []).some((a) => a.kode === anak.kode);
}

/**
 * Menu yang terlihat untuk sebuah peran (R1/M6/N7).
 * Modul login belum ada — peran dipilih manual di Pengaturan, dan penyaringan
 * ini berlaku di sidebar. Menu yang tidak boleh diakses peran disembunyikan:
 *  - Kasir     : hanya Penjualan ▸ dua mode POS (contoh pada spesifikasi),
 *  - Staf Gudang & Kasir: tanpa Akuntansi; laporan disaring per kategori,
 *  - Admin/Manajer/Akuntan: semua menu.
 */
export function menuUntukPeran(peran: Peran, hak?: Record<string, string[]>): MenuItem[] {
  // TAHAP 2 — bila matriks sesi tersedia, matriks itulah sumber kebenaran:
  // menu yang dicentang Admin harus benar-benar tampil, dan yang dicabut
  // hilang. Aturan bawaan per peran hanya dipakai tanpa matriks (pemanggilan
  // lama) supaya perilaku lawas tidak berubah.
  const pakaiMatriks = Boolean(hak);
  const dasar = MENU.flatMap((m) => {
    // H6 — Kasir & Staf Gudang tidak bisa membuka menu Akuntansi.
    if (!pakaiMatriks && m.kode === 'akuntansi' && (peran === 'kasir' || peran === 'gudang')) return [];
    if (m.kode === 'laporan') {
      const anak = (m.anak ?? []).filter((a) =>
        bolehLaporan(peran, kategoriSubLaporan(a.kode), hak),
      );
      return anak.length ? [{ ...m, anak }] : [];
    }
    // R1 — Kasir hanya melihat Penjualan > POS (tanpa matriks).
    if (!pakaiMatriks && peran === 'kasir') {
      if (m.kode !== 'penjualan') return [];
      return [
        {
          ...m,
          anak: (m.anak ?? []).filter((a) =>
            ['penjualan-pos-foto', 'penjualan-pos-cepat'].includes(a.kode),
          ),
        },
      ];
    }
    return [m];
  });

  // TAHAP 2 — irisan dengan matriks hak akses peran (sesi login):
  // modul tanpa aksi `lihat` disembunyikan dari sidebar; sub-menu terkunci
  // per modulnya (Opname → 'opname', POS → 'pos'). Tanpa matriks, filter ini
  // tidak berubah sehingga perilaku lama tetap sama.
  return dasar
    .filter((m) => bolehModul(hak, MODUL_ATAS[m.kode] ?? null))
    .map((m) =>
      m.anak
        ? {
            ...m,
            anak: m.anak.filter((a) =>
              bolehModul(hak, modulAnak(a.kode, MODUL_ATAS[m.kode] ?? null)),
            ),
          }
        : m,
    );
}
