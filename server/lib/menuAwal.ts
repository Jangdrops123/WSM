// ============================================================================
// AY — Menu awal setelah login per peran.
//
// Atribut peran (BUKAN izin): satu kode halaman stabil per baris roles.
// Tidak ada matriks, baris, kolom, atau kode izin baru — seluruh pemeriksaan
// tetap memakai sel Lihat pada matriks peran yang sudah ada.
//
// Kode halaman stabil (tidak berubah walau judul menu berubah):
//   dashboard, master-*, stok-*, pembelian-*, penjualan-*, pos-*,
//   akuntansi, laporan-*, pengaturan
// ============================================================================

import { all, get } from '../db.pg.ts';

export interface PilihanMenuAwal {
  kode: string;
  label: string;
  grup: string;
  rute: string;
  /** Modul matriks yang sel Lihat-nya disyaratkan (null = selalu boleh). */
  modul: string | null;
}

export interface GrupMenuAwal {
  grup: string;
  opsi: { kode: string; label: string; rute: string }[];
}

/** Registri tunggal — cermin di src/config/menuAwal.ts (ubah keduanya). */
export const DAFTAR_MENU_AWAL: PilihanMenuAwal[] = [
  { kode: 'dashboard', label: 'Dashboard', grup: 'Dashboard', rute: '/', modul: 'dashboard' },
  { kode: 'master-produk', label: 'Produk', grup: 'Master Data', rute: '/master/produk', modul: 'master' },
  { kode: 'master-konversi', label: 'Konversi Satuan', grup: 'Master Data', rute: '/master/konversi', modul: 'master' },
  { kode: 'master-paket', label: 'Paket / Box', grup: 'Master Data', rute: '/master/paket', modul: 'master' },
  { kode: 'master-kategori', label: 'Kategori', grup: 'Master Data', rute: '/master/kategori', modul: 'master' },
  { kode: 'master-merek', label: 'Merek', grup: 'Master Data', rute: '/master/merek', modul: 'master' },
  { kode: 'master-satuan', label: 'Satuan', grup: 'Master Data', rute: '/master/satuan', modul: 'master' },
  { kode: 'master-pelanggan', label: 'Pelanggan', grup: 'Master Data', rute: '/master/pelanggan', modul: 'master' },
  { kode: 'master-pemasok', label: 'Pemasok', grup: 'Master Data', rute: '/master/pemasok', modul: 'master' },
  { kode: 'master-gudang', label: 'Gudang & Lokasi', grup: 'Master Data', rute: '/master/gudang', modul: 'master' },
  { kode: 'stok-saat-ini', label: 'Stok Saat Ini', grup: 'Stok', rute: '/stok', modul: 'stok' },
  { kode: 'stok-masuk', label: 'Item Masuk', grup: 'Stok', rute: '/stok/masuk', modul: 'stok' },
  { kode: 'stok-keluar', label: 'Item Keluar', grup: 'Stok', rute: '/stok/keluar', modul: 'stok' },
  { kode: 'stok-opname', label: 'Opname', grup: 'Stok', rute: '/stok/opname', modul: 'opname' },
  { kode: 'pembelian-input', label: 'Input Pembelian', grup: 'Pembelian', rute: '/pembelian', modul: 'pembelian' },
  { kode: 'pembelian-riwayat', label: 'Riwayat & Dokumen', grup: 'Pembelian', rute: '/pembelian/riwayat', modul: 'pembelian' },
  { kode: 'penjualan-riwayat', label: 'Riwayat Penjualan', grup: 'Penjualan', rute: '/penjualan', modul: 'penjualan' },
  { kode: 'pos-foto', label: 'POS Mode Foto', grup: 'Penjualan', rute: '/penjualan/pos/foto', modul: 'pos' },
  { kode: 'pos-tanpa-foto', label: 'POS Mode Tanpa Foto', grup: 'Penjualan', rute: '/penjualan/pos/tanpa-foto', modul: 'pos' },
  { kode: 'penjualan-retur', label: 'Retur', grup: 'Penjualan', rute: '/penjualan/retur', modul: 'penjualan' },
  { kode: 'penjualan-piutang', label: 'Piutang', grup: 'Penjualan', rute: '/penjualan/piutang', modul: 'penjualan' },
  { kode: 'akuntansi', label: 'Akuntansi', grup: 'Akuntansi', rute: '/akuntansi', modul: 'akuntansi' },
  { kode: 'laporan-ringkasan', label: 'Ringkasan', grup: 'Laporan', rute: '/laporan', modul: 'laporan' },
  { kode: 'laporan-penjualan', label: 'Penjualan', grup: 'Laporan', rute: '/laporan/penjualan', modul: 'laporan' },
  { kode: 'laporan-pembelian', label: 'Pembelian', grup: 'Laporan', rute: '/laporan/pembelian', modul: 'laporan' },
  { kode: 'laporan-stok', label: 'Stok & Persediaan', grup: 'Laporan', rute: '/laporan/stok', modul: 'laporan' },
  { kode: 'laporan-opname', label: 'Opname', grup: 'Laporan', rute: '/laporan/opname', modul: 'laporan' },
  { kode: 'laporan-keuangan', label: 'Keuangan', grup: 'Laporan', rute: '/laporan/keuangan', modul: 'laporan' },
  { kode: 'laporan-dasar', label: 'Laporan Dasar', grup: 'Laporan', rute: '/akuntansi/laporan', modul: 'akuntansi' },
  { kode: 'laporan-pajak', label: 'Pajak', grup: 'Laporan', rute: '/laporan/pajak', modul: 'laporan' },
  { kode: 'laporan-piutang', label: 'Piutang & Utang', grup: 'Laporan', rute: '/laporan/piutang', modul: 'laporan' },
  { kode: 'laporan-tersimpan', label: 'Laporan Tersimpan', grup: 'Laporan', rute: '/laporan/tersimpan', modul: 'laporan' },
  { kode: 'pengaturan', label: 'Pengaturan', grup: 'Pengaturan', rute: '/pengaturan', modul: 'pengaturan' },
];

/** Urutan fallback = urutan sidebar (tanpa Dashboard — dasbor tidak dihitung sebagai halaman berizin). */
const URUT_FALLBACK = [
  'dashboard', 'master-produk', 'master-konversi', 'master-paket', 'master-kategori', 'master-merek',
  'master-satuan', 'master-pelanggan', 'master-pemasok', 'master-gudang',
  'stok-saat-ini', 'stok-masuk', 'stok-keluar', 'stok-opname',
  'pembelian-input', 'pembelian-riwayat',
  'penjualan-riwayat', 'penjualan-retur', 'penjualan-piutang', 'pos-foto', 'pos-tanpa-foto',
  'akuntansi',
  'laporan-ringkasan', 'laporan-penjualan', 'laporan-pembelian', 'laporan-stok',
  'laporan-opname', 'laporan-keuangan', 'laporan-dasar', 'laporan-pajak',
  'laporan-piutang', 'laporan-tersimpan',
  'pengaturan',
];

const PETA = new Map(DAFTAR_MENU_AWAL.map((p) => [p.kode, p]));

export function definisiMenuAwal(kode: string | null | undefined): PilihanMenuAwal | null {
  if (!kode) return null;
  return PETA.get(String(kode).trim()) ?? null;
}

export function labelMenuAwal(kode: string | null | undefined): string | null {
  return definisiMenuAwal(kode)?.label ?? null;
}

/** Sel Lihat yang disyaratkan sebuah kode halaman. */
export function modulUntukMenuAwal(kode: string): string | null {
  return definisiMenuAwal(kode)?.modul ?? null;
}

export function kodeMenuAwalSah(kode: unknown): kode is string {
  return typeof kode === 'string' && PETA.has(kode.trim());
}

/**
 * Pilihan untuk dropdown Admin: hanya halaman yang boleh dilihat peran
 * (sel Lihat tercentang). Dikelompokkan seperti sidebar.
 */
export function pilihanUntukHak(hakLihat: (modul: string | null) => boolean): GrupMenuAwal[] {
  const keluar: GrupMenuAwal[] = [];
  for (const p of DAFTAR_MENU_AWAL) {
    if (!hakLihat(p.modul)) continue;
    let g = keluar.find((x) => x.grup === p.grup);
    if (!g) {
      g = { grup: p.grup, opsi: [] };
      keluar.push(g);
    }
    g.opsi.push({ kode: p.kode, label: p.label, rute: p.rute });
  }
  return keluar;
}

/** Halaman pertama yang boleh dilihat (urutan sidebar) — untuk fallback aman. */
export function halamanPertama(hakLihat: (modul: string | null) => boolean): PilihanMenuAwal | null {
  for (const kode of URUT_FALLBACK) {
    const p = PETA.get(kode)!;
    if (hakLihat(p.modul)) return p;
  }
  return null;
}

/**
 * Selesaikan menu awal sebuah peran menjadi rute (diperiksa ulang di server
 * saat login — bukan hanya saat disimpan). Kembali null bila tidak ada
 * halaman yang boleh dilihat (klien menampilkan halaman tanpa-akses).
 */
export async function resolveMenuAwal(roleId: number, peranTop: boolean): Promise<{ kode: string; rute: string } | null> {
  let hak: Record<string, string[]>;
  if (peranTop) {
    hak = {};
  } else {
    hak = {};
    try {
      const rows = await all<{ menu: string; aksi: string }>(
        'SELECT menu, aksi FROM role_permissions WHERE role_id = ? AND aksi = ?',
        roleId,
        'lihat',
      );
      for (const r of rows) (hak[r.menu] ??= []).push(r.aksi);
    } catch {
      return null;
    }
  }
  const lihat = (modul: string | null): boolean => {
    if (modul === null) return true;
    if (peranTop) return true;
    return (hak[modul] ?? []).includes('lihat');
  };
  let tersimpan: string | null = null;
  try {
    tersimpan = await ((await get<{ menu_awal: string | null }>('SELECT menu_awal FROM roles WHERE id = ?', roleId)))?.menu_awal ?? null;
  } catch {
    tersimpan = null;
  }
  const def = definisiMenuAwal(tersimpan);
  if (def && lihat(def.modul)) return { kode: def.kode, rute: def.rute };
  const pertama = halamanPertama(lihat);
  if (pertama) return { kode: pertama.kode, rute: pertama.rute };
  return null;
}
