-- ============================================================================
-- MODUL PERSEDIAAN SUB (baru)
--   Item Masuk  → menambah stok   (alasan: stok_awal, temuan, koreksi_pos, lainnya)
--   Item Keluar → mengurangi stok (alasan: rusak, hilang, sampel, koreksi_neg, lainnya)
--
-- Perubahan stok TIDAK tersimpan di tabel ini — selalu lewat ubahStok()
-- (server/lib/stok.ts) dengan tipe_dokumen 'penyesuaian' dan
-- dokumen_id = id dokumen ini, sehingga masuk/keluar tercatat di
-- stock_ledger (riwayat per produk) tanpa mengubah CHECK tipe_dokumen.
-- Pembatalan TIDAK menghapus baris: stok dibalik, status → 'batal'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sub_stock_docs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  no_dokumen      TEXT NOT NULL UNIQUE,      -- PSM-2026-0001 / PSK-2026-0001 (otomatis)
  arah            TEXT NOT NULL CHECK (arah IN ('masuk', 'keluar')),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses (id),
  tanggal         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  alasan          TEXT NOT NULL CHECK (alasan IN (
                    'stok_awal', 'temuan', 'koreksi_pos',   -- hanya arah masuk
                    'rusak', 'hilang', 'sampel', 'koreksi_neg', -- hanya arah keluar
                    'lainnya')),
  keterangan       TEXT,
  status          TEXT NOT NULL DEFAULT 'disahkan' CHECK (status IN ('disahkan', 'batal')),
  total_qty       REAL NOT NULL DEFAULT 0,
  jumlah_item     INTEGER NOT NULL DEFAULT 0,
  dibuat_oleh     INTEGER REFERENCES users (id),
  dibuat_pada     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  dibatalkan_pada TEXT,
  batal_oleh      INTEGER REFERENCES users (id),
  alasan_batal    TEXT,
  -- alasan wajib sesuai arah dokumen (lainnya dipakai berdua)
  CHECK (
    (arah = 'masuk'  AND alasan IN ('stok_awal', 'temuan', 'koreksi_pos', 'lainnya'))
    OR
    (arah = 'keluar' AND alasan IN ('rusak', 'hilang', 'sampel', 'koreksi_neg', 'lainnya'))
  )
);

CREATE INDEX IF NOT EXISTS idx_sub_docs_arah ON sub_stock_docs (arah, tanggal);
CREATE INDEX IF NOT EXISTS idx_sub_docs_status ON sub_stock_docs (status);

-- Satu baris per produk per dokumen (stok sebelum/sesudah = snapshot saat disimpan).
CREATE TABLE IF NOT EXISTS sub_stock_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id       INTEGER NOT NULL REFERENCES sub_stock_docs (id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products (id),
  qty          REAL NOT NULL CHECK (qty > 0),
  satuan       TEXT,                         -- snapshot nama satuan dasar
  stok_sebelum REAL NOT NULL DEFAULT 0,
  stok_sesudah REAL NOT NULL DEFAULT 0,
  UNIQUE (doc_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_items_doc ON sub_stock_items (doc_id);
