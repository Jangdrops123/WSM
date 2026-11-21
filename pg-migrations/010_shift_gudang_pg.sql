-- Multi-kasir / multi-shift per gudang -------------------------------------
-- Satu akun tetap hanya punya satu shift terbuka per gudang, tetapi beberapa
-- akun kasir berbeda boleh berjalan bersamaan di gudang yang sama.
ALTER TABLE cashier_shifts
  ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES warehouses(id);

-- Retur ikut tercatat ke shift kasir yang memprosesnya, bukan shift penjualan
-- asal, agar tutup kasir menghitung uang keluar pada shift yang benar.
ALTER TABLE sale_returns
  ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES cashier_shifts(id);

-- Data lama: isi gudang shift dari penjualan yang tertaut, lalu dari gudang
-- bawaan pengguna. Baris lama tidak dihapus/diubah statusnya.
UPDATE cashier_shifts cs
   SET warehouse_id = sub.warehouse_id
  FROM (
    SELECT shift_id, MIN(warehouse_id) AS warehouse_id
      FROM sales
     WHERE shift_id IS NOT NULL
     GROUP BY shift_id
  ) sub
 WHERE cs.warehouse_id IS NULL
   AND cs.id = sub.shift_id;

UPDATE cashier_shifts cs
   SET warehouse_id = w.id
  FROM users u
  JOIN warehouses w ON w.kode = u.toko_bawaan
 WHERE cs.warehouse_id IS NULL
   AND cs.user_id = u.id;

UPDATE sale_returns sr
   SET shift_id = s.shift_id
  FROM sales s
 WHERE sr.shift_id IS NULL
   AND sr.sale_id = s.id;

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_aktif_gudang
  ON cashier_shifts (user_id, warehouse_id)
  WHERE tutup_pada IS NULL;
