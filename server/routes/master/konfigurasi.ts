// Konfigurasi entitas Master Data untuk CRUD generik (API + impor/ekspor Excel).
// Nama tabel & kolom TIDAK berubah — mengikuti skema resmi.

export type TipeKolom = 'teks' | 'teks_wajib' | 'teks_panjang' | 'angka' | 'angka_bulat' | 'bool' | 'ref';

export interface KolomEntitas {
  key: string;
  label: string;
  tipe: TipeKolom;
  wajib?: boolean;
  unik?: boolean;
  min?: number;
  max?: number;
  /** Rujukan boleh kosong (mis. Profil size pada Kategori — kosong = belum terklasifikasi). */
  opsional?: boolean;
  /** Kolom rujukan: resolusi id ↔ tampilan saat ekspor/impor. */
  ref?: { tabel: string; kolomCari: string; kolomTampil: string; labelTampil: string };
}

export interface EntitasConfig {
  kode: string;
  tabel: string;
  label: string;
  kolom: KolomEntitas[];
  cariKolom: string[];
  urutBawaan: string;
  urutDiizinkan: string[];
  /** Filter tambahan pada daftar (mis. lokasi per gudang). */
  filter?: { key: string; label: string; refTabel: string; refKolomCari: string }[];
}

const AUDIT_KOLOM = ['dibuat_oleh', 'dibuat_pada', 'diubah_pada'] as const;

export const ENTITAS: Record<string, EntitasConfig> = {
  kategori: {
    kode: 'kategori',
    tabel: 'categories',
    label: 'Kategori',
    kolom: [
      { key: 'nama', label: 'Nama Kategori', tipe: 'teks_wajib', wajib: true, unik: true, max: 120 },
      // AF2 — klasifikasi barang: kosong = belum diklasifikasi (resolusi otomatis).
      {
        key: 'size_profile_id',
        label: 'Profil size',
        tipe: 'ref',
        opsional: true,
        ref: { tabel: 'size_profiles', kolomCari: 'kode', kolomTampil: 'nama', labelTampil: 'Profil size' },
      },
    ],
    cariKolom: ['nama'],
    urutBawaan: 'nama',
    urutDiizinkan: ['nama', 'dibuat_pada'],
  },
  merek: {
    kode: 'merek',
    tabel: 'brands',
    label: 'Merek',
    kolom: [{ key: 'nama', label: 'Nama Merek', tipe: 'teks_wajib', wajib: true, unik: true, max: 120 }],
    cariKolom: ['nama'],
    urutBawaan: 'nama',
    urutDiizinkan: ['nama', 'dibuat_pada'],
  },
  satuan: {
    kode: 'satuan',
    tabel: 'units',
    label: 'Satuan',
    kolom: [
      { key: 'kode', label: 'Kode', tipe: 'teks_wajib', wajib: true, unik: true, max: 20 },
      { key: 'nama', label: 'Nama Satuan', tipe: 'teks_wajib', wajib: true, unik: true, max: 60 },
    ],
    cariKolom: ['kode', 'nama'],
    urutBawaan: 'nama',
    urutDiizinkan: ['kode', 'nama', 'dibuat_pada'],
  },
  pelanggan: {
    kode: 'pelanggan',
    tabel: 'customers',
    label: 'Pelanggan',
    kolom: [
      { key: 'nama', label: 'Nama Pelanggan', tipe: 'teks_wajib', wajib: true, max: 160 },
      { key: 'telepon', label: 'Telepon', tipe: 'teks', max: 40 },
      { key: 'alamat', label: 'Alamat', tipe: 'teks_panjang', max: 400 },
      { key: 'limit_piutang', label: 'Limit Piutang', tipe: 'angka', min: 0 },
      { key: 'aktif', label: 'Status Aktif', tipe: 'bool' },
    ],
    cariKolom: ['nama', 'telepon'],
    urutBawaan: 'nama',
    urutDiizinkan: ['nama', 'telepon', 'limit_piutang', 'dibuat_pada'],
  },
  pemasok: {
    kode: 'pemasok',
    tabel: 'suppliers',
    label: 'Pemasok',
    kolom: [
      { key: 'nama', label: 'Nama Pemasok', tipe: 'teks_wajib', wajib: true, max: 160 },
      { key: 'telepon', label: 'Telepon', tipe: 'teks', max: 40 },
      { key: 'alamat', label: 'Alamat', tipe: 'teks_panjang', max: 400 },
      { key: 'termin_hari', label: 'Termin (hari)', tipe: 'angka_bulat', min: 0 },
      { key: 'aktif', label: 'Status Aktif', tipe: 'bool' },
    ],
    cariKolom: ['nama', 'telepon'],
    urutBawaan: 'nama',
    urutDiizinkan: ['nama', 'telepon', 'termin_hari', 'dibuat_pada'],
  },
  gudang: {
    kode: 'gudang',
    tabel: 'warehouses',
    label: 'Gudang',
    kolom: [
      { key: 'kode', label: 'Kode Gudang', tipe: 'teks_wajib', wajib: true, unik: true, max: 20 },
      { key: 'nama', label: 'Nama Gudang', tipe: 'teks_wajib', wajib: true, unik: true, max: 120 },
      // AS1/AS3 — nonaktif mengunci gudang di form pengguna & melepas akses.
      { key: 'aktif', label: 'Status Aktif', tipe: 'bool' },
    ],
    cariKolom: ['kode', 'nama'],
    urutBawaan: 'nama',
    urutDiizinkan: ['kode', 'nama', 'dibuat_pada'],
  },
  lokasi: {
    kode: 'lokasi',
    tabel: 'locations',
    label: 'Lokasi',
    kolom: [
      {
        key: 'warehouse_id',
        label: 'Gudang',
        tipe: 'ref',
        wajib: true,
        ref: { tabel: 'warehouses', kolomCari: 'kode', kolomTampil: 'nama', labelTampil: 'Gudang' },
      },
      { key: 'kode_lokasi', label: 'Kode Lokasi', tipe: 'teks_wajib', wajib: true, unik: true, max: 40 },
      { key: 'zona', label: 'Zona', tipe: 'teks', max: 40 },
      { key: 'rak', label: 'Rak', tipe: 'teks', max: 40 },
      { key: 'bin', label: 'Bin', tipe: 'teks', max: 40 },
    ],
    cariKolom: ['kode_lokasi', 'zona', 'rak', 'bin'],
    urutBawaan: 'kode_lokasi',
    urutDiizinkan: ['kode_lokasi', 'zona', 'rak', 'bin', 'dibuat_pada'],
    filter: [{ key: 'warehouse_id', label: 'Gudang', refTabel: 'warehouses', refKolomCari: 'kode' }],
  },
};

export const KOLOM_AUDIT = AUDIT_KOLOM;

/** Kolom yang selalu ikut saat daftar (bukan untuk input). */
export function kolomBawaan(): string[] {
  return ['id', ...AUDIT_KOLOM];
}
