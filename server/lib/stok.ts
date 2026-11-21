import { get, run, withTransaction } from '../db.pg.ts';
import { tolak } from './http.ts';

/**
 * SATU-JALUR perubahan stok.
 *
 * Setiap perubahan stock_balances WAJIB melewati fungsi ini supaya selalu
 * tercatat di stock_ledger (Kartu Stok / tabel mutasi stok) dalam transaksi yang
 * sama — tidak ada cara mengubah stok tanpa mutasi lewat aplikasi ini.
 * Saldo disimpan per produk per gudang; lokasi/rak hanya tercatat di mutasi.
 *
 * Valuasi persediaan memakai RATA-RATA BERGERAK per gudang:
 *   - masuk  : rata' = (qty × rata + masuk × hargaMasuk) / (qty + masuk)
 *   - keluar : nilai unit = rata saat itu (rata tidak berubah)
 * Nilai unit disimpan di setiap baris stock_ledger sehingga rata-rata bergerak
 * kapan pun bisa dihitung ulang dari kartu stok.
 */

export interface OpsiUbahStok {
  productId: number;
  warehouseId: number;
  /** Lokasi/rak penempatan saat mutasi (opsional — hanya informasi di kartu stok). */
  locationId?: number | null;
  masuk?: number;
  keluar?: number;
  /** Harga per unit saat masuk (pembelian/penyesuaian). Untuk pindah gudang, isi rata-rata sumber. */
  hargaMasuk?: number;
  /** Jenis dokumen sumber (dibatasi CHECK di skema):
   *  'pembelian' | 'pembelian_batal' | 'penjualan' | 'retur' |
   *  'transfer' | 'transfer_batal' | 'opname' | 'penyesuaian' */
  tipeDokumen: string;
  dokumenId?: number | null;
  userId?: number | null;
  /** Waktu (ISO); default sekarang. */
  tanggal?: string;
}

export interface HasilUbahStok {
  saldo: number;
  rataBergerak: number;
}

const bool = (nilai: unknown): boolean => ['1', 'true', 'ya', 'y'].includes(String(nilai ?? 'false').toLowerCase());

/** Pengaturan: apakah stok boleh minus? (default tidak) */
export async function stokMinusDiizinkan(): Promise<boolean> {
  const row = await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'stok_minus_izinkan'`);
  return bool(row?.nilai);
}

/** Rata-rata bergerak per (produk, gudang) — dihitung dari Kartu Stok. */
export async function hitungRataBergerak(productId: number, warehouseId: number): Promise<number> {
  const row = await get<{ nilai: number | null; qty: number | null }>(
    `SELECT COALESCE(SUM(qty_masuk * nilai_unit), 0) - COALESCE(SUM(qty_keluar * nilai_unit), 0) AS nilai,
            COALESCE(SUM(qty_masuk), 0) - COALESCE(SUM(qty_keluar), 0) AS qty
     FROM stock_ledger
     WHERE product_id = ? AND warehouse_id = ?`,
    productId,
    warehouseId,
  );
  const qty = Number(row?.qty ?? 0);
  if (qty <= 0) return 0;
  return Number(row?.nilai ?? 0) / qty;
}

/** Baca saldo saat ini + rata-rata bergerak sebuah produk di satu gudang. */
export async function bacaSaldo(productId: number, warehouseId: number): Promise<{ qty: number; rataBergerak: number }> {
  const row = await get<{ qty: number }>(
    `SELECT qty FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
    productId,
    warehouseId,
  );
  return { qty: Number(row?.qty ?? 0), rataBergerak: await hitungRataBergerak(productId, warehouseId) };
}

/**
 * Ubah stok + tulis Kartu Stok dalam SATU transaksi atomik.
 * Melempar HttpError bila qty tidak mencukupi dan stok minus tidak diizinkan.
 */
export async function ubahStok(opsi: OpsiUbahStok): Promise<HasilUbahStok> {
  const masuk = Math.max(0, opsi.masuk ?? 0);
  const keluar = Math.max(0, opsi.keluar ?? 0);
  if (masuk === 0 && keluar === 0) throw tolak(400, 'Qty masuk/keluar harus lebih dari 0.');
  if (masuk > 0 && keluar > 0) throw tolak(400, 'Qty masuk dan keluar tidak boleh bersamaan.');
  if (!Number.isInteger(opsi.productId)) throw tolak(400, 'Produk tidak valid.');
  if (!Number.isInteger(opsi.warehouseId)) throw tolak(400, 'Gudang tidak valid.');
  if (!await get<{ id: number }>('SELECT id FROM products WHERE id = ?', opsi.productId)) throw tolak(400, 'Produk tidak ditemukan.');
  if (opsi.locationId != null) {
    if (!await get<{ id: number }>('SELECT id FROM locations WHERE id = ? AND warehouse_id = ?', opsi.locationId, opsi.warehouseId)) {
      throw tolak(400, 'Lokasi tidak berada di gudang tersebut.');
    }
  }

  return await withTransaction(async () => {
    const sekarang = await bacaSaldo(opsi.productId, opsi.warehouseId);
    const tanggal = opsi.tanggal ?? new Date().toISOString();

    let saldoBaru: number;
    let nilaiUnit: number;

    if (masuk > 0) {
      nilaiUnit = opsi.hargaMasuk ?? sekarang.rataBergerak;
      if (nilaiUnit < 0) throw tolak(400, 'Harga masuk tidak boleh negatif.');
      saldoBaru = sekarang.qty + masuk;
    } else {
      nilaiUnit = sekarang.rataBergerak;
      saldoBaru = sekarang.qty - keluar;
      if (saldoBaru < 0 && !await stokMinusDiizinkan()) {
        throw tolak(
          409,
          `Stok tidak mencukupi: tersisa ${sekarang.qty}, diminta ${keluar}. Aktifkan "stok minus" di Pengaturan Stok bila diizinkan.`,
        );
      }
    }

    // 1) saldo per produk per gudang — selalu bersama baris kartu stok
    await run(
      `INSERT INTO stock_balances (product_id, warehouse_id, qty, diubah_pada)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (product_id, warehouse_id)
       DO UPDATE SET qty = excluded.qty, diubah_pada = excluded.diubah_pada`,
      opsi.productId,
      opsi.warehouseId,
      saldoBaru,
      tanggal,
    );

    // 2) kartu stok / mutasi (wajib) — lokasi tercatat sebagai penempatan
    await run(
      `INSERT INTO stock_ledger
         (tanggal, product_id, warehouse_id, location_id, tipe_dokumen, dokumen_id,
          qty_masuk, qty_keluar, saldo, nilai_unit, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tanggal,
      opsi.productId,
      opsi.warehouseId,
      opsi.locationId ?? null,
      opsi.tipeDokumen,
      opsi.dokumenId ?? null,
      masuk,
      keluar,
      saldoBaru,
      nilaiUnit,
      opsi.userId ?? null,
    );

    return { saldo: saldoBaru, rataBergerak: await hitungRataBergerak(opsi.productId, opsi.warehouseId) };
  });
}

/**
 * Penyesuaian opname: selisih qty fisik vs sistem di gudang yang sama.
 * Selisih positif = masuk (stok fisik lebih), negatif = keluar.
 */
export async  function sesuaikanStok(
  productId: number,
  warehouseId: number,
  locationId: number | null,
  qtySistem: number,
  qtyFisik: number,
  dokumenId: number | null,
  userId: number | null,
): Promise<HasilUbahStok> {
  const selisih = qtyFisik - qtySistem;
  if (selisih === 0) {
    const { qty, rataBergerak } = await bacaSaldo(productId, warehouseId);
    return { saldo: qty, rataBergerak };
  }
  return await ubahStok({
    productId,
    warehouseId,
    locationId,
    masuk: selisih > 0 ? selisih : 0,
    keluar: selisih < 0 ? -selisih : 0,
    tipeDokumen: 'opname',
    dokumenId,
    userId,
  });
}

/**
 * Total nilai persediaan (rata-rata bergerak per gudang).
 * `gudang`: batasi ke id gudang sesi (ISOLASI GUDANG) — null/undefined =
 * semua gudang; [] = tanpa akses (nilai & qty 0).
 */
export async function totalNilaiPersediaan(gudang?: number[] | null): Promise<{ nilai: number; qty: number }> {
  const batas = gudang === undefined || gudang === null
    ? ''
    : gudang.length === 0
      ? ' WHERE 1 = 0'
      : ` WHERE sb.warehouse_id IN (${gudang.map((n) => Number(n)).join(',')})`;
  const row = await get<{ nilai: number | null; qty: number | null }>(
    `SELECT
       SUM(qty * (
         SELECT CASE
           WHEN COALESCE(SUM(l.qty_masuk) - SUM(l.qty_keluar), 0) > 0
             THEN (COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0) - COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0))
                  / (SUM(l.qty_masuk) - SUM(l.qty_keluar))
           ELSE 0 END
         FROM stock_ledger l
         WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id
       )) AS nilai,
       SUM(qty) AS qty
     FROM stock_balances sb${batas}`,
  );
  return { nilai: Number(row?.nilai ?? 0), qty: Number(row?.qty ?? 0) };
}
