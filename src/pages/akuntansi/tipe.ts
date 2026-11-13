// Tipe data bersama halaman AKUNTANSI DASAR.
// Tanpa debit/kredit, tanpa Bagan Akun, tanpa jurnal. Saldo kas dihitung
// dari saldo awal + mutasi (masuk − keluar). Piutang/hutang memakai tabel
// receivables/payables yang sudah ada.

/** Rekening kas/bank (nama, jenis, saldo awal, saldo sekarang). */
export interface AkunKas {
  id: number;
  kode: string;
  nama: string;
  jenis: 'kas' | 'bank' | 'e-wallet';
  saldo_awal: number;
  aktif: number;
  saldo?: number;
}

/** Satu mutasi kas (kas masuk/keluar/transfer). */
export interface MutasiKas {
  id: number;
  tipe: 'masuk' | 'keluar' | 'transfer';
  tanggal: string;
  nomor: string;
  jumlah: number;
  keterangan: string | null;
  akun_kode: string;
  akun_nama: string;
  tujuan_kode?: string | null;
  tujuan_nama?: string | null;
  kategori?: string | null;
  pembuat?: string | null;
  sumber_tipe?: string | null;
  sumber_id?: number | null;
}

/** Kategori pengeluaran/biaya atau pemasukan lain. */
export interface KategoriKas {
  id: number;
  nama: string;
  tipe: 'pengeluaran' | 'pemasukan';
  aktif: number;
}

/** Piutang / Hutang (dari penjualan tempo / pembelian tempo). */
export interface Tagihan {
  id: number;
  no_dokumen: string;
  tanggal_dok: string;
  jatuh_tempo: string | null;
  total: number;
  terbayar: number;
  sisa: number;
  status: string;
  entitas: string | null;
  /** Telepon/WA pelanggan/pemasok dari master — pengingat tagihan via WhatsApp. */
  entitas_telepon?: string | null;
  umur_hari: number;
  umur_ember: string;
  telat_hari: number;
  dokumen_id: number;
}

/** Nominal rupiah tanpa desimal. */
export const rp = (n: number): string =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

/** Tipe mutasi kas yang dikenal. */
export const JENIS_REKENING = ['kas', 'bank', 'e-wallet'] as const;
