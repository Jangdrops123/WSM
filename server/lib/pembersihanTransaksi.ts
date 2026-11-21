// Kebijakan Pembersihan Data Transaksi (No Retain Policy).
//
// Aturan yang dipegang modul ini:
//   * Transaksi yang dibatalkan / di-reset TIDAK menyisakan baris "batal".
//     Header & detail dihapus permanen (hard delete), bukan diubah statusnya.
//   * Master Barang tetap dipertahankan. Saldo stok, nilai persediaan, dan
//     kartu stok dikosongkan (stok efektif 0) saat Reset Transaksi / Proses
//     Tahunan.
//   * Produk non-aktif yang sama sekali tidak punya riwayat transaksi boleh
//     dihapus lewat "Hapus Master Produk Tanpa Transaksi".
//
// Semua fungsi di sini memakai koneksi modul db yang sedang aktif, jadi harus
// dipanggil DI DALAM `withTransaction(...)` milik pemanggil bila ingin atomik.
// PENTING: operasi best-effort memakai runOpsional (SAVEPOINT), bukan
// `.catch()`. Di PostgreSQL satu statement gagal membuat SELURUH transaksi
// aborted (25P02) sehingga statement berikutnya — termasuk audit log dan
// COMMIT — ikut ditolak. runOpsional mengembalikan { ok:false } tanpa
// merusak transaksi induk.
import { all, get, run, runOpsional } from '../db.pg.ts';

/* ------------------------- dokumen pembelian ---------------------------- */

/** Hapus permanen satu dokumen pembelian beserta seluruh detail & jejaknya. */
export async function hapusPembelianPermanen(id: number): Promise<void> {
  // Jurnal otomatis (bila ada) — baris jurnal ikut hilang (CASCADE barisnya).
  await run(`UPDATE journals SET status = 'batal' WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, id);
  await run(`DELETE FROM journals WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, id);
  await run(`DELETE FROM invoices WHERE sumber_tipe = 'pembelian' AND sumber_id = ?`, id);
  await run(`DELETE FROM payables WHERE purchase_id = ?`, id);
  await runOpsional(`DELETE FROM purchase_scan_logs WHERE purchase_id = ?`, id);
  await runOpsional(`DELETE FROM purchase_chat_logs WHERE purchase_id = ?`, id);
  await run(`DELETE FROM purchase_items WHERE purchase_id = ?`, id);
  await run(`DELETE FROM purchases WHERE id = ?`, id);
  // Kartu stok: riwayat asli maupun gerakan pembalik pembatalan.
  await run(
    `DELETE FROM stock_ledger WHERE tipe_dokumen IN ('pembelian', 'pembelian_batal') AND dokumen_id = ?`,
    id,
  );
}

/* -------------------------- dokumen penjualan --------------------------- */

/** Hapus permanen satu penjualan POS beserta seluruh detail & jejaknya. */
export async function hapusPenjualanPermanen(id: number): Promise<void> {
  // Urutan: anak dulu, induk terakhir. yang opsional (tabel/relasi lama)
  // dibungkus runOpsional agar kegagalannya tidak meng-abort transaksi.
  await run(`DELETE FROM journals WHERE sumber_tipe IN ('penjualan', 'pos') AND sumber_id = ?`, id);
  await run(`DELETE FROM invoices WHERE sumber_tipe = 'penjualan' AND sumber_id = ?`, id);
  // sale_return_items tidak punya kolom sale_id (relasinya lewat return_id).
  // Versi lama memakai `WHERE sale_id = ?` → error 42703 yang ditelan .catch,
  // meng-abort transaksi dan memunculkan "current transaction is aborted".
  await run(
    `DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE sale_id = ?)`,
    id,
  );
  await run(`DELETE FROM sale_returns WHERE sale_id = ?`, id);
  await run(`DELETE FROM sale_payments WHERE sale_id = ?`, id);
  await run(`DELETE FROM receivables WHERE sale_id = ?`, id);
  await run(`DELETE FROM sale_items WHERE sale_id = ?`, id);
  await run(`DELETE FROM sales WHERE id = ?`, id);
  await run(`DELETE FROM cash_transactions WHERE sumber_tipe = 'penjualan' AND sumber_id = ?`, id);
  await run(`DELETE FROM stock_ledger WHERE tipe_dokumen IN ('penjualan', 'penjualan_batal') AND dokumen_id = ?`, id);
}

/* --------------------- dokumen Item Masuk / Keluar ---------------------- */

export async function hapusSubStockPermanen(id: number): Promise<void> {
  await run(`DELETE FROM sub_stock_items WHERE doc_id = ?`, id);
  await run(`DELETE FROM sub_stock_docs WHERE id = ?`, id);
  await runOpsional(
    `DELETE FROM stock_ledger WHERE tipe_dokumen IN ('penyesuaian', 'persediaan', 'persediaan_masuk', 'persediaan_keluar', 'sub_stock') AND dokumen_id = ?`,
    id,
  );
}

/* ------------------------------ transfer -------------------------------- */

export async function hapusTransferPermanen(id: number): Promise<void> {
  await runOpsional(`DELETE FROM stock_transfer_items WHERE transfer_id = ?`, id);
  await run(`DELETE FROM stock_transfers WHERE id = ?`, id);
  await run(
    `DELETE FROM stock_ledger WHERE tipe_dokumen IN ('transfer', 'transfer_batal') AND dokumen_id = ?`,
    id,
  );
}

/* ------------------- sapu seluruh log transaksi batal ------------------- */

/**
 * Hapus permanen semua dokumen berstatus `batal` (penjualan & pembelian),
 * tanpa memandang tanggal. Dipakai sebelum Proses Tahunan / Reset Transaksi
 * supaya tidak ada log transaksi lama yang sudah dibatalkan tertinggal.
 */
export async function sapuTransaksiBatal(): Promise<{ penjualan: number; pembelian: number }> {
  const jual = await all<{ id: number }>(`SELECT id FROM sales WHERE status = 'batal'`);
  for (const r of jual) await hapusPenjualanPermanen(Number(r.id));
  const beli = await all<{ id: number }>(`SELECT id FROM purchases WHERE status = 'batal'`);
  for (const r of beli) await hapusPembelianPermanen(Number(r.id));
  return { penjualan: jual.length, pembelian: beli.length };
}

/* --------------------------- stok & nilai stok -------------------------- */

/**
 * Kosongkan saldo stok seluruh produk/gudang sehingga stok fisik & nilai
 * persediaan kembali 0. Kartu stok juga dibersihkan.
 * Produk di Master Barang TIDAK dihapus.
 */
/**
 * Reset Transaksi — stok fisik & nilai persediaan kembali 0 TANPA menghapus
 * baris saldo.
 *
 * Baris `stock_balances` (per produk per gudang) sengaja DIPERTAHANKAN dengan
 * qty = 0: ID master produk dan relasi gudangnya tetap utuh, sehingga
 * autocomplete POS/Pembelian/PO/Kartu Stok langsung menemukan produk aktif
 * setelah reset. Hanya kartu stok (riwayat mutasi) yang dikosongkan.
 */
export async function nolkanStok(): Promise<{ saldo: number; kartu: number }> {
  const saldo = (
    await run(`UPDATE stock_balances SET qty = 0, diubah_pada = ?`, new Date().toISOString())
  ).changes;
  const kartu = (await run(`DELETE FROM stock_ledger`)).changes;
  return { saldo, kartu };
}

/* ------------------ master produk tanpa riwayat transaksi --------------- */

const TABEL_TRANSAKSI_PRODUK = [
  'sale_items',
  'purchase_items',
  'sale_return_items',
  'stock_ledger',
  'stock_balances',
  'sub_stock_items',
  'opname_items',
  'stock_transfer_items',
  'po_items',
  'invoice_items',
  'held_sale_items',
];

async function tabelAda(nama: string): Promise<boolean> {
  return Boolean(
    await get(`SELECT 1 AS ada FROM pg_tables WHERE schemaname = 'public' AND tablename = ?`, nama),
  );
}

/** Syarat "tidak punya riwayat transaksi" untuk alias produk `p`. */
async function syaratTanpaTransaksi(): Promise<string> {
  const bagian: string[] = [];
  for (const t of TABEL_TRANSAKSI_PRODUK) {
    if (await tabelAda(t)) bagian.push(`NOT EXISTS (SELECT 1 FROM "${t}" x WHERE x.product_id = p.id)`);
  }
  return bagian.join(' AND ');
}

export interface ProdukTanpaTransaksi {
  id: number;
  nama: string;
  sku: string;
}

/** Produk non-aktif yang aman dihapus: tidak dirujuk transaksi apa pun. */
export async function daftarMasterTanpaTransaksi(): Promise<ProdukTanpaTransaksi[]> {
  const syarat = await syaratTanpaTransaksi();
  const where = [`p.aktif = 0`];
  if (syarat) where.push(syarat);
  return await all<ProdukTanpaTransaksi>(
    `SELECT p.id, p.nama, p.sku FROM products p WHERE ${where.join(' AND ')} ORDER BY p.nama`,
  );
}

/**
 * Hapus produk non-aktif tanpa transaksi beserta turunan master-nya (paket,
 * konversi satuan, harga, dsb). Baris anak yang masih dirujuk ulang dicoba
 * beberapa putaran; sisa yang gagal dilaporkan sebagai `dilewati`.
 */
/**
 * Hapus permanen SATU produk beserta seluruh baris yang merujuknya
 * (detail transaksi lama, kartu stok, saldo, konversi, harga, barcode, dsb.).
 * Pemanggil WAJIB sudah memastikan tidak ada transaksi aktif.
 */
export async function hapusProdukPermanen(id: number): Promise<{ dilewati: string[] }> {
  const fk = await all<{ tabel: string; kolom: string }>(
    `SELECT kcu.table_name AS tabel, kcu.column_name AS kolom
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND ccu.table_name = 'products' AND kcu.table_name <> 'products'`,
  );
  const dilewati: string[] = [];
  let sisa = [...new Map(fk.map((r) => [`${r.tabel}|${r.kolom}`, r])).values()];
  for (let putaran = 0; sisa.length && putaran < 12; putaran++) {
    const gagal: typeof sisa = [];
    for (const r of sisa) {
      // savepoint per tabel: FK yang masih dipakai dilewati tanpa meng-abort
      // transaksi pemanggil (hapus master berjalan di dalam withTransaction).
      const hasil = await runOpsional(`DELETE FROM "${r.tabel}" WHERE "${r.kolom}" = ?`, id);
      if (!hasil.ok) gagal.push(r);
    }
    if (gagal.length === sisa.length) {
      for (const r of gagal) dilewati.push(`${r.tabel}.${r.kolom}`);
      break;
    }
    sisa = gagal;
  }
  await run(`DELETE FROM products WHERE id = ?`, id);
  return { dilewati };
}

export async function hapusMasterTanpaTransaksi(): Promise<{
  produk: number;
  dilewati: string[];
}> {
  const daftar = await daftarMasterTanpaTransaksi();
  if (!daftar.length) return { produk: 0, dilewati: [] };
  const id = daftar.map((p) => Number(p.id));
  const daftarId = id.map(() => '?').join(',');

  // Seluruh tabel yang punya kunci asing ke products (selain products).
  const fk = await all<{ tabel: string; kolom: string }>(
    `SELECT kcu.table_name AS tabel, kcu.column_name AS kolom
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND ccu.table_name = 'products' AND kcu.table_name <> 'products'`,
  );

  const dilewati: string[] = [];
  let sisa = [...new Map(fk.map((r) => [`${r.tabel}|${r.kolom}`, r])).values()];
  for (let putaran = 0; sisa.length && putaran < 12; putaran++) {
    const gagal: typeof sisa = [];
    for (const r of sisa) {
      const hasil = await runOpsional(`DELETE FROM "${r.tabel}" WHERE "${r.kolom}" IN (${daftarId})`, ...id);
      if (!hasil.ok) gagal.push(r);
    }
    if (gagal.length === sisa.length) {
      for (const r of gagal) dilewati.push(`${r.tabel}.${r.kolom}`);
      break;
    }
    sisa = gagal;
  }

  const produk = (
    await run(`DELETE FROM products WHERE id IN (${daftarId}) AND aktif = 0`, ...id)
  ).changes;
  return { produk, dilewati };
}
