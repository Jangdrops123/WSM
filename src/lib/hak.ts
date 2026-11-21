import type { InfoSesi } from './sesi';

// AX — satu-satunya penentu hak akses di klien: matriks peran dari sesi
// (info.hak: {menu: [aksi...]}) + penanda Top (pengguna.admin). Delapan sel
// sah: lihat, tambah, ubah, hapus, sahkan, impor, ekspor, cetak.
export type AksiMatriks = 'lihat' | 'tambah' | 'ubah' | 'hapus' | 'sahkan' | 'impor' | 'ekspor' | 'cetak';

export const LABEL_AKSI: Record<AksiMatriks, string> = {
  lihat: 'Lihat',
  tambah: 'Tambah',
  ubah: 'Ubah',
  hapus: 'Hapus',
  sahkan: 'Sahkan',
  impor: 'Impor',
  ekspor: 'Ekspor',
  cetak: 'Cetak',
};

/**
 * POS & Penjualan memakai satu layar/rute kasir — baris matriks "POS" dan
 * "Penjualan" saling mewakili (sama dengan server/lib/hak.ts).
 */
const ALIAS_MENU: Record<string, readonly string[]> = {
  pos: ['pos', 'pos-kasir', 'penjualan'],
  'pos-kasir': ['pos-kasir', 'pos', 'penjualan'],
  penjualan: ['penjualan', 'pos', 'pos-kasir'],
};

/** Satu fungsi can(modul, aksi) — dipakai semua tombol di UI. */
export function can(info: InfoSesi | null | undefined, modul: string, ...aksi: AksiMatriks[]): boolean {
  if (!info) return false;
  if (info.pengguna.admin) return true;
  const kandidat = ALIAS_MENU[modul] ?? [modul];
  const sel = kandidat.flatMap((m) => info.hak?.[m] ?? []);
  return aksi.every((a) => sel.includes(a));
}

/**
 * Token Edit/Batal transaksi (sama dengan server): Administrator, Hak Khusus
 * "Hapus transaksi", atau sel matriks modul/aksi yang bersangkutan.
 */
export function bolehKelolaTransaksi(
  info: InfoSesi | null | undefined,
  modul = 'penjualan',
  aksi: AksiMatriks = 'ubah',
): boolean {
  if (!info) return false;
  if (info.pengguna.admin === true || info.khusus?.hapus_transaksi === true) return true;
  return can(info, modul, aksi);
}

/** Modul matriks baris Purchase Order — terpisah dari Pembelian. */
export const MODUL_PO = 'purchase-order';

const LABEL_MODUL: Record<string, string> = {
  pembelian: 'Pembelian',
  'purchase-order': 'Purchase Order (PO)',
  penjualan: 'Penjualan',
  'pos-kasir': 'POS Kasir',
  opname: 'Opname',
  persediaan: 'Persediaan',
  'persediaan-sub': 'Item Masuk/Keluar',
  stok: 'Stok',
  akuntansi: 'Akuntansi',
  laporan: 'Laporan',
  master: 'Master Data',
  pengaturan: 'Pengaturan',
};

/**
 * Pesan penolakan kosakata matriks (AX4) untuk tooltip tombol nonaktif.
 * Tunggal: "Peran Operator belum memiliki izin 'Ubah' pada Pembelian
 * (dibutuhkan untuk Terima barang). Admin dapat mengaktifkannya di
 * Pengaturan > Pengguna & Hak Akses > Peran."
 */
export function pesanIzin(
  info: InfoSesi | null | undefined,
  modul: string,
  sel: AksiMatriks | AksiMatriks[],
  operasi?: string,
): string {
  const daftar = Array.isArray(sel) ? sel : [sel];
  const modulLabel = LABEL_MODUL[modul] ?? modul;
  if (daftar.length > 1) {
    const kurang = daftar
      .filter((s) => !can(info, modul, s))
      .map((s) => `'${LABEL_AKSI[s]}'`);
    return (
      `Dibutuhkan izin ${daftar.map((s) => `'${LABEL_AKSI[s]}'`).join(' dan ')} pada ${modulLabel}; ` +
      `peran Anda belum memiliki ${kurang.join(' dan ') || 'izin tersebut'}.`
    );
  }
  const aksi = daftar[0];
  const peran = info?.pengguna.peranNama?.trim() ? info.pengguna.peranNama : 'Anda';
  const butuh = operasi ? ` (dibutuhkan untuk ${operasi})` : '';
  return (
    `Peran ${peran} belum memiliki izin '${LABEL_AKSI[aksi]}' pada ${modulLabel}${butuh}. ` +
    `Admin dapat mengaktifkannya di Pengaturan > Pengguna & Hak Akses > Peran.`
  );
}
