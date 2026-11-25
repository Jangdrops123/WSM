-- Modul Pembelian/Inbound (metode Biasa): Purchase Order (opsional) > GRN > Faktur.
--
-- 1) Bangun ulang tabel purchases karena CHECK constraint tidak bisa diubah
--    lewat ALTER TABLE: tambah status 'diterima' (tahap GRN) + kolom dokumen
--    GRN/faktur. Anak purchases (purchase_items, payables, purchase_scan_logs,
--    purchase_chat_logs) di-snapshot dulu karena DROP TABLE orang tua melakukan
--    hapus-implisit (cascade) yang bisa menghapus baris anak.
--    Tabel ini belum pernah diisi kode mana pun (modul baru), tetapi salinan
--    tetap dibuat agar migrasi aman bila ada data.

CREATE TABLE _m010_pi AS SELECT * FROM purchase_items;
CREATE TABLE _m010_pa AS SELECT * FROM payables;
CREATE TABLE _m010_sl AS SELECT * FROM purchase_scan_logs;
CREATE TABLE _m010_cl AS SELECT * FROM purchase_chat_logs;

DELETE FROM purchase_items;
DELETE FROM purchase_scan_logs;
DELETE FROM purchase_chat_logs;
DELETE FROM payables;

CREATE TABLE purchases_baru (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen      TEXT NOT NULL UNIQUE,
  no_po           TEXT,
  no_grn          TEXT,
  no_faktur       TEXT,
  tanggal         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  metode_input    TEXT NOT NULL DEFAULT 'biasa' CHECK (metode_input IN ('biasa', 'scan', 'chatbot')),
  subtotal        REAL NOT NULL DEFAULT 0,
  diskon          REAL NOT NULL DEFAULT 0,
  pajak_persen    REAL NOT NULL DEFAULT 0,
  pajak           REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'diterima', 'disahkan', 'batal')),
  diterima_pada   TEXT,
  disahkan_pada   TEXT,
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT
);

INSERT INTO purchases_baru
  (id, no_dokumen, tanggal, supplier_id, warehouse_id, metode_input,
   subtotal, diskon, pajak, total, status, dibuat_oleh, dibuat_pada, diubah_pada)
SELECT id, no_dokumen, tanggal, supplier_id, warehouse_id, metode_input,
       subtotal, diskon, pajak, total, status, dibuat_oleh, dibuat_pada, diubah_pada
FROM purchases;

DROP TABLE purchases;
ALTER TABLE purchases_baru RENAME TO purchases;

INSERT INTO purchase_items SELECT * FROM _m010_pi;
INSERT INTO payables       SELECT * FROM _m010_pa;
INSERT INTO purchase_scan_logs SELECT * FROM _m010_sl;
INSERT INTO purchase_chat_logs SELECT * FROM _m010_cl;
DROP TABLE _m010_pi;
DROP TABLE _m010_pa;
DROP TABLE _m010_sl;
DROP TABLE _m010_cl;

CREATE INDEX idx_purchases_tanggal  ON purchases(tanggal);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_purchases_status   ON purchases(status);

-- Kunci dokumen disahkan (sama seperti versi awal, ditambah kolom baru).
CREATE TRIGGER trg_purchases_disahkan_terkunci
BEFORE UPDATE ON purchases
FOR EACH ROW
WHEN OLD.status = 'disahkan'
 AND NOT (
   NEW.status     = 'batal'
   AND NEW.no_dokumen  IS OLD.no_dokumen
   AND NEW.no_po       IS OLD.no_po
   AND NEW.no_grn      IS OLD.no_grn
   AND NEW.no_faktur   IS OLD.no_faktur
   AND NEW.tanggal     IS OLD.tanggal
   AND NEW.supplier_id IS OLD.supplier_id
   AND NEW.warehouse_id IS OLD.warehouse_id
   AND NEW.metode_input IS OLD.metode_input
   AND NEW.subtotal    IS OLD.subtotal
   AND NEW.diskon      IS OLD.diskon
   AND NEW.pajak_persen IS OLD.pajak_persen
   AND NEW.pajak       IS OLD.pajak
   AND NEW.total       IS OLD.total
   AND NEW.diterima_pada IS OLD.diterima_pada
   AND NEW.disahkan_pada IS OLD.disahkan_pada
   AND NEW.dibuat_oleh IS OLD.dibuat_oleh
   AND NEW.dibuat_pada IS OLD.dibuat_pada
 )
BEGIN
  SELECT RAISE(ABORT, 'Pembelian berstatus disahkan tidak dapat diubah, hanya dapat dibatalkan (void)');
END;

-- 2) COA untuk jurnal pengesahan pembelian:
--    Dr Persediaan (1200) + Dr PPN Masukan (1150) / Cr Utang Usaha (2100).
INSERT INTO accounts (kode, nama, tipe, saldo_normal) VALUES
  ('1150', 'PPN Masukan', 'aset',      'debit'),
  ('2100', 'Utang Usaha', 'kewajiban', 'kredit')
ON CONFLICT (kode) DO NOTHING;
