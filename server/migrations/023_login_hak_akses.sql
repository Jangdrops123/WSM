-- ============================================================================
-- TAHAP 1 & 2 — Modul Log In, Pengguna, dan Hak Akses
--
-- 1) users: kolom kontak/status/kunci (WhatsApp, cakupan toko, wajib ganti
--    password, hitung gagal, masa kunci, login terakhir).
-- 2) username unik tanpa membedakan huruf besar/kecil & spasi dipangkas
--    (indeks ekspresi LOWER(TRIM(username))).
-- 3) sessions, password_resets (token reset 30 menit, sekali pakai),
--    recovery_codes (10 kode pemulihan Admin utama, sekali pakai).
-- 4) roles: cakupan toko/gudang per peran + tanda peran bawaan.
-- 5) role_permissions: dibangun ulang agar kolom aksi memuat 'cetak'
--    (matriks Hak Akses: Lihat/Tambah/Ubah/Hapus/Cetak/Ekspor/Impor/Sahkan).
-- 6) Benih matriks bawaan agar perilaku peran lama TIDAK berubah.
-- ============================================================================

-- 1. Kolom tambahan pada users -----------------------------------------------
ALTER TABLE users ADD COLUMN wa TEXT;
ALTER TABLE users ADD COLUMN cakupan_toko TEXT;
ALTER TABLE users ADD COLUMN wajib_ganti INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN gagal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN kunci_sampai TEXT;
ALTER TABLE users ADD COLUMN login_terakhir TEXT;
ALTER TABLE users ADD COLUMN sandi_diubah_pada TEXT;

-- 2. Username unik tanpa membedakan besar/kecil, spasi dipangkas --------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci
  ON users (LOWER(TRIM(username)));

-- 3a. Sesi login (cookie httpOnly `ns_sesi`) ---------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perangkat      TEXT,
  ip             TEXT,
  dibuat_pada    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  terakhir_aktif TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  kadaluarsa     TEXT,
  diingat        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 3b. Permintaan lupa password: token acak (hash disimpan), 30 menit, sekali
--     pakai; sekaligus menjadi batas 3x per jam per akun.
CREATE TABLE IF NOT EXISTS password_resets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  kanal         TEXT NOT NULL,
  tujuan        TEXT,
  kedaluwarsa   TEXT NOT NULL,
  dipakai_pada  TEXT,
  dibuat_pada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_user_waktu ON password_resets (user_id, dibuat_pada);

-- 3c. Kode Pemulihan Admin utama (10 kode, sekali pakai) --------------------
CREATE TABLE IF NOT EXISTS recovery_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kode_hash   TEXT NOT NULL,
  dipakai_pada TEXT,
  dibuat_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes (user_id);

-- 3d. Kotak keluar pesan (alur reset mengirim tautan ke email/WhatsApp
--     terdaftar; bila kanal belum tersambung, pesan menunggu di sini agar
--     Admin dapat meneruskannya — lihat Pengaturan ▸ Notifikasi).
CREATE TABLE IF NOT EXISTS pesan_keluar (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis      TEXT NOT NULL,
  tujuan     TEXT NOT NULL,
  isi        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'antre',
  dibuat_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- 4. Peran: cakupan data toko/gudang + tanda peran bawaan ---------------------
ALTER TABLE roles ADD COLUMN cakupan_toko TEXT;
ALTER TABLE roles ADD COLUMN bawaan INTEGER NOT NULL DEFAULT 0;
UPDATE roles SET bawaan = 1
 WHERE lower(nama) IN ('administrator', 'manajer', 'kasir', 'gudang', 'akuntan');

-- 4b. Hak khusus terpisah per peran (Tahap 2): lihat harga beli/HPP,
--     ubah harga jual di kasir, batas diskon %, hapus/batalkan transaksi,
--     Proses Tahunan (hanya Admin — disimpan untuk tampilan, selalu dicek lagi).
CREATE TABLE IF NOT EXISTS role_hak_khusus (
  role_id          INTEGER PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  lihat_hpp        INTEGER NOT NULL DEFAULT 1,
  ubah_harga_kasir INTEGER NOT NULL DEFAULT 1,
  diskon_maks      REAL NOT NULL DEFAULT 100,
  hapus_transaksi  INTEGER NOT NULL DEFAULT 1,
  proses_tahunan   INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO role_hak_khusus (role_id) SELECT id FROM roles WHERE bawaan = 1;

-- 5. Matriks hak akses: bangun ulang role_permissions agar menerima 'cetak'.
--    Nilai 'batal' lama disatukan ke 'sahkan' (kolom "Batalkan/Sahkan").
CREATE TABLE role_permissions_baru (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  menu    TEXT NOT NULL,
  aksi    TEXT NOT NULL
         CHECK (aksi IN ('lihat','tambah','ubah','hapus','cetak','ekspor','impor','sahkan','batal')),
  UNIQUE (role_id, menu, aksi)
);
INSERT INTO role_permissions_baru (id, role_id, menu, aksi)
  SELECT id, role_id, menu, CASE WHEN aksi = 'batal' THEN 'sahkan' ELSE aksi END
    FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_baru RENAME TO role_permissions;
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_menu_aksi ON role_permissions (role_id, menu, aksi);

-- 6. Benih matriks: perilaku peran lama TIDAK berubah.
--    - Administrator : seluruh modul & aksi (Admin selalu lolos guard).
--    - Manajer       : semua modul kecuali Proses Tahunan (khusus Admin).
--    - Akuntan       : semua modul kecuali Proses Tahunan.
--    - Staf Gudang   : semua kecuali Akuntansi & Proses Tahunan.
--    - Kasir         : hanya Penjualan + POS (sebagaimana sidebar lama).
--    Peran baru yang dibuat Admin mulai dari KOSONG (default deny).
INSERT OR IGNORE INTO role_permissions (role_id, menu, aksi)
SELECT r.id, m.menu, a.aksi
  FROM roles r
  JOIN (
    SELECT 'penjualan' AS menu UNION ALL SELECT 'pos' UNION ALL SELECT 'pembelian'
    UNION ALL SELECT 'stok' UNION ALL SELECT 'opname' UNION ALL SELECT 'persediaan-sub'
    UNION ALL SELECT 'dokumen' UNION ALL SELECT 'akuntansi' UNION ALL SELECT 'laporan'
    UNION ALL SELECT 'master' UNION ALL SELECT 'pengaturan' UNION ALL SELECT 'proses-tahunan'
  ) m
  JOIN (
    SELECT 'lihat' AS aksi UNION ALL SELECT 'tambah' UNION ALL SELECT 'ubah'
    UNION ALL SELECT 'hapus' UNION ALL SELECT 'cetak' UNION ALL SELECT 'ekspor'
    UNION ALL SELECT 'impor' UNION ALL SELECT 'sahkan'
  ) a
 WHERE (
   lower(r.nama) = 'administrator'
   OR (lower(r.nama) IN ('manajer', 'akuntan') AND m.menu <> 'proses-tahunan')
   OR (lower(r.nama) = 'gudang' AND m.menu NOT IN ('akuntansi', 'proses-tahunan'))
   OR (lower(r.nama) = 'kasir' AND m.menu IN ('penjualan', 'pos'))
 );
