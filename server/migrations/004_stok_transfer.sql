-- ============================================================================
-- Modul Stok
-- 1) Transfer antar gudang: melacak tahap kirim/terima TANPA mengubah kolom
--    status yang ada (status tetap: draft / disahkan / batal).
--    Alur: draft -> [kirim: stok keluar gudang asal] -> [terima: stok masuk
--    gudang tujuan] -> status 'disahkan'. Batal membalik pergerakan yang sudah
--    terjadi.
-- 2) Indeks untuk Halaman Kartu Stok (filter produk + gudang + lokasi + tanggal)
-- ============================================================================

ALTER TABLE stock_transfers ADD COLUMN dikirim_pada  TEXT;
ALTER TABLE stock_transfers ADD COLUMN dikirim_oleh  INTEGER REFERENCES users(id);
ALTER TABLE stock_transfers ADD COLUMN diterima_pada TEXT;
ALTER TABLE stock_transfers ADD COLUMN diterima_oleh INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_produk_lokasi
  ON stock_ledger (product_id, warehouse_id, location_id, tanggal);

CREATE INDEX IF NOT EXISTS idx_stock_balances_wh_product
  ON stock_balances (warehouse_id, product_id);
