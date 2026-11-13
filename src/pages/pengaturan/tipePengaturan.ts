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
  opsi: { nilai: string; label: string }[] | null;
  ket: string | null;
  satuan: string | null;
  min: number | null;
  max: number | null;
  wajib: boolean;
  cakupan: 'db' | 'toko';
  opsiUrl: string | null;
  pratinjau: boolean;
  /** Peringatan dampak yang harus dibaca sebelum menyimpan. */
  dampak: string | null;
  /** Tautan ke halaman lain (isinya ada di modul lain). */
  ke: string | null;
  /** Layanan luar yang belum tersambung — tampil nonaktif dengan petunjuk. */
  nonaktif: string | null;
}

export interface Tab {
  kode: string;
  grup: 'umum' | 'transaksi' | 'keuangan' | 'sistem' | 'lain';
  label: string;
  ket: string | null;
  cakupan: 'db' | 'toko';
  kustom: string | null;
  /** Tab hanya menampilkan informasi — tidak ada yang bisa diubah. */
  informatif: boolean;
  dampak: string | null;
  /** Izin tab untuk peran aktif (matriks Hak Akses) — false = jangan ditampilkan. */
  boleh: boolean;
  bidang: Bidang[];
}

export interface Grup {
  kode: string;
  label: string;
}

export interface KartuDashboard {
  kode: string;
  label: string;
}

export interface JenisNomor {
  kode: string;
  label: string;
  prefix: string;
  contoh: string;
  konfig: { format: string; digit: number; reset: string };
}

export interface DaftarPengaturan {
  grup: Grup[];
  kartu: KartuDashboard[];
  jenisNomor: JenisNomor[];
  tab: Tab[];
}

export interface NilaiTab {
  tab: string;
  label: string;
  cakupan: 'db' | 'toko';
  toko: string | null;
  nilai: Record<string, unknown>;
  bawaan: Record<string, unknown>;
}

export interface Opsi {
  id?: number;
  /** Nilai tersimpan — dipakai bila ada (kode toko); kalau tidak, pakai `id`. */
  nilai?: string;
  label: string;
}
