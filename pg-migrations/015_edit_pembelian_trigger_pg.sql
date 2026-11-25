-- ============================================================================
-- 015 — Edit Transaksi Pembelian (Token Edit) vs. trigger kunci pembelian
--
-- Masalah: fn_purchases_disahkan_terkunci() menolak SEMUA UPDATE pada purchases
-- yang berstatus 'disahkan' kecuali void (status -> 'batal'), sehingga
-- PUT /api/pembelian/:id selalu gagal P0001 dan tampil sebagai
-- "Terjadi kesalahan pada server".
--
-- Perbaikan: fungsi tetap mengunci pembelian disahkan, TAPI memberi jalan
-- resmi bagi handler edit. Handler menandai transaksinya sendiri dengan
--     SET LOCAL nusapos.edit_pembelian = 'on';
-- sebelum menulis ulang header. Penanda ini hanya berlaku di transaksi itu
-- (SET LOCAL), tidak bisa dikirim dari klien, dan tetap melalui validasi
-- validasiIsi() + izin wajibSel/wajibKelolaTransaksi.
--
-- Server juga menerapkan ulang fungsi ini otomatis saat start
-- (server/lib/sinkronSkema.ts), jadi instalasi lama ikut terkoreksi.
-- Terapkan manual: psql "$DATABASE_URL" -f pg-migrations/015_edit_pembelian_trigger_pg.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_purchases_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  -- Jalur resmi Edit Transaksi (Token Edit) — lihat PUT /api/pembelian/:id.
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
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchases_disahkan_terkunci ON purchases;
CREATE TRIGGER trg_purchases_disahkan_terkunci
BEFORE UPDATE ON purchases
FOR EACH ROW EXECUTE FUNCTION fn_purchases_disahkan_terkunci();
