/**
 * Sinkronisasi skema saat server naik (auto-migration yang AMAN diulang).
 *
 * Latar belakang: folder `pg-migrations/*.sql` diterapkan manual lewat psql
 * (atau hanya sekali saat volume PostgreSQL pertama kali dibuat). Database yang
 * sudah lebih dulu ada tidak pernah menerima migrasi baru, sehingga kode yang
 * menulis kolom baru gagal dengan SQLSTATE 42703 ("column ... does not exist").
 * Penangan error pusat lalu menampilkannya sebagai 500 generik — persis gejala
 * "Terjadi kesalahan pada server" pada alur transaksi.
 *
 * Modul ini menutup celah itu: SETIAP tambahan kolom/constraint yang dipakai
 * kode dipastikan ada sebelum aplikasi melayani permintaan. Semua pernyataan
 * idempoten (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`), jadi
 * aman dijalankan setiap kali server start — sama seperti guard
 * `pastikanSkema*` yang sudah ada di route POS/PO.
 *
 * Catatan penamaan: aplikasi memakai kolom `catatan` (bukan `notes`) dan tabel
 * `stock_ledger` (bukan `stock_movements`). Yang disinkronkan adalah nama yang
 * benar-benar dibaca/ditulis kode.
 */
import { get, run } from '../db.pg.ts';

interface Kolom {
  tabel: string;
  kolom: string;
  definisi: string;
}

/** Kolom yang ditambahkan setelah skema awal 001 (dipakai kode, bukan opsional). */
const KOLOM: Kolom[] = [
  // Catatan transaksi (migrasi 013 / 040).
  { tabel: 'sales', kolom: 'catatan', definisi: 'TEXT' },
  { tabel: 'purchases', kolom: 'catatan', definisi: 'TEXT' },
  { tabel: 'purchase_orders', kolom: 'catatan', definisi: 'TEXT' },
  { tabel: 'purchase_order_items', kolom: 'catatan', definisi: 'TEXT' },
  { tabel: 'po_receipts', kolom: 'catatan', definisi: 'TEXT' },
  { tabel: 'po_receipt_items', kolom: 'catatan', definisi: 'TEXT' },
  // Purchase Order (modul Purchase).
  { tabel: 'purchase_orders', kolom: 'tenggat', definisi: 'TIMESTAMPTZ' },
  { tabel: 'purchase_orders', kolom: 'is_tax_enabled', definisi: 'BOOLEAN NOT NULL DEFAULT false' },
  { tabel: 'purchase_orders', kolom: 'tax_rate', definisi: 'NUMERIC(5,2) NOT NULL DEFAULT 11' },
  { tabel: 'purchase_orders', kolom: 'is_manually_closed', definisi: 'BOOLEAN NOT NULL DEFAULT false' },
  { tabel: 'purchase_orders', kolom: 'parent_po_id', definisi: 'BIGINT REFERENCES purchase_orders(id)' },
  // Jejak pembatalan PO (alasan + waktu + pelaku) agar tidak hanya tersimpan
  // di log audit.
  { tabel: 'purchase_orders', kolom: 'cancel_reason', definisi: 'TEXT' },
  { tabel: 'purchase_orders', kolom: 'cancelled_at', definisi: 'TIMESTAMPTZ' },
  { tabel: 'purchase_orders', kolom: 'cancelled_by', definisi: 'BIGINT REFERENCES users(id)' },
  { tabel: 'po_receipt_items', kolom: 'is_unplanned', definisi: 'BOOLEAN NOT NULL DEFAULT false' },
  // Multi-kasir per gudang & pelunasan piutang dari kasir.
  { tabel: 'cashier_shifts', kolom: 'warehouse_id', definisi: 'BIGINT REFERENCES warehouses(id)' },
  { tabel: 'sale_returns', kolom: 'shift_id', definisi: 'BIGINT REFERENCES cashier_shifts(id)' },
  { tabel: 'payments', kolom: 'shift_id', definisi: 'BIGINT REFERENCES cashier_shifts(id)' },
  { tabel: 'payments', kolom: 'metode', definisi: 'TEXT' },
];

/** Status PO terminal yang dipakai UI (termasuk pembatalan & kadaluwarsa). */
const STATUS_PO = [
  'draft',
  'terkirim',
  'sebagian',
  'selesai',
  'selesai_kurang',
  'lebih',
  'kadaluwarsa',
  'batal',
];

async function tabelAda(nama: string): Promise<boolean> {
  const r = await get<{ t: string | null }>(`SELECT to_regclass(?) AS t`, `public.${nama}`);
  return Boolean(r?.t);
}

/**
 * Terapkan seluruh penyesuaian skema. Mengembalikan daftar perubahan yang
 * benar-benar dijalankan (untuk log start-up); kegagalan satu langkah tidak
 * menghentikan langkah lain agar server tetap naik.
 */
export async function sinkronkanSkema(): Promise<string[]> {
  const diterapkan: string[] = [];
  const gagal: string[] = [];

  const jalankan = async (label: string, sql: string): Promise<void> => {
    try {
      await run(sql);
      diterapkan.push(label);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : String(e);
      gagal.push(`${label}: ${pesan}`);
    }
  };

  for (const k of KOLOM) {
    if (!await tabelAda(k.tabel)) continue;
    await jalankan(`${k.tabel}.${k.kolom}`, `ALTER TABLE ${k.tabel} ADD COLUMN IF NOT EXISTS ${k.kolom} ${k.definisi}`);
  }

  // CHECK status PO: constraint lama menolak 'batal'/'kadaluwarsa' (23514),
  // sehingga pembatalan PO muncul sebagai error server.
  if (await tabelAda('purchase_orders')) {
    await jalankan(
      'purchase_orders.status_check',
      `ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`,
    );
    await jalankan(
      'purchase_orders.status_check',
      `ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
         CHECK (status IN (${STATUS_PO.map((s) => `'${s}'`).join(', ')}))`,
    );
  }

  // Trigger kunci pembelian disahkan: beri jalur resmi Edit Transaksi (Token
  // Edit) memakai penanda transaksi `nusapos.edit_pembelian` — pola yang sama
  // dengan `nusapos.edit_penjualan` (pg-migrations/007). Tanpa ini, semua edit
  // dokumen disahkan gagal P0001 walau stok & hutang sudah direkonsiliasi.
  if (await tabelAda('purchases')) {
    await jalankan(
      'purchases.edit_terkunci',
      `CREATE OR REPLACE FUNCTION fn_purchases_disahkan_terkunci() RETURNS trigger AS $$
       BEGIN
         IF current_setting('nusapos.edit_pembelian', true) = 'on' THEN
           RETURN NEW;
         END IF;
         IF OLD.status = 'disahkan' AND NOT (
           NEW.status      = 'batal'
           AND NEW.no_dokumen   IS NOT DISTINCT FROM OLD.no_dokumen
           AND NEW.no_po        IS NOT DISTINCT FROM OLD.no_po
           AND NEW.no_grn       IS NOT DISTINCT FROM OLD.no_grn
           AND NEW.no_faktur    IS NOT DISTINCT FROM OLD.no_faktur
           AND NEW.tanggal      IS NOT DISTINCT FROM OLD.tanggal
           AND NEW.supplier_id  IS NOT DISTINCT FROM OLD.supplier_id
           AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id
           AND NEW.metode_input IS NOT DISTINCT FROM OLD.metode_input
           AND NEW.subtotal     IS NOT DISTINCT FROM OLD.subtotal
           AND NEW.diskon       IS NOT DISTINCT FROM OLD.diskon
           AND NEW.pajak_persen IS NOT DISTINCT FROM OLD.pajak_persen
           AND NEW.pajak        IS NOT DISTINCT FROM OLD.pajak
           AND NEW.total        IS NOT DISTINCT FROM OLD.total
           AND NEW.diterima_pada IS NOT DISTINCT FROM OLD.diterima_pada
           AND NEW.disahkan_pada IS NOT DISTINCT FROM OLD.disahkan_pada
           AND NEW.dibuat_oleh  IS NOT DISTINCT FROM OLD.dibuat_oleh
           AND NEW.dibuat_pada  IS NOT DISTINCT FROM OLD.dibuat_pada
         ) THEN
           RAISE EXCEPTION 'Pembelian berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
         END IF;
         RETURN NEW;
       END $$ LANGUAGE plpgsql`,
    );
    await jalankan('purchases.edit_terkunci', `DROP TRIGGER IF EXISTS trg_purchases_disahkan_terkunci ON purchases`);
    await jalankan(
      'purchases.edit_terkunci',
      `CREATE TRIGGER trg_purchases_disahkan_terkunci
         BEFORE UPDATE ON purchases
         FOR EACH ROW EXECUTE FUNCTION fn_purchases_disahkan_terkunci()`,
    );
  }

  if (gagal.length > 0) {
    console.warn('[skema] sebagian penyesuaian dilewati:\n  - ' + gagal.join('\n  - '));
  }
  return diterapkan;
}
