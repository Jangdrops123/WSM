-- ============================================================================
-- AKUNTANSI DASAR — pengganti modul akuntansi (COA/jurnal/buku besar/neraca).
-- Prinsip: TANPA debit/kredit, TANPA jurnal. Saldo kas/bank dihitung dari
-- saldo awal + mutasi (kas masuk/keluar/transfer). Piutang & hutang tetap
-- memakai tabel receivables/payables yang sudah ada (tidak berubah).
-- ============================================================================

-- Rekening kas/bank (pengganti Bagan Akun, khusus uang).
CREATE TABLE IF NOT EXISTS cash_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT    NOT NULL UNIQUE,
  nama          TEXT    NOT NULL,
  -- 'kas' | 'bank' | 'e-wallet'
  jenis         TEXT    NOT NULL DEFAULT 'kas' CHECK (jenis IN ('kas', 'bank', 'e-wallet')),
  saldo_awal    REAL    NOT NULL DEFAULT 0,
  aktif         INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TRIGGER IF NOT EXISTS trg_cash_accounts_diubah
BEFORE UPDATE ON cash_accounts
FOR EACH ROW
BEGIN
  UPDATE cash_accounts SET diubah_pada = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = OLD.id;
END;

-- Kategori pengeluaran/biaya dan pemasukan lain (bisa ditambah pengguna).
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nama       TEXT    NOT NULL UNIQUE,
  tipe       TEXT    NOT NULL CHECK (tipe IN ('pengeluaran', 'pemasukan')),
  aktif      INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_pada TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'masuk' | 'keluar' | 'transfer'
  tipe           TEXT    NOT NULL CHECK (tipe IN ('masuk', 'keluar', 'transfer')),
  tanggal        TEXT    NOT NULL DEFAULT (date('now')),
  nomor          TEXT    NOT NULL UNIQUE,
  -- akun kas sumber (untuk keluar/transfer) dan tujuan (untuk masuk/transfer)
  cash_account_id       INTEGER NOT NULL REFERENCES cash_accounts(id),
  cash_account_tujuan_id INTEGER REFERENCES cash_accounts(id),
  category_id   INTEGER REFERENCES expense_categories(id),
  jumlah        REAL    NOT NULL,
  keterangan    TEXT,
  -- jejak dokumen asal (penjualan/pembelian/pembayaran) agar laporan bisa rujuk
  sumber_tipe   TEXT,
  sumber_id     INTEGER,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  CHECK (tipe <> 'transfer' OR cash_account_tujuan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cash_tx_akun_tanggal ON cash_transactions (cash_account_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_cash_tx_sumber ON cash_transactions (sumber_tipe, sumber_id);

-- Pemetaan metode bayar -> rekening kas/bank (pengganti pemetaan COA per metode).
CREATE TABLE IF NOT EXISTS payment_method_accounts (
  metode          TEXT    PRIMARY KEY,   -- 'tunai' | 'transfer' | 'qris'
  cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id)
);

-- --------------------------------------------------------------------------
-- SEED: rekening kas/bank bawaan & kategori bawaan. Saldo awal 0 (migrasi
-- data mengisi saldo awal dari neraca jurnal lama bila ada — lihat catatan
-- pada skrip migrasi).
-- --------------------------------------------------------------------------
INSERT INTO cash_accounts (kode, nama, jenis, saldo_awal) VALUES
  ('KAS-001', 'Kas Kasir',       'kas',       0),
  ('KAS-002', 'Kas Besar',       'kas',       0),
  ('BANK-001', 'Bank',           'bank',      0),
  ('EWAL-001', 'Dompet Digital', 'e-wallet',  0)
ON CONFLICT (kode) DO NOTHING;

INSERT INTO expense_categories (nama, tipe) VALUES
  ('Gaji',        'pengeluaran'),
  ('Sewa',        'pengeluaran'),
  ('Listrik',     'pengeluaran'),
  ('Transport',   'pengeluaran'),
  ('Lain-lain',   'pengeluaran')
ON CONFLICT (nama) DO NOTHING;

INSERT INTO expense_categories (nama, tipe) VALUES
  ('Pendapatan Jasa', 'pemasukan'),
  ('Lain-lain',       'pemasukan')
ON CONFLICT (nama) DO NOTHING;

-- Pemetaan metode bayar bawaan menunjuk rekening kas bawaan.
INSERT INTO payment_method_accounts (metode, cash_account_id)
SELECT 'tunai', id FROM cash_accounts WHERE kode = 'KAS-001'
ON CONFLICT (metode) DO NOTHING;
INSERT INTO payment_method_accounts (metode, cash_account_id)
SELECT 'transfer', id FROM cash_accounts WHERE kode = 'BANK-001'
ON CONFLICT (metode) DO NOTHING;
INSERT INTO payment_method_accounts (metode, cash_account_id)
SELECT 'qris', id FROM cash_accounts WHERE kode = 'EWAL-001'
ON CONFLICT (metode) DO NOTHING;
