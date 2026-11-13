// ============================================================================
// AKUNTANSI DASAR — helper jurnal LAMA dinonaktifkan.
// Modul akuntansi (COA/jurnal/buku besar/neraca/penutupan periode) dihapus dan
// diganti Akuntansi Dasar (kas, biaya, pemasukan, piutang/hutang, laporan).
//   • idPenggunaBawaan  — MASIH DIPAKAI banyak modul (POS, opname, dashboard)
//   • buatJurnal / balikJurnalSumber — NO-OP: transaksi tetap tersimpan normal,
//     hanya tidak lagi membuat jurnal.
// Kas bergerak lewat lib/dasarKas (penjualan tunai, pembelian tunai, pelunasan
// piutang/hutang) — lihat catatBayarTagihanKas & catatPenjualanTunai dsb.
// ============================================================================
import { get } from '../db.pg.ts';
import { tolak } from './http.ts';
import { catatMutasiKas } from './dasarKas.ts';

/** id pengguna bawaan (modul login menyusul — pakai pengguna pertama). */
export async function idPenggunaBawaan(): Promise<number> {
  const u = await get<{ id: number }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
  if (!u) throw tolak(500, 'Belum ada pengguna — jalankan migrasi 008_pos.');
  return u.id;
}

// ---------------------------------------------------------------------------
// Jurnal: NO-OP agar pemanggil lama (POS/Pembelian/Opname) tidak rusak.
// ---------------------------------------------------------------------------

/** Tidak membuat jurnal lagi (Akuntansi Dasar tanpa jurnal). */
export function buatJurnal(
  _sumberTipe: string,
  _sumberId: number | null,
  _keterangan: string,
  _baris: {
    akun: number;
    debit: number;
    kredit: number;
    product_id?: number;
    nama_produk?: string;
    sku?: string;
  }[],
  _dibuatOleh?: number | null,
  _tanggal?: string,
): number {
  return 0;
}

/** Tidak membalik jurnal (tidak ada jurnal untuk dibalik). */
export function balikJurnalSumber(
  _sumberTipe: string,
  _sumberId: number,
  _alasan: string,
  _dibuatOleh?: number | null,
): number[] {
  return [];
}

// ---------------------------------------------------------------------------
// Kas otomatis dari transaksi (dipanggil POS/Pembelian/Pelunasan).
// ---------------------------------------------------------------------------

/**
 * Catat kas dari pembayaran piutang/hutang. `akunKasId` = rekening kas yang
 * dipakai (hasil pemetaan metode bayar). Piutang masuk kas, hutang keluar kas.
 */
export async  function catatBayarTagihanKas(params: {
  tipe: 'piutang' | 'hutang';
  akunKasId: number;
  jumlah: number;
  keterangan: string;
  sumberId: number;
  dibuatOleh?: number | null;
}): Promise<void> {
  if (!(params.jumlah > 0)) return;
  await catatMutasiKas({
    tipe: params.tipe === 'piutang' ? 'masuk' : 'keluar',
    akunId: params.akunKasId,
    jumlah: params.jumlah,
    keterangan: params.keterangan,
    sumberTipe: 'pembayaran',
    sumberId: params.sumberId,
    dibuatOleh: params.dibuatOleh ?? null,
  });
}
