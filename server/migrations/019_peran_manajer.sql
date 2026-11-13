-- Peran Manajer.
--
-- Spesifikasi Pengaturan ▸ aturan: "Admin bisa mengizinkan peran lain membuka
-- tab tertentu, misalnya Manajer ke Penomoran dan Pajak." Peran Manajer sudah
-- dikenal klien (Pengaturan ▸ Halaman Awal & Peran) dan server, tetapi belum
-- ada barisnya di tabel `roles` — akibatnya Admin tidak bisa memberi izin tab
-- padanya. Disisipkan tanpa duplikat agar aman dijalankan berulang.
INSERT INTO roles (nama)
SELECT 'Manajer'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE lower(nama) = 'manajer');
