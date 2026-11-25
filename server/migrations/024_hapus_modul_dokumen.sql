-- R2 — Modul "Daftar Dokumen" dilebur ke Pembelian & Penjualan.
-- Salin setiap izin dokumen ke kedua modul (idempoten), lalu hapus baris lama.
-- Peran baru tidak terpengaruh (tidak punya baris dokumen).
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT role_id, 'pembelian', aksi FROM role_permissions WHERE menu = 'dokumen';
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT role_id, 'penjualan', aksi FROM role_permissions WHERE menu = 'dokumen';
DELETE FROM role_permissions WHERE menu = 'dokumen';
