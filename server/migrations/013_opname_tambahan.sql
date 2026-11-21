-- MODUL STOK OPNAME — pelengkap skema 001 (opname_sessions/items/scans).
--
-- Alur sesi: draft 'hitung' (manual & scan mengisi data yang sama)
--   -> POST /selesai  => tahap 'tinjau' (stempel selesai_hitung_pada)
--   -> POST /sahkan   => status 'disahkan' (PIN supervisor) + penyesuaian stok & jurnal.
-- Status tetap 'draft'|'disahkan'|'batal' sesuai CHECK di 001; tahap membedakan
-- "sedang hitung" vs "menunggu persetujuan" tanpa melanggar CHECK tersebut.

ALTER TABLE opname_sessions ADD COLUMN tahap TEXT NOT NULL DEFAULT 'hitung'
  CHECK (tahap IN ('hitung', 'tinjau'));
ALTER TABLE opname_sessions ADD COLUMN selesai_hitung_pada TEXT;
ALTER TABLE opname_sessions ADD COLUMN disetujui_pada TEXT;
ALTER TABLE opname_sessions ADD COLUMN catatan TEXT;

-- Per baris: "sudah dihitung" = dihitung_manual = 1 ATAU jml_scan > 0.
-- sumber = 'manual' | 'scan' — penanda penulis terakhir; baris yang diisi manual
-- (nilai absolut) tidak dikurangi oleh Undo scan (scan hanya mengurangi baris
-- yang jumlahnya berasal dari scan).
ALTER TABLE opname_items ADD COLUMN dihitung_manual INTEGER NOT NULL DEFAULT 0
  CHECK (dihitung_manual IN (0, 1));
ALTER TABLE opname_items ADD COLUMN jml_scan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opname_items ADD COLUMN sumber TEXT;
ALTER TABLE opname_items ADD COLUMN dihitung_pada TEXT;

-- Akun penampung jurnal penyesuaian persediaan opname:
--   fisik > sistem => Debit 1200 Persediaan / Kredit 5102
--   fisik < sistem => Debit 5102 / Kredit 1200 Persediaan
INSERT INTO accounts (kode, nama, tipe, saldo_normal) VALUES
  ('5102', 'Selisih Opname Persediaan', 'beban', 'debit')
ON CONFLICT (kode) DO NOTHING;
