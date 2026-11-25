-- Indeks pencarian cepat untuk daftar, POS, dan autocomplete.
-- Catatan: products.sku, products.barcode, packs.kode_box,
-- packs.barcode_box, locations.kode_lokasi sudah terindeks otomatis (UNIQUE).

CREATE INDEX IF NOT EXISTS idx_products_nama        ON products (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_products_aktif       ON products (aktif);
CREATE INDEX IF NOT EXISTS idx_categories_nama      ON categories (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_brands_nama          ON brands (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_units_nama           ON units (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_units_kode           ON units (kode COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_customers_nama       ON customers (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_customers_telepon    ON customers (telepon);
CREATE INDEX IF NOT EXISTS idx_suppliers_nama       ON suppliers (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_suppliers_telepon    ON suppliers (telepon);
CREATE INDEX IF NOT EXISTS idx_warehouses_nama      ON warehouses (nama COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_locations_warehouse2 ON locations (warehouse_id, kode_lokasi);

-- Jalur cepat POS / autocomplete: lookup barcode lalu isi keranjang
CREATE INDEX IF NOT EXISTS idx_products_aktif_nama ON products (aktif, nama);

CREATE INDEX IF NOT EXISTS idx_pack_items_product  ON pack_items (product_id);
CREATE INDEX IF NOT EXISTS idx_unit_conv_product   ON unit_conversions (product_id);
