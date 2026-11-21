-- Catatan transaksi pada Riwayat Penjualan & Pembelian.
ALTER TABLE sales ADD COLUMN catatan TEXT;
ALTER TABLE purchases ADD COLUMN catatan TEXT;
