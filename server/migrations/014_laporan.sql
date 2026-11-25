-- BAGIAN N — MODUL LAPORAN
-- Indeks untuk query agregat laporan (tanggal, gudang, produk, pelanggan)
-- + tabel laporan tersimpan (N5) dan berkas hasil laporan.

-- Penjualan ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_wh_tanggal     ON sales (warehouse_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_sales_pelanggan_tgl  ON sales (customer_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_sales_status_tanggal ON sales (status, tanggal);
CREATE INDEX IF NOT EXISTS idx_sale_items_produk    ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_metode ON sale_payments (metode);
CREATE INDEX IF NOT EXISTS idx_sale_returns_tanggal ON sale_returns (tanggal);

-- Pembelian ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchase_items_produk ON purchase_items (product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_wh_tanggal  ON purchases (warehouse_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_purchases_status      ON purchases (status, tanggal);

-- Stok --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_ledger_wh_tanggal ON stock_ledger (warehouse_id, tanggal);

-- Piutang & utang ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_receivables_status ON receivables (status, jatuh_tempo);
CREATE INDEX IF NOT EXISTS idx_payables_status    ON payables (status, jatuh_tempo);

-- Laporan tersimpan (N5) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  laporan       TEXT NOT NULL,
  params_json   TEXT NOT NULL DEFAULT '{}',
  jadwal        TEXT CHECK (jadwal IN ('harian', 'mingguan', 'bulanan')),
  aktif         INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  terakhir_jalan TEXT,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

-- Berkas hasil laporan (tampil di Daftar Dokumen & riwayat Laporan Tersimpan)
CREATE TABLE IF NOT EXISTS report_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_report_id INTEGER REFERENCES saved_reports(id) ON DELETE SET NULL,
  laporan         TEXT NOT NULL,
  nama            TEXT NOT NULL,
  periode_dari    TEXT,
  periode_sampai  TEXT,
  params_json     TEXT NOT NULL DEFAULT '{}',
  ringkas_json    TEXT,
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
