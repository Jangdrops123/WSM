-- 014: BAGIAN K — pengaturan kolom tabel faktur per template.
--
--  pengaturan_kolom : JSON per kolom { nama?, lebar?, satuan_lebar?, rata? }
--    - nama        : label kolom hasil ganti (bila kosong → LABEL_KOLOM)
--    - lebar       : null = otomatis (rasio K2); angka = lebar tetap
--    - satuan_lebar: '%' | 'mm'
--    - rata        : 'kiri' | 'tengah' | 'kanan' (bila kosong → otomatis per jenis kolom)
--  singkat_kolom   : 'auto' (kertas sempit → singkatan) | 'ya' | 'tidak'
ALTER TABLE invoice_templates ADD COLUMN pengaturan_kolom TEXT NOT NULL DEFAULT '{}';
ALTER TABLE invoice_templates ADD COLUMN singkat_kolom TEXT NOT NULL DEFAULT 'auto';
