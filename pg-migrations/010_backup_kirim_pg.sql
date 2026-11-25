-- 010 — Status pengiriman otomatis berkas cadangan (Telegram/Email).
-- Kolom ini juga ditambahkan otomatis oleh server/lib/sistem.ts pada runtime;
-- migrasi ini untuk instalasi baru/audit.
ALTER TABLE system_backups ADD COLUMN IF NOT EXISTS kirim_telegram TEXT;
ALTER TABLE system_backups ADD COLUMN IF NOT EXISTS kirim_email TEXT;
ALTER TABLE system_backups ADD COLUMN IF NOT EXISTS kirim_galat TEXT;
