-- ============================================================================
-- 032 — Perbaiki sisa cakupan tersimpan sebagai NAMA → KODE gudang kanonis.
--
-- Latar: sebelum 029/AS1, sebagian instalasi menyimpan NAMA gudang/toko
-- (mis. "Tempuny Group") di users.cakupan_toko / roles.cakupan_toko dan di
-- kolom toko_bawaan / toko_terakhir. Normalisasi waktu-baca sudah menutupi
-- di aplikasi, tetapi data mentah tetap basi: sulit diaudit dan rapuh bila
-- gudang diganti nama. Migrasi ini memetakan permanen ke warehouses.kode.
--
-- Aturan per entri: kode gudang (tak peduli huruf) → kode itu; nama gudang →
-- kodenya; kode/nama toko → kode gudang toko itu; tak dikenal → dibuang.
-- Array yang hasilnya kosong → '[]' (tanpa akses, bukan tanpa batas).
-- Kolom skalar yang sudah berupa kode gudang tidak disentuh.
-- ============================================================================

-- users.cakupan_toko: nama → kode (unik).
UPDATE users SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN '[]' ELSE json_group_array(kode) END
  FROM (
    SELECT DISTINCT COALESCE(
      (SELECT w.kode FROM warehouses w WHERE lower(w.kode) = lower(j.value) LIMIT 1),
      (SELECT w.kode FROM warehouses w WHERE lower(w.nama) = lower(j.value) LIMIT 1),
      (SELECT w.kode FROM stores s JOIN warehouses w ON w.id = s.warehouse_id
        WHERE lower(s.kode) = lower(j.value) OR lower(s.nama) = lower(j.value) LIMIT 1)
    ) AS kode
    FROM json_each(users.cakupan_toko) j
  )
  WHERE kode IS NOT NULL
) WHERE cakupan_toko IS NOT NULL AND json_valid(cakupan_toko);

-- roles.cakupan_toko: aturan yang sama.
UPDATE roles SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN '[]' ELSE json_group_array(kode) END
  FROM (
    SELECT DISTINCT COALESCE(
      (SELECT w.kode FROM warehouses w WHERE lower(w.kode) = lower(j.value) LIMIT 1),
      (SELECT w.kode FROM warehouses w WHERE lower(w.nama) = lower(j.value) LIMIT 1),
      (SELECT w.kode FROM stores s JOIN warehouses w ON w.id = s.warehouse_id
        WHERE lower(s.kode) = lower(j.value) OR lower(s.nama) = lower(j.value) LIMIT 1)
    ) AS kode
    FROM json_each(roles.cakupan_toko) j
  )
  WHERE kode IS NOT NULL
) WHERE cakupan_toko IS NOT NULL AND json_valid(cakupan_toko);

-- users.toko_bawaan / toko_terakhir: nama → kode (hanya bila bukan kode).
UPDATE users SET toko_bawaan = COALESCE(
  (SELECT w.kode FROM warehouses w WHERE lower(w.nama) = lower(toko_bawaan) LIMIT 1),
  (SELECT w.kode FROM stores s JOIN warehouses w ON w.id = s.warehouse_id
    WHERE lower(s.kode) = lower(toko_bawaan) OR lower(s.nama) = lower(toko_bawaan) LIMIT 1),
  toko_bawaan
) WHERE toko_bawaan IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE lower(w.kode) = lower(toko_bawaan));

UPDATE users SET toko_terakhir = COALESCE(
  (SELECT w.kode FROM warehouses w WHERE lower(w.nama) = lower(toko_terakhir) LIMIT 1),
  (SELECT w.kode FROM stores s JOIN warehouses w ON w.id = s.warehouse_id
    WHERE lower(s.kode) = lower(toko_terakhir) OR lower(s.nama) = lower(toko_terakhir) LIMIT 1),
  toko_terakhir
) WHERE toko_terakhir IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE lower(w.kode) = lower(toko_terakhir));
