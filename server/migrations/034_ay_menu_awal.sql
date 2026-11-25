-- ============================================================================
-- 034 — AY: Menu awal setelah login per peran (atribut roles.menu_awal).
--
-- Ini ATRIBUT peran, bukan izin: tidak ada matriks/baris/kolom/kode izin baru.
-- Nilai = kode halaman stabil (dashboard, pos-tanpa-foto, stok-saat-ini,
-- pembelian-input, ...). NULL = fallback (halaman pertama yang boleh dilihat).
--
-- 1) Gabungkan pengaturan lama (tab "Halaman Awal & Peran"):
--    settings 'peng.halaman-awal' {namaPeran: dashboard|pos|penjualan}
--    disalin ke peran terkait, lalu data lama dihapus (satu sumber).
-- 2) Nilai awal AY3 hanya untuk peran yang belum memiliki isian.
-- ============================================================================

ALTER TABLE roles ADD COLUMN menu_awal TEXT;

-- 1) Migrasi pengaturan lama → kolom peran (hanya bila masih kosong).
UPDATE roles SET menu_awal = (
  SELECT CASE lower(j.value)
    WHEN 'dashboard' THEN 'dashboard'
    WHEN 'pos' THEN 'pos-tanpa-foto'
    WHEN 'penjualan' THEN 'penjualan-riwayat'
    ELSE NULL END
  FROM settings s, json_each(s.nilai) j
  WHERE s.kunci = 'peng.halaman-awal'
    AND json_valid(s.nilai)
    AND lower(j.key) = lower(roles.nama)
) WHERE menu_awal IS NULL
  AND EXISTS (
    SELECT 1 FROM settings
    WHERE kunci = 'peng.halaman-awal' AND json_valid(nilai)
  );

-- 2) Nilai awal AY3 — hanya peran yang masih kosong (tidak menimpa).
UPDATE roles SET menu_awal = 'dashboard'
WHERE menu_awal IS NULL AND lower(nama) IN ('administrator', 'owner', 'supervisor');
UPDATE roles SET menu_awal = 'pos-tanpa-foto'
WHERE menu_awal IS NULL AND lower(nama) = 'kasir';
UPDATE roles SET menu_awal = 'stok-saat-ini'
WHERE menu_awal IS NULL AND lower(nama) IN ('gudang', 'staf gudang');
UPDATE roles SET menu_awal = 'pembelian-input'
WHERE menu_awal IS NULL AND lower(nama) = 'operator';

-- 3) Hapus data lama — kolom peran adalah satu-satunya sumber.
DELETE FROM settings WHERE kunci = 'peng.halaman-awal';
