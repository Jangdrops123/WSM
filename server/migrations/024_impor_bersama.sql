-- 024 — Mesin impor bersama (BAGIAN AB):
--   * import_errors.nilai  → kolom "Nilai" pada tabel detail error (No Baris | Kolom | Nilai | Alasan).
--   * import_batches.undo_data → jejak per baris (tambah/perbarui + baris sebelum) untuk tombol
--     "Urungkan impor"; diurungkan menandai batch sudah dibatalkan (tidak bisa diurungkan dua kali).

ALTER TABLE import_errors ADD COLUMN nilai TEXT;

ALTER TABLE import_batches ADD COLUMN undo_data TEXT;
ALTER TABLE import_batches ADD COLUMN diurungkan INTEGER NOT NULL DEFAULT 0;
