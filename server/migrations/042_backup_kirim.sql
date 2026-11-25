-- 042 — Status pengiriman otomatis berkas cadangan (Telegram/Email).
-- Kolom ini juga ditambahkan otomatis oleh server/lib/sistem.ts pada runtime;
-- versi migrasi ini menjaga skema tetap sinkron.
ALTER TABLE system_backups ADD COLUMN kirim_telegram TEXT;
ALTER TABLE system_backups ADD COLUMN kirim_email TEXT;
ALTER TABLE system_backups ADD COLUMN kirim_galat TEXT;
