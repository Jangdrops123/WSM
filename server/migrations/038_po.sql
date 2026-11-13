-- Modul Purchase Order (PO) — pesanan ke pemasok + penerimaan bertahap.
-- Status: draft → terkirim → sebagian → selesai | selesai_kurang | lebih.
-- Qty selalu disimpan dalam PCS; tampilan kodi dihitung (isi_per_kodi).
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  no_po           TEXT NOT NULL UNIQUE,
  tanggal         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  catatan         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','terkirim','sebagian','selesai','selesai_kurang','lebih')),
  total_pcs       INTEGER NOT NULL DEFAULT 0,
  total_harga     REAL NOT NULL DEFAULT 0,
  dikirim_pada    TEXT,
  dikirim_tujuan  TEXT,
  ditutup_pada    TEXT,
  dibuat_oleh     INTEGER REFERENCES users(id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_tanggal  ON purchase_orders(tanggal);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_no       ON purchase_orders(no_po);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id       INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty_pesan   INTEGER NOT NULL CHECK (qty_pesan > 0),
  harga_beli  REAL NOT NULL DEFAULT 0 CHECK (harga_beli >= 0),
  satuan      TEXT NOT NULL DEFAULT 'pcs',
  UNIQUE (po_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);

CREATE TABLE IF NOT EXISTS po_receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id          INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  tanggal        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  no_surat_jalan TEXT,
  catatan        TEXT,
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  dibuat_oleh    INTEGER REFERENCES users(id),
  dibuat_pada    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_por_po      ON po_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_por_tanggal ON po_receipts(tanggal);

CREATE TABLE IF NOT EXISTS po_receipt_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id  INTEGER NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty_datang  INTEGER NOT NULL CHECK (qty_datang > 0)
);
CREATE INDEX IF NOT EXISTS idx_pori_receipt ON po_receipt_items(receipt_id);

-- Pengaturan isi per kodi (pcs), bisa diubah di Pengaturan.
INSERT INTO settings (kunci, nilai, keterangan) VALUES ('isi_per_kodi', '20', 'Jumlah pcs dalam 1 kodi untuk modul Purchase')
ON CONFLICT(kunci) DO NOTHING;
