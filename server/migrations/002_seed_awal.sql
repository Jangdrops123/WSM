-- Migrasi awal seed: peran bawaan & pengaturan default
INSERT INTO roles (nama) VALUES
  ('Administrator'),
  ('Kasir'),
  ('Gudang'),
  ('Akuntan');

INSERT INTO settings (kunci, nilai, keterangan) VALUES
  ('stok_minus_izinkan', 'false', 'Izinkan stok menjadi minus jika stok fisik kurang'),
  ('pajak_persen', '0', 'Persentase pajak penjualan (PPN) bawaan'),
  ('mata_uang', 'IDR', 'Mata uang aplikasi (Rupiah)'),
  ('format_tanggal', 'dd/mm/yyyy', 'Format tanggal tampilan aplikasi'),
  ('nama_usaha', 'Toko Retail', 'Nama usaha/cabang pada dokumen dan struk');
