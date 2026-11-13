import type { BidangForm, KolomTabel } from '../../components/crud/HalamanGenerik';
import { formatAngka, formatRupiah } from '../../lib/format';

export interface KonfigurasiSederhana {
  entitas: string;
  judul: string;
  deskripsi: string;
  cariContoh: string;
  kolom: KolomTabel[];
  form: BidangForm[];
  /** AG6 — aksi massal "Atur Profil size" (khusus Kategori). */
  massalUbah?: { key: string; label: string; opsiUrl: string; labelKosong: string };
}

/** Konfigurasi halaman CRUD untuk entitas sederhana. */
export const ENTITAS_SEDERHANA: Record<string, KonfigurasiSederhana> = {
  kategori: {
    entitas: 'kategori',
    judul: 'Kategori',
    deskripsi: 'Kelompokkan produk berdasarkan kategori. Profil size menandai pola ukuran (mis. S–XL) milik kategori.',
    cariContoh: 'Cari kategori…',
    kolom: [
      { key: 'nama', label: 'Nama Kategori' },
      { key: 'size_profile_id_label', label: 'Profil Size', render: (b) => b.size_profile_id_label ?? '—' },
    ],
    form: [
      { key: 'nama', label: 'Nama Kategori', tipe: 'teks', wajib: true },
      // AF2 — klasifikasi barang: kosong = belum diklasifikasi (resolusi otomatis).
      {
        key: 'size_profile_id',
        label: 'Profil size',
        tipe: 'ref',
        opsiUrl: '/api/profil-size/opsi',
        labelKosong: '— belum diklasifikasi —',
      },
    ],
    massalUbah: {
      key: 'size_profile_id',
      label: 'Profil size',
      opsiUrl: '/api/profil-size/opsi',
      labelKosong: '— belum diklasifikasi —',
    },
  },
  merek: {
    entitas: 'merek',
    judul: 'Merek',
    deskripsi: 'Daftar merek/brand produk.',
    cariContoh: 'Cari merek…',
    kolom: [{ key: 'nama', label: 'Nama Merek' }],
    form: [{ key: 'nama', label: 'Nama Merek', tipe: 'teks', wajib: true }],
  },
  satuan: {
    entitas: 'satuan',
    judul: 'Satuan',
    deskripsi: 'Satuan dasar & kelipatan (pcs, lusin, kodi, dus…).',
    cariContoh: 'Cari kode atau nama satuan…',
    kolom: [
      { key: 'kode', label: 'Kode' },
      { key: 'nama', label: 'Nama Satuan' },
    ],
    form: [
      { key: 'kode', label: 'Kode', tipe: 'teks', wajib: true, contoh: 'PCS' },
      { key: 'nama', label: 'Nama Satuan', tipe: 'teks', wajib: true, contoh: 'Pcs' },
    ],
  },
  pelanggan: {
    entitas: 'pelanggan',
    judul: 'Pelanggan',
    deskripsi: 'Data pelanggan beserta limit piutang.',
    cariContoh: 'Cari nama atau telepon…',
    kolom: [
      { key: 'nama', label: 'Nama Pelanggan' },
      { key: 'telepon', label: 'Telepon' },
      { key: 'alamat', label: 'Alamat', render: (b) => b.alamat ?? '—' },
      { key: 'limit_piutang', label: 'Limit Piutang', rata: 'kanan', render: (b) => formatRupiah(Number(b.limit_piutang ?? 0)) },
      { key: 'aktif', label: 'Status', render: (b) => (Number(b.aktif ?? 1) === 1 ? 'Aktif' : 'Nonaktif') },
    ],
    form: [
      { key: 'nama', label: 'Nama Pelanggan', tipe: 'teks', wajib: true },
      { key: 'telepon', label: 'Telepon', tipe: 'teks', contoh: '0812…' },
      { key: 'limit_piutang', label: 'Limit Piutang', tipe: 'angka', min: 0 },
      { key: 'alamat', label: 'Alamat', tipe: 'teks_panjang' },
      { key: 'aktif', label: 'Pelanggan aktif', tipe: 'bool' },
    ],
  },
  pemasok: {
    entitas: 'pemasok',
    judul: 'Pemasok',
    deskripsi: 'Data supplier beserta termin pembayaran.',
    cariContoh: 'Cari nama atau telepon…',
    kolom: [
      { key: 'nama', label: 'Nama Pemasok' },
      { key: 'telepon', label: 'Telepon' },
      { key: 'alamat', label: 'Alamat' },
      { key: 'termin_hari', label: 'Termin', rata: 'kanan', render: (b) => `${formatAngka(Number(b.termin_hari ?? 0))} hari` },
      { key: 'aktif', label: 'Status', render: (b) => (Number(b.aktif ?? 1) === 1 ? 'Aktif' : 'Nonaktif') },
    ],
    form: [
      { key: 'nama', label: 'Nama Pemasok', tipe: 'teks', wajib: true },
      { key: 'telepon', label: 'Telepon', tipe: 'teks', contoh: '021…' },
      { key: 'termin_hari', label: 'Termin (hari)', tipe: 'angka', min: 0 },
      { key: 'alamat', label: 'Alamat', tipe: 'teks_panjang' },
      { key: 'aktif', label: 'Pemasok aktif', tipe: 'bool' },
    ],
  },
};
