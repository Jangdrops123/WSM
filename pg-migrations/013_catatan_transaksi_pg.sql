-- Catatan transaksi pada Riwayat Penjualan & Pembelian.
-- Aman dijalankan ulang: kolom hanya dibuat bila belum ada.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS catatan TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS catatan TEXT;
