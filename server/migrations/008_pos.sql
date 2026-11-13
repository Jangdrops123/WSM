-- Fitur POS Mode Foto (010)
-- 1) Pengguna default — sales.kasir_id & held_sales.kasir_id NOT NULL.
--    Modul login menyusul; akses.ts akan memakai pengguna ini.
INSERT INTO users (nama, username, password_hash, role_id)
SELECT 'Administrator', 'admin', '!',
       (SELECT id FROM roles WHERE nama = 'Administrator')
WHERE NOT EXISTS (SELECT 1 FROM users);

-- 2) COA minimal untuk posting penjualan, HPP, dan pembayaran campuran.
INSERT INTO accounts (kode, nama, tipe, saldo_normal) VALUES
  ('1001', 'Kas',              'aset',      'debit'),
  ('1002', 'Bank',             'aset',      'debit'),
  ('1003', 'QRIS',             'aset',      'debit'),
  ('1100', 'Piutang Usaha',    'aset',      'debit'),
  ('1200', 'Persediaan Barang','aset',      'debit'),
  ('2101', 'Utang PPN',        'kewajiban', 'kredit'),
  ('4001', 'Penjualan Barang', 'pendapatan', 'kredit'),
  ('5001', 'HPP Penjualan',    'beban',     'debit')
ON CONFLICT (kode) DO NOTHING;

-- 3) Periode akuntansi berjalan (dipakai period_id jurnal POS).
INSERT INTO periods (tahun, bulan, status)
SELECT CAST(strftime('%Y', 'now') AS INTEGER),
       CAST(strftime('%m', 'now') AS INTEGER),
       'buka'
WHERE NOT EXISTS (
  SELECT 1 FROM periods
  WHERE tahun = CAST(strftime('%Y', 'now') AS INTEGER)
    AND bulan = CAST(strftime('%m', 'now') AS INTEGER)
);

-- 4) PIN supervisor untuk void/retur (SHA-256; bawaan '1234', ganti di Pengaturan).
INSERT INTO settings (kunci, nilai, keterangan)
SELECT 'pin_supervisor',
       '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
       'PIN supervisor void/retur (SHA-256; bawaan 1234)'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE kunci = 'pin_supervisor');
