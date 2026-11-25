-- 008 — Modul hak akses "purchase-order" (Purchase Order / PO) — PostgreSQL.
-- Menyalin izin modul Pembelian tiap peran ke baris purchase-order agar akses
-- PO tidak berubah saat modul dipisahkan. Aman diulang.
INSERT INTO role_permissions (role_id, menu, aksi)
SELECT role_id, 'purchase-order', aksi
FROM role_permissions
WHERE menu = 'pembelian'
ON CONFLICT (role_id, menu, aksi) DO NOTHING;
