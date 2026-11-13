-- ============================================================================
-- Migrasi awal: seluruh skema relasional POS + WMS + Akuntansi
-- Konvensi:
--   * id INTEGER PRIMARY KEY AUTOINCREMENT
--   * status transaksi: draft / disahkan / batal  (CHECK)
--   * boolean: INTEGER 0/1 (CHECK)
--   * waktu/tanggal: TEXT ISO-8601 ('YYYY-MM-DD HH:MM:SS.SSS' / 'YYYY-MM-DD')
--   * dokumen disahkan terkunci di level database lewat trigger
--   * setiap perubahan stock_balances wajib disertai baris stock_ledger
--     dalam transaksi yang sama (dijamin lapisan aplikasi, server/lib/stock.ts)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. AKSES & AUDIT
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL UNIQUE
);

CREATE TABLE role_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  menu          TEXT NOT NULL,
  aksi          TEXT NOT NULL CHECK (aksi IN ('lihat','tambah','ubah','hapus','sahkan','batal','ekspor','impor')),
  UNIQUE (role_id, menu, aksi)
);

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nama                TEXT NOT NULL,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT,
  password_hash       TEXT NOT NULL,
  role_id             INTEGER NOT NULL REFERENCES roles(id),
  pin_supervisor_hash TEXT,
  aktif               INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_oleh         INTEGER REFERENCES users(id),
  dibuat_pada         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada         TEXT
);

CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  waktu         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  aksi          TEXT NOT NULL,
  tabel         TEXT NOT NULL,
  record_id     TEXT,
  data_sebelum  TEXT,
  data_sesudah  TEXT,
  alasan        TEXT
);

CREATE INDEX idx_audit_logs_tabel_waktu ON audit_logs (tabel, waktu);
CREATE INDEX idx_audit_logs_user_waktu  ON audit_logs (user_id, waktu);

-- ---------------------------------------------------------------------------
-- 2. MASTER DATA
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL UNIQUE,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE brands (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL UNIQUE,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL UNIQUE,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

-- Master Produk TANPA varian: identitas (SKU unik, barcode), harga, dan stok
-- minimum melekat langsung pada produk. Satu baris = satu unit stok.
CREATE TABLE products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nama            TEXT NOT NULL,
  sku             TEXT NOT NULL UNIQUE,
  barcode         TEXT UNIQUE,
  category_id     INTEGER REFERENCES categories(id),
  brand_id        INTEGER REFERENCES brands(id),
  satuan_dasar_id INTEGER REFERENCES units(id),
  harga_beli      REAL NOT NULL DEFAULT 0,
  harga_jual      REAL NOT NULL DEFAULT 0,
  stok_min        REAL NOT NULL DEFAULT 0,
  aktif           INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT
);

CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_brand     ON products (brand_id);
CREATE INDEX idx_products_nama      ON products (nama);

CREATE TABLE unit_conversions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id              INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id                 INTEGER NOT NULL REFERENCES units(id),
  jumlah_per_satuan_dasar REAL NOT NULL CHECK (jumlah_per_satuan_dasar > 0),
  UNIQUE (product_id, unit_id)
);

CREATE TABLE packs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_box      TEXT NOT NULL UNIQUE,
  barcode_box   TEXT UNIQUE,
  nama          TEXT NOT NULL,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE pack_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id     INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         REAL NOT NULL CHECK (qty > 0),
  UNIQUE (pack_id, product_id)
);

CREATE TABLE customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nama            TEXT NOT NULL,
  telepon         TEXT,
  alamat          TEXT,
  limit_piutang   REAL NOT NULL DEFAULT 0,
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT
);

CREATE TABLE suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  telepon       TEXT,
  alamat        TEXT,
  termin_hari   INTEGER NOT NULL DEFAULT 0,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE warehouses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL UNIQUE,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  zona          TEXT,
  rak           TEXT,
  bin           TEXT,
  kode_lokasi   TEXT NOT NULL UNIQUE,
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE INDEX idx_locations_warehouse ON locations (warehouse_id);

-- ---------------------------------------------------------------------------
-- 3. STOK (WMS)
-- ---------------------------------------------------------------------------
-- SALDO: per produk per gudang (tanpa lokasi) — lokasi/rak hanya informasi
-- penempatan yang tercatat di mutasi (stock_ledger), transfer, dan opname.
CREATE TABLE stock_balances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  qty           REAL NOT NULL DEFAULT 0,
  diubah_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  UNIQUE (product_id, warehouse_id)
);

CREATE INDEX idx_stock_balances_product   ON stock_balances (product_id);
CREATE INDEX idx_stock_balances_warehouse ON stock_balances (warehouse_id);

-- MUTASI STOK: satu-satunya jalur perubahan saldo (dijamin server/lib/stok.ts).
-- location_id = penempatan saat mutasi terjadi (NULL bila tidak diketahui).
-- tipe_dokumen dibatasi CHECK: hanya dari dokumen transaksi yang sah.
CREATE TABLE stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  location_id   INTEGER REFERENCES locations(id),
  tipe_dokumen  TEXT NOT NULL CHECK (tipe_dokumen IN
    ('pembelian', 'pembelian_batal', 'penjualan', 'retur',
     'transfer', 'transfer_batal', 'opname', 'penyesuaian')),
  dokumen_id    INTEGER,
  qty_masuk     REAL NOT NULL DEFAULT 0,
  qty_keluar    REAL NOT NULL DEFAULT 0,
  saldo         REAL NOT NULL DEFAULT 0,
  nilai_unit    REAL NOT NULL DEFAULT 0,
  user_id       INTEGER REFERENCES users(id)
);

CREATE INDEX idx_stock_ledger_product_tanggal ON stock_ledger (product_id, tanggal);
CREATE INDEX idx_stock_ledger_dokumen         ON stock_ledger (tipe_dokumen, dokumen_id);

CREATE TABLE stock_transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen      TEXT NOT NULL UNIQUE,
  dari_warehouse  INTEGER NOT NULL REFERENCES warehouses(id),
  ke_warehouse    INTEGER NOT NULL REFERENCES warehouses(id),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  tanggal         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT,
  CHECK (dari_warehouse <> ke_warehouse)
);

CREATE TABLE stock_transfer_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         REAL NOT NULL CHECK (qty > 0),
  UNIQUE (transfer_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 4. POS (PENJUALAN KASIR)
-- ---------------------------------------------------------------------------
CREATE TABLE cashier_shifts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  buka_pada         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  tutup_pada        TEXT,
  kas_awal          REAL NOT NULL DEFAULT 0,
  kas_akhir_sistem  REAL,
  kas_akhir_fisik   REAL,
  selisih           REAL,
  dibuat_oleh       INTEGER REFERENCES users(id),
  dibuat_pada       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada       TEXT
);

CREATE TABLE sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen    TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  shift_id      INTEGER REFERENCES cashier_shifts(id),
  kasir_id      INTEGER NOT NULL REFERENCES users(id),
  customer_id   INTEGER REFERENCES customers(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  mode_pos      TEXT NOT NULL DEFAULT 'foto' CHECK (mode_pos IN ('foto', 'cepat')),
  subtotal      REAL NOT NULL DEFAULT 0,
  diskon        REAL NOT NULL DEFAULT 0,
  pajak         REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE INDEX idx_sales_tanggal ON sales (tanggal);
CREATE INDEX idx_sales_shift   ON sales (shift_id);
CREATE INDEX idx_sales_kasir   ON sales (kasir_id);

-- Snapshot nama/SKU/harga disimpan per baris agar riwayat transaksi tetap
-- utuh walau master produk berubah nama/harga.
CREATE TABLE sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  nama_produk   TEXT NOT NULL,
  sku           TEXT NOT NULL,
  qty           REAL NOT NULL CHECK (qty > 0),
  unit_id       INTEGER REFERENCES units(id),
  harga         REAL NOT NULL DEFAULT 0,
  diskon        REAL NOT NULL DEFAULT 0,
  subtotal      REAL NOT NULL DEFAULT 0,
  hpp           REAL NOT NULL DEFAULT 0,
  UNIQUE (sale_id, product_id)
);

CREATE TABLE sale_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  metode      TEXT NOT NULL,
  jumlah      REAL NOT NULL,
  referensi   TEXT
);

CREATE TABLE held_sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kasir_id    INTEGER NOT NULL REFERENCES users(id),
  data_json   TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TABLE sale_returns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen    TEXT NOT NULL UNIQUE,
  sale_id       INTEGER NOT NULL REFERENCES sales(id),
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  alasan        TEXT,
  total         REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE sale_return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  nama_produk   TEXT NOT NULL,
  sku           TEXT NOT NULL,
  qty           REAL NOT NULL CHECK (qty > 0),
  harga         REAL NOT NULL DEFAULT 0,
  UNIQUE (return_id, product_id)
);

-- ---------------------------------------------------------------------------
-- 5. PEMBELIAN / INBOUND (WMS)
-- ---------------------------------------------------------------------------
CREATE TABLE purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen      TEXT NOT NULL UNIQUE,
  tanggal         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  metode_input    TEXT NOT NULL DEFAULT 'biasa' CHECK (metode_input IN ('biasa', 'scan', 'chatbot')),
  subtotal        REAL NOT NULL DEFAULT 0,
  diskon          REAL NOT NULL DEFAULT 0,
  pajak           REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT
);

CREATE INDEX idx_purchases_tanggal  ON purchases (tanggal);
CREATE INDEX idx_purchases_supplier ON purchases (supplier_id);

CREATE TABLE purchase_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  nama_produk     TEXT NOT NULL,
  sku             TEXT NOT NULL,
  qty             REAL NOT NULL CHECK (qty > 0),
  unit_id         INTEGER REFERENCES units(id),
  harga_beli      REAL NOT NULL DEFAULT 0,
  diskon          REAL NOT NULL DEFAULT 0,
  subtotal        REAL NOT NULL DEFAULT 0,
  pack_id         INTEGER REFERENCES packs(id),
  sumber_scan     TEXT,
  direvisi        INTEGER NOT NULL DEFAULT 0 CHECK (direvisi IN (0, 1)),
  location_id     INTEGER REFERENCES locations(id)
);

-- Satu baris per kombinasi item (lokasi & pack boleh NULL)
CREATE UNIQUE INDEX idx_purchase_items_unik
  ON purchase_items (purchase_id, product_id, COALESCE(location_id, -1), COALESCE(pack_id, -1));

CREATE TABLE purchase_scan_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id   INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  barcode       TEXT NOT NULL,
  tipe          TEXT NOT NULL CHECK (tipe IN ('box', 'satuan', 'tidak_dikenal')),
  pack_id       INTEGER REFERENCES packs(id),
  product_id    INTEGER REFERENCES products(id),
  waktu         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  user_id       INTEGER REFERENCES users(id)
);

CREATE TABLE purchase_chat_logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id         INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  pesan_user          TEXT NOT NULL,
  hasil_parse_json    TEXT,
  waktu               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- ---------------------------------------------------------------------------
-- 6. OPNAME STOK
-- ---------------------------------------------------------------------------
CREATE TABLE opname_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen          TEXT NOT NULL UNIQUE,
  warehouse_id        INTEGER NOT NULL REFERENCES warehouses(id),
  location_id         INTEGER REFERENCES locations(id),
  tanggal             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  metode              TEXT NOT NULL DEFAULT 'manual' CHECK (metode IN ('manual', 'scan', 'gabungan')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  penanggung_jawab_id INTEGER NOT NULL REFERENCES users(id),
  disetujui_oleh      INTEGER REFERENCES users(id),
  dibuat_oleh         INTEGER REFERENCES users(id),
  dibuat_pada         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada         TEXT
);

CREATE TABLE opname_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES opname_sessions(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  location_id   INTEGER REFERENCES locations(id),
  qty_sistem   REAL NOT NULL DEFAULT 0,
  qty_fisik     REAL NOT NULL DEFAULT 0,
  selisih       REAL NOT NULL DEFAULT 0,
  catatan       TEXT
);

CREATE UNIQUE INDEX idx_opname_items_unik
  ON opname_items (session_id, product_id, COALESCE(location_id, -1));

CREATE TABLE opname_scans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES opname_sessions(id) ON DELETE CASCADE,
  barcode       TEXT NOT NULL,
  product_id    INTEGER REFERENCES products(id),
  location_id   INTEGER REFERENCES locations(id),
  waktu         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  user_id       INTEGER REFERENCES users(id),
  dibatalkan    INTEGER NOT NULL DEFAULT 0 CHECK (dibatalkan IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- 7. AKUNTANSI
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  tipe          TEXT NOT NULL,
  induk_id      INTEGER REFERENCES accounts(id),
  saldo_normal  TEXT NOT NULL DEFAULT 'debit' CHECK (saldo_normal IN ('debit', 'kredit')),
  aktif         INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE INDEX idx_accounts_induk ON accounts (induk_id);

CREATE TABLE periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tahun         INTEGER NOT NULL,
  bulan         INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  status        TEXT NOT NULL DEFAULT 'buka' CHECK (status IN ('buka', 'tutup')),
  UNIQUE (tahun, bulan)
);

CREATE TABLE journals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  no_jurnal     TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  period_id     INTEGER NOT NULL REFERENCES periods(id),
  sumber_tipe   TEXT NOT NULL,
  sumber_id     INTEGER,
  keterangan    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'disahkan', 'batal')),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE INDEX idx_journals_sumber  ON journals (sumber_tipe, sumber_id);
CREATE INDEX idx_journals_tanggal ON journals (tanggal);

-- Baris terkait produk (persediaan/HPP/penyesuaian) mengacu langsung
-- product_id + snapshot nama & SKU saat transaksi; baris kas/piutang/utang
-- membiarkan product_id NULL.
CREATE TABLE journal_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id    INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  product_id    INTEGER REFERENCES products(id),
  nama_produk   TEXT,
  sku           TEXT,
  debit         REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
  kredit        REAL NOT NULL DEFAULT 0 CHECK (kredit >= 0),
  keterangan    TEXT,
  CHECK (debit = 0 OR kredit = 0)
);

CREATE INDEX idx_journal_lines_journal ON journal_lines (journal_id);

CREATE TABLE payables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id   INTEGER NOT NULL UNIQUE REFERENCES purchases(id),
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  jatuh_tempo   TEXT,
  total         REAL NOT NULL DEFAULT 0,
  terbayar      REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'belum' CHECK (status IN ('belum', 'sebagian', 'lunas', 'batal')),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE receivables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  jatuh_tempo   TEXT,
  total         REAL NOT NULL DEFAULT 0,
  terbayar      REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'belum' CHECK (status IN ('belum', 'sebagian', 'lunas', 'batal')),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipe          TEXT NOT NULL,
  referensi_id  INTEGER,
  tanggal       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  jumlah        REAL NOT NULL,
  akun_kas_id   INTEGER NOT NULL REFERENCES accounts(id),
  dibuat_oleh   INTEGER REFERENCES users(id),
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada   TEXT
);

-- ---------------------------------------------------------------------------
-- 8. IMPOR MASSAL
-- ---------------------------------------------------------------------------
CREATE TABLE import_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  modul         TEXT NOT NULL,
  nama_file     TEXT NOT NULL,
  total_baris   INTEGER NOT NULL DEFAULT 0,
  baris_valid   INTEGER NOT NULL DEFAULT 0,
  baris_error   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'diproses' CHECK (status IN ('diproses', 'selesai', 'gagal')),
  user_id       INTEGER REFERENCES users(id),
  waktu         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TABLE import_errors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  nomor_baris   INTEGER NOT NULL,
  kolom         TEXT,
  pesan         TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 9. INFRASTRUKTUR APLIKASI
-- ---------------------------------------------------------------------------
-- Penomoran dokumen otomatis (no_dokumen), mis. kunci 'penjualan-2026'
CREATE TABLE document_counters (
  kunci     TEXT PRIMARY KEY,
  terakhir  INTEGER NOT NULL DEFAULT 0
);

-- Pengaturan aplikasi (stok minus aktif/tidak, pajak, cabang, dll.)
CREATE TABLE settings (
  kunci       TEXT PRIMARY KEY,
  nilai       TEXT,
  keterangan  TEXT,
  diubah_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- ---------------------------------------------------------------------------
-- 10. TRIGGER PENJAGA ATURAN
-- ---------------------------------------------------------------------------

-- 10a. Jurnal: total debit wajib sama dengan total kredit saat disahkan
CREATE TRIGGER trg_journals_disahkan_seimbang
BEFORE UPDATE OF status ON journals
FOR EACH ROW
WHEN NEW.status = 'disahkan'
 AND (
   (SELECT COALESCE(SUM(debit), 0)  FROM journal_lines WHERE journal_id = NEW.id) <>
   (SELECT COALESCE(SUM(kredit), 0) FROM journal_lines WHERE journal_id = NEW.id)
   OR
   (SELECT COUNT(*) FROM journal_lines WHERE journal_id = NEW.id) = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'Jurnal harus memiliki baris dan total debit = total kredit sebelum disahkan');
END;

-- 10b. Jurnal disahkan: hanya boleh diubah menjadi batal (kolom lain terkunci)
CREATE TRIGGER trg_journals_disahkan_terkunci
BEFORE UPDATE ON journals
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status = 'batal'
   AND NEW.no_jurnal   IS OLD.no_jurnal
   AND NEW.tanggal     IS OLD.tanggal
   AND NEW.period_id   IS OLD.period_id
   AND NEW.sumber_tipe IS OLD.sumber_tipe
   AND NEW.sumber_id   IS OLD.sumber_id
   AND NEW.keterangan  IS OLD.keterangan
   AND NEW.dibuat_oleh IS OLD.dibuat_oleh
   AND NEW.dibuat_pada IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Jurnal berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 10c. Baris jurnal induk disahkan tidak boleh ditambah/diubah/dihapus
CREATE TRIGGER trg_journal_lines_induk_disahkan_ins
BEFORE INSERT ON journal_lines
FOR EACH ROW
WHEN (SELECT status FROM journals WHERE id = NEW.journal_id) = 'disahkan'
BEGIN
  SELECT RAISE(ABORT, 'Jurnal berstatus disahkan tidak dapat diubah');
END;

CREATE TRIGGER trg_journal_lines_induk_disahkan_upd
BEFORE UPDATE ON journal_lines
FOR EACH ROW
WHEN (SELECT status FROM journals WHERE id = OLD.journal_id) = 'disahkan'
BEGIN
  SELECT RAISE(ABORT, 'Jurnal berstatus disahkan tidak dapat diubah');
END;

CREATE TRIGGER trg_journal_lines_induk_disahkan_del
BEFORE DELETE ON journal_lines
FOR EACH ROW
WHEN (SELECT status FROM journals WHERE id = OLD.journal_id) = 'disahkan'
BEGIN
  SELECT RAISE(ABORT, 'Jurnal berstatus disahkan tidak dapat diubah');
END;

-- 10d. Penjualan disahkan: hanya boleh diubah statusnya menjadi batal
CREATE TRIGGER trg_sales_disahkan_terkunci
BEFORE UPDATE ON sales
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status     = 'batal'
   AND NEW.no_dokumen IS OLD.no_dokumen
   AND NEW.tanggal    IS OLD.tanggal
   AND NEW.shift_id   IS OLD.shift_id
   AND NEW.kasir_id   IS OLD.kasir_id
   AND NEW.customer_id IS OLD.customer_id
   AND NEW.warehouse_id IS OLD.warehouse_id
   AND NEW.mode_pos  IS OLD.mode_pos
   AND NEW.subtotal  IS OLD.subtotal
   AND NEW.diskon    IS OLD.diskon
   AND NEW.pajak     IS OLD.pajak
   AND NEW.total     IS OLD.total
   AND NEW.dibuat_oleh IS OLD.dibuat_oleh
   AND NEW.dibuat_pada IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Penjualan berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void) atau diretur');
END;

-- 10e. Pembelian disahkan: terkunci
CREATE TRIGGER trg_purchases_disahkan_terkunci
BEFORE UPDATE ON purchases
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status     = 'batal'
   AND NEW.no_dokumen  IS OLD.no_dokumen
   AND NEW.tanggal     IS OLD.tanggal
   AND NEW.supplier_id IS OLD.supplier_id
   AND NEW.warehouse_id IS OLD.warehouse_id
   AND NEW.metode_input IS OLD.metode_input
   AND NEW.subtotal    IS OLD.subtotal
   AND NEW.diskon      IS OLD.diskon
   AND NEW.pajak       IS OLD.pajak
   AND NEW.total       IS OLD.total
   AND NEW.dibuat_oleh IS OLD.dibuat_oleh
   AND NEW.dibuat_pada IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Pembelian berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 10f. Opname disahkan: terkunci
CREATE TRIGGER trg_opname_disahkan_terkunci
BEFORE UPDATE ON opname_sessions
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status     = 'batal'
   AND NEW.no_dokumen         IS OLD.no_dokumen
   AND NEW.warehouse_id       IS OLD.warehouse_id
   AND NEW.location_id        IS OLD.location_id
   AND NEW.tanggal            IS OLD.tanggal
   AND NEW.metode             IS OLD.metode
   AND NEW.penanggung_jawab_id IS OLD.penanggung_jawab_id
   AND NEW.disetujui_oleh     IS OLD.disetujui_oleh
   AND NEW.dibuat_oleh        IS OLD.dibuat_oleh
   AND NEW.dibuat_pada        IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Opname berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 10g. Transfer stok disahkan: terkunci
CREATE TRIGGER trg_transfers_disahkan_terkunci
BEFORE UPDATE ON stock_transfers
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status        = 'batal'
   AND NEW.no_dokumen    IS OLD.no_dokumen
   AND NEW.dari_warehouse IS OLD.dari_warehouse
   AND NEW.ke_warehouse   IS OLD.ke_warehouse
   AND NEW.tanggal        IS OLD.tanggal
   AND NEW.dibuat_oleh    IS OLD.dibuat_oleh
   AND NEW.dibuat_pada    IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Transfer berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 10h. Retur penjualan disahkan: terkunci
CREATE TRIGGER trg_sale_returns_disahkan_terkunci
BEFORE UPDATE ON sale_returns
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status     = 'batal'
   AND NEW.no_dokumen IS OLD.no_dokumen
   AND NEW.sale_id    IS OLD.sale_id
   AND NEW.tanggal    IS OLD.tanggal
   AND NEW.alasan     IS OLD.alasan
   AND NEW.total      IS OLD.total
   AND NEW.dibuat_oleh IS OLD.dibuat_oleh
   AND NEW.dibuat_pada IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Retur berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 10i. Produk yang sudah bertransaksi TIDAK BOLEH dihapus — hanya bisa
--      dinonaktifkan (aktif = 0). Referensi transaksi di seluruh tabel jadi
--      penanda: sale_items, purchase_items, opname_items, stock_ledger,
--      stock_transfer_items, journal_lines.
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
