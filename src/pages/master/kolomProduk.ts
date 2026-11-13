/**
 * Model kolom Produk untuk wizard Impor & dialog Ekspor (Excel / PDF).
 *
 * SAMBUNGKAN DENGAN `KOLOM_IMPOR` pada server/routes/master/produk.ts —
 * daftar di sini hanyalah tampilan (label + format + keterangan) untuk klien;
 * sumber kebenaran pemetaan & penulisan tetap di server. Kolom turunan (stok)
 * hanya ada saat ekspor dan tidak ikut template impor.
 */
export interface KolomProduk {
  key: string;
  label: string;
  wajib: boolean;
  format: string;
  ket: string;
  /** Kolom turunan — hanya tersedia saat ekspor (tidak diimpor). */
  turunan?: boolean;
  /** Angka / rupiah → rata kanan pada pratinjau & PDF. */
  angka?: boolean;
}

export const KOLOM_PRODUK: KolomProduk[] = [
  { key: 'kode_item', label: 'Kode Item', wajib: true, format: 'Teks unik (BRG-0001)', ket: 'Kode unik produk. Wajib. Impor bersifat UPSERT per kode_item.' },
  { key: 'nama_produk', label: 'Nama Produk', wajib: true, format: 'Teks', ket: 'Nama produk. Wajib.' },
  { key: 'sku', label: 'SKU', wajib: true, format: 'Teks unik', ket: 'SKU produk — unik di seluruh katalog (tanpa varian).' },
  { key: 'kategori', label: 'Kategori', wajib: false, format: 'Teks', ket: 'Nama kategori — bila belum ada, dibuat otomatis saat konfirmasi impor.' },
  { key: 'merek', label: 'Merek', wajib: false, format: 'Teks', ket: 'Nama merek — bila belum ada, dibuat otomatis saat konfirmasi impor.' },
  { key: 'satuan', label: 'Satuan', wajib: false, format: 'Teks (kode/nama satuan)', ket: 'Satuan dasar produk — harus sudah ada di menu Satuan.' },
  { key: 'profil_size', label: 'Profil Size', wajib: false, format: 'Teks (nama profil)', ket: 'Nama profil size (mis. Sepatu Pria) dari Pengaturan ▸ Aturan Kodi.' },
  { key: 'barcode', label: 'Barcode', wajib: false, format: 'Teks unik', ket: 'Barcode produk; kosongkan bila tidak ada.' },
  { key: 'harga_beli', label: 'Harga Beli', wajib: false, format: 'Angka ≥ 0', ket: 'Kosong = tidak diubah (produk baru: 0).', angka: true },
  { key: 'harga_jual', label: 'Harga Jual', wajib: false, format: 'Angka ≥ 0', ket: 'Harga jual produk. Kosong = tidak diubah (produk baru: 0).', angka: true },
  { key: 'stok_min', label: 'Stok Minimum', wajib: false, format: 'Angka ≥ 0', ket: 'Batas stok minimum (kolom MINIMUM di Stok Persediaan). Kosong = 0.', angka: true },
  { key: 'status', label: 'Status', wajib: false, format: 'Aktif / Nonaktif', ket: 'Status produk. Kosong = Aktif (produk baru) / tidak diubah.' },
  { key: 'nama_file_foto', label: 'Nama File Foto', wajib: false, format: 'Teks', ket: 'Nama file hasil Unggah Foto Massal (BRG-0001.jpg) atau URL https://… .' },
  { key: 'stok', label: 'Stok', wajib: false, format: 'Angka', ket: 'Jumlah stok total saat ini — hanya tersedia saat ekspor, tidak ikut template impor.', turunan: true, angka: true },
];

/**
 * Kolom khusus impor (tidak ada di daftar/export): gudang penempatan +
 * stok awal. Dipetakan di wizard "Cocokkan kolom" dan dibaca server.
 */
const KOLOM_IMPOR_TAMBAHAN: KolomProduk[] = [
  { key: 'gudang', label: 'Gudang', wajib: false, format: 'Teks (kode/nama gudang)', ket: 'Gudang penempatan stok awal — harus sudah ada di Master › Gudang.' },
  { key: 'stok_awal', label: 'Stok Awal', wajib: false, format: 'Angka ≥ 0', ket: 'Stok awal di gudang tersebut — ditulis bila saldo gudang masih kosong, tercatat di Kartu Stok.', angka: true },
];

/** Kolom yang boleh dipetakan saat impor (semua kecuali turunan + khusus impor). */
export const KOLOM_IMPOR_PRODUK = [...KOLOM_PRODUK.filter((k) => !k.turunan), ...KOLOM_IMPOR_TAMBAHAN];

export const kolomProduk = (key: string): KolomProduk =>
  KOLOM_PRODUK.find((k) => k.key === key) ?? { key, label: key, wajib: false, format: '', ket: '' };

/** Normalkan judul kolom agar pembandingan tidak sensitif spasi/huruf/kutip. */
function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Sinonim judul kolom Excel yang lazim dipakai pengguna — dipakai pemetaan
 * otomatis langkah "Cocokkan kolom" sebelum dicocokkan persis.
 */
const SINONIM: Record<string, string[]> = {
  kode_item: ['kode', 'kodeitem', 'kodeproduk', 'code', 'id', 'idproduk', 'itemcode'],
  nama_produk: ['nama', 'namaproduk', 'namabarang', 'nam item', 'namabaranglengkap', 'produk', 'description', 'deskripsi'],
  sku: ['sku', 'kodeSKU', 'codesku', 'articlesku', 'nomorsku'],
  kategori: ['kategori', 'category', 'jenis', 'golongan', 'tipe'],
  merek: ['merek', 'brand', 'merk', 'pabrikan'],
  satuan: ['satuan', 'unit', 'uom', 'satuan dasar', 'satuanDasar'],
  profil_size: ['profil', 'profilsize', 'sizeprofile', 'aturankodi', 'aturan kodi'],
  barcode: ['barcode', 'barcodes', 'ean', 'upc', 'kodebatang', 'kodeserat'],
  harga_beli: ['hargabeli', 'beli', 'hpp', 'modal', 'harga modal', 'cost', 'purchaseprice'],
  harga_jual: ['hargajual', 'jual', 'harga', 'retail', 'harga retel', 'sellingprice', 'price'],
  stok_min: ['stokmin', 'stokminimum', 'minimum', 'minstock', 'minstok', 'batasstok', 'minimumstok'],
  status: ['status', 'aktif', 'state', 'enable'],
  gudang: ['gudang', 'warehouse', 'kodegudang', 'namagudang', 'gudangpenempatan'],
  stok_awal: ['stokawal', 'qtyawal', 'jumlahawal', 'saldoawal', 'openingstock'],
  nama_file_foto: ['foto', 'namafilefoto', 'gambar', 'image', 'photo', 'namafoto', 'filefoto'],
};

/**
 * Pemetaan otomatis: cocokkan kolom file Excel dengan kolom modul.
 * Urutan: (1) judul persis, (2) sinonim umum, (3) pertama yang belum dipakai.
 */
export function autoPemetaan(kolomFile: string[], kolomModul = KOLOM_IMPOR_PRODUK): Record<string, string> {
  const dipakai = new Set<string>();
  const hasil: Record<string, string> = {};
  const normFile = new Map(kolomFile.map((k) => [norm(k), k]));

  for (const m of kolomModul) {
    // 1. persis
    const persis = normFile.get(norm(m.key)) ?? normFile.get(norm(m.label));
    if (persis && !dipakai.has(persis)) {
      hasil[m.key] = persis;
      dipakai.add(persis);
    }
  }
  for (const m of kolomModul) {
    if (hasil[m.key]) continue;
    // 2. sinonim
    for (const s of SINONIM[m.key] ?? []) {
      const cocok = normFile.get(norm(s));
      if (cocok && !dipakai.has(cocok)) {
        hasil[m.key] = cocok;
        dipakai.add(cocok);
        break;
      }
    }
  }
  // 3. mengandung — judul file yang memuat nama kolom modul (min. 4 huruf),
  //    mis. "Harga Jual Satuan" → harga_jual, "Daftar Harga Beli" → harga_beli.
  for (const m of kolomModul) {
    if (hasil[m.key]) continue;
    const calon = [norm(m.key), norm(m.label)].filter((s) => s.length >= 4);
    if (!calon.length) continue;
    const cocok = kolomFile.find((c) => {
      const n = norm(c);
      return n.length >= 4 && !dipakai.has(c) && calon.some((s) => n.includes(s) || s.includes(n));
    });
    if (cocok) {
      hasil[m.key] = cocok;
      dipakai.add(cocok);
    }
  }
  return hasil;
}
