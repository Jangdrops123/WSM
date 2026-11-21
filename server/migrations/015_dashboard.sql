-- Dashboard (fitur "Atur tampilan" + Pengingat faktur):
-- 1) Pilihan tampil kartu per pengguna — user_id mengikuti users.id.
--    Modul login menyusul: permintaan saat ini dianggap berasal dari
--    Administrator (pengguna bawaan migrasi 008), jadi baris akan menempel
--    pada user tersebut sampai ada sesi login sungguhan.
CREATE TABLE IF NOT EXISTS pengaturan_dashboard (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kartu_id    TEXT    NOT NULL,
  tampil      INTEGER NOT NULL DEFAULT 1 CHECK (tampil IN (0, 1)),
  diubah_pada TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (user_id, kartu_id)
);

-- 1b) Tampilan bawaan per peran (ditetapkan Admin) — dipakai saat pengguna
--     belum mengatur tampilannya sendiri. Peran dikirim klien (peranAktif()).
CREATE TABLE IF NOT EXISTS pengaturan_dashboard_peran (
  peran      TEXT    NOT NULL,
  kartu_id   TEXT    NOT NULL,
  tampil     INTEGER NOT NULL DEFAULT 1 CHECK (tampil IN (0, 1)),
  diubah_pada TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (peran, kartu_id)
);

-- 2) Pengaturan pengingat faktur (nilainya di settings):
--    pengingat_hari_sebelum      : 1 | 3 | 7 hari sebelum jatuh tempo
--    pengingat_terlambat_harian  : true = terus diingatkan tiap hari setelah
--                                  jatuh tempo lewat
INSERT OR IGNORE INTO settings (kunci, nilai, keterangan) VALUES
  ('pengingat_hari_sebelum', '3', 'Pengingat faktur: hari sebelum jatuh tempo (1/3/7)'),
  ('pengingat_terlambat_harian', 'true', 'Pengingat faktur: ingatkan setiap hari setelah terlambat');
