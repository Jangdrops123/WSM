-- BAGIAN AG0 — MIGRASI ATURAN CHATBOT LAMA → PROFIL SIZE "PRIA".
--
-- Mode Chatbot lama menyimpan aturan kodi di settings.aturan_kodi
-- ({"per_kodi":20,"normal":{"39":4,…,"43":4}}). Setelah mode lama dihapus,
-- aturan itu dipindah otomatis ke sebuah Profil Size:
--   * bila sudah ada profil dengan jumlah pasang + daftar size + jatah yang
--     sama persis (bawaan "Sepatu Pria" memang begitu) → dipakai apa adanya;
--   * bila aturan lama pernah dikustomisasi → dibuat profil baru bernama "Pria".
-- Kunci aturan_kodi lalu dihapus supaya tidak ada jejak mode lama.
--
-- Alias/penyamaan lama: tidak ada tabel alias pada mode lama (dicek saat AG0),
-- sehingga tidak ada data yang dipindah ke AliasBarang (AG3).

CREATE TABLE IF NOT EXISTS _m025_lama (per_kodi INTEGER, size TEXT, jatah INTEGER);

INSERT INTO _m025_lama (per_kodi, size, jatah)
SELECT CAST(json_extract(s.nilai, '$.per_kodi') AS INTEGER),
       CAST(je.key AS TEXT),
       CAST(je.value AS INTEGER)
  FROM settings s, json_each(s.nilai, '$.normal') je
 WHERE s.kunci = 'aturan_kodi';

-- Profil "Pria" hanya dibuat bila aturan lama ada DAN belum ada profil kembar.
INSERT INTO size_profiles (kode, nama, pasang_per_kodi, kata_kunci, bawaan)
SELECT 'pria', 'Pria',
       (SELECT MIN(per_kodi) FROM _m025_lama),
       '["pria","cowok","cwo","men"]', 0
  WHERE EXISTS (SELECT 1 FROM _m025_lama)
    AND NOT EXISTS (
      SELECT 1 FROM size_profiles sp
       WHERE sp.pasang_per_kodi = (SELECT MIN(per_kodi) FROM _m025_lama)
         AND (SELECT COUNT(*) FROM size_profile_sizes s WHERE s.profile_id = sp.id)
             = (SELECT COUNT(*) FROM _m025_lama)
         AND NOT EXISTS (
               SELECT 1 FROM _m025_lama l
                WHERE NOT EXISTS (
                        SELECT 1 FROM size_profile_sizes s
                         WHERE s.profile_id = sp.id AND s.size = l.size AND s.jatah = l.jatah
                      )
             )
    );

INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan)
SELECT sp.id, l.size, l.jatah,
       ROW_NUMBER() OVER (ORDER BY CAST(l.size AS INTEGER), l.size) - 1
  FROM _m025_lama l
  JOIN size_profiles sp ON sp.kode = 'pria'
 WHERE NOT EXISTS (SELECT 1 FROM size_profile_sizes s WHERE s.profile_id = sp.id);

-- Profil default lama yang sudah tidak ada (atau kosong) → profil "Pria".
UPDATE settings
   SET nilai = 'pria'
 WHERE kunci = 'size_profile_default'
   AND (nilai = '' OR nilai NOT IN (SELECT kode FROM size_profiles))
   AND EXISTS (SELECT 1 FROM size_profiles WHERE kode = 'pria');

-- Hapus aturan chatbot lama (mode lama sudah tidak ada).
DELETE FROM settings WHERE kunci = 'aturan_kodi';

DROP TABLE IF EXISTS _m025_lama;
