-- ============================================================================
-- Modul Produk: kode item unik + foto produk
-- 1) kode_item: identitas pendek produk (BRG-0001) untuk pencarian, urutan
--    kolom, impor Excel, dan pencocokan file foto massal.
--    Produk lama diisi otomatis berurutan mengikuti id.
-- 2) foto_url: foto produk (unggah massal / impor Excel via nama_file_foto).
-- Kewajiban (NOT NULL) & kelangkaan dijaga di lapisan aplikasi + UNIQUE index;
-- SQLite tidak memungkinkan ADD COLUMN NOT NULL tanpa rebuild tabel.
-- ============================================================================

ALTER TABLE products ADD COLUMN kode_item TEXT;
ALTER TABLE products ADD COLUMN foto_url TEXT;

-- Isi otomatis produk lama: BRG-0001, BRG-0002, ... (rapat, urut id)
UPDATE products
   SET kode_item = 'BRG-' || printf('%04d',
         (SELECT COUNT(*) FROM products p2 WHERE p2.id <= products.id))
 WHERE kode_item IS NULL OR kode_item = '';

CREATE UNIQUE INDEX idx_products_kode_item ON products (kode_item);
