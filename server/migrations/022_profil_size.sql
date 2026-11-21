-- BAGIAN X5 — PROFIL SIZE untuk aturan kodi chatbot (fleksibel, bukan tetap39-43).
-- Satu profil = nama + daftar size + jatah pasang per size + total pasang per kodi
-- + kata kunci untuk resolusi otomatis dari baris chat. Profil ditetapkan ke
-- produk / kategori / merek; resolusi: produk > kategori/merek > kata kunci >
-- profil default (settings size_profile_default).
CREATE TABLE IF NOT EXISTS size_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT    NOT NULL UNIQUE,
  nama            TEXT    NOT NULL,
  pasang_per_kodi INTEGER NOT NULL DEFAULT 20 CHECK (pasang_per_kodi > 0),
  kata_kunci      TEXT    NOT NULL DEFAULT '[]',
  bawaan          INTEGER NOT NULL DEFAULT 0,
  dibuat_pada     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  diubah_pada     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TABLE IF NOT EXISTS size_profile_sizes (
  profile_id INTEGER NOT NULL REFERENCES size_profiles(id) ON DELETE CASCADE,
  size       TEXT    NOT NULL,
  jatah      INTEGER NOT NULL DEFAULT 0 CHECK (jatah >= 0),
  urutan     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, size)
);

-- Penetapan profil ke master data (opsional — bila kosong pakai kata kunci/default).
ALTER TABLE products  ADD COLUMN size_profile_id INTEGER REFERENCES size_profiles(id);
ALTER TABLE categories ADD COLUMN size_profile_id INTEGER REFERENCES size_profiles(id);
ALTER TABLE brands     ADD COLUMN size_profile_id INTEGER REFERENCES size_profiles(id);

CREATE INDEX IF NOT EXISTS idx_sps_profile ON size_profile_sizes(profile_id);

-- ===== Profil bawaan (bisa diedit, diduplikat, dihapus) =====================

INSERT INTO size_profiles (kode, nama, pasang_per_kodi, kata_kunci, bawaan) VALUES
  ('sepatu-pria',   'Sepatu Pria',   20, '["cwo","cowok","pria","pri","men"]', 1),
  ('sepatu-wanita', 'Sepatu Wanita', 20, '["cwe","cewek","wanita","wnt","women"]', 1),
  ('sandal-pria',   'Sandal Pria',   20, '["sandal pria","sandal pri","sandal men"]', 1),
  ('sandal-wanita', 'Sandal Wanita', 20, '["sandal wanita","sandal wnt","sandal women"]', 1),
  ('anak',          'Anak',          20, '["anak","kids","kid"]', 1),
  ('kustom',        'Kustom',         4, '[]', 1);

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT '39' size, 4 jatah, 0 urutan UNION ALL SELECT '40',4,1 UNION ALL SELECT '41',4,2
        UNION ALL SELECT '42',4,3 UNION ALL SELECT '43',4,4) s
  WHERE p.kode = 'sepatu-pria';

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT '37' size, 5 jatah, 0 urutan UNION ALL SELECT '38',5,1 UNION ALL SELECT '39',5,2
        UNION ALL SELECT '40',5,3) s
  WHERE p.kode = 'sepatu-wanita';

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT '39' size, 4 jatah, 0 urutan UNION ALL SELECT '40',4,1 UNION ALL SELECT '41',4,2
        UNION ALL SELECT '42',4,3 UNION ALL SELECT '43',4,4) s
  WHERE p.kode = 'sandal-pria';

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT '37' size, 5 jatah, 0 urutan UNION ALL SELECT '38',5,1 UNION ALL SELECT '39',5,2
        UNION ALL SELECT '40',5,3) s
  WHERE p.kode = 'sandal-wanita';

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT '1' size, 4 jatah, 0 urutan UNION ALL SELECT '2',4,1 UNION ALL SELECT '3',4,2
        UNION ALL SELECT '4',4,3 UNION ALL SELECT '5',4,4) s
  WHERE p.kode = 'anak';

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
  SELECT p.id, s.size, s.jatah, s.urutan FROM size_profiles p
  JOIN (SELECT 'S' size, 1 jatah, 0 urutan UNION ALL SELECT 'M',1,1 UNION ALL SELECT 'L',1,2
        UNION ALL SELECT 'XL',1,3) s
  WHERE p.kode = 'kustom';

-- Profil default dipakai bila produk/kategori/merek tidak menetapkan profil dan
-- baris chat tidak mengandung kata kunci apa pun.
INSERT OR IGNORE INTO settings (kunci, nilai, keterangan) VALUES
  ('size_profile_default', 'sepatu-pria', 'Profil size default untuk chatbot (kode profil)');
