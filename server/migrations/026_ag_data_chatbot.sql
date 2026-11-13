-- BAGIAN AG3/AG9 — DATA MODE CHATBOT BARU.
--
-- AG3 entitas:
--   * operator_komposisi — kata kunci Db/Tp beserta pengali (dapat diedit/ditambah).
--   * alias_barang       — teks ternormalisasi → produk/grup (opsional per pemasok),
--                          jumlah pemakaian & terakhir dipakai (dipelajari dari koreksi).
--   * chat_match_logs    — log setiap pencocokan/koreksi (teks, hasil, skor, pengguna).
-- AG9:
--   * purchases.chat_rincian_json — rincian size, profil, dan komposisi Db/Tp
--     ikut tersimpan pada dokumen (perubahan aturan setelahnya tidak mengubah dokumen lama).

CREATE TABLE IF NOT EXISTS operator_komposisi (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT    NOT NULL UNIQUE,
  pengali     INTEGER NOT NULL,
  kata_kunci  TEXT    NOT NULL DEFAULT '[]',
  aktif       INTEGER NOT NULL DEFAULT 1,
  dibuat_pada TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

INSERT INTO operator_komposisi (label, pengali, kata_kunci) VALUES
  ('Db', 2, '["db","dbl","double","dobel","x2"]'),
  ('Tp', 0, '["tp","tnpa","tanpa","no"]');

CREATE TABLE IF NOT EXISTS alias_barang (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  teks           TEXT    NOT NULL UNIQUE,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  grup           TEXT,
  supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  pakai          INTEGER NOT NULL DEFAULT 1,
  terakhir_pakai TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  dibuat_pada    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alias_barang_teks    ON alias_barang(teks);
CREATE INDEX IF NOT EXISTS idx_alias_barang_produk  ON alias_barang(product_id);
CREATE INDEX IF NOT EXISTS idx_alias_barang_pemasok ON alias_barang(supplier_id);

CREATE TABLE IF NOT EXISTS chat_match_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipe        TEXT    NOT NULL DEFAULT 'produk',
  teks        TEXT    NOT NULL,
  hasil       TEXT    NOT NULL,
  skor        INTEGER NOT NULL DEFAULT 0,
  product_id  INTEGER,
  supplier_id INTEGER,
  pengguna_id INTEGER,
  detail_json TEXT,
  waktu       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_match_waktu ON chat_match_logs(waktu);

ALTER TABLE purchases ADD COLUMN chat_rincian_json TEXT;
