// Tipe & helper bersama untuk User & Hak Akses (templat baru).
// Kode menu/aksi mengikuti matriks server (server/lib/hak.ts, server/lib/auth.ts)
// sehingga penegakan API tidak berubah — yang diganti hanya tampilan.

export interface UserBaru {
  id: number;
  nama: string;
  username: string;
  email: string | null;
  peran_id: number;
  peran: string;
  cakupan_toko: string[] | null;
  status: 'aktif' | 'nonaktif' | 'terkunci';
  login_terakhir: string | null;
  admin_utama: boolean;
  top: boolean;
  toko_bawaan: string | null;
  /** WI2 — gudang default (id) + kunci pilihan gudang. */
  default_warehouse_id: number | null;
  is_warehouse_locked: boolean;
  mode_toko: string;
  periode_aktif: boolean;
  jam_dari: string | null;
  jam_sampai: string | null;
  hari_aktif: string[];
  zona: string;
  login_shift: boolean;
  maks_perangkat: number;
  perlu_ditinjau: boolean;
}

export interface PeranBaru {
  id: number;
  nama: string;
  top: boolean;
  jumlah_pengguna: number;
  hak: Record<string, string>;
  cakupan_toko: string[] | null;
  /** WI2 — gudang default (kode) + kunci pilihan gudang per peran. */
  gudang_default: string | null;
  gudang_terkunci: boolean;
  /** AY — kode menu awal (null = otomatis). Label + pilihan dari server. */
  menu_awal: string | null;
  menuAwalLabel: string | null;
  pilihanMenu: { grup: string; opsi: { kode: string; label: string; rute: string }[] }[];
}

export interface GudangGrupBaru {
  toko_kode: string | null;
  toko_nama: string;
  gudang: { kode: string; nama: string; aktif: number }[];
}

/** Baris matriks = modul inti server (urutan tampil templat). */
export const MENU_MATRIKS: { kode: string; label: string }[] = [
  { kode: 'dashboard', label: 'Dashboard' },
  { kode: 'penjualan', label: 'Penjualan' },
  { kode: 'pos', label: 'POS' },
  { kode: 'pembelian', label: 'Pembelian' },
  { kode: 'purchase-order', label: 'Purchase Order (PO)' },
  { kode: 'stok', label: 'Stok' },
  { kode: 'opname', label: 'Opname' },
  { kode: 'persediaan-sub', label: 'Persediaan' },
  { kode: 'akuntansi', label: 'Akuntansi' },
  { kode: 'laporan', label: 'Laporan' },
  { kode: 'master', label: 'Master Data' },
  { kode: 'pengaturan', label: 'Pengaturan' },
  { kode: 'proses-tahunan', label: 'Proses Tahunan' },
];

/** Kolom matriks = delapan sel sah (server/lib/hak.ts). Tanpa kolom tambahan. */
export const KOLOM_MATRIKS = [
  { kode: 'lihat', label: 'LIHAT' },
  { kode: 'tambah', label: 'TAMBAH' },
  { kode: 'ubah', label: 'UBAH' },
  { kode: 'hapus', label: 'HAPUS' },
  { kode: 'sahkan', label: 'SAHKAN' },
  { kode: 'impor', label: 'IMPOR' },
  { kode: 'ekspor', label: 'EKSPOR' },
  { kode: 'cetak', label: 'CETAK' },
] as const;

/** Keterangan tiap kolom (AX2) — tooltip judul kolom + legenda bawah matriks. */
export const KETERANGAN_KOLOM: Record<string, string> = {
  lihat: 'Melihat daftar, detail, riwayat, kartu stok, dan pop up detail.',
  tambah: 'Membuat dokumen baru (draft), menyalin ke draft baru, transaksi baru (POS, Item Masuk/Keluar, retur).',
  ubah: 'Mengubah draft/dokumen belum final; langkah operasional: Terima barang (GRN), tahan & lanjutkan, Transfer dikirim & diterima, hitung/scan/selesai sesi Opname; edit data master.',
  hapus: 'Membatalkan/menghapus (soft) dokumen: Batal draft atau GRN, Void; hapus data master; hapus massal.',
  sahkan: 'Langkah yang memposting stok & jurnal: mengesahkan Faktur Pembelian, mengesahkan Opname, menyetujui retur, pelunasan hutang/piutang.',
  impor: 'Impor data dari Excel.',
  ekspor: 'Ekspor data ke Excel/PDF.',
  cetak: 'Cetak dokumen, simpan PDF, kirim WhatsApp.',
};

/** Satu baris legenda di bawah matriks (AX2). */
export const LEGENDA_MATRIKS =
  'Ubah mencakup Terima barang (GRN) & kirim/terima Transfer • ' +
  'Hapus mencakup Batal draft/GRN & Void • ' +
  'Sahkan mencakup pengesahan faktur/opname & pelunasan • ' +
  '"Batal & Pulihkan" dokumen yang sudah disahkan butuh Hapus dan Sahkan. ' +
  'Purchase Order (PO): Lihat = daftar & detail PO • Tambah = buat PO/terima langsung • ' +
  'Ubah = ubah item, kirim PO, terima barang (GRN), retur, buka kembali • ' +
  'Hapus = batalkan/Void atau tutup PO.';

/** Tidak ada lagi aksi di luar delapan kolom — simpan tidak mempertahankan kode lama. */
export const AKSI_LAIN: readonly string[] = [];

/** Deskripsi peran pada modal user (tampilan saja). */
export function deskripsiPeran(nama: string): string {
  const n = nama.toLowerCase().trim();
  if (n === 'owner' || n === 'administrator' || n === 'admin') {
    return 'Akses penuh, semua gudang, kelola user dan pengaturan.';
  }
  if (n === 'supervisor') {
    return 'Semua menu kecuali Pengaturan; boleh mengubah status dan melihat laporan gudang yang diizinkan.';
  }
  if (n === 'operator') {
    return 'Hanya input retur dan melihat jurnal di gudang yang diizinkan; tidak bisa menghapus data.';
  }
  if (n === 'viewer') {
    return 'Hanya melihat data gudang yang diizinkan; tidak bisa menambah, mengubah, atau menghapus.';
  }
  return 'Hak akses rinci diatur pada Matriks Peran.';
}

/** Warna pill peran (tampilan saja). */
export function kelasPeran(nama: string): string {
  const n = nama.toLowerCase().trim();
  if (n === 'owner' || n === 'administrator' || n === 'admin') return 'ax-pill ax-pill--biru';
  if (n === 'supervisor') return 'ax-pill ax-pill--cokelat';
  if (n === 'operator') return 'ax-pill ax-pill--hijau-tua';
  if (n === 'viewer') return 'ax-pill ax-pill--abu';
  return 'ax-pill ax-pill--netral';
}

/** "2026-10-28 13:49:04.481" → "28 Okt 2026, 13.49". */
export function formatLogin(iso: string | null): string {
  if (!iso) return '—';
  const normal = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const d = new Date(normal.length === 19 ? `${normal}Z` : normal);
  if (Number.isNaN(d.getTime())) return iso;
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
  return `${tgl}, ${jam}`;
}

/** "lihat,tambah" → ['lihat','tambah']. */
export function parseAksi(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
