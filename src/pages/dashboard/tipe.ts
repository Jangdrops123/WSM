// Tipe & daftar kartu Dashboard — daftar id kartu mengikuti server
// (server/routes/dashboard.ts → KARTU_DASHBOARD) dan dipakai panel
// "Atur tampilan".

export interface IsiDashboard {
  kpi: {
    penjualan: number;
    transaksi: number;
    laba: number;
    stok: number;
    piutang: number;
    menipis: number;
  };
  tren: { periode: string; omzet: number; pembelian: number }[];
  metode: { nama: string; jumlah: number }[];
  terlaris: { nama: string; nilai: number }[];
  transaksi: { no_dokumen: string; waktu: string; total: number; kasir: string | null }[];
  stokMenipis: { nama: string; sku: string; qty: number; minimum: number }[];
}

export type Urgensi = 'terlambat' | 'dekat' | 'aman';

export interface BarisPengingat {
  id: number;
  pihak: string;
  telepon: string | null;
  no_faktur: string;
  no_dokumen: string;
  sisa: number;
  total: number;
  terbayar: number;
  jatuh_tempo: string | null;
  urgensi: Urgensi;
  perlu_ingat: boolean;
}

export interface DataPengingat {
  piutang: BarisPengingat[];
  hutang: BarisPengingat[];
  terlambat: number;
  pengaturan: { hariSebelum: number; terlambatHarian: boolean };
}

export type KartuTampil = Record<string, boolean>;

/* ================= X2 — Model widget / tata letak Dashboard ================ */

export type PeriodeWidget =
  | 'hari-ini'
  | '7-hari'
  | '14-hari'
  | '30-hari'
  | 'bulan-ini'
  | 'tahun-ini'
  | 'kustom';
export type JenisWidget = 'kpi' | 'grafik' | 'donat' | 'daftar' | 'kas' | 'pintasan';
export type LebarWidget = 3 | 4 | 6 | 8 | 12;
export type TinggiWidget = 'kompak' | 'normal' | 'tinggi';

export interface WidgetDashboard {
  id: string;
  jenis: JenisWidget;
  judul: string;
  /** Kode metrik (lihat METRIK_WIDGET) — abaikan untuk jenis 'pintasan'. */
  metrik: string;
  periode?: PeriodeWidget;
  dari?: string;
  sampai?: string;
  gudang?: string;
  kasir?: string;
  kategori?: string;
  /** Jenis tampilan grafik (X2.2). */
  tampilan?: 'garis' | 'batang';
  /** Jumlah item daftar peringkat (Top 5/10). */
  jumlah?: number;
  lebar: LebarWidget;
  tinggi: TinggiWidget;
}

export interface LayoutDashboard {
  versi: 1;
  widgets: WidgetDashboard[];
}

/** Katalog metrik (sinkron dengan server/routes/dashboard.ts). */
export const METRIK_WIDGET: {
  kode: string;
  label: string;
  jenis: JenisWidget[];
  format: 'rupiah' | 'angka' | 'produk' | 'rekening';
}[] = [
  { kode: 'penjualan', label: 'Penjualan (omzet)', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  { kode: 'pembelian', label: 'Pembelian', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  { kode: 'laba', label: 'Laba kotor', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  { kode: 'transaksi', label: 'Jumlah transaksi', jenis: ['kpi', 'grafik'], format: 'angka' },
  { kode: 'stok', label: 'Nilai persediaan', jenis: ['kpi'], format: 'rupiah' },
  { kode: 'piutang', label: 'Piutang belum lunas', jenis: ['kpi', 'daftar'], format: 'rupiah' },
  { kode: 'utang', label: 'Utang belum lunas', jenis: ['kpi'], format: 'rupiah' },
  { kode: 'menipis', label: 'Stok menipis', jenis: ['kpi', 'daftar'], format: 'produk' },
  { kode: 'terlaris', label: 'Produk terlaris', jenis: ['grafik', 'daftar'], format: 'rupiah' },
  { kode: 'metode', label: 'Metode pembayaran', jenis: ['donat'], format: 'rupiah' },
  { kode: 'kas', label: 'Ringkasan kas & bank', jenis: ['kas'], format: 'rekening' },
  { kode: 'piutang-jatuh-tempo', label: 'Piutang jatuh tempo', jenis: ['daftar'], format: 'rupiah' },
  { kode: 'transaksi-terakhir', label: 'Transaksi terakhir', jenis: ['daftar'], format: 'rupiah' },
];

export const PERIODE_WIDGET: { kode: PeriodeWidget; label: string }[] = [
  { kode: 'hari-ini', label: 'Hari ini' },
  { kode: '7-hari', label: '7 hari' },
  { kode: '14-hari', label: '14 hari' },
  { kode: '30-hari', label: '30 hari' },
  { kode: 'bulan-ini', label: 'Bulan ini' },
  { kode: 'tahun-ini', label: 'Tahun ini' },
  { kode: 'kustom', label: 'Kustom…' },
];

/** Kode periode untuk deret harian (chip 7/14/30 pada kartu tren). */
export const PERIODE_TREN: PeriodeWidget[] = ['7-hari', '14-hari', '30-hari'];

export const LABEL_PERIODE: Record<PeriodeWidget, string> = {
  'hari-ini': 'Hari ini',
  '7-hari': '7 hari',
  '14-hari': '14 hari',
  '30-hari': '30 hari',
  'bulan-ini': 'Bulan ini',
  'tahun-ini': 'Tahun ini',
  kustom: 'Kustom',
};

/** Tautan "Detail" pada kartu — metrik → halaman sumber datanya. */
export const TAUTAN_METRIK: Record<string, string> = {
  penjualan: '/laporan/penjualan',
  // Pembelian: halaman gabungan (langsung + PO − retur) — sumber angka yang
  // sama dengan kartu ini, bukan hanya faktur pembelian.
  pembelian: '/laporan/l/pembelian-gabungan',
  laba: '/laporan/keuangan',
  transaksi: '/penjualan',
  stok: '/stok',
  piutang: '/penjualan/piutang',
  'piutang-jatuh-tempo': '/penjualan/piutang',
  utang: '/akuntansi/hutang',
  menipis: '/stok',
  terlaris: '/laporan/penjualan',
  metode: '/laporan/penjualan',
  'transaksi-terakhir': '/penjualan',
  kas: '/akuntansi/kas',
};

export const UKURAN_KARTU: { lebar: LebarWidget; tinggi: TinggiWidget; label: string }[] = [
  { lebar: 3, tinggi: 'kompak', label: 'Kecil' },
  { lebar: 6, tinggi: 'normal', label: 'Sedang' },
  { lebar: 8, tinggi: 'tinggi', label: 'Besar' },
  { lebar: 12, tinggi: 'normal', label: 'Penuh' },
];

/** Widget baru dengan nilai bawaan yang masuk akal. */
export function widgetBaru(jenis: JenisWidget, metrik: string, judul: string): WidgetDashboard {
  return {
    id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    jenis,
    metrik,
    judul,
    periode: jenis === 'kpi' || jenis === 'grafik' || jenis === 'donat' ? '30-hari' : undefined,
    tampilan: jenis === 'grafik' ? 'batang' : undefined,
    jumlah: jenis === 'daftar' ? 5 : undefined,
    lebar: jenis === 'kpi' ? 3 : jenis === 'pintasan' ? 12 : 6,
    tinggi: jenis === 'kpi' ? 'kompak' : 'normal',
  };
}

/** Preset tersimpan (X2.3) — Admin bisa memakainya sebagai titik awal. */
export const PRESET_DASHBOARD: { kode: string; label: string; widgets: WidgetDashboard[] }[] = [
  {
    kode: 'pemilik',
    label: 'Pemilik',
    widgets: [
      { ...widgetBaru('kpi', 'penjualan', 'Penjualan'), periode: 'bulan-ini' },
      { ...widgetBaru('kpi', 'pembelian', 'Pembelian'), periode: 'bulan-ini' },
      { ...widgetBaru('kpi', 'laba', 'Laba Kotor'), periode: 'bulan-ini' },
      { ...widgetBaru('kpi', 'piutang', 'Faktur Belum Lunas') },
      {
        ...widgetBaru('grafik', 'penjualan', 'Tren Penjualan'),
        periode: '7-hari',
        tampilan: 'batang',
        lebar: 8,
        tinggi: 'normal',
      },
      { ...widgetBaru('daftar', 'terlaris', 'Produk Terlaris'), periode: '30-hari', jumlah: 5, lebar: 4, tinggi: 'normal' },
      { ...widgetBaru('daftar', 'menipis', 'Produk Menipis'), jumlah: 5, lebar: 6, tinggi: 'normal' },
      { ...widgetBaru('daftar', 'piutang-jatuh-tempo', 'Faktur Jatuh Tempo'), jumlah: 5, lebar: 6, tinggi: 'normal' },
    ],
  },
  {
    kode: 'gudang',
    label: 'Gudang',
    widgets: [
      { ...widgetBaru('kpi', 'stok', 'Nilai Persediaan') },
      { ...widgetBaru('kpi', 'menipis', 'Stok Menipis') },
      { ...widgetBaru('daftar', 'menipis', 'Stok Menipis — Peringkat') },
      { ...widgetBaru('kpi', 'pembelian', 'Pembelian — 30 Hari') },
      { ...widgetBaru('grafik', 'pembelian', 'Tren Pembelian — 30 Hari'), tampilan: 'batang' },
      { ...widgetBaru('pintasan', 'pintasan', 'Modul Aplikasi') },
    ],
  },
  {
    kode: 'kasir',
    label: 'Kasir',
    widgets: [
      { ...widgetBaru('kpi', 'penjualan', 'Penjualan Hari Ini'), periode: 'hari-ini' },
      { ...widgetBaru('kpi', 'transaksi', 'Jumlah Transaksi'), periode: 'hari-ini' },
      { ...widgetBaru('grafik', 'penjualan', 'Tren Penjualan — 7 Hari'), periode: '7-hari', tampilan: 'garis', lebar: 6 },
      { ...widgetBaru('daftar', 'terlaris', 'Produk Terlaris — Top 5'), jumlah: 5 },
      { ...widgetBaru('daftar', 'transaksi-terakhir', 'Transaksi Terakhir') },
    ],
  },
];

/** Semua id kartu dalam urutan tampil — dipakai "Atur ulang" & panel. */
export const SEMUA_KARTU = [
  'pintasan',
  'kpi-penjualan',
  'kpi-transaksi',
  'kpi-laba',
  'kpi-stok',
  'kpi-piutang',
  'kpi-menipis',
  'pengingat',
  'grafik-7hari',
  'grafik-metode',
  'grafik-terlaris',
  'grafik-vs',
  'tabel-transaksi',
  'tabel-menipis',
] as const;

/** Pengelompokan kartu untuk panel "Atur tampilan". */
export const GRUP_KARTU: { judul: string; kartu: { id: string; label: string }[] }[] = [
  { judul: 'Pintasan', kartu: [{ id: 'pintasan', label: 'Modul Aplikasi' }] },
  {
    judul: 'Ringkasan (KPI)',
    kartu: [
      { id: 'kpi-penjualan', label: 'Penjualan hari ini' },
      { id: 'kpi-transaksi', label: 'Jumlah transaksi' },
      { id: 'kpi-laba', label: 'Laba kotor' },
      { id: 'kpi-stok', label: 'Nilai persediaan' },
      { id: 'kpi-piutang', label: 'Piutang belum lunas' },
      { id: 'kpi-menipis', label: 'Stok menipis' },
    ],
  },
  { judul: 'Pengingat', kartu: [{ id: 'pengingat', label: 'Pengingat faktur belum lunas' }] },
  {
    judul: 'Grafik',
    kartu: [
      { id: 'grafik-7hari', label: 'Tren 7 hari' },
      { id: 'grafik-metode', label: 'Metode pembayaran' },
      { id: 'grafik-terlaris', label: 'Produk terlaris' },
      { id: 'grafik-vs', label: 'Penjualan vs pembelian' },
    ],
  },
  {
    judul: 'Tabel',
    kartu: [
      { id: 'tabel-transaksi', label: 'Transaksi terakhir' },
      { id: 'tabel-menipis', label: 'Stok menipis' },
    ],
  },
];
