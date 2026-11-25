-- 031 — Katalog peran templat User & Hak Akses (Admin, Operator, Supervisor, Viewer).
-- Aman diulang: tambah peran templat bila belum ada, beri izin bawaan sesuai
-- deskripsi templat bila peran masih kosong, dan hapus peran lama yang TIDAK
-- dipakai pengguna mana pun. Peran Owner/Administrator tidak pernah disentuh.

-- 1) Peran templat.
INSERT INTO roles (nama, bawaan) SELECT 'Operator', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'operator');
INSERT INTO roles (nama, bawaan) SELECT 'Supervisor', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'supervisor');
INSERT INTO roles (nama, bawaan) SELECT 'Viewer', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'viewer');

-- 2) Cakupan gudang bawaan peran templat = semua gudang Master Data
-- (Admin dapat mempersempit lewat Matriks Peran / form user).
UPDATE roles SET cakupan_toko = (SELECT json_group_array(kode) FROM warehouses)
WHERE lower(nama) IN ('operator', 'supervisor', 'viewer') AND cakupan_toko IS NULL;

-- 3) Izin bawaan Supervisor: semua menu kecuali Pengaturan (lihat+tambah+ubah+ekspor).
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id);
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pembelian' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pembelian' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pembelian' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pembelian' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'opname' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'opname' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'opname' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'opname' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'persediaan-sub', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'persediaan-sub' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'persediaan-sub', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'persediaan-sub' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'persediaan-sub', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'persediaan-sub' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'persediaan-sub', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'persediaan-sub' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'akuntansi', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'akuntansi' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'akuntansi', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'akuntansi' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'akuntansi', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'akuntansi' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'akuntansi', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'akuntansi' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'ekspor');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'tambah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'ubah' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'ekspor' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'ekspor');

-- 4) Izin bawaan Operator: input penjualan/POS + lihat stok, master, laporan.
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'tambah' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'ubah' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'tambah' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'tambah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'ubah' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'ubah');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'lihat');

-- 5) Izin bawaan Viewer: hanya melihat.
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'penjualan', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'penjualan' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pos', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pos' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'pembelian', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'pembelian' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'stok', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'stok' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'opname', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'opname' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'persediaan-sub', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'persediaan-sub' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'akuntansi', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'akuntansi' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'laporan', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'laporan' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'master', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'master' AND p.aksi = 'lihat');

-- 6) Hapus peran lama yang tidak dipakai pengguna mana pun.
DELETE FROM role_permissions WHERE role_id IN (
  SELECT id FROM roles
  WHERE lower(nama) IN ('kasir', 'gudang', 'akuntan', 'manajer')
  AND lower(nama) NOT IN ('owner', 'administrator')
  AND NOT EXISTS (SELECT 1 FROM users WHERE users.role_id = roles.id)
);
DELETE FROM role_hak_khusus WHERE role_id IN (
  SELECT id FROM roles
  WHERE lower(nama) IN ('kasir', 'gudang', 'akuntan', 'manajer')
  AND lower(nama) NOT IN ('owner', 'administrator')
  AND NOT EXISTS (SELECT 1 FROM users WHERE users.role_id = roles.id)
);
DELETE FROM roles
WHERE lower(nama) IN ('kasir', 'gudang', 'akuntan', 'manajer')
AND lower(nama) NOT IN ('owner', 'administrator')
AND NOT EXISTS (SELECT 1 FROM users WHERE users.role_id = roles.id);
