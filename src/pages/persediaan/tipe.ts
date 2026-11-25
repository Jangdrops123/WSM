// Tipe bersama modul Persediaan Sub — Item Masuk (tambah stok) & Item Keluar.
// Balasan server ada di server/routes/persediaan.ts — jaga kesesuaian di sini.

export type Arah = 'masuk' | 'keluar';

export interface OpsiAlasan {
  kode: string;
  label: string;
}

/** Balasan GET /api/persediaan/meta — nomor pratinjau + daftar alasan. */
export interface MetaPersediaan {
  nomor: Record<Arah, string>;
  alasan: Record<Arah, OpsiAlasan[]>;
  prefix: Record<Arah, string>;
}

/** Satu baris tabel input form (belum tersimpan). */
export interface BarisItem {
  productId: number;
  kode: string;
  nama: string;
  /** Size/Varian — Master tanpa varian; tampil "—" bila tidak ada. */
  size: string | null;
  satuan: string | null;
  qty: number;
  /** Stok di gudang terpilih saat baris ditambahkan (diperbarui saat gudang ganti). */
  stokSebelum: number;
}

/** Balasan GET /api/persediaan/stok — saldo terkini + satuan dasar. */
export interface BarisSaldo {
  product_id: number;
  qty: number;
  satuan: string | null;
}

/** Dokumen riwayat (daftar, detail, balasan simpan/batal). */
export interface DokumenSub {
  id: number;
  no_dokumen: string;
  arah: Arah;
  warehouse_id: number;
  gudang_kode: string | null;
  gudang_nama: string;
  tanggal: string;
  alasan: string;
  alasan_label: string;
  keterangan: string | null;
  status: string;
  status_label: string;
  total_qty: number;
  jumlah_item: number;
  dibuat_pada: string;
  dibatalkan_pada: string | null;
  alasan_batal: string | null;
}

export interface ItemDokumen {
  id: number;
  product_id: number;
  kode_item: string | null;
  nama: string;
  barcode: string | null;
  qty: number;
  satuan: string | null;
  stok_sebelum: number;
  stok_sesudah: number;
}
