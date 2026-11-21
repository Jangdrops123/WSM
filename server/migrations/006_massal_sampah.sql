-- Fitur Pilih Massal & Aksi Massal (008)
-- 1) Soft delete produk → "Sampah" (bisa dipulihkan).
ALTER TABLE products ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_products_deleted ON products (deleted_at);

-- 2) Status aktif untuk Pelanggan & Pemasok agar aksi "Nonaktifkan" tersedia.
ALTER TABLE customers ADD COLUMN aktif INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1));
ALTER TABLE suppliers ADD COLUMN aktif INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1));
