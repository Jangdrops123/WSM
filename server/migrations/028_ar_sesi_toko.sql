-- AR7/AR8 — ingat toko/gudang pilihan per sesi + terakhir dipakai pengguna.
ALTER TABLE sessions ADD COLUMN toko_kode TEXT;
ALTER TABLE users ADD COLUMN toko_terakhir TEXT;
