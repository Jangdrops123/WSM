// ============================================================================
// PEMBELIAN BERSIH (NET PURCHASE) — satu sumber angka untuk Dashboard & Laporan.
//
// Sebelumnya widget "Pembelian" hanya menjumlahkan `purchases` (pembelian
// langsung), sehingga nilai Purchase Order (yang tidak pernah membuat baris
// `purchases` saat penerimaan barang) tidak pernah muncul di Dashboard.
//
// Definisi yang dipakai sekarang:
//   Pembelian = Pembelian Langsung + Purchase Order Diterima
//   (fitur Retur Pembelian sudah dihapus — tidak ada pengurangan retur).
//
//   1. Pembelian Langsung : `purchases` status 'disahkan' (sama seperti dulu).
//   2. Purchase Order     : `purchase_orders` yang barangnya sudah diterima
//                           (status sebagian/selesai/selesai_kurang/lebih).
//                           PO yang sudah difakturkan lewat modul Pembelian
//                           (ada `purchases.no_po` yang sama & disahkan) TIDAK
//                           dihitung lagi agar tidak dobel.
//
// Filter periode & gudang memakai kolom `tanggal` pada masing-masing dokumen
// (zona toko), sehingga "Bulan ini"/rentang kustom berlaku konsisten.
// ============================================================================
import { all, get } from '../db.pg.ts';

export interface LingkupPembelian {
  /** Filter gudang eksplisit (dropdown widget/laporan). */
  gudang?: number | null;
  /** Isolasi gudang sesi; null/undefined = tanpa batasan. Array kosong = tidak ada akses. */
  lingkup?: number[] | null;
  /** Zona waktu toko untuk konversi tanggal (bawaan Asia/Jakarta). */
  zona?: string;
}

export type SumberPembelian = 'langsung' | 'po';

export interface BagianPembelian {
  kunci: SumberPembelian;
  sql: string;
  arg: unknown[];
}

const STATUS_PO_DITERIMA = `('sebagian','selesai','selesai_kurang','lebih')`;

function batasGudang(alias: string, l: LingkupPembelian): string {
  if (l.gudang) return ` AND ${alias}.warehouse_id = ${Number(l.gudang)}`;
  if (Array.isArray(l.lingkup)) {
    return l.lingkup.length
      ? ` AND ${alias}.warehouse_id IN (${l.lingkup.map((n) => Number(n)).join(',')})`
      : ' AND 1 = 0';
  }
  return '';
}

/** Tabel ada di database ini? (dipakai agar PO/retur yang belum dimigrasi dilewati) */
async function tabelAda(nama: string): Promise<boolean> {
  return Boolean(
    await get(`SELECT 1 AS ada FROM pg_tables WHERE schemaname = 'public' AND tablename = ?`, nama),
  );
}

/**
 * Potongan SQL per sumber (masing-masing menghasilkan `periode` & `nilai`
 * untuk rentang tanggal yang sama). Bisa di-UNION ALL untuk deret harian
 * maupun dijumlahkan untuk satu angka KPI.
 */
export async function bagianPembelianBersih(
  l: LingkupPembelian,
  dari: string,
  sampai: string,
): Promise<BagianPembelian[]> {
  const zona = l.zona ?? 'Asia/Jakarta';
  const tgl = (alias: string) => `(${alias}.tanggal AT TIME ZONE '${zona}')::date`;
  const bagian: BagianPembelian[] = [];

  bagian.push({
    kunci: 'langsung',
    sql: `SELECT ${tgl('p')} AS periode, COALESCE(SUM(p.total), 0) AS nilai
            FROM purchases p
           WHERE p.status = 'disahkan'${batasGudang('p', l)}
             AND ${tgl('p')} BETWEEN ? AND ?
           GROUP BY 1`,
    arg: [dari, sampai],
  });

  if (await tabelAda('purchase_orders')) {
    bagian.push({
      kunci: 'po',
      sql: `SELECT ${tgl('po')} AS periode, COALESCE(SUM(po.total_harga), 0) AS nilai
              FROM purchase_orders po
             WHERE po.status IN ${STATUS_PO_DITERIMA}${batasGudang('po', l)}
               AND ${tgl('po')} BETWEEN ? AND ?
               AND NOT EXISTS (SELECT 1 FROM purchases pf
                                WHERE pf.status = 'disahkan'
                                  AND pf.no_po IS NOT NULL
                                  AND po.no_po IS NOT NULL
                                  AND lower(trim(pf.no_po)) = lower(trim(po.no_po)))
             GROUP BY 1`,
      arg: [dari, sampai],
    });
  }

  return bagian;
}

/** Gabungan semua sumber → satu angka total (tanpa kolom periode). */
const totalSql = (bagian: BagianPembelian[]): string =>
  `SELECT COALESCE(SUM(nilai), 0) AS v FROM (${bagian.map((b) => b.sql).join(' UNION ALL ')}) x`;

/** Gabungan semua sumber → deret per tanggal. */
const seriSql = (bagian: BagianPembelian[]): string =>
  `SELECT periode, COALESCE(SUM(nilai), 0) AS nilai
     FROM (${bagian.map((b) => b.sql).join(' UNION ALL ')}) x
    GROUP BY periode ORDER BY periode`;

const argGabung = (bagian: BagianPembelian[]): unknown[] => bagian.flatMap((b) => b.arg);

/** Satu angka: Pembelian Bersih pada rentang tanggal. */
export async function nilaiPembelianBersih(
  l: LingkupPembelian,
  dari: string,
  sampai: string,
): Promise<number> {
  const bagian = await bagianPembelianBersih(l, dari, sampai);
  const row = await get<{ v: number | null }>(totalSql(bagian), ...argGabung(bagian));
  return Number(row?.v ?? 0);
}

/** Deret harian Pembelian Bersih (untuk grafik/sparkline). */
export async function seriPembelianBersih(
  l: LingkupPembelian,
  dari: string,
  sampai: string,
): Promise<{ periode: string; nilai: number }[]> {
  const bagian = await bagianPembelianBersih(l, dari, sampai);
  const rows = await all<{ periode: string; nilai: number }>(
    seriSql(bagian),
    ...argGabung(bagian),
  );
  return rows.map((r) => ({ periode: String(r.periode), nilai: Number(r.nilai) }));
}

export interface RincianPembelianBersih {
  langsung: number;
  po: number;
  retur: number;
  net: number;
}

/** Rincian per sumber + netto (dipakai laporan gabungan & panel detail). */
export async function rincianPembelianBersih(
  l: LingkupPembelian,
  dari: string,
  sampai: string,
): Promise<RincianPembelianBersih> {
  const bagian = await bagianPembelianBersih(l, dari, sampai);
  const hasil: RincianPembelianBersih = { langsung: 0, po: 0, retur: 0, net: 0 };
  for (const b of bagian) {
    const row = await get<{ v: number | null }>(
      `SELECT COALESCE(SUM(nilai), 0) AS v FROM (${b.sql}) x`,
      ...b.arg,
    );
    const nilai = Number(row?.v ?? 0);
    if (b.kunci === 'langsung') hasil.langsung = nilai;
    else hasil.po = nilai;
    hasil.net += nilai;
  }
  return hasil;
}
