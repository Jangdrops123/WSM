-- Pengaturan ▸ tab baru (Grup Umum & Grup Transaksi).
-- Nama tabel/kolom lama TIDAK berubah. Nilai pengaturan disimpan di tabel
-- `settings` yang sudah ada (kunci `peng.<tab>.<bidang>`), sehingga
-- "Kembalikan ke Bawaan" cukup mengembalikan nilai bawaan registry.

-- Daftar toko (tab 2: Data Toko & Gudang). Pengaturan bersifat per toko
-- disimpan di `settings` dengan akhiran `@<kode_toko>`.
CREATE TABLE IF NOT EXISTS stores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kode         TEXT    NOT NULL UNIQUE,
  nama         TEXT    NOT NULL,
  alamat       TEXT,
  telepon      TEXT,
  email        TEXT,
  logo         TEXT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  aktif        INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0, 1)),
  dibuat_pada  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TRIGGER IF NOT EXISTS trg_stores_diubah
BEFORE UPDATE ON stores
FOR EACH ROW
BEGIN
  UPDATE stores SET diubah_pada = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = OLD.id;
END;
