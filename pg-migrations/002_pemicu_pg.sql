-- ============================================================================
-- NusaSuite — Pemicu PostgreSQL (padanan 13 trigger SQLite di data/app.db)
-- Ditulis tangan: RAISE(ABORT,...)/WHEN tidak ada padanan mekanis di PG.
-- Aturan bisnis IDENTIK dengan SQLite; hanya dialek yang berubah:
--   WHEN <kondisi> + SELECT RAISE(ABORT, 'pesan')
--     -> IF NOT (<kondisi>) IS TRUE ... IF <kondisi> THEN RAISE EXCEPTION 'pesan'
--   UPDATE tabel_sendiri di BEFORE UPDATE (rekursi di PG)
--     -> NEW.kolom := now(); RETURN NEW;
-- Jalankan SETELAH 001_skema_pg.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Jurnal disahkan harus seimbang & punya baris
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_journals_disahkan_seimbang() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'disahkan' THEN
    IF (SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE journal_id = NEW.id)
       <> (SELECT COALESCE(SUM(kredit), 0) FROM journal_lines WHERE journal_id = NEW.id)
       OR NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_id = NEW.id) THEN
      RAISE EXCEPTION 'Jurnal harus memiliki baris dan total debit = total kredit sebelum disahkan';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journals_disahkan_seimbang ON journals;
CREATE TRIGGER trg_journals_disahkan_seimbang
BEFORE UPDATE OF status ON journals
FOR EACH ROW EXECUTE FUNCTION fn_journals_disahkan_seimbang();

-- ----------------------------------------------------------------------------
-- 2. Jurnal disahkan terkunci (hanya boleh jadi batal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_journals_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'disahkan' AND NOT (
    NEW.status = 'batal'
    AND NEW.no_jurnal   IS NOT DISTINCT FROM OLD.no_jurnal
    AND NEW.tanggal     IS NOT DISTINCT FROM OLD.tanggal
    AND NEW.period_id   IS NOT DISTINCT FROM OLD.period_id
    AND NEW.sumber_tipe IS NOT DISTINCT FROM OLD.sumber_tipe
    AND NEW.sumber_id   IS NOT DISTINCT FROM OLD.sumber_id
    AND NEW.keterangan  IS NOT DISTINCT FROM OLD.keterangan
    AND NEW.dibuat_oleh IS NOT DISTINCT FROM OLD.dibuat_oleh
    AND NEW.dibuat_pada IS NOT DISTINCT FROM OLD.dibuat_pada
  ) THEN
    RAISE EXCEPTION 'Jurnal berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journals_disahkan_terkunci ON journals;
CREATE TRIGGER trg_journals_disahkan_terkunci
BEFORE UPDATE ON journals
FOR EACH ROW EXECUTE FUNCTION fn_journals_disahkan_terkunci();

-- ----------------------------------------------------------------------------
-- 3-5. Baris jurnal induk-disahkan tidak bisa tambah/ubah/hapus
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_journal_lines_induk_disahkan() RETURNS trigger AS $$
DECLARE
  induk_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO induk_status FROM journals WHERE id = OLD.journal_id;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT status INTO induk_status FROM journals WHERE id = NEW.journal_id;
  ELSE
    SELECT status INTO induk_status FROM journals WHERE id = OLD.journal_id;
  END IF;
  IF induk_status = 'disahkan' THEN
    RAISE EXCEPTION 'Jurnal berstatus disahkan tidak dapat diubah';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_induk_disahkan_ins ON journal_lines;
CREATE TRIGGER trg_journal_lines_induk_disahkan_ins
BEFORE INSERT ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_journal_lines_induk_disahkan();

DROP TRIGGER IF EXISTS trg_journal_lines_induk_disahkan_upd ON journal_lines;
CREATE TRIGGER trg_journal_lines_induk_disahkan_upd
BEFORE UPDATE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_journal_lines_induk_disahkan();

DROP TRIGGER IF EXISTS trg_journal_lines_induk_disahkan_del ON journal_lines;
CREATE TRIGGER trg_journal_lines_induk_disahkan_del
BEFORE DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION fn_journal_lines_induk_disahkan();

-- ----------------------------------------------------------------------------
-- 6. Penjualan disahkan terkunci (hanya boleh jadi batal / diretur via tabel retur)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sales_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
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

-- ----------------------------------------------------------------------------
-- 7. Pembelian disahkan terkunci
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_purchases_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
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

-- ----------------------------------------------------------------------------
-- 8. Opname disahkan terkunci
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_opname_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'disahkan' AND NOT (
    NEW.status               = 'batal'
    AND NEW.no_dokumen         IS NOT DISTINCT FROM OLD.no_dokumen
    AND NEW.warehouse_id       IS NOT DISTINCT FROM OLD.warehouse_id
    AND NEW.location_id        IS NOT DISTINCT FROM OLD.location_id
    AND NEW.tanggal            IS NOT DISTINCT FROM OLD.tanggal
    AND NEW.metode             IS NOT DISTINCT FROM OLD.metode
    AND NEW.penanggung_jawab_id IS NOT DISTINCT FROM OLD.penanggung_jawab_id
    AND NEW.disetujui_oleh     IS NOT DISTINCT FROM OLD.disetujui_oleh
    AND NEW.dibuat_oleh        IS NOT DISTINCT FROM OLD.dibuat_oleh
    AND NEW.dibuat_pada        IS NOT DISTINCT FROM OLD.dibuat_pada
  ) THEN
    RAISE EXCEPTION 'Opname berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opname_disahkan_terkunci ON opname_sessions;
CREATE TRIGGER trg_opname_disahkan_terkunci
BEFORE UPDATE ON opname_sessions
FOR EACH ROW EXECUTE FUNCTION fn_opname_disahkan_terkunci();

-- ----------------------------------------------------------------------------
-- 9. Transfer disahkan terkunci
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transfers_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'disahkan' AND NOT (
    NEW.status         = 'batal'
    AND NEW.no_dokumen     IS NOT DISTINCT FROM OLD.no_dokumen
    AND NEW.dari_warehouse IS NOT DISTINCT FROM OLD.dari_warehouse
    AND NEW.ke_warehouse   IS NOT DISTINCT FROM OLD.ke_warehouse
    AND NEW.tanggal        IS NOT DISTINCT FROM OLD.tanggal
    AND NEW.dibuat_oleh    IS NOT DISTINCT FROM OLD.dibuat_oleh
    AND NEW.dibuat_pada    IS NOT DISTINCT FROM OLD.dibuat_pada
  ) THEN
    RAISE EXCEPTION 'Transfer berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfers_disahkan_terkunci ON stock_transfers;
CREATE TRIGGER trg_transfers_disahkan_terkunci
BEFORE UPDATE ON stock_transfers
FOR EACH ROW EXECUTE FUNCTION fn_transfers_disahkan_terkunci();

-- ----------------------------------------------------------------------------
-- 10. Retur penjualan disahkan terkunci
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sale_returns_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'disahkan' AND NOT (
    NEW.status      = 'batal'
    AND NEW.no_dokumen  IS NOT DISTINCT FROM OLD.no_dokumen
    AND NEW.sale_id     IS NOT DISTINCT FROM OLD.sale_id
    AND NEW.tanggal     IS NOT DISTINCT FROM OLD.tanggal
    AND NEW.alasan      IS NOT DISTINCT FROM OLD.alasan
    AND NEW.total       IS NOT DISTINCT FROM OLD.total
    AND NEW.dibuat_oleh IS NOT DISTINCT FROM OLD.dibuat_oleh
    AND NEW.dibuat_pada IS NOT DISTINCT FROM OLD.dibuat_pada
  ) THEN
    RAISE EXCEPTION 'Retur berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_returns_disahkan_terkunci ON sale_returns;
CREATE TRIGGER trg_sale_returns_disahkan_terkunci
BEFORE UPDATE ON sale_returns
FOR EACH ROW EXECUTE FUNCTION fn_sale_returns_disahkan_terkunci();

-- ----------------------------------------------------------------------------
-- 11. Produk bertransaksi tidak boleh dihapus (nonaktifkan saja)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_products_tidak_dihapus_bertransaksi() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_items            WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM purchase_items        WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM opname_items          WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM stock_ledger          WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM stock_transfer_items  WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM journal_lines         WHERE product_id = OLD.id) THEN
    RAISE EXCEPTION 'Produk sudah bertransaksi dan tidak dapat dihapus — nonaktifkan saja (aktif = false).';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_tidak_dihapus_bertransaksi ON products;
CREATE TRIGGER trg_products_tidak_dihapus_bertransaksi
BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION fn_products_tidak_dihapus_bertransaksi();

-- ----------------------------------------------------------------------------
-- 12-13. Stempel diubah_pada otomatis (cash_accounts, stores).
-- SQLite memakai UPDATE tabel-sendiri di dalam trigger; di PG itu rekursi,
-- jadi ditulis sebagai penugasan NEW langsung (hasil akhir SAMA).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_stempel_diubah_pada() RETURNS trigger AS $$
BEGIN
  NEW.diubah_pada := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_accounts_diubah ON cash_accounts;
CREATE TRIGGER trg_cash_accounts_diubah
BEFORE UPDATE ON cash_accounts
FOR EACH ROW EXECUTE FUNCTION fn_stempel_diubah_pada();

DROP TRIGGER IF EXISTS trg_stores_diubah ON stores;
CREATE TRIGGER trg_stores_diubah
BEFORE UPDATE ON stores
FOR EACH ROW EXECUTE FUNCTION fn_stempel_diubah_pada();
