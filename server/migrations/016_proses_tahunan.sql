-- Migrasi 016 — Proses Tahunan
-- 1) Tipe 'saldo_awal' di stock_ledger: baris penanda "Saldo Awal" periode baru
--    (kartu stok menampilkan label khusus, tidak ikut terhapus proses berikutnya
--    karena nilainya digabung ke saldo awal baru saat dihitung ulang).
--    SQLite tidak bisa ALTER pada CHECK: rebuild tabel + salin seluruh baris.
-- 2) annual_processes: riwayat setiap Proses Tahunan (audit ringkas).
-- 3) Akun 3100 Laba Ditahan (tuju penutupan laba/rugi periode berjalan).
-- TIDAK menghapus atau mengubah data apa pun yang sudah ada.

-- Trigger di tabel products merujuk stock_ledger: dilepas dulu agar rebuild
-- (DROP + RENAME) tidak membuat skema rusak, lalu dipasang kembali utuh.
DROP TRIGGER IF EXISTS trg_products_tidak_dihapus_bertransaksi;

CREATE TABLE stock_ledger_baru (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  location_id   INTEGER REFERENCES locations(id),
  tipe_dokumen  TEXT NOT NULL CHECK (tipe_dokumen IN
    ('pembelian', 'pembelian_batal', 'penjualan', 'retur',
     'transfer', 'transfer_batal', 'opname', 'penyesuaian', 'saldo_awal')),
  dokumen_id    INTEGER,
  qty_masuk     REAL NOT NULL DEFAULT 0,
  qty_keluar    REAL NOT NULL DEFAULT 0,
  saldo         REAL NOT NULL DEFAULT 0,
  nilai_unit    REAL NOT NULL DEFAULT 0,
  user_id       INTEGER REFERENCES users(id)
);

INSERT INTO stock_ledger_baru
  (id, tanggal, product_id, warehouse_id, location_id, tipe_dokumen,
   dokumen_id, qty_masuk, qty_keluar, saldo, nilai_unit, user_id)
SELECT id, tanggal, product_id, warehouse_id, location_id, tipe_dokumen,
       dokumen_id, qty_masuk, qty_keluar, saldo, nilai_unit, user_id
FROM stock_ledger;

DROP TABLE stock_ledger;
ALTER TABLE stock_ledger_baru RENAME TO stock_ledger;

CREATE INDEX idx_stock_ledger_product_tanggal ON stock_ledger (product_id, tanggal);
CREATE INDEX idx_stock_ledger_dokumen         ON stock_ledger (tipe_dokumen, dokumen_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_produk_lokasi
  ON stock_ledger (product_id, warehouse_id, location_id, tanggal);

-- Pasang kembali trigger proteksi produk (definisi sama dengan migrasi 001).
CREATE TRIGGER trg_products_tidak_dihapus_bertransaksi
BEFORE DELETE ON products
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM sale_items          WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM purchase_items      WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM opname_items        WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM stock_ledger        WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM stock_transfer_items WHERE product_id = OLD.id)
  OR EXISTS (SELECT 1 FROM journal_lines       WHERE product_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Produk sudah bertransaksi dan tidak dapat dihapus — nonaktifkan saja (aktif = 0).');
END;

-- Riwayat Proses Tahunan
CREATE TABLE annual_processes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  no_proses         TEXT NOT NULL UNIQUE,
  gudang_id         INTEGER REFERENCES warehouses(id),
  sampai            TEXT NOT NULL,
  periode_baru_dari TEXT NOT NULL,
  user_id           INTEGER REFERENCES users(id),
  jumlah_hapus      TEXT NOT NULL DEFAULT '{}',
  pratinjau         TEXT NOT NULL DEFAULT '{}',
  dipulihkan_pada   TEXT,
  dibuat_pada       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- Akun penampung laba/rugi: jurnal penutup Proses Tahunan
INSERT INTO accounts (kode, nama, tipe, saldo_normal) VALUES
  ('3100', 'Laba Ditahan', 'modal', 'kredit')
ON CONFLICT (kode) DO NOTHING;
