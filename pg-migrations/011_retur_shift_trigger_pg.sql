-- Izinkan backfill atribusi shift pada retur lama tanpa membuka perubahan
-- lain: retur 'disahkan' tetap terkunci, kecuali pembatalan (status -> batal)
-- atau perubahan yang tidak menyentuh field dokumen apa pun (mis. shift_id).
CREATE OR REPLACE FUNCTION fn_sale_returns_disahkan_terkunci() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'disahkan' AND NOT (
    (
      NEW.status = 'batal'
      AND NEW.no_dokumen  IS NOT DISTINCT FROM OLD.no_dokumen
      AND NEW.sale_id     IS NOT DISTINCT FROM OLD.sale_id
      AND NEW.tanggal     IS NOT DISTINCT FROM OLD.tanggal
      AND NEW.alasan      IS NOT DISTINCT FROM OLD.alasan
      AND NEW.total       IS NOT DISTINCT FROM OLD.total
      AND NEW.dibuat_oleh IS NOT DISTINCT FROM OLD.dibuat_oleh
      AND NEW.dibuat_pada IS NOT DISTINCT FROM OLD.dibuat_pada
    )
    OR (
      NEW.status      IS NOT DISTINCT FROM OLD.status
      AND NEW.no_dokumen  IS NOT DISTINCT FROM OLD.no_dokumen
      AND NEW.sale_id     IS NOT DISTINCT FROM OLD.sale_id
      AND NEW.tanggal     IS NOT DISTINCT FROM OLD.tanggal
      AND NEW.alasan      IS NOT DISTINCT FROM OLD.alasan
      AND NEW.total       IS NOT DISTINCT FROM OLD.total
      AND NEW.dibuat_oleh IS NOT DISTINCT FROM OLD.dibuat_oleh
      AND NEW.dibuat_pada IS NOT DISTINCT FROM OLD.dibuat_pada
    )
  ) THEN
    RAISE EXCEPTION 'Retur berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
