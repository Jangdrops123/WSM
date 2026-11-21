// Pemetaan akun otomatis (Bagian B) — semua kode jurnal otomatis dibaca dari
// settings 'akuntansi_pemetaan' (Pengaturan › Pemetaan Akun), TIDAK ditulis
// mati di dalam rute. Pengaturan PPN dari settings 'akuntansi_ppn'.
import { get, run } from '../db.pg.ts';
import { tolak } from './http.ts';

export interface PetaanAkun {
  /** peran akun → kode akun COA (mis. kas_kasir → "1-1100"). */
  peran: Record<string, string>;
  /** metode bayar → kunci peran (mis. tunai → kas_kasir). */
  metode: Record<string, string>;
}

/** Daftar peran akun otomatis yang harus selalu terpetakan (label untuk UI). */
export const PERAN_AKUN: { kunci: string; label: string }[] = [
  { kunci: 'kas_kasir', label: 'Kas Kasir' },
  { kunci: 'kas_besar', label: 'Kas Besar' },
  { kunci: 'bank', label: 'Bank' },
  { kunci: 'kas_dalam_penyelesaian', label: 'Kas Dalam Penyelesaian (QRIS/EDC)' },
  { kunci: 'piutang', label: 'Piutang Usaha' },
  { kunci: 'persediaan', label: 'Persediaan Barang Dagang' },
  { kunci: 'ppn_masukan', label: 'PPN Masukan' },
  { kunci: 'uang_muka_pembelian', label: 'Uang Muka Pembelian' },
  { kunci: 'hutang_usaha', label: 'Hutang Usaha' },
  { kunci: 'ppn_keluaran', label: 'PPN Keluaran' },
  { kunci: 'uang_muka_pelanggan', label: 'Uang Muka Pelanggan' },
  { kunci: 'laba_ditahan', label: 'Laba Ditahan (penutup)' },
  { kunci: 'penjualan', label: 'Penjualan' },
  { kunci: 'diskon_penjualan', label: 'Diskon Penjualan' },
  { kunci: 'retur_penjualan', label: 'Retur Penjualan' },
  { kunci: 'pendapatan_lain', label: 'Pendapatan Lain-lain' },
  { kunci: 'selisih_stok_lebih', label: 'Selisih Stok Lebih' },
  { kunci: 'hpp', label: 'HPP' },
  { kunci: 'diskon_pembelian', label: 'Diskon Pembelian' },
  { kunci: 'selisih_stok_kurang', label: 'Selisih Stok Kurang' },
  { kunci: 'selisih_kas', label: 'Selisih Kas Kasir' },
  { kunci: 'beban_admin_bank', label: 'Beban Administrasi Bank' },
];

export const METODE_BAYAR = ['tunai', 'transfer', 'qris', 'kredit'] as const;

/** Baca pemetaan akun dari settings (bila kosong, kembalikan struktur kosong). */
export async function bacaPemetaan(): Promise<PetaanAkun> {
  const row = await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'akuntansi_pemetaan'`);
  let petaan: PetaanAkun = { peran: {}, metode: {} };
  if (row?.nilai) {
    try {
      const parsed = JSON.parse(row.nilai) as Partial<PetaanAkun>;
      petaan = { peran: parsed.peran ?? {}, metode: parsed.metode ?? {} };
    } catch {
      /* JSON rusak — pemetaan dianggap kosong agar kesalahan terlihat jelas */
    }
  }
  return petaan;
}

/** Simpan pemetaan akun (dipanggil halaman Pengaturan › Pemetaan Akun). */
export async function simpanPemetaan(petaan: PetaanAkun): Promise<void> {
  const nilai = JSON.stringify({ peran: petaan.peran, metode: petaan.metode });
  await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES ('akuntansi_pemetaan', ?, 'Pemetaan peran akun otomatis & metode bayar → kode akun COA')
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    nilai,
  );
}

/** id akun dari sebuah peran — SELALU lewat pemetaan (bukan kode mati). */
export async function akunPeran(peran: string): Promise<number> {
  const petaan = await bacaPemetaan();
  const kode = petaan.peran[peran];
  if (!kode) throw tolak(500, `Pemetaan akun untuk peran "${peran}" belum diatur — buka Pengaturan › Pemetaan Akun.`);
  const a = await get<{ id: number }>(`SELECT id FROM accounts WHERE kode = ?`, kode);
  if (!a) throw tolak(500, `Akun "${kode}" (peran ${peran}) tidak ada di COA — perbarui Pemetaan Akun.`);
  return a.id;
}

/** id akun untuk sebuah metode bayar (tunai/transfer/qris/kredit) via pemetaan. */
export async  function akunMetodeBayar(metode: string): Promise<number> {
  const petaan = await bacaPemetaan();
  const peran = petaan.metode[metode];
  if (!peran) throw tolak(500, `Pemetaan metode bayar "${metode}" belum diatur — buka Pengaturan › Pemetaan Akun.`);
  return await akunPeran(peran);
}

export interface PengaturanPpn {
  aktif: boolean;
  tarif: number;
  hargaTermasuk: boolean;
}

/** Pengaturan PPN (PKP/non-PKP, tarif %, harga termasuk PPN). */
export async function pengaturanPpn(): Promise<PengaturanPpn> {
  const row = await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'akuntansi_ppn'`);
  let p: PengaturanPpn = { aktif: false, tarif: 11, hargaTermasuk: false };
  if (row?.nilai) {
    try {
      const parsed = JSON.parse(row.nilai) as { aktif?: boolean; tarif?: number; harga_termasuk?: boolean };
      p = {
        aktif: !!parsed.aktif,
        tarif: Number.isFinite(Number(parsed.tarif)) ? Math.min(100, Math.max(0, Number(parsed.tarif))) : 11,
        hargaTermasuk: !!parsed.harga_termasuk,
      };
    } catch {
      /* JSON rusak — pakai bawaan nonaktif */
    }
  }
  return p;
}

export async function simpanPengaturanPpn(p: PengaturanPpn): Promise<void> {
  const nilai = JSON.stringify({ aktif: p.aktif, tarif: p.tarif, harga_termasuk: p.hargaTermasuk });
  await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES ('akuntansi_ppn', ?, 'Pengaturan PPN: aktif (PKP), tarif %, harga sudah termasuk PPN')
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
    nilai,
  );
}
