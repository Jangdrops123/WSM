-- 040 — Modul hak akses "purchase-order" (Purchase Order / PO).
-- PO dipisahkan dari modul Pembelian agar izin daftar/buat/ubah/batal PO bisa
-- diatur per peran. Izin lama disalin PERSIS dari Pembelian supaya akses PO
-- tidak berubah saat pemisahan; Admin dapat menyesuaikannya di matriks peran.
-- Aman diulang.
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT role_id, 'purchase-order', aksi
FROM role_permissions
WHERE menu = 'pembelian';
