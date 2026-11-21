-- Riwayat chat per dokumen pembelian (metode Chatbot).
--
-- 1) Bangun ulang purchase_chat_logs (CHECK/NOT NULL tidak bisa di-ALTER):
--    - purchase_id menjadi NULL-able: pengguna mengetik SEBELUM dokumen draft
--      dibuat (draft baru dibuat saat konfirmasi) sehingga pesan awal menunggu
--      dengan chat_sesi dulu, lalu 'diklaim' ke dokumen saat konfirmasi.
--    - chat_sesi: pengikat pesan pra-dokumen -> dokumen.
--    - pesan_bot: ringkasan balasan parser agar riwayat utuh saat dibuka lagi.
--    Anak lain tidak menyentuh tabel ini (FK ON DELETE CASCADE tetap).
--    Salinan dibuat dulu karena DROP TABLE orang tua / hapus-implisit bisa
--    menghapus baris yang ada.

CREATE TABLE _m011_cl AS SELECT * FROM purchase_chat_logs;
DELETE FROM purchase_chat_logs;
DROP TABLE purchase_chat_logs;

CREATE TABLE purchase_chat_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id       INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
  chat_sesi         TEXT,
  pesan_user        TEXT NOT NULL,
  pesan_bot         TEXT,
  hasil_parse_json  TEXT,
  waktu             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- Pesan lama (bila ada) dipertahankan: purchase_id lama NOT NULL sehingga selalu terisi.
INSERT INTO purchase_chat_logs (id, purchase_id, pesan_user, hasil_parse_json, waktu)
SELECT id, purchase_id, pesan_user, hasil_parse_json, waktu FROM _m011_cl;
DROP TABLE _m011_cl;

CREATE INDEX idx_chat_logs_purchase ON purchase_chat_logs(purchase_id);
CREATE INDEX idx_chat_logs_sesi     ON purchase_chat_logs(chat_sesi);
