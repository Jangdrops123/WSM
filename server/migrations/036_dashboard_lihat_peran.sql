-- 036 — Peran templat harus bisa MEMBUKA Dashboard (lihat ringkasan agregat).
-- Akar bug: 031 memberi Operator/Supervisor/Viewer izin modul detail tanpa
-- 'dashboard' → seluruh GET /api/dashboard/* ditolak wajibModul (403
-- "Peran X belum memiliki izin 'Lihat' pada Dashboard").
-- Aman diulang: hanya menambah sel yang belum ada (kustomisasi Admin yang
-- menghapus sel ini... tidak dibedakan — lihat catatan di bawah).
-- CATATAN: migrasi hanya memperbaiki peran BAWAHAN templat. Bila Admin pernah
-- sengaja mencabut 'dashboard/lihat' dari peran tersebut, jalankan ulang
-- matriks via Pengaturan > Pengguna & Hak Akses > Peran setelah migrasi.
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'dashboard', 'lihat' FROM roles r WHERE lower(r.nama) = 'operator'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'dashboard' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'dashboard', 'lihat' FROM roles r WHERE lower(r.nama) = 'supervisor'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'dashboard' AND p.aksi = 'lihat');
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'dashboard', 'lihat' FROM roles r WHERE lower(r.nama) = 'viewer'
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'dashboard' AND p.aksi = 'lihat');
