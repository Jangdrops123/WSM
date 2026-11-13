-- BAGIAN L — IMPOR OPNAME MASSAL VIA EXCEL
-- Arsip file asli yang diunggah menempel pada dokumen opname + log jumlah baris.
ALTER TABLE opname_sessions ADD COLUMN impor_file_nama TEXT;
ALTER TABLE opname_sessions ADD COLUMN impor_file_data BLOB;
ALTER TABLE opname_sessions ADD COLUMN impor_baris INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opname_sessions ADD COLUMN impor_pada TEXT;
