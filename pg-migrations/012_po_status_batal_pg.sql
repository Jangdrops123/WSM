-- 012 — Status PO terminal yang dipakai aplikasi.
-- Constraint lama (005) hanya mengizinkan draft..lebih, sehingga UPDATE ke
-- 'batal' atau 'kadaluwarsa' ditolak dengan SQLSTATE 23514.
-- Aman dijalankan berulang: constraint lama dibuang lebih dulu.
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'draft', 'terkirim', 'sebagian', 'selesai', 'selesai_kurang',
    'lebih', 'kadaluwarsa', 'batal'
  ));