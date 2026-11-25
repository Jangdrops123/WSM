-- ============================================================================
-- AR — Pengguna & Hak Akses per Toko/Gudang (Owner tertinggi)
-- 1) Peran Owner (setara Administrator, tidak bisa dihapus/dibatasi).
-- 2) Hak khusus tambahan sesuai AR2.
-- 3) Kolom pembatasan login, mode toko, perangkat, penanda migrasi.
-- 4) Opsi delegasi Admin (default mati).
-- ============================================================================

-- 1. Peran Owner -------------------------------------------------------------
INSERT INTO roles (nama, bawaan) SELECT 'Owner', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'owner');
UPDATE roles SET bawaan = 1 WHERE lower(nama) IN ('owner','administrator','manajer','kasir','gudang','akuntan');

-- Salin matriks Administrator ke Owner bila Owner masih kosong.
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT (SELECT id FROM roles WHERE lower(nama) = 'owner'), m.menu, m.aksi
FROM role_permissions m
JOIN roles r ON r.id = m.role_id AND lower(r.nama) = 'administrator'
WHERE EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'owner')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions p
    WHERE p.role_id = (SELECT id FROM roles WHERE lower(nama) = 'owner')
  );

-- Salin hak khusus Administrator ke Owner.
INSERT OR IGNORE INTO role_hak_khusus (role_id, lihat_hpp, ubah_harga_kasir, diskon_maks, hapus_transaksi, proses_tahunan)
SELECT (SELECT id FROM roles WHERE lower(nama) = 'owner'), lihat_hpp, ubah_harga_kasir, diskon_maks, hapus_transaksi, proses_tahunan
FROM role_hak_khusus
WHERE role_id = (SELECT id FROM roles WHERE lower(nama) = 'administrator' LIMIT 1);

-- 2. Hak khusus tambahan (AR2) ----------------------------------------------
-- SQLite tidak punya ADD COLUMN IF NOT EXISTS — migrasi jalan sekali, jadi aman.
ALTER TABLE role_hak_khusus ADD COLUMN void_retur INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN buka_tutup_shift INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN lihat_laba INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN ubah_stok_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN sahkan_opname INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN hapus_massal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN kelola_pengguna INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN ubah_pengaturan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE role_hak_khusus ADD COLUMN akses_semua_toko INTEGER NOT NULL DEFAULT 0;

-- Owner/Administrator selalu penuh (ditegakkan juga di kode).
UPDATE role_hak_khusus SET
  lihat_hpp = 1, ubah_harga_kasir = 1, diskon_maks = 100, hapus_transaksi = 1,
  void_retur = 1, buka_tutup_shift = 1, lihat_laba = 1, ubah_stok_manual = 1,
  sahkan_opname = 1, hapus_massal = 1, kelola_pengguna = 1, ubah_pengaturan = 1,
  akses_semua_toko = 1, proses_tahunan = 1
WHERE role_id IN (SELECT id FROM roles WHERE lower(nama) IN ('owner','administrator'));

-- 3. Kolom pengguna (AR4/AR7/AR10) -------------------------------------------
ALTER TABLE users ADD COLUMN toko_bawaan TEXT;
ALTER TABLE users ADD COLUMN mode_toko TEXT NOT NULL DEFAULT 'terbatas';
ALTER TABLE users ADD COLUMN periode_aktif INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN jam_dari TEXT;
ALTER TABLE users ADD COLUMN jam_sampai TEXT;
ALTER TABLE users ADD COLUMN hari_aktif TEXT;
ALTER TABLE users ADD COLUMN zona TEXT NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE users ADD COLUMN login_shift INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN maks_perangkat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN perlu_ditinjau INTEGER NOT NULL DEFAULT 0;

-- Tandai pengguna non-Admin yang sudah ada agar Owner meninjau aksesnya (AR10).
UPDATE users SET perlu_ditinjau = 1
WHERE id NOT IN (
  SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
  WHERE lower(r.nama) IN ('owner','administrator')
);

-- 4. Delegasi Admin (AR1, default mati) ---------------------------------------
INSERT OR IGNORE INTO settings (kunci, nilai, keterangan) VALUES
  ('peng.admin_delegasi', 'false', 'Izinkan Admin mengelola pengguna di toko miliknya (default mati)');
