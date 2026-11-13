-- BAGIAN X2 — Tata letak Dashboard yang bisa diatur admin/pengguna:
-- susunan, ukuran, dan isi tiap kartu (widget) tersimpan sebagai JSON array.
-- Resolusi: layout pengguna > layout bawaan per peran > preset bawaan klien.
CREATE TABLE IF NOT EXISTS dashboard_layout (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json        TEXT    NOT NULL,
  diubah_pada TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- Bawaan per peran (Admin menetapkan lewat "Jadikan default untuk peran").
CREATE TABLE IF NOT EXISTS dashboard_layout_peran (
  peran       TEXT    PRIMARY KEY,
  json        TEXT    NOT NULL,
  diubah_pada TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
