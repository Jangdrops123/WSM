-- Indeks pencarian cepat POS Mode Cepat (/pos/cepat): pencarian awalan
-- case-insensitive (LIKE 'kata%' memakai indeks COLLATE NOCASE).
--
-- Catatan: 003_indeks_pencarian mencoba membuat idx_products_nama (nama COLLATE
-- NOCASE), tetapi namanya bentrok dengan idx_products_nama dari 001 (kolasi
-- BINARY) sehingga IF NOT EXISTS melewatkannya — indeks NOCASE tidak pernah
-- terbentuk. Nama baru dipakai di sini agar 'LIKE awalan%' benar-benar
-- menggunakan indeks (jalur pencarian awalan berhenti setelah 10 baris).
CREATE INDEX IF NOT EXISTS idx_products_nama_nocase    ON products (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_kode_nocase    ON products (kode_item COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_sku_nocase     ON products (sku COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_barcode_nocase ON products (barcode COLLATE NOCASE);

-- Statistik WAJIB: tanpa ANALYZE, planner SQLite lebih memilih indeks
-- idx_products_aktif (aktif=1) dan melewatkan pencarian indeks NOCASE di atas
-- (terukur: 57ms → 0.4ms per pencarian pada 50.000 produk setelah ANALYZE).
ANALYZE;
