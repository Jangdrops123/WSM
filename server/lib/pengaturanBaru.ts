// Registry Pengaturan baru (BAGIAN tab Grup Umum & Grup Transaksi).
//
// Satu sumber kebenaran untuk: bentuk form (bidang, tipe, bawaan), cakupan
// (per database / per toko), validasi, dan pembacaan–penulisan nilai.
//
// Nilai disimpan di tabel `settings` yang sudah ada. Sebagian bidang menumpang
// pada KUNCI LAMA (mis. `mata_uang`, `stok_minus_izinkan`, `akuntansi_ppn`) supaya
// pengaturan langsung menggerakkan perilaku aplikasi tanpa perlu diubah
// di banyak tempat.
import { get, getSettings, nextDocumentSequence, run, withTransaction } from '../db.pg.ts';
import { tolak } from './http.ts';
import { zonaValid } from './zonaWaktu.ts';

/* ------------------------------- TIPE ----------------------------------- */

export type TipeBidang =
  | 'teks'
  | 'teks_panjang'
  | 'angka'
  | 'bilangan'
  | 'bool'
  | 'pilihan'
  | 'warna'
  | 'gambar'
  | 'daftar'
  | 'penomoran'
  | 'tautan'
  | 'catatan';

export interface Bidang {
  kunci: string;
  label: string;
  tipe: TipeBidang;
  /** Nilai bawaan — dipakai saat baris settings belum ada & saat reset. */
  bawaan?: unknown;
  opsi?: { nilai: string; label: string }[];
  ket?: string;
  satuan?: string;
  min?: number;
  max?: number;
  wajib?: boolean;
  /** Cakupan berbeda dari tab-nya (penanda "bisa diatur berbeda tiap toko"). */
  cakupan?: 'db' | 'toko';
  /** Pilihan dinamis dari endpoint (mis. daftar satuan/gudang). */
  opsiUrl?: string;
  /** Token yang tersedia untuk pratinjau nomor dokumen. */
  token?: string[];
  pratinjau?: boolean;
  /**
   * Tulis–baca ke baris `settings` lama agar pengaturan benar-benar
   * menggerakkan aplikasi. `akuntansi_ppn::aktif` = properti `aktif`
   * di dalam JSON pada kunci `akuntansi_ppn`.
   */
  kunciLama?: string;
  /** Penanda per toko pada tabel daftar (tab Data Toko & Gudang). */
  perToko?: boolean;
  /** Peringatan dampak yang harus dibaca pengguna sebelum menyimpan. */
  dampak?: string;
  /** Tautan ke halaman lain (untuk tab yang isinya ada di modul lain). */
  ke?: string;
  /** Layanan luar yang belum tersambung — tampil nonaktif dengan petunjuk. */
  nonaktif?: string;
}

export interface TabPengaturan {
  kode: string;
  grup: 'umum' | 'transaksi' | 'keuangan' | 'sistem' | 'lain';
  label: string;
  ket?: string;
  cakupan: 'db' | 'toko';
  bidang: Bidang[];
  /** Komponen khusus di klien (mis. tabel toko, pratinjau label). */
  kustom?: string;
  /** Peringatan dampak sebelum menyimpan tab ini. */
  dampak?: string;
  /** Tab ini hanya menampilkan informasi (tidak ada yang bisa diubah). */
  informatif?: boolean;
}

export const GRUP = [
  { kode: 'umum', label: 'Grup Umum' },
  { kode: 'transaksi', label: 'Grup Transaksi' },
  { kode: 'keuangan', label: 'Grup Keuangan' },
  { kode: 'sistem', label: 'Keamanan & Sistem' },
  { kode: 'lain', label: 'Lainnya' },
] as const;

/* ------------------------- JENIS NOMOR DOKUMEN --------------------------- */

export interface JenisNomor {
  kode: string;
  label: string;
  /** Awalan huruf yang selama ini dipakai (tetap jadi nilai bawaan {KODE}). */
  prefix: string;
  /** Pengaturan `faktur_prefix_*` — bila ada, dipakai menggantikan `prefix`. */
  prefixDari?: string;
  format: string;
  digit: number;
  reset: 'tidak_pernah' | 'tahun' | 'bulan';
  /** Dasar kunci counter (harus persis lama agar nomor tetap sambung). */
  dasarKunci?: string;
}

export const JENIS_NOMOR: JenisNomor[] = [
  {
    kode: 'penjualan', label: 'Faktur Penjualan', prefix: 'INV', prefixDari: 'faktur_prefix_penjualan',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun',
  },
  {
    kode: 'pembelian', label: 'Pesanan Pembelian', prefix: 'PB',
    format: '{KODE}-{TAHUN}-{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'po', label: 'Purchase Order (PO)', prefix: 'PO',
    format: '{KODE}-{TAHUN}{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'penerimaan', label: 'Penerimaan Barang (GRN)', prefix: 'GRN',
    format: '{KODE}-{TAHUN}-{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'faktur_pembelian', label: 'Faktur Pembelian', prefix: 'PB', prefixDari: 'faktur_prefix_pembelian',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun',
  },
  {
    kode: 'faktur_pemasok', label: 'Faktur Pemasok (tanpa no. sendiri)', prefix: 'FP',
    format: '{KODE}-{TAHUN}-{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'surat_jalan', label: 'Surat Jalan / Penjualan POS', prefix: 'SJ',
    format: '{KODE}-{TAHUN}-{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'retur', label: 'Retur Penjualan (POS)', prefix: 'RET',
    format: '{KODE}-{TAHUN}-{BULAN}-{NOMOR}', digit: 4, reset: 'bulan',
  },
  {
    kode: 'item_masuk', label: 'Item Masuk', prefix: 'PSM',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun', dasarKunci: 'persediaan-masuk',
  },
  {
    kode: 'item_keluar', label: 'Item Keluar', prefix: 'PSK',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun', dasarKunci: 'persediaan-keluar',
  },
  {
    kode: 'opname', label: 'Opname Persediaan', prefix: 'OPN',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun', dasarKunci: 'opname',
  },
  {
    kode: 'transfer', label: 'Transfer Gudang', prefix: 'TRF',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun', dasarKunci: 'transfer',
  },
  {
    kode: 'jurnal', label: 'Jurnal Umum', prefix: 'JU',
    format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun', dasarKunci: 'jurnal',
  },
];

export const TOKEN_NOMOR = ['{KODE}', '{KODE_TOKO}', '{TAHUN}', '{BULAN}', '{NOMOR}'];

/* ------------------------- KARTU DASHBOARD ------------------------------- */

export const KARTU_DASHBOARD_PENGATURAN = [
  { kode: 'pintasan', label: 'Pintasan Modul' },
  { kode: 'kpi-penjualan', label: 'KPI Penjualan Hari Ini' },
  { kode: 'kpi-transaksi', label: 'KPI Transaksi Hari Ini' },
  { kode: 'kpi-laba', label: 'KPI Laba Hari Ini' },
  { kode: 'kpi-stok', label: 'KPI Nilai Stok' },
  { kode: 'kpi-piutang', label: 'KPI Piutang Belum Lunas' },
  { kode: 'kpi-menipis', label: 'KPI Stok Menipis' },
  { kode: 'pengingat', label: 'Pengingat Faktur Jatuh Tempo' },
  { kode: 'grafik-7hari', label: 'Grafik 7 Hari' },
  { kode: 'grafik-metode', label: 'Grafik Metode Bayar' },
  { kode: 'grafik-terlaris', label: 'Grafik Produk Terlaris' },
  { kode: 'grafik-vs', label: 'Grafik Perbandingan' },
  { kode: 'tabel-transaksi', label: 'Tabel Transaksi Terbaru' },
  { kode: 'tabel-menipis', label: 'Tabel Stok Menipis' },
];

/* ------------------------------ REGISTRY -------------------------------- */

const OP = (v: string[]) => v.map((x) => ({ nilai: x, label: x }));

export const TAB_PENGATURAN: TabPengaturan[] = [
  /* ========================== GRUP UMUM ================================ */
  // Y2.1 — Identitas Aplikasi: urutan paling atas (ditempatkan khusus di grup
  // "Pengaturan Dasar" pada navigasi kiri — lihat PengaturanLayout).
  // Seluruh isinya dirender panel khusus (kustom 'identitas').
  {
    kode: 'identitas-aplikasi', grup: 'umum', label: 'Identitas Aplikasi', cakupan: 'db',
    kustom: 'identitas',
    ket: 'Nama, tagline, dan logo aplikasi (sidebar, Log In, judul tab, favicon).',
    bidang: [],
  },
  {
    kode: 'profil-usaha', grup: 'umum', label: 'Profil Usaha', cakupan: 'db',
    ket: 'Tampil di faktur, struk, dan cetakan laporan.',
    bidang: [
      // Y2.2 — hubungan dengan Identitas Aplikasi: tautan langsung ke sana.
      { kunci: 'logo_aplikasi', label: 'Ubah logo aplikasi di Identitas Aplikasi', tipe: 'tautan', bawaan: '', ke: '/pengaturan/t/identitas-aplikasi', ket: 'Identitas Aplikasi mengatur tampilan aplikasi (sidebar, Log In, tab, layar muat). Data di bawah ini tetap terpisah untuk dokumen, kecuali opsi "Pakai logo dan nama ini juga untuk faktur dan struk" di Identitas Aplikasi aktif.' },
      { kunci: 'nama_usaha', label: 'Nama Usaha', tipe: 'teks', bawaan: '', wajib: true, max: 160, kunciLama: 'nama_usaha' },
      { kunci: 'logo_usaha', label: 'Logo', tipe: 'gambar', bawaan: '', ket: 'URL gambar logo yang tampil di faktur/struk.', kunciLama: 'logo_usaha' },
      { kunci: 'alamat_usaha', label: 'Alamat', tipe: 'teks_panjang', bawaan: '', max: 400, kunciLama: 'alamat_usaha' },
      { kunci: 'kota_usaha', label: 'Kota', tipe: 'teks', bawaan: '', max: 80 },
      { kunci: 'telepon_usaha', label: 'Telepon', tipe: 'teks', bawaan: '', max: 40, kunciLama: 'telepon_usaha' },
      { kunci: 'email_usaha', label: 'Email', tipe: 'teks', bawaan: '', max: 120 },
      { kunci: 'npwp_usaha', label: 'NPWP', tipe: 'teks', bawaan: '', max: 40, ket: 'Nomor Pokok Wajib Pajak yang tampil di faktur.' },
      { kunci: 'rekening_bank', label: 'Rekening Bank', tipe: 'teks_panjang', bawaan: '', max: 200, ket: 'Contoh: BCA 1234567890 a.n. Nama Usaha — tampil di faktur.' },
      { kunci: 'tanda_tangan', label: 'Tanda Tangan Digital', tipe: 'gambar', bawaan: '', ket: 'URL gambar tanda tangan untuk kolom tanda tangan faktur.' },
      { kunci: 'stempel', label: 'Stempel Digital', tipe: 'gambar', bawaan: '', ket: 'URL gambar stempel yang tampil di faktur.' },
    ],
  },
  {
    kode: 'toko-gudang', grup: 'umum', label: 'Data Toko & Gudang', cakupan: 'toko', kustom: 'toko',
    ket: 'Daftar toko & gudang. Pengaturan bertanda "Per toko" bisa berbeda tiap toko.',
    bidang: [
      { kunci: 'toko_bawaan', label: 'Toko Bawaan', tipe: 'pilihan', bawaan: '', opsi: [], opsiUrl: '/api/pengaturan/toko/opsi', ket: 'Toko yang dipakai saat aplikasi dibuka.', cakupan: 'db' },
      { kunci: 'gudang_bawaan', label: 'Gudang Bawaan', tipe: 'pilihan', bawaan: '', opsi: [], opsiUrl: '/api/master/gudang/opsi', ket: 'Gudang tujuan bawaan transaksi & laporan.', kunciLama: 'gudang_bawaan', cakupan: 'db' },
    ],
  },
  {
    kode: 'umum-regional', grup: 'umum', label: 'Umum & Regional', cakupan: 'db',
    bidang: [
      { kunci: 'mata_uang', label: 'Mata Uang', tipe: 'teks', bawaan: 'IDR', max: 10, kunciLama: 'mata_uang', ket: 'Kode mata uang (IDR, USD, …).' },
      { kunci: 'pemisah_ribuan', label: 'Pemisah Ribuan', tipe: 'pilihan', bawaan: '.', opsi: OP(['.', ',', ' ', 'tanpa']) },
      { kunci: 'pemisah_desimal', label: 'Pemisah Desimal', tipe: 'pilihan', bawaan: ',', opsi: OP([',', '.', 'tanpa']) },
      { kunci: 'jumlah_desimal', label: 'Jumlah Desimal', tipe: 'angka', bawaan: 0, min: 0, max: 4, satuan: 'angka' },
      { kunci: 'format_tanggal', label: 'Format Tanggal', tipe: 'pilihan', bawaan: 'DD/MM/YYYY', opsi: OP(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY']), kunciLama: 'format_tanggal' },
      { kunci: 'format_jam', label: 'Format Jam', tipe: 'pilihan', bawaan: '24', opsi: [{ nilai: '24', label: '24 jam (14:30)' }, { nilai: '12', label: '12 jam (2:30 PM)' }] },
      { kunci: 'zona_waktu', label: 'Zona Waktu', tipe: 'teks', bawaan: 'Asia/Jakarta', max: 40, ket: 'Contoh: Asia/Jakarta (WIB), Asia/Makassar (WITA), Asia/Jayapura (WIT).' },
      { kunci: 'bahasa', label: 'Bahasa', tipe: 'pilihan', bawaan: 'id', opsi: [{ nilai: 'id', label: 'Bahasa Indonesia' }, { nilai: 'en', label: 'English' }] },
      { kunci: 'awal_minggu', label: 'Awal Minggu', tipe: 'pilihan', bawaan: 'senin', opsi: [{ nilai: 'senin', label: 'Senin' }, { nilai: 'minggu', label: 'Minggu' }] },
      { kunci: 'satuan_bawaan', label: 'Satuan Bawaan', tipe: 'pilihan', bawaan: '', opsi: [], opsiUrl: '/api/master/satuan/opsi' },
      { kunci: 'pembulatan', label: 'Pembulatan', tipe: 'pilihan', bawaan: 'tanpa', opsi: [{ nilai: 'tanpa', label: 'Tanpa pembulatan' }, { nilai: '100', label: 'Ke 100' }, { nilai: '500', label: 'Ke 500' }, { nilai: '1000', label: 'Ke 1.000' }] },
    ],
  },
  {
    kode: 'dashboard', grup: 'umum', label: 'Dashboard', cakupan: 'db', kustom: 'kartu',
    bidang: [
      { kunci: 'kartu', label: 'Kartu yang Tampil & Urutannya', tipe: 'daftar', bawaan: KARTU_DASHBOARD_PENGATURAN.map((k) => k.kode), ket: 'Baris pertama = tampil paling atas. Nonaktifkan kartu yang tidak dipakai.' },
      { kunci: 'rentang_waktu_bawaan', label: 'Rentang Waktu Bawaan', tipe: 'pilihan', bawaan: '30', opsi: OP(['7', '30', '90', 'tahun']) },
      { kunci: 'pengingat_jatuh_tempo_hari', label: 'Pengingat Faktur — hari sebelum jatuh tempo', tipe: 'angka', bawaan: 3, min: 0, max: 90, satuan: 'hari', kunciLama: 'pengingat_jatuh_tempo_hari' },
      { kunci: 'pengingat_terlambat_harian', label: 'Ingatkan faktur terlambat setiap hari', tipe: 'bool', bawaan: true, kunciLama: 'pengingat_terlambat_harian' },
    ],
  },
  {
    kode: 'tampilan', grup: 'umum', label: 'Tampilan', cakupan: 'db', kustom: 'tampilan',
    bidang: [
      { kunci: 'tema', label: 'Tema', tipe: 'pilihan', bawaan: 'sistem', opsi: [{ nilai: 'terang', label: 'Terang' }, { nilai: 'gelap', label: 'Gelap' }, { nilai: 'sistem', label: 'Ikuti Sistem' }], kunciLama: 'tema' },
      { kunci: 'aksen', label: 'Warna Aksen', tipe: 'pilihan', bawaan: '', opsi: [{ nilai: '', label: 'Otomatis' }, { nilai: 'biru', label: 'Biru' }, { nilai: 'indigo', label: 'Indigo' }, { nilai: 'hijau', label: 'Hijau' }, { nilai: 'oranye', label: 'Oranye' }], kunciLama: 'aksen' },
      { kunci: 'kepadatan', label: 'Kepadatan Tampilan', tipe: 'pilihan', bawaan: 'nyaman', ket: 'Mengatur jarak: tinggi baris tabel, padding kartu, dan jarak antar blok — BUKAN ukuran font.', opsi: [{ nilai: 'nyaman', label: 'Nyaman (bawaan)' }, { nilai: 'padat', label: 'Padat — baris tabel rapat' }, { nilai: 'longgar', label: 'Longgar — baris tabel lega' }, { nilai: 'normal', label: 'Normal (lama)' }, { nilai: 'ringkas', label: 'Ringkas (lama)' }] },
      { kunci: 'ukuran_font', label: 'Ukuran Font', tipe: 'pilihan', bawaan: '100', ket: 'Berlaku ke seluruh teks, ikon, tombol, tabel, pop up, dan grafik. Cetak/PDF tidak terpengaruh.', opsi: [{ nilai: '80', label: 'Sangat kecil (80%)' }, { nilai: '87', label: 'Kecil (87%)' }, { nilai: '100', label: 'Normal (100%)' }, { nilai: '112', label: 'Besar (112%)' }, { nilai: '125', label: 'Sangat besar (125%)' }, { nilai: 'kustom', label: 'Kustom (slider 75–150%)' }] },
      { kunci: 'ukuran_font_kustom', label: 'Ukuran Font — persentase kustom', tipe: 'angka', bawaan: 100, min: 75, max: 150, satuan: '%', ket: 'Dipakai bila Ukuran Font = Kustom — geser di kartu pratinjau, langkah 1%.' },
      { kunci: 'sidebar_ciut', label: 'Menu Sidebar — ciutkan otomatis', tipe: 'bool', bawaan: false, ket: 'Sidebar menyusut otomatis saat layar sempit.' },
      { kunci: 'sidebar_tampilan', label: 'Warna Sidebar', tipe: 'pilihan', bawaan: 'gelap', opsi: [{ nilai: 'gelap', label: 'Gelap' }, { nilai: 'terang', label: 'Terang' }], kunciLama: 'sidebar_tampilan' },
      { kunci: 'tampilan_cakupan', label: 'Berlaku untuk', tipe: 'pilihan', bawaan: 'semua', ket: 'Pengaturan per akun menimpa pengaturan global (database). Admin mengatur nilai global; akun lain mengatur miliknya.', opsi: [{ nilai: 'semua', label: 'Semua pengguna (database)' }, { nilai: 'akun', label: 'Hanya akun saya' }] },
    ],
  },

  /* ======================== GRUP TRANSAKSI ============================= */
  {
    kode: 'penomoran', grup: 'transaksi', label: 'Penomoran Dokumen', cakupan: 'db',
    ket: 'Token: {KODE} {KODE_TOKO} {TAHUN} {BULAN} {NOMOR}.',
    bidang: JENIS_NOMOR.map((j) => ({
      kunci: j.kode,
      label: j.label,
      tipe: 'penomoran' as const,
      bawaan: { format: j.format, digit: j.digit, reset: j.reset },
      token: TOKEN_NOMOR,
      pratinjau: true,
      ket: `Awalan bawaan ${j.prefix}.`,
    })),
  },
  {
    kode: 'pajak', grup: 'transaksi', label: 'Pajak', cakupan: 'db',
    bidang: [
      { kunci: 'ppn_aktif', label: 'PPN aktif', tipe: 'bool', bawaan: false, kunciLama: 'akuntansi_ppn::aktif' },
      { kunci: 'ppn_tarif', label: 'Tarif PPN', tipe: 'bilangan', bawaan: 11, min: 0, max: 100, satuan: '%', kunciLama: 'akuntansi_ppn::tarif' },
      { kunci: 'ppn_sudah_termasuk', label: 'Harga sudah termasuk pajak', tipe: 'bool', bawaan: false, kunciLama: 'akuntansi_ppn::harga_termasuk' },
      { kunci: 'pembulatan_pajak', label: 'Pembulatan pajak', tipe: 'pilihan', bawaan: 'tanpa', opsi: [{ nilai: 'tanpa', label: 'Tanpa pembulatan' }, { nilai: '100', label: 'Ke 100' }, { nilai: '1000', label: 'Ke 1.000' }] },
      { kunci: 'pajak_lain_nama', label: 'Pajak lain (opsional)', tipe: 'teks', bawaan: '', max: 60, ket: 'Kosongkan bila tidak dipakai.' },
      { kunci: 'pajak_lain_tarif', label: 'Tarif pajak lain', tipe: 'bilangan', bawaan: 0, min: 0, max: 100, satuan: '%' },
      { kunci: 'tampil_di_faktur', label: 'Tampilkan rincian pajak di faktur', tipe: 'bool', bawaan: true },
      { kunci: 'tampil_di_struk', label: 'Tampilkan rincian pajak di struk', tipe: 'bool', bawaan: true },
    ],
  },
  {
    kode: 'penjualan-pos', grup: 'transaksi', label: 'Penjualan & POS', cakupan: 'toko',
    bidang: [
      { kunci: 'pos_mode_bawaan', label: 'Mode POS bawaan', tipe: 'pilihan', bawaan: 'foto', opsi: [{ nilai: 'foto', label: 'Foto' }, { nilai: 'tanpa_foto', label: 'Tanpa Foto' }] },
      // Rasio gambar kartu: preferensi tampilan global (dibaca /api/pos/produk),
      // bukan per toko — sama seperti stok_minus_izinkan di tab ini.
      { kunci: 'pos_foto_rasio', label: 'Rasio foto kartu (Mode Foto)', tipe: 'pilihan', bawaan: '1/1', opsi: [{ nilai: '1/1', label: 'Persegi 1:1' }, { nilai: '4/3', label: 'Lanskap 4:3' }], ket: 'Bentuk gambar pada kartu produk di POS Mode Foto.', cakupan: 'db' },
      { kunci: 'harga_bawaan', label: 'Harga bawaan di kasir', tipe: 'pilihan', bawaan: 'eceran', opsi: [{ nilai: 'eceran', label: 'Eceran' }, { nilai: 'grosir', label: 'Grosir' }] },
      { kunci: 'izinkan_diskon', label: 'Izinkan diskon di kasir', tipe: 'bool', bawaan: true },
      { kunci: 'diskon_maks_persen', label: 'Maksimum diskon', tipe: 'bilangan', bawaan: 100, min: 0, max: 100, satuan: '%' },
      { kunci: 'izinkan_ubah_harga', label: 'Izinkan ubah harga di kasir', tipe: 'bool', bawaan: false },
      { kunci: 'stok_minus_izinkan', label: 'Izinkan stok minus', tipe: 'bool', bawaan: true, kunciLama: 'stok_minus_izinkan', cakupan: 'db' },
      { kunci: 'metode_bayar', label: 'Metode bayar (nama & akun kas/bank)', tipe: 'daftar', bawaan: ['tunai|Tunai', 'transfer|Transfer', 'qris|QRIS', 'kartu|Kartu', 'tempo|Tempo/Kredit'], ket: 'Satu baris = kode|nama. Urutan = urutan tombol di kasir.' },
      { kunci: 'izinkan_kembalian', label: 'Hitung kembalian tunai', tipe: 'bool', bawaan: true },
      { kunci: 'cetak_otomatis', label: 'Cetak nota otomatis setelah simpan', tipe: 'bool', bawaan: false, kunciLama: 'struk_cetak_otomatis' },
      { kunci: 'kirim_wa_otomatis', label: 'Kirim struk otomatis via WhatsApp', tipe: 'bool', bawaan: false },
      { kunci: 'piutang_jatuh_tempo_hari', label: 'Jatuh tempo piutang bawaan', tipe: 'angka', bawaan: 30, min: 0, max: 365, satuan: 'hari' },
    ],
  },
  {
    kode: 'pembelian-wms', grup: 'transaksi', label: 'Pembelian & Inbound (WMS)', cakupan: 'db',
    bidang: [
      { kunci: 'metode_input_bawaan', label: 'Metode input bawaan', tipe: 'pilihan', bawaan: 'biasa', opsi: [{ nilai: 'biasa', label: 'Biasa' }, { nilai: 'scan', label: 'Scan Barcode' }, { nilai: 'chat', label: 'Chatbot' }] },
      { kunci: 'isi_per_box', label: 'Isi per box bawaan', tipe: 'angka', bawaan: 20, min: 1, max: 1000, satuan: 'pcs', ket: 'Dipakai saat menghitung konversi box → pcs.' },
      { kunci: 'isi_per_kodi', label: 'Isi per kodi (modul Purchase)', tipe: 'angka', bawaan: 20, min: 1, max: 1000, satuan: 'pcs', ket: 'Dipakai modul Purchase: 1 kodi = N pcs. Berlaku untuk semua PO.', kunciLama: 'isi_per_kodi', cakupan: 'db' },
      { kunci: 'enable_kodi_conversion', label: 'Tampilkan konversi kodi di Purchase', tipe: 'bool', bawaan: true, kunciLama: 'enable_kodi_conversion', ket: 'Aktif: kolom Kodi tampil sebagai konverter otomatis (1 kodi = N pasang). Nonaktif: kolom Kodi disembunyikan, fokus hanya pada Pasang/Pcs.', cakupan: 'db' },
      { kunci: 'wajib_revisi_varian', label: 'Wajib revisi size/warna sebelum disahkan', tipe: 'bool', bawaan: true },
      { kunci: 'wajib_pengesahan_masuk', label: 'Wajib pengesahan sebelum masuk gudang', tipe: 'bool', bawaan: true },
      { kunci: 'hutang_jatuh_tempo_hari', label: 'Jatuh tempo hutang bawaan', tipe: 'angka', bawaan: 30, min: 0, max: 365, satuan: 'hari' },
      { kunci: 'penempatan_otomatis', label: 'Penempatan rak/bin otomatis', tipe: 'bool', bawaan: true, ket: 'Barang baru ditempatkan ke lokasi kosong yang tersedia.' },
    ],
  },
  {
    kode: 'persediaan-stok', grup: 'transaksi', label: 'Persediaan & Stok', cakupan: 'db',
    bidang: [
      { kunci: 'metode_hpp', label: 'Metode HPP', tipe: 'pilihan', bawaan: 'rata_rata', opsi: [{ nilai: 'rata_rata', label: 'Rata-rata bergerak' }, { nilai: 'fifo', label: 'FIFO' }], ket: 'Biaya barang terjual dihitung memakai metode ini.' },
      { kunci: 'stok_minus_izinkan', label: 'Izinkan stok minus (global)', tipe: 'bool', bawaan: true, kunciLama: 'stok_minus_izinkan' },
      { kunci: 'stok_minimum_batas', label: 'Batas stok minimum (peringatan)', tipe: 'angka', bawaan: 5, min: 0, max: 100000, satuan: 'unit' },
      { kunci: 'daftar_satuan', label: 'Satuan & konversi', tipe: 'daftar', bawaan: ['pcs', 'lusin', 'kodi', 'box'], ket: 'Satu baris satu satuan, sesuai yang ada di Master ▸ Satuan.' },
      { kunci: 'daftar_size', label: 'Daftar size', tipe: 'daftar', bawaan: ['S', 'M', 'L', 'XL', 'XXL'] },
      { kunci: 'daftar_varian', label: 'Daftar warna/varian', tipe: 'daftar', bawaan: ['Hitam', 'Putih', 'Merah', 'Biru', 'Abu-abu'] },
      { kunci: 'aturan_varian', label: 'Aturan Double/Tanpa', tipe: 'pilihan', bawaan: 'double', opsi: [{ nilai: 'double', label: 'Double (size × warna)' }, { nilai: 'tanpa', label: 'Tanpa (hanya kode produk)' }], ket: 'Sesuai Pengaturan ▸ Aturan Kodi.' },
      { kunci: 'stok_valuasi', label: 'Nilai stok memakai', tipe: 'pilihan', bawaan: 'hpp', opsi: [{ nilai: 'hpp', label: 'HPP (harga pokok)' }, { nilai: 'jual', label: 'Harga jual' }] },
    ],
  },
  {
    kode: 'opname', grup: 'transaksi', label: 'Opname', cakupan: 'db',
    bidang: [
      { kunci: 'metode_bawaan', label: 'Metode bawaan', tipe: 'pilihan', bawaan: 'manual', opsi: [{ nilai: 'manual', label: 'Manual' }, { nilai: 'scan', label: 'Scan satu per satu' }] },
      { kunci: 'wajib_pengesahan', label: 'Wajib pengesahan opname', tipe: 'bool', bawaan: true },
      { kunci: 'toleransi_selisih', label: 'Toleransi selisih', tipe: 'bilangan', bawaan: 0, min: 0, max: 100, satuan: 'unit', ket: 'Selisih di atas angka ini wajib diberi keterangan.' },
      { kunci: 'batas_selisih_persen', label: 'Batas selisih impor Excel (%)', tipe: 'angka', bawaan: 10, min: 0, max: 100, satuan: '%', ket: 'Baris impor opname dengan selisih melebihi persentase ini (terhadap stok sistem) ditandai Peringatan.' },
      { kunci: 'kunci_transaksi', label: 'Kunci transaksi saat opname berjalan', tipe: 'bool', bawaan: true },
      { kunci: 'penyesuaian_otomatis', label: 'Penyesuaian stok otomatis setelah disahkan', tipe: 'bool', bawaan: true },
    ],
  },
  {
    kode: 'barcode-label', grup: 'transaksi', label: 'Barcode & Label', cakupan: 'db', kustom: 'label',
    bidang: [
      { kunci: 'format_barcode', label: 'Format barcode', tipe: 'pilihan', bawaan: 'code128', opsi: [{ nilai: 'code128', label: 'Code128' }, { nilai: 'ean13', label: 'EAN-13' }, { nilai: 'qr', label: 'QR Code' }] },
      { kunci: 'lebar_label', label: 'Ukuran label — lebar', tipe: 'bilangan', bawaan: 50, min: 20, max: 200, satuan: 'mm' },
      { kunci: 'tinggi_label', label: 'Ukuran label — tinggi', tipe: 'bilangan', bawaan: 30, min: 15, max: 200, satuan: 'mm' },
      { kunci: 'kolom_label', label: 'Jumlah kolom cetak', tipe: 'angka', bawaan: 3, min: 1, max: 8, satuan: 'kolom' },
      { kunci: 'margin_label', label: 'Margin', tipe: 'bilangan', bawaan: 2, min: 0, max: 20, satuan: 'mm' },
      { kunci: 'blok_label', label: 'Blok yang tampil di label', tipe: 'daftar', bawaan: ['nama', 'kode', 'size', 'harga'], ket: 'Pilihan: nama, kode, sku, size, warna, harga.' },
      { kunci: 'printer_thermal', label: 'Printer thermal roll', tipe: 'bool', bawaan: true },
      { kunci: 'barcode_otomatis', label: 'Buat barcode otomatis untuk produk baru', tipe: 'bool', bawaan: true },
    ],
  },
  {
    kode: 'printer-cetak', grup: 'transaksi', label: 'Printer & Cetak', cakupan: 'toko',
    bidang: [
      { kunci: 'printer_struk', label: 'Printer bawaan — struk', tipe: 'teks', bawaan: '', max: 120, ket: 'Kosongkan = printer bawaan perangkat.' },
      { kunci: 'printer_faktur', label: 'Printer bawaan — faktur', tipe: 'teks', bawaan: '', max: 120 },
      { kunci: 'printer_label', label: 'Printer bawaan — label', tipe: 'teks', bawaan: '', max: 120 },
      { kunci: 'ukuran_struk', label: 'Ukuran struk', tipe: 'pilihan', bawaan: '80mm', opsi: [{ nilai: '58mm', label: '58 mm' }, { nilai: '80mm', label: '80 mm' }], ket: 'Ikut menentukan profil struk yang dipakai di POS.' },
      { kunci: 'jumlah_salinan', label: 'Jumlah salinan cetak', tipe: 'angka', bawaan: 1, min: 1, max: 5, satuan: 'salinan' },
      { kunci: 'cetak_otomatis', label: 'Cetak otomatis setelah simpan', tipe: 'bool', bawaan: false, kunciLama: 'struk_cetak_otomatis', cakupan: 'db' },
    ],
  },

  /* ======================== GRUP KEUANGAN ============================== */
  {
    // Umpan balik scan — suara Web Audio + getar perangkat. Dipakai POS,
    // Pembelian, Buat PO, dan Barang Datang (GRN). 
    kode: 'suara-scan', grup: 'transaksi', label: 'Suara & Getar Scan', cakupan: 'db', kustom: 'suara-scan',
    ket: 'Umpan balik suara & getar saat memindai barcode/SKU di POS, Pembelian, PO, dan Barang Datang.',
    bidang: [
      { kunci: 'scan_suara_aktif', label: 'Aktifkan Suara Scan', tipe: 'bool', bawaan: true, ket: 'Bunyi instan tanpa menunggu server (Web Audio).' },
      { kunci: 'scan_getar_aktif', label: 'Aktifkan Efek Getar (perangkat mobile/tablet)', tipe: 'bool', bawaan: true, ket: 'Getar singkat saat berhasil, getar ganda saat gagal.' },
      { kunci: 'scan_suara_berhasil', label: 'Suara berhasil scan', tipe: 'pilihan', bawaan: 'beep-standar', opsi: [{ nilai: 'beep-standar', label: 'Beep Standar (Kasir)' }, { nilai: 'ting-chime', label: 'Ting / Chime Halus' }, { nilai: 'pop-modern', label: 'Pop Modern' }], ket: 'Dipakai bila file audio kustom berhasil kosong.' },
      // Base64 Data URL: 400 KB biner ≈ 547 ribu karakter, jadi batas simpan
      // dinaikkan (batas file tetap 400 KB di sisi unggahan).
      { kunci: 'scan_audio_berhasil', label: 'File audio kustom — berhasil', tipe: 'teks', bawaan: '', max: 800000, ket: 'URL .mp3/.wav atau unggahan lewat kartu Tes di atas. Kosongkan untuk memakai preset.' },
      { kunci: 'scan_audio_berhasil_nama', label: 'Nama file audio kustom — berhasil', tipe: 'teks', bawaan: '', max: 200, ket: 'Ditampilkan di kartu Tes setelah halaman dimuat ulang.' },
      { kunci: 'scan_suara_gagal', label: 'Suara gagal scan', tipe: 'pilihan', bawaan: 'buzz', opsi: [{ nilai: 'buzz', label: 'Buzz Peringatan' }, { nilai: 'double-beep', label: 'Double Beep Rendah' }, { nilai: 'error-tone', label: 'Error Tone' }], ket: 'Dipakai bila file audio kustom gagal kosong.' },
      { kunci: 'scan_audio_gagal', label: 'File audio kustom — gagal', tipe: 'teks', bawaan: '', max: 800000, ket: 'URL .mp3/.wav atau unggahan lewat kartu Tes di atas. Kosongkan untuk memakai preset.' },
      { kunci: 'scan_audio_gagal_nama', label: 'Nama file audio kustom — gagal', tipe: 'teks', bawaan: '', max: 200, ket: 'Ditampilkan di kartu Tes setelah halaman dimuat ulang.' },
      { kunci: 'scan_volume', label: 'Volume suara', tipe: 'angka', bawaan: 80, min: 0, max: 100, satuan: '%' },
    ],
  },
  {
    // AKUNTANSI DASAR — tab lama "Akuntansi" (periode buku, jurnal otomatis,
    // Laba Diganti "Kas & Bank": pemetaan metode bayar → rekening kas +
    // kategori biaya & pemasukan.
    kode: 'kas-bank', grup: 'keuangan', label: 'Kas & Bank', cakupan: 'db', kustom: 'kas',
    ket: 'Rekening kas/bank bawaan per metode bayar, dan kategori biaya & pemasukan.',
    bidang: [],
  },

  /* ==================== GRUP KEAMANAN & SISTEM ========================= */
  {
    kode: 'keamanan', grup: 'sistem', label: 'Keamanan', cakupan: 'db', kustom: 'keamanan',
    ket: 'Kebijakan sandi, percobaan masuk, sesi, dan Kode Pemulihan Admin.',
    bidang: [
      { kunci: 'sandi_min_panjang', label: 'Panjang minimum sandi', tipe: 'angka', bawaan: 8, min: 6, max: 64, satuan: 'karakter' },
      { kunci: 'sandi_wajib_huruf_angka', label: 'Wajib memuat huruf dan angka', tipe: 'bool', bawaan: true },
      { kunci: 'sandi_wajib_simbol', label: 'Wajib memuat simbol', tipe: 'bool', bawaan: false },
      { kunci: 'masuk_coba_maks', label: 'Batas percobaan Log In', tipe: 'angka', bawaan: 5, min: 1, max: 20, satuan: 'kali' },
      { kunci: 'masuk_terkunci_menit', label: 'Lama terkunci setelah batas tercapai', tipe: 'angka', bawaan: 15, min: 1, max: 1440, satuan: 'menit' },
      { kunci: 'sesi_menit', label: 'Sesi berakhir otomatis setelah', tipe: 'angka', bawaan: 480, min: 5, max: 10080, satuan: 'menit' },
      {
        kunci: 'kunci_perangkat_baru', label: 'Wajib Kode Pemulihan Admin untuk perangkat baru', tipe: 'bool', bawaan: false,
        ket: 'Saat modul Log In aktif, masuk dari perangkat baru perlu kode pemulihan.',
      },
    ],
  },
  {
    kode: 'pengguna', grup: 'sistem', label: 'Pengguna & Hak Akses', cakupan: 'db', kustom: 'pengguna', informatif: true,
    ket: 'Daftar pengguna, peran, dan matriks hak akses per tab Pengaturan.',
    bidang: [],
  },
  {
    kode: 'database', grup: 'sistem', label: 'Database & Backup', cakupan: 'db', kustom: 'database',
    ket: 'Info database, cadangan manual & terjadwal, pemulihan.',
    bidang: [
      { kunci: 'backup_otomatis', label: 'Backup otomatis terjadwal', tipe: 'pilihan', bawaan: 'mati', opsi: [{ nilai: 'mati', label: 'Mati' }, { nilai: '4jam', label: 'Per 4 jam' }, { nilai: '6jam', label: 'Per 6 jam' }, { nilai: '12jam', label: 'Per 12 jam' }, { nilai: 'harian', label: 'Harian' }, { nilai: 'mingguan', label: 'Mingguan (Senin)' }, { nilai: 'bulanan', label: 'Bulanan (tgl 1)' }, { nilai: 'kustom', label: 'Kustom (menit/jam)' }] },
      { kunci: 'backup_jam', label: 'Jam backup terjadwal', tipe: 'pilihan', bawaan: '02:00', opsi: OP(['00:00', '01:00', '02:00', '03:00', '22:00', '23:00']) },
      { kunci: 'interval_nilai', label: 'Interval kustom — nilai', tipe: 'angka', bawaan: 4, min: 1, max: 1440 },
      { kunci: 'interval_satuan', label: 'Satuan interval kustom', tipe: 'pilihan', bawaan: 'jam', opsi: [{ nilai: 'menit', label: 'Menit' }, { nilai: 'jam', label: 'Jam' }] },
      { kunci: 'jumlah_backup', label: 'Jumlah backup yang disimpan', tipe: 'angka', bawaan: 14, min: 1, max: 100, satuan: 'berkas' },
      { kunci: 'retensi_hari', label: 'Hapus otomatis backup lokal lebih tua dari', tipe: 'angka', bawaan: 30, min: 1, max: 365, satuan: 'hari', ket: 'Berlaku untuk cadangan manual & otomatis. Checkpoint pengaman tidak ikut dihapus.' },
      { kunci: 'backup_ota_penuh', label: 'Cadangkan juga folder foto produk', tipe: 'bool', bawaan: false, ket: 'Berkas foto bisa besar — aktifkan bila perlu salinan lengkap.' },
      {
        kunci: 'jadwal_ketersediaan', label: 'Catatan jadwal', tipe: 'catatan', bawaan: '',
        ket: 'Backup terjadwal dijalankan oleh proses server. Bila aplikasi dihentikan pada jam terjadwal, backup dibuat otomatis saat server dijalankan kembali.',
      },
    ],
  },
  {
    kode: 'impor-ekspor', grup: 'sistem', label: 'Impor & Ekspor', cakupan: 'db', kustom: 'impor',
    ket: 'Contoh file impor, aturan duplikat, dan riwayat impor.',
    bidang: [
      { kunci: 'duplikat_impor', label: 'Bila data sudah ada (duplikat)', tipe: 'pilihan', bawaan: 'tanya', opsi: [{ nilai: 'lewati', label: 'Lewati baris duplikat' }, { nilai: 'timpa', label: 'Timpa data lama' }, { nilai: 'tanya', label: 'Tanya tiap baris (pra-tinjau)' }] },
      { kunci: 'impor_konfirmasi_timpa', label: 'Konfirmasi sebelum menimpa data lama', tipe: 'bool', bawaan: true },
    ],
  },
  {
    kode: 'notifikasi', grup: 'sistem', label: 'Notifikasi & Pesan', cakupan: 'db', kustom: 'notifikasi',
    ket: 'Koneksi WhatsApp/email dan template pesan.',
    bidang: [
      {
        kunci: 'wa_aktif', label: 'Kirim struk & faktur via WhatsApp otomatis', tipe: 'bool', bawaan: false,
        kunciLama: 'wa_kirim_otomatis',
        nonaktif: 'WhatsApp otomatis memerlukan akun WhatsApp Business API (Cloud API). Saat ini pengiriman memakai tautan wa.me — kasir membuka WhatsApp secara manual.',
      },
      {
        kunci: 'wa_nomor_pengirim', label: 'Nomor WhatsApp pengirim', tipe: 'teks', bawaan: '', max: 25,
        nonaktif: 'Isi nomor setelah akun WhatsApp Business API tersambung.',
      },
      {
        kunci: 'smtp_aktif', label: 'Kirim email (faktur, reset password)', tipe: 'bool', bawaan: false,
        nonaktif: 'Pengirim email (SMTP) belum dikonfigurasi. Isi host, port, pengguna, dan kata sandi aplikasi email Anda lalu aktifkan.',
      },
      { kunci: 'smtp_host', label: 'Host SMTP', tipe: 'teks', bawaan: '', max: 120, nonaktif: 'Belum ada kredensial SMTP.' },
      { kunci: 'smtp_port', label: 'Port SMTP', tipe: 'angka', bawaan: 587, min: 1, max: 65535, satuan: 'port', nonaktif: 'Belum ada kredensial SMTP.' },
      { kunci: 'smtp_pengguna', label: 'Pengguna SMTP', tipe: 'teks', bawaan: '', max: 120, nonaktif: 'Belum ada kredensial SMTP.' },
      { kunci: 'smtp_sandi', label: 'Kata sandi aplikasi SMTP', tipe: 'teks', bawaan: '', max: 200, nonaktif: 'Belum ada kredensial SMTP.' },
      { kunci: 'template_faktur', label: 'Template pesan faktur', tipe: 'teks_panjang', bawaan: 'Halo {NAMA}, berikut faktur {NOMOR} sebesar {TOTAL}. Terima kasih.', max: 1000, ket: 'Variabel: {NAMA} {NOMOR} {TOTAL} {JATUH_TEMPO}' },
      { kunci: 'template_pengingat', label: 'Template pesan pengingat jatuh tempo', tipe: 'teks_panjang', bawaan: 'Halo {NAMA}, faktur {NOMOR} sebesar {TOTAL} jatuh tempo pada {JATUH_TEMPO}. Mohon pembayarannya.', max: 1000, ket: 'Variabel: {NAMA} {NOMOR} {TOTAL} {JATUH_TEMPO}' },
      { kunci: 'template_struk', label: 'Template pesan struk', tipe: 'teks_panjang', bawaan: 'Terima kasih {NAMA}. Struk {NOMOR} total {TOTAL}.', max: 1000, ket: 'Variabel: {NAMA} {NOMOR} {TOTAL}' },
      { kunci: 'pengingat_piutang_hari', label: 'Jadwal pengingat piutang (H hari sebelum jatuh tempo)', tipe: 'angka', bawaan: 3, min: 0, max: 90, satuan: 'hari' },
      { kunci: 'pengingat_hutang_hari', label: 'Jadwal pengingat hutang (H hari sebelum jatuh tempo)', tipe: 'angka', bawaan: 3, min: 0, max: 90, satuan: 'hari' },
    ],
  },
  {
    kode: 'log-aktivitas', grup: 'sistem', label: 'Log Aktivitas', cakupan: 'db', kustom: 'log',
    ket: 'Riwayat aktivitas: siapa, kapan, sebelum/sesudah.',
    bidang: [
      {
        kunci: 'log_simpan_bulan', label: 'Lama penyimpanan log', tipe: 'pilihan', bawaan: '12',
        opsi: OP(['3', '6', '12', '24', 'selamanya']), satuan: 'bulan',
        ket: 'Log yang lebih tua dari ini dibersihkan otomatis saat server dijalankan.',
      },
    ],
  },
  {
    kode: 'tentang', grup: 'sistem', label: 'Tentang Sistem', cakupan: 'db', kustom: 'tentang', informatif: true,
    ket: 'Versi aplikasi, nama database, dan ringkasan jumlah data.',
    bidang: [],
  },
];

const SET_KODE = new Set(TAB_PENGATURAN.map((t) => t.kode));

export function cariTab(kode: string): TabPengaturan {
  const t = TAB_PENGATURAN.find((x) => x.kode === kode);
  if (!t || !SET_KODE.has(kode)) throw tolak(404, `Tab pengaturan "${kode}" tidak ditemukan.`);
  return t;
}

/* --------------------------- BACA / TULIS ------------------------------- */

function bawaan(b: Bidang): unknown {
  return b.tipe === 'bool' ? b.bawaan === true : (b.bawaan ?? (b.tipe === 'daftar' ? [] : ''));
}

/** Kunci baris `settings` untuk satu bidang. */
export function kunciSimpan(tab: TabPengaturan, b: Bidang, toko?: string | null): string {
  const lama = b.kunciLama?.split('::')[0];
  if (lama) return lama;
  const dasar = `peng.${tab.kode}.${b.kunci}`;
  const cakupan = b.cakupan ?? tab.cakupan;
  return cakupan === 'toko' && toko ? `${dasar}@${toko}` : dasar;
}

/** Ubah nilai tersimpan (teks) menjadi tipe bidang. */
function uraikanNilai(b: Bidang, mentah: string | null | undefined): unknown {
  const m = mentah ?? null;
  if (m === null) return bawaan(b);
  switch (b.tipe) {
    case 'bool':
      return m === 'true' || m === '1';
    case 'angka': {
      const n = Number.parseInt(m, 10);
      return Number.isFinite(n) ? n : bawaan(b);
    }
    case 'bilangan': {
      const n = Number.parseFloat(m.replace(',', '.'));
      return Number.isFinite(n) ? n : bawaan(b);
    }
    case 'daftar':
      try {
        const j: unknown = JSON.parse(m);
        return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : bawaan(b);
      } catch {
        return bawaan(b);
      }
    case 'penomoran': {
      const def = bawaan(b) as { format: string; digit: number; reset: string };
      try {
        const j = JSON.parse(m) as Partial<{ format: string; digit: number; reset: string }>;
        return {
          format: typeof j.format === 'string' && j.format ? j.format : def.format,
          digit: Number.isFinite(Number(j.digit)) ? Math.min(12, Math.max(1, Number(j.digit))) : def.digit,
          reset: ['tidak_pernah', 'tahun', 'bulan'].includes(String(j.reset)) ? j.reset : def.reset,
        };
      } catch {
        return def;
      }
    }
    default:
      return m;
  }
}

/** Tulis nilai tipe bidang menjadi teks untuk kolom `settings.nilai`. */
function simpanNilai(b: Bidang, nilai: unknown): string {
  switch (b.tipe) {
    case 'bool':
      return nilai ? 'true' : 'false';
    case 'angka':
    case 'bilangan':
      return String(nilai ?? 0);
    case 'daftar':
      return JSON.stringify(Array.isArray(nilai) ? nilai : []);
    case 'penomoran':
      return JSON.stringify(nilai ?? {});
    default:
      return nilai === null || nilai === undefined ? '' : String(nilai);
  }
}

const bacaBaris = async (kunci: string): Promise<string | null> =>
  await ((await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', kunci)))?.nilai ?? null;

async function tulisBaris(kunci: string, nilai: string): Promise<void> {
  await run(
    `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    kunci,
    nilai,
  );
}

/** Baca semua nilai satu tab. */
export async function bacaTab(tab: TabPengaturan, toko?: string | null): Promise<Record<string, unknown>> {
  const s = await getSettings();
  const out: Record<string, unknown> = {};
  for (const b of tab.bidang) {
    if (b.kunciLama?.includes('::')) {
      const [kunci, prop] = b.kunciLama.split('::');
      let obj: Record<string, unknown> = {};
      try {
        obj = JSON.parse(s[kunci] || '{}') as Record<string, unknown>;
      } catch {
        obj = {};
      }
      const v = obj[prop!];
      out[b.kunci] = v === undefined || v === null ? bawaan(b) : b.tipe === 'bool' ? Boolean(v) : Number(v ?? 0);
      continue;
    }
    out[b.kunci] = uraikanNilai(b, s[kunciSimpan(tab, b, toko)]);
  }
  return out;
}

/** Nilai bawaan satu tab (untuk tombol "Kembalikan ke Bawaan"). */
export function bawaanTab(tab: TabPengaturan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const b of tab.bidang) out[b.kunci] = bawaan(b);
  return out;
}

/* ------------------------------ VALIDASI -------------------------------- */

export function validasi(tab: TabPengaturan, nilai: Record<string, unknown>): void {
  const masuk = Object.keys(nilai);
  const takDikenal = masuk.filter((k) => !tab.bidang.some((b) => b.kunci === k));
  if (takDikenal.length) throw tolak(400, `Bidang tidak dikenal: ${takDikenal.join(', ')}.`);

  for (const b of tab.bidang) {
    if (!(b.kunci in nilai)) continue;
    const v = nilai[b.kunci];
    const nama = `"${b.label}"`;
    // Zona Waktu wajib nama zona IANA valid agar konversi waktu konsisten.
    if (b.kunci === 'zona_waktu' && typeof v === 'string' && v.trim() !== '' && !zonaValid(v.trim())) {
      throw tolak(400, `${nama} harus nama zona valid, mis. Asia/Jakarta, Asia/Makassar, atau Asia/Jayapura.`);
    }
    switch (b.tipe) {
      case 'bool':
        if (typeof v !== 'boolean') throw tolak(400, `${nama} harus true/false.`);
        break;
      case 'angka':
      case 'bilangan': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw tolak(400, `${nama} harus berupa angka.`);
        if (b.min !== undefined && n < b.min) throw tolak(400, `${nama} minimal ${b.min}.`);
        if (b.max !== undefined && n > b.max) throw tolak(400, `${nama} maksimal ${b.max}.`);
        if (b.tipe === 'angka' && !Number.isInteger(n)) throw tolak(400, `${nama} harus bilangan bulat.`);
        break;
      }
      case 'pilihan': {
        const pilihan = (b.opsi ?? []).map((o) => o.nilai);
        if (pilihan.length && !pilihan.includes(String(v))) {
          throw tolak(400, `${nama} harus salah satu dari: ${pilihan.join(', ')}.`);
        }
        break;
      }
      case 'daftar': {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
          throw tolak(400, `${nama} harus berupa daftar teks.`);
        }
        if (v.length > 300) throw tolak(400, `${nama} maksimal 300 baris.`);
        if (v.some((x) => String(x).length > 200)) throw tolak(400, `${nama} memiliki baris terlalu panjang.`);
        break;
      }
      case 'penomoran': {
        const o = (v ?? {}) as { format?: unknown; digit?: unknown; reset?: unknown };
        if (typeof o.format !== 'string' || !o.format.trim()) throw tolak(400, `${nama} memerlukan format.`);
        if (o.format.length > 120) throw tolak(400, `${nama} terlalu panjang.`);
        if (!/\{NOMOR\}/.test(o.format)) throw tolak(400, `${nama} wajib memuat token {NOMOR}.`);
        const tokenDipakai = [...o.format.matchAll(/\{[A-Z_]+\}/g)].map((m) => m[0]);
        const asing = tokenDipakai.filter((t) => !TOKEN_NOMOR.includes(t));
        if (asing.length) throw tolak(400, `${nama} memuat token tak dikenal: ${asing.join(', ')}.`);
        const d = Number(o.digit);
        if (!Number.isInteger(d) || d < 1 || d > 12) throw tolak(400, `${nama}: digit nomor harus 1–12.`);
        if (!['tidak_pernah', 'tahun', 'bulan'].includes(String(o.reset))) {
          throw tolak(400, `${nama}: reset urutan tidak dikenal.`);
        }
        break;
      }
      default: {
        if (typeof v !== 'string') throw tolak(400, `${nama} harus berupa teks.`);
        if (b.wajib && !v.trim()) throw tolak(400, `${nama} wajib diisi.`);
        const maks = b.max ?? 4000;
        if (v.length > maks) throw tolak(400, `${nama} maksimal ${maks} karakter.`);
        break;
      }
    }
  }
}

/* ------------------------- TULIS / RESET / AUDIT ------------------------- */

export interface Perubahan {
  kunci: string;
  label: string;
  sebelum: unknown;
  sesudah: unknown;
}

/** Terapkan nilai tab. Mengembalikan daftar perubahan (untuk audit). */
export async function tulisTab(
  tab: TabPengaturan,
  nilai: Record<string, unknown>,
  toko?: string | null,
): Promise<Perubahan[]> {
  const sebelum = await bacaTab(tab, toko);
  const perubahan: Perubahan[] = [];

  for (const b of tab.bidang) {
    if (!(b.kunci in nilai)) continue;
    const baru = nilai[b.kunci];
    const lama = sebelum[b.kunci];
    if (JSON.stringify(lama ?? null) === JSON.stringify(baru ?? null)) continue;
    perubahan.push({ kunci: `${b.kunci}${toko && (b.cakupan ?? tab.cakupan) === 'toko' ? ` (toko ${toko})` : ''}`, label: b.label, sebelum: lama ?? null, sesudah: baru ?? null });
  }
  if (!perubahan.length) return [];

  await withTransaction(async () => {
    for (const b of tab.bidang) {
      if (!(b.kunci in nilai)) continue;
      if (b.kunciLama?.includes('::')) {
        const [kunci, prop] = b.kunciLama.split('::');
        let obj: Record<string, unknown> = {};
        try {
          obj = JSON.parse(await bacaBaris(kunci) || '{}') as Record<string, unknown>;
        } catch {
          obj = {};
        }
        obj[prop!] = nilai[b.kunci];
        await tulisBaris(kunci!, JSON.stringify(obj));
        continue;
      }
      await tulisBaris(kunciSimpan(tab, b, toko), simpanNilai(b, nilai[b.kunci]));
    }
  });
  return perubahan;
}

/** Kembalikan satu tab ke nilai bawaan registry. */
export async  function resetTab(tab: TabPengaturan, toko?: string | null): Promise<Perubahan[]> {
  return await tulisTab(tab, bawaanTab(tab), toko);
}

/* --------------------- AH2d — CAKUPAN PER AKUN --------------------------- */

/** Kunci settings penyimpanan tab Tampilan milik SATU akun (JSON seluruh bidang). */
const kunciTampilanAkun = (uid: number): string => `peng.tampilan.akun.${uid}`;

/**
 * AH2d — baca pengaturan Tampilan milik satu akun (null bila belum ada).
 * Nilai ini MENIMPA pengaturan global saat pilihan "Berlaku untuk:
 * Hanya akun saya".
 */
export async  function bacaTampilanAkun(uid: number | null): Promise<Record<string, unknown> | null> {
  if (uid === null || !Number.isFinite(uid)) return null;
  const mentah = await bacaBaris(kunciTampilanAkun(uid));
  if (!mentah) return null;
  try {
    const j = JSON.parse(mentah) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** AH2d — simpan seluruh bidang tab Tampilan untuk satu akun (satu baris JSON). */
export async  function tulisTampilanAkun(uid: number, nilai: Record<string, unknown>): Promise<void> {
  await tulisBaris(kunciTampilanAkun(uid), JSON.stringify(nilai));
}

/** AH2d — hapus pengaturan per akun agar kembali memakai pengaturan global. */
export async function hapusTampilanAkun(uid: number | null): Promise<void> {
  if (uid === null || !Number.isFinite(uid)) return;
  await run('DELETE FROM settings WHERE kunci = ?', kunciTampilanAkun(uid));
}

/* --------------------------- PENOMORAN DOKUMEN --------------------------- */

interface KonfigNomor {
  format: string;
  digit: number;
  reset: 'tidak_pernah' | 'tahun' | 'bulan';
}

const PENOMORAN_TAB = TAB_PENGATURAN.find((t) => t.kode === 'penomoran')!;

/** Konfigurasi nomor satu jenis (fallback ke bawaan registry). */
export async function konfigNomor(jenis: string, s?: Record<string, string>): Promise<KonfigNomor> {
  const st = s ?? (await getSettings());
  const b = PENOMORAN_TAB.bidang.find((x) => x.kunci === jenis);
  const def = (b?.bawaan ?? { format: '{KODE}-{TAHUN}-{NOMOR}', digit: 4, reset: 'tahun' }) as KonfigNomor;
  if (!b) throw tolak(404, `Jenis dokumen "${jenis}" tidak dikenal.`);
  const mentah = st[`peng.penomoran.${jenis}`];
  if (!mentah) return def;
  const hasil = uraikanNilai(b, mentah) as KonfigNomor;
  return { format: hasil.format, digit: hasil.digit, reset: hasil.reset };
}

export async function prefixNomor(jenis: string, s?: Record<string, string>): Promise<string> {
  const j = JENIS_NOMOR.find((x) => x.kode === jenis);
  if (!j) throw tolak(404, `Jenis dokumen "${jenis}" tidak dikenal.`);
  if (j.prefixDari) return ((s ?? (await getSettings()))[j.prefixDari]?.trim() || j.prefix).toUpperCase();
  return j.prefix;
}

/** Kode toko bawaan (untuk token {KODE_TOKO}); kosong bila belum ada toko. */
export async function kodeTokoBawaan(s?: Record<string, string>): Promise<string> {
  const kode = ((s ?? (await getSettings()))['toko_bawaan'] ?? '').trim();
  if (!kode) return '';
  const nama = await ((await get<{ kode: string }>('SELECT kode FROM stores WHERE kode = ?', kode)))?.kode;
  return nama ?? '';
}

/**
 * Nomor dokumen otomatis sesuai Pengaturan ▸ Penomoran Dokumen.
 * Bila pengaturan masih bawaan, hasilnya PERSIS sama dengan perilaku lama
 * (`formatDocumentNumber(prefix, periode, nextDocumentSequence(kunci))`),
 * termasuk kunci counter — jadi nomor lama tetap sambung.
 */
/**
 * Kunci counter yang dipakai `nomorOtomatis()` untuk satu jenis dokumen &
 * tanggal — dibutuhkan pemanggil yang ingin menyinkronkan counter (mis. saat
 * nomor yang dihasilkan ternyata sudah terpakai).
 */
export async function kunciCounterNomor(jenis: string, tanggalISO?: string): Promise<string> {
  const s = await getSettings();
  const j = JENIS_NOMOR.find((x) => x.kode === jenis);
  if (!j) throw tolak(404, `Jenis dokumen "${jenis}" tidak dikenal.`);
  const cfg = await konfigNomor(jenis, s);
  const prefix = (await prefixNomor(jenis, s)).toUpperCase();
  const t = (tanggalISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const tahun = t.slice(0, 4) || String(new Date().getFullYear());
  const bulan = t.slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
  const dasar = j.dasarKunci ?? prefix.toLowerCase();
  const periode = cfg.reset === 'tahun' ? tahun : cfg.reset === 'bulan' ? `${tahun}-${bulan}` : '';
  return periode ? `${dasar}-${periode}` : dasar;
}

export async function nomorOtomatis(jenis: string, tanggalISO?: string, prefixPaksa?: string): Promise<string> {
  const s = await getSettings();
  const j = JENIS_NOMOR.find((x) => x.kode === jenis);
  if (!j) throw tolak(404, `Jenis dokumen "${jenis}" tidak dikenal.`);
  const cfg = await konfigNomor(jenis, s);
  const prefix = (prefixPaksa ?? await prefixNomor(jenis, s)).toUpperCase();
  const t = (tanggalISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const tahun = t.slice(0, 4) || String(new Date().getFullYear());
  const bulan = t.slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');

  const dasar = j.dasarKunci ?? prefix.toLowerCase();
  const periode = cfg.reset === 'tahun' ? tahun : cfg.reset === 'bulan' ? `${tahun}-${bulan}` : '';
  const urut = await nextDocumentSequence(periode ? `${dasar}-${periode}` : dasar);

  const toko = await kodeTokoBawaan(s);
  return cfg.format
    .replace(/\{KODE_TOKO\}/g, toko || prefix)
    .replace(/\{KODE\}/g, prefix)
    .replace(/\{TAHUN\}/g, tahun)
    .replace(/\{BULAN\}/g, bulan)
    .replace(/\{NOMOR\}/g, String(urut).padStart(cfg.digit, '0'));
}

/** Pratinjau contoh nomor (tanpa mengubah counter). */
export async function pratinjauNomor(jenis: string, tanggalISO?: string): Promise<string> {
  const s = await getSettings();
  const cfg = await konfigNomor(jenis, s);
  const prefix = await prefixNomor(jenis, s);
  const t = (tanggalISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const toko = await kodeTokoBawaan(s);
  return cfg.format
    .replace(/\{KODE_TOKO\}/g, toko || prefix)
    .replace(/\{KODE\}/g, prefix)
    .replace(/\{TAHUN\}/g, t.slice(0, 4))
    .replace(/\{BULAN\}/g, t.slice(5, 7))
    .replace(/\{NOMOR\}/g, String(1).padStart(cfg.digit, '0'));
}
