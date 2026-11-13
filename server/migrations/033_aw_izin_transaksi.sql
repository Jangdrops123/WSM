-- 033 — AW1: registri izin transaksi (terima/batal/batal_disahkan).
-- Aman diulang. Memperluas CHECK role_permissions agar memuat aksi baru,
-- lalu memberi izin padanan ke peran yang sudah ada.

-- 1) Perluas CHECK: bangun ulang tabel dengan daftar aksi baru.
CREATE TABLE IF NOT EXISTS role_permissions_aw1 (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  menu    TEXT NOT NULL,
  aksi    TEXT NOT NULL
         CHECK (aksi IN ('lihat','tambah','ubah','hapus','cetak','ekspor','impor','sahkan','batal','terima','batal_disahkan')),
  UNIQUE (role_id, menu, aksi)
);
INSERT OR IGNORE INTO role_permissions_aw1 (id, role_id, menu, aksi)
  SELECT id, role_id, menu,
    CASE WHEN aksi = 'batal' THEN 'sahkan' ELSE aksi END
  FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_aw1 RENAME TO role_permissions;
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_menu_aksi ON role_permissions (role_id, menu, aksi);

-- 2) Nilai awal (seed) per AW1:
-- Owner & Administrator: semua kode baru.
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', a.aksi FROM roles r,
  (SELECT 'terima' AS aksi UNION ALL SELECT 'batal' UNION ALL SELECT 'batal_disahkan' UNION ALL SELECT 'cetak' UNION ALL SELECT 'ekspor') a
WHERE lower(r.nama) IN ('owner','administrator');

INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', a.aksi FROM roles r,
  (SELECT 'sahkan' AS aksi UNION ALL SELECT 'batal' UNION ALL SELECT 'cetak' UNION ALL SELECT 'ekspor') a
WHERE lower(r.nama) IN ('owner','administrator');

-- Staf Gudang (peran 'gudang'): lihat,tambah,ubah,terima (pembelian); lihat,tambah,ubah (opname).
-- Hanya bila peran belum punya baris itu (jangan menimpa kustomisasi Owner).
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', a.aksi FROM roles r,
  (SELECT 'lihat' AS aksi UNION ALL SELECT 'tambah' UNION ALL SELECT 'ubah' UNION ALL SELECT 'terima') a
WHERE lower(r.nama) = 'gudang';

INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', a.aksi FROM roles r,
  (SELECT 'lihat' AS aksi UNION ALL SELECT 'tambah' UNION ALL SELECT 'ubah') a
WHERE lower(r.nama) = 'gudang';

-- 3) Migrasi peran yang sudah ada: yang punya Sahkan mendapat Terima & Batal
-- (padanan operasional), tetapi Batal & Pulihkan HANYA Owner/Admin otomatis
-- (sesuai AW1: "hanya jika Owner menyetujuinya").
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT DISTINCT p.role_id, 'pembelian', 'terima'
FROM role_permissions p JOIN roles r ON r.id = p.role_id
WHERE p.menu = 'pembelian' AND p.aksi = 'sahkan'
  AND lower(r.nama) NOT IN ('owner','administrator');

INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT DISTINCT p.role_id, 'pembelian', 'batal'
FROM role_permissions p JOIN roles r ON r.id = p.role_id
WHERE p.menu = 'pembelian' AND p.aksi = 'sahkan'
  AND lower(r.nama) NOT IN ('owner','administrator');

-- Kasir: tidak diberi izin pembelian (dipastikan tidak ada yang otomatis).
-- (Tidak ada INSERT untuk kasir di sini.)
