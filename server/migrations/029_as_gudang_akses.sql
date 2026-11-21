-- ============================================================================
-- AS — Akses pengguna berbasis GUDANG (warehouses.kode, mis. GD-1)
--
-- Latar: cakupan_toko menyimpan kode TOKO (stores.kode), padahal di banyak
-- instalasi tabel stores kosong — gudang hidup di Master Data > Gudang &
-- Lokasi (warehouses). Akibatnya form pengguna tidak menampilkan gudang.
-- Mulai migrasi ini unit akses = KODE GUDANG dari Master Data.
--
-- 1) warehouses.aktif (nonaktif = terkunci di form, akses dilepas).
-- 2) Petakan ulang isi cakupan_toko (users + roles): kode toko → kode gudang
--    lewat stores.warehouse_id; kode yang sudah berupa kode gudang dipertahankan;
--    kode yang tidak dikenal di kedua tabel dibuang (akses dilepas, AS3).
-- ============================================================================

ALTER TABLE warehouses ADD COLUMN aktif INTEGER NOT NULL DEFAULT 1;

-- Bersihkan duplikat akibat pemetaan (satu gudang dari beberapa toko): bangun
-- ulang array JSON per baris memakai pemetaan toko→gudang.
UPDATE users SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE json_group_array(nilai) END
  FROM (
    SELECT DISTINCT COALESCE(w.kode, j.value) AS nilai
    FROM json_each(users.cakupan_toko) j
    LEFT JOIN stores s ON s.kode = j.value
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
  )
) WHERE cakupan_toko IS NOT NULL;

UPDATE roles SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE json_group_array(nilai) END
  FROM (
    SELECT DISTINCT COALESCE(w.kode, j.value) AS nilai
    FROM json_each(roles.cakupan_toko) j
    LEFT JOIN stores s ON s.kode = j.value
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
  )
) WHERE cakupan_toko IS NOT NULL;

-- Buang kode yang tidak ada di Master gudang (AS3: akses ke gudang yang sudah
-- tidak ada dilepas otomatis). Baris yang hasilnya kosong → '[]' (TANPA akses,
-- bukan NULL/semua — NULL akan menaikkan hak secara diam-diam).
UPDATE users SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN '[]' ELSE json_group_array(j.value) END
  FROM json_each(users.cakupan_toko) j
  JOIN warehouses w ON w.kode = j.value
) WHERE cakupan_toko IS NOT NULL;

UPDATE roles SET cakupan_toko = (
  SELECT CASE WHEN COUNT(*) = 0 THEN '[]' ELSE json_group_array(j.value) END
  FROM json_each(roles.cakupan_toko) j
  JOIN warehouses w ON w.kode = j.value
) WHERE cakupan_toko IS NOT NULL;

-- Tandai pengguna yang cakupannya berubah total menjadi kosong agar Owner
-- meninjau ulang (AS3): mereka yang sebelumnya membatasi kini tanpa batas
-- tidak ditandai — hanya yang cakupannya berisi kode tak dikenal.
-- (Kasus ini jarang; penanda umum sudah ada dari AR10.)
