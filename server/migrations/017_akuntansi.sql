-- ============================================================================
-- BAGIAN A — MODUL AKUNTANSI
-- 1) Rekode akun lama (008/010/013/016) ke skema COA retail memakai kode
--    baru "C-XXXX" (induk kelas > anak). Baris lama TIDAK dihapus agar jurnal
--    historis tetap utuh (FK journal_lines → accounts).
-- ============================================================================
UPDATE accounts SET kode = '1-1100', nama = 'Kas Kasir',                 tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1001';
UPDATE accounts SET kode = '1-1200', nama = 'Bank',                      tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1002';
UPDATE accounts SET kode = '1-1210', nama = 'Kas Dalam Penyelesaian',    tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1003';
UPDATE accounts SET kode = '1-1300', nama = 'Piutang Usaha',             tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1100';
UPDATE accounts SET kode = '1-1400', nama = 'Persediaan Barang Dagang',  tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1200';
UPDATE accounts SET kode = '1-1500', nama = 'PPN Masukan',               tipe = 'aset',      saldo_normal = 'debit'  WHERE kode = '1150';
UPDATE accounts SET kode = '2-1100', nama = 'Hutang Usaha',              tipe = 'kewajiban', saldo_normal = 'kredit' WHERE kode = '2100';
UPDATE accounts SET kode = '2-1200', nama = 'PPN Keluaran',              tipe = 'kewajiban', saldo_normal = 'kredit' WHERE kode = '2101';
UPDATE accounts SET kode = '4-1100', nama = 'Penjualan',                 tipe = 'pendapatan',saldo_normal = 'kredit' WHERE kode = '4001';
UPDATE accounts SET kode = '5-1000', nama = 'HPP',                       tipe = 'beban',     saldo_normal = 'debit'  WHERE kode = '5001';
UPDATE accounts SET kode = '6-1900', nama = 'Selisih Stok Kurang',       tipe = 'beban',     saldo_normal = 'debit'  WHERE kode = '5102';
UPDATE accounts SET kode = '3-3000', nama = 'Laba Ditahan',              tipe = 'modal',     saldo_normal = 'kredit' WHERE kode = '3100';

-- 2) Induk kelas (tingkat 1).
INSERT INTO accounts (kode, nama, tipe, saldo_normal, induk_id) VALUES
  ('1',   'ASET',         'aset',      'debit',  NULL),
  ('2',   'KEWAJIBAN',    'kewajiban', 'kredit', NULL),
  ('3',   'EKUITAS',      'modal',     'kredit', NULL),
  ('4',   'PENDAPATAN',   'pendapatan','kredit', NULL),
  ('5',   'HPP',          'beban',     'debit',  NULL),
  ('6',   'BEBAN',        'beban',     'debit',  NULL)
ON CONFLICT (kode) DO NOTHING;

-- 3) Anak COA retail (baris yang belum ada dari rekode di atas).
INSERT INTO accounts (kode, nama, tipe, saldo_normal) VALUES
  ('1-1100', 'Kas Kasir',                        'aset',      'debit'),
  ('1-1110', 'Kas Besar',                        'aset',      'debit'),
  ('1-1200', 'Bank',                             'aset',      'debit'),
  ('1-1210', 'Kas Dalam Penyelesaian',           'aset',      'debit'),
  ('1-1300', 'Piutang Usaha',                    'aset',      'debit'),
  ('1-1400', 'Persediaan Barang Dagang',         'aset',      'debit'),
  ('1-1500', 'PPN Masukan',                      'aset',      'debit'),
  ('1-1600', 'Uang Muka Pembelian',              'aset',      'debit'),
  ('1-2100', 'Peralatan Toko',                   'aset',      'debit'),
  ('1-2110', 'Akumulasi Penyusutan Peralatan',   'aset',      'kredit'),
  ('1-2200', 'Kendaraan',                        'aset',      'debit'),
  ('1-2210', 'Akumulasi Penyusutan Kendaraan',   'aset',      'kredit'),
  ('2-1100', 'Hutang Usaha',                     'kewajiban', 'kredit'),
  ('2-1200', 'PPN Keluaran',                     'kewajiban', 'kredit'),
  ('2-1300', 'Hutang Gaji',                      'kewajiban', 'kredit'),
  ('2-1400', 'Uang Muka Pelanggan',              'kewajiban', 'kredit'),
  ('2-1500', 'Hutang Lain-lain',                 'kewajiban', 'kredit'),
  ('3-1000', 'Modal Pemilik',                    'modal',     'kredit'),
  ('3-2000', 'Prive',                            'modal',     'debit'),
  ('3-3000', 'Laba Ditahan',                     'modal',     'kredit'),
  ('3-4000', 'Laba Tahun Berjalan',              'modal',     'kredit'),
  ('4-1100', 'Penjualan',                        'pendapatan','kredit'),
  ('4-1200', 'Diskon Penjualan',                 'pendapatan','debit'),
  ('4-1300', 'Retur Penjualan',                  'pendapatan','debit'),
  ('4-2000', 'Pendapatan Lain-lain',             'pendapatan','kredit'),
  ('4-2100', 'Selisih Stok Lebih',               'pendapatan','kredit'),
  ('5-1000', 'HPP',                              'beban',     'debit'),
  ('5-2000', 'Diskon Pembelian',                 'beban',     'kredit'),
  ('5-3000', 'Retur Pembelian',                  'beban',     'kredit'),
  ('6-1100', 'Gaji',                             'beban',     'debit'),
  ('6-1200', 'Sewa',                             'beban',     'debit'),
  ('6-1300', 'Listrik/Air/Internet',             'beban',     'debit'),
  ('6-1400', 'Pengiriman dan Kemasan',           'beban',     'debit'),
  ('6-1500', 'Pemasaran',                        'beban',     'debit'),
  ('6-1600', 'Penyusutan',                       'beban',     'debit'),
  ('6-1700', 'Administrasi Bank',                'beban',     'debit'),
  ('6-1800', 'Lain-lain',                        'beban',     'debit'),
  ('6-1900', 'Selisih Stok Kurang',              'beban',     'debit'),
  ('6-1950', 'Selisih Kas Kasir',                'beban',     'debit')
ON CONFLICT (kode) DO NOTHING;

-- 4) Pasang induk kelas pada semua anak (termasuk baris hasil rekode).
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '1') WHERE kode LIKE '1-%' AND induk_id IS NULL;
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '2') WHERE kode LIKE '2-%' AND induk_id IS NULL;
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '3') WHERE kode LIKE '3-%' AND induk_id IS NULL;
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '4') WHERE kode LIKE '4-%' AND induk_id IS NULL;
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '5') WHERE kode LIKE '5-%' AND induk_id IS NULL;
UPDATE accounts SET induk_id = (SELECT id FROM accounts WHERE kode = '6') WHERE kode LIKE '6-%' AND induk_id IS NULL;

-- ============================================================================
-- BAGIAN B — PEMETAAN AKUN (kode jurnal otomatis SELALU dibaca dari sini)
-- ============================================================================
INSERT INTO settings (kunci, nilai, keterangan)
SELECT 'akuntansi_pemetaan',
       '{"peran":{"kas_kasir":"1-1100","kas_besar":"1-1110","bank":"1-1200","kas_dalam_penyelesaian":"1-1210","piutang":"1-1300","persediaan":"1-1400","ppn_masukan":"1-1500","uang_muka_pembelian":"1-1600","hutang_usaha":"2-1100","ppn_keluaran":"2-1200","uang_muka_pelanggan":"2-1400","laba_ditahan":"3-3000","penjualan":"4-1100","diskon_penjualan":"4-1200","retur_penjualan":"4-1300","pendapatan_lain":"4-2000","selisih_stok_lebih":"4-2100","hpp":"5-1000","diskon_pembelian":"5-2000","retur_pembelian":"5-3000","selisih_stok_kurang":"6-1900","selisih_kas":"6-1950","beban_admin_bank":"6-1700"},"metode":{"tunai":"kas_kasir","transfer":"bank","qris":"kas_dalam_penyelesaian","kredit":"piutang"}}',
       'Pemetaan peran akun otomatis & metode bayar → kode akun COA'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE kunci = 'akuntansi_pemetaan');

-- ============================================================================
-- BAGIAN C — PENGATURAN PPN (PKP/non-PKP, tarif, harga termasuk PPN)
-- ============================================================================
INSERT INTO settings (kunci, nilai, keterangan)
SELECT 'akuntansi_ppn',
       '{"aktif":false,"tarif":11,"harga_termasuk":false}',
       'Pengaturan PPN: aktif (PKP), tarif %, harga sudah termasuk PPN'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE kunci = 'akuntansi_ppn');
