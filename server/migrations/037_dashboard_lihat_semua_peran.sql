-- 037 — Seluruh peran non-admin bisa MEMBUKA Dashboard (lihat ringkasan agregat).
-- Melengkapi 036 (yang hanya menyebut operator/supervisor/viewer berdasar nama):
-- peran kustom seperti Gudang/Kasir tetap 403 "belum memiliki izin 'Lihat' pada
-- Dashboard" karena tidak punya sel dashboard/lihat.
-- Aman diulang: hanya menambah sel yang belum ada (NOT EXISTS). Peran top
-- (owner/administrator) tidak perlu baris eksplisit — bacaHak() memberi penuh.
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT r.id, 'dashboard', 'lihat' FROM roles r
WHERE lower(r.nama) NOT IN ('owner', 'administrator', 'admin')
AND NOT EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.menu = 'dashboard' AND p.aksi = 'lihat');
