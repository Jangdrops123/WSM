// Tipe bersama modul laporan (BAGIAN N) — mencerminkan respons server.

export type TipeKolom = 'teks' | 'angka' | 'rupiah' | 'tanggal' | 'waktu' | 'persen';

export interface KolomLaporan {
  kunci: string;
  label: string;
  tipe: TipeKolom;
}

export interface KartuLaporan {
  kunci: string;
  label: string;
  nilai: number;
  format: 'rupiah' | 'angka' | 'persen';
  /** Nilai periode pembanding (N1) bila filter "Bandingkan" aktif. */
  lalu?: number | null;
}

export interface DefRingkas {
  kode: string;
  judul: string;
  kategori: string;
  deskripsi: string;
}

export interface ResponsLaporan {
  kode: string;
  judul: string;
  kategori: string;
  deskripsi: string;
  kolom: KolomLaporan[];
  grafik: 'garis' | 'batang' | 'donat' | null;
  grafikKunci: { x: string; seri: string[] } | null;
  filter: [string, string][];
  periode: { dari: string; sampai: string; bandingDari: string; bandingSampai: string };
  kartu: KartuLaporan[];
  rows: Record<string, unknown>[];
  total: Record<string, unknown> | null;
  terbatas: boolean;
  durasi_ms: number;
}

export interface ResponsRingkasan {
  kartu: KartuLaporan[];
  tren: { periode: string; omzet: number; laba: number }[];
  terlaris: { nama: string; qty: number; omzet: number }[];
  filter: [string, string][];
  periode: { dari: string; sampai: string; bandingDari: string; bandingSampai: string };
  durasi_ms: number;
}

/** Parameter filter global (N2) — seluruhnya string agar cocok dengan query URL. */
export interface ParameterFilter {
  periode: string;
  dari: string;
  sampai: string;
  bandingkan: string;
  gudang: string;
  kasir: string;
  pelanggan: string;
  pemasok: string;
  kategori: string;
  merek: string;
  produk: string;
  metode: string;
  status: string;
}

export const KUNCI_FILTER: (keyof ParameterFilter)[] = [
  'periode', 'dari', 'sampai', 'bandingkan',
  'gudang', 'kasir', 'pelanggan', 'pemasok',
  'kategori', 'merek', 'produk', 'metode', 'status',
];

export const KUNCI_TAMBAHAN = ['lap', 'grup', 'urut', 'cari', 'status_po'] as const;

export type ParameterSemua = ParameterFilter & Record<string, string>;

export const PARAMETER_AWAL: ParameterFilter = {
  periode: '7-hari',
  dari: '',
  sampai: '',
  bandingkan: '',
  gudang: '',
  kasir: '',
  pelanggan: '',
  pemasok: '',
  kategori: '',
  merek: '',
  produk: '',
  metode: '',
  status: '',
};
