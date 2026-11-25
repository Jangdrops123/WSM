-- ============================================================================
-- 007 — Edit Transaksi Penjualan (Token Edit) vs. trigger kunci penjualan
--
-- Masalah: fn_sales_disahkan_terkunci() menolak SEMUA UPDATE pada sales yang
-- berstatus 'disahkan' kecuali void (status -> 'batal'), sehingga endpoint
-- PUT /api/pos/sales/:id selalu gagal dengan SQLSTATE P0001 lalu dilaporkan
-- klien sebagai "Terjadi kesalahan pada server".
--
-- Perbaikan: fungsi tetap mengunci penjualan disahkan, TAPI memberi jalan
-- resmi bagi handler edit. Handler menandai transaksinya sendiri dengan
--     SET LOCAL nusapos.edit_penjualan = 'on';
-- sebelum menulis ulang header. Penanda ini hanya berlaku di transaksi itu
-- (SET LOCAL), tidak bisa dikirim dari klien, dan tetap melalui validasi
-- hitungPenjualan() + izin wajibSel/wajibKelolaTransaksi.
--
-- Terapkan: psql "$DATABASE_URL" -f pg-migrations/007_edit_penjualan_pg.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_sales_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  -- Jalur resmi Edit Transaksi (Token Edit) — lihat PUT /api/pos/sales/:id.
  IF current_setting('nusapos.edit_penjualan', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'disahkan' AND NOT (
    NEW.status      = 'batal'
    AND NEW.no_dokumen  IS NOT DISTINCT FROM OLD.no_dokumen
    AND NEW.tanggal     IS NOT DISTINCT FROM OLD.tanggal
    AND NEW.shift_id    IS NOT DISTINCT FROM OLD.shift_id
    AND NEW.kasir_id    IS NOT DISTINCT FROM OLD.kasir_id
    AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
    AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id
    AND NEW.mode_pos    IS NOT DISTINCT FROM OLD.mode_pos
    AND NEW.subtotal    IS NOT DISTINCT FROM OLD.subtotal
    AND NEW.diskon      IS NOT DISTINCT FROM OLD.diskon
    AND NEW.pajak       IS NOT DISTINCT FROM OLD.pajak
    AND NEW.total       IS NOT DISTINCT FROM OLD.total
    AND NEW.dibuat_oleh IS NOT DISTINCT FROM OLD.dibuat_oleh
    AND NEW.dibuat_pada IS NOT DISTINCT FROM OLD.dibuat_pada
  ) THEN
    RAISE EXCEPTION 'Penjualan berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void) atau diretur';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_disahkan_terkunci ON sales;
CREATE TRIGGER trg_sales_disahkan_terkunci
BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION fn_sales_disahkan_terkunci();
