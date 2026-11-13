// AY — Registri menu awal setelah login per peran (cermin server/lib/menuAwal.ts).
// Atribut peran, BUKAN izin. Ubah keduanya bila menambah/mengganti halaman.
//
// Kode stabil → label, grup (seperti sidebar), rute, dan modul matriks yang
// sel Lihat-nya disyaratkan (null = selalu boleh, mis. Dashboard).

export interface OpsiMenuAwal {
  kode: string;
  label: string;
  grup: string;
  rute: string;
  modul: string | null;
}

export const DAFTAR_MENU_AWAL: OpsiMenuAwal[] = [
  { kode: 'dashboard', label: 'Dashboard', grup: 'Dashboard', rute: '/', modul: 'dashboard' },
  { kode: 'master-produk', label: 'Produk', grup: 'Master Data', rute: '/master/produk', modul: 'master' },
  { kode: 'master-konversi', label: 'Konversi Satuan', grup: 'Master Data', rute: '/master/konversi', modul: 'master' },
  { kode: 'master-paket', label: 'Paket / Box', grup: 'Master Data', rute: '/master/paket', modul: 'master' },
  { kode: 'master-kategori', label: 'Kategori', grup: 'Master Data', rute: '/master/kategori', modul: 'master' },
  { kode: 'master-merek', label: 'Merek', grup: 'Master Data', rute: '/master/merek', modul: 'master' },
  { kode: 'master-satuan', label: 'Satuan', grup: 'Master Data', rute: '/master/satuan', modul: 'master' },
  { kode: 'master-pelanggan', label: 'Pelanggan', grup: 'Master Data', rute: '/master/pelanggan', modul: 'master' },
  { kode: 'master-pemasok', label: 'Pemasok', grup: 'Master Data', rute: '/master/pemasok', modul: 'master' },
  { kode: 'master-gudang', label: 'Gudang & Lokasi', grup: 'Master Data', rute: '/master/gudang', modul: 'master' },
  { kode: 'stok-saat-ini', label: 'Stok Saat Ini', grup: 'Stok', rute: '/stok', modul: 'stok' },
  { kode: 'stok-masuk', label: 'Item Masuk', grup: 'Stok', rute: '/stok/masuk', modul: 'stok' },
  { kode: 'stok-keluar', label: 'Item Keluar', grup: 'Stok', rute: '/stok/keluar', modul: 'stok' },
  { kode: 'stok-opname', label: 'Opname', grup: 'Stok', rute: '/stok/opname', modul: 'opname' },
  { kode: 'pembelian-input', label: 'Input Pembelian', grup: 'Pembelian', rute: '/pembelian', modul: 'pembelian' },
  { kode: 'pembelian-riwayat', label: 'Riwayat & Dokumen', grup: 'Pembelian', rute: '/pembelian/riwayat', modul: 'pembelian' },
  { kode: 'penjualan-riwayat', label: 'Riwayat Penjualan', grup: 'Penjualan', rute: '/penjualan', modul: 'penjualan' },
  { kode: 'pos-foto', label: 'POS Mode Foto', grup: 'Penjualan', rute: '/penjualan/pos/foto', modul: 'pos' },
  { kode: 'pos-tanpa-foto', label: 'POS Mode Tanpa Foto', grup: 'Penjualan', rute: '/penjualan/pos/tanpa-foto', modul: 'pos' },
  { kode: 'penjualan-retur', label: 'Retur', grup: 'Penjualan', rute: '/penjualan/retur', modul: 'penjualan' },
  { kode: 'penjualan-piutang', label: 'Piutang', grup: 'Penjualan', rute: '/penjualan/piutang', modul: 'penjualan' },
  { kode: 'akuntansi', label: 'Akuntansi', grup: 'Akuntansi', rute: '/akuntansi', modul: 'akuntansi' },
  { kode: 'laporan-ringkasan', label: 'Ringkasan', grup: 'Laporan', rute: '/laporan', modul: 'laporan' },
  { kode: 'laporan-penjualan', label: 'Penjualan', grup: 'Laporan', rute: '/laporan/penjualan', modul: 'laporan' },
  { kode: 'laporan-pembelian', label: 'Pembelian', grup: 'Laporan', rute: '/laporan/pembelian', modul: 'laporan' },
  { kode: 'laporan-stok', label: 'Stok & Persediaan', grup: 'Laporan', rute: '/laporan/stok', modul: 'laporan' },
  { kode: 'laporan-opname', label: 'Opname', grup: 'Laporan', rute: '/laporan/opname', modul: 'laporan' },
  { kode: 'laporan-keuangan', label: 'Keuangan', grup: 'Laporan', rute: '/laporan/keuangan', modul: 'laporan' },
  { kode: 'laporan-dasar', label: 'Laporan Dasar', grup: 'Laporan', rute: '/akuntansi/laporan', modul: 'akuntansi' },
  { kode: 'laporan-pajak', label: 'Pajak', grup: 'Laporan', rute: '/laporan/pajak', modul: 'laporan' },
  { kode: 'laporan-piutang', label: 'Piutang & Utang', grup: 'Laporan', rute: '/laporan/piutang', modul: 'laporan' },
  { kode: 'laporan-tersimpan', label: 'Laporan Tersimpan', grup: 'Laporan', rute: '/laporan/tersimpan', modul: 'laporan' },
  { kode: 'pengaturan', label: 'Pengaturan', grup: 'Pengaturan', rute: '/pengaturan', modul: 'pengaturan' },
];

const PETA = new Map(DAFTAR_MENU_AWAL.map((p) => [p.kode, p] as const));

export function definisiMenuAwalKlien(kode: string | null | undefined): OpsiMenuAwal | null {
  if (!kode) return null;
  return PETA.get(kode.trim()) ?? null;
}

export function labelMenuAwalKlien(kode: string | null | undefined, cadangan = 'Otomatis'): string {
  return definisiMenuAwalKlien(kode)?.label ?? cadangan;
}

/** Opsi yang boleh dilihat peran (dari set Lihat draf), dikelompokkan. */
export function opsiUntukLihat(lihat: (modul: string | null) => boolean): { grup: string; opsi: OpsiMenuAwal[] }[] {
  const keluar: { grup: string; opsi: OpsiMenuAwal[] }[] = [];
  for (const p of DAFTAR_MENU_AWAL) {
    if (!lihat(p.modul)) continue;
    let g = keluar.find((x) => x.grup === p.grup);
    if (!g) {
      g = { grup: p.grup, opsi: [] };
      keluar.push(g);
    }
    g.opsi.push(p);
  }
  return keluar;
}
