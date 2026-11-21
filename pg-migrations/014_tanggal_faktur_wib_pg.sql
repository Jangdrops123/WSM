-- 014 — Perbaikan tanggal faktur yang mundur 7 jam (H-1).
--
-- Penyebab: adapter DB mengembalikan TIMESTAMPTZ sebagai string UTC tanpa
-- penanda zona ("YYYY-MM-DD HH:MM:SS.sss"). Saat string itu disalin ke kolom
-- invoices.tanggal (timestamptz) dengan zona sesi Asia/Jakarta, PostgreSQL
-- membacanya sebagai WIB — 7 jam lebih awal. Transaksi 02:13 WIB (21/11)
-- tersimpan sebagai 20/11 19:13 WIB sehingga faktur tercetak 20 November.
--
-- Perbaikan kode ada di server/lib/faktur.ts (waktuAbsolut). Migrasi ini
-- menyamakan tanggal faktur LAMA dengan waktu transaksi sumbernya, khusus
-- baris yang memang persis bergeser 7 jam. Idempoten: dijalankan ulang tidak
-- mengubah apa pun.

UPDATE invoices i
   SET tanggal = s.tanggal
  FROM sales s
 WHERE i.sumber_tipe = 'penjualan'
   AND i.sumber_id = s.id
   AND i.tanggal = s.tanggal - INTERVAL '7 hours';

UPDATE invoices i
   SET tanggal = p.tanggal
  FROM purchases p
 WHERE i.sumber_tipe = 'pembelian'
   AND i.sumber_id = p.id
   AND i.tanggal = p.tanggal - INTERVAL '7 hours';
