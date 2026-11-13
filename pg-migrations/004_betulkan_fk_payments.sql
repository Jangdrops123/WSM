-- 004 — Betulkan FK payments.akun_kas_id.
--
-- Skema SQLite asal mendeklarasikan `akun_kas_id ... REFERENCES accounts(id)`
-- (tabel COA), tetapi SQLite tidak menegakkan FK sehingga aplikasi berjalan
-- normal: seluruh tulis memakai id rekening kas (cash_accounts). Di PostgreSQL
-- FK ditegakkan sehingga constraint yang salah sasaran ini menolak SEMUA
-- pembayaran piutang/hutang. Arahkan ke tabel yang benar (cash_accounts).
-- Logika/aturan aplikasi TIDAK berubah.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_akun_kas_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_akun_kas_id_fkey FOREIGN KEY (akun_kas_id) REFERENCES cash_accounts (id);
