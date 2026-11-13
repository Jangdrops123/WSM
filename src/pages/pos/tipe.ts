// Tipe bersama halaman POS — Master Produk tanpa varian:
// satu baris produk = satu unit stok, keranjang merujuk product_id langsung.

export interface ProdukPos {
  id: number;
  kode_item: string | null;
  nama: string;
  sku: string;
  barcode: string | null;
  foto_url: string | null;
  category_id: number | null;
  kategori: string | null;
  stok_min: number;
  harga: number;
  stok: number;
  /** Stok per gudang: { [warehouse_id]: qty } */
  stok_gudang: Record<string, number>;
}

export interface BarisKeranjang {
  productId: number;
  nama: string;
  sku: string;
  harga: number;
  qty: number;
  /** Stok produk di gudang terpilih saat baris ditambahkan. */
  stok: number;
  /** Diskon baris (Rp) — dipakai POS Mode Cepat; foto memakai diskon kasir. */
  diskon?: number;
}

/** Hasil autocomplete /api/pos/cari — satu baris = satu produk (unit jual). */
export interface SaranCari {
  product_id: number;
  nama: string;
  kode_item: string | null;
  sku: string;
  barcode: string | null;
  /** Stok minimum produk — warna kuning "menipis" pada Mode Cepat (J2). */
  stok_min: number;
  harga: number;
  stok: number;
}

export interface ShiftAktif {
  id: number;
  kas_awal: number;
  dibuat_pada: string;
  ringkasan: {
    jumlah_transaksi: number;
    penjualan: number;
    tunai: number;
    /** Pelunasan piutang tunai pada shift ini (menambah laci). */
    tunai_piutang?: number;
    penerimaan_tunai?: number;
  };
}

export interface Opsi {
  id: number;
  label: string;
  /** Nomor telepon master (pelanggan/pemasok) — isi otomatis nomor WhatsApp. */
  telepon?: string | null;
}
