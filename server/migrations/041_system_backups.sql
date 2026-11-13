-- 041 — Riwayat backup database (SQLite/dev).
-- Tabel ini juga dibuat otomatis oleh server/lib/sistem.ts pada runtime
-- PostgreSQL; versi SQLite ini menjaga skema migrasi tetap sinkron.
CREATE TABLE IF NOT EXISTS system_backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama        TEXT NOT NULL UNIQUE,
  ukuran      INTEGER NOT NULL DEFAULT 0,
  tipe        TEXT NOT NULL DEFAULT 'manual',
  status      TEXT NOT NULL DEFAULT 'sukses',
  galat       TEXT,
  dibuat_oleh INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dibuat_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_system_backups_waktu ON system_backups(dibuat_pada DESC);
CREATE INDEX IF NOT EXISTS idx_system_backups_status ON system_backups(status, dibuat_pada DESC);
