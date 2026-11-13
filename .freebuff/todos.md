- [x] H1: parser chatbot satu-baris-per-barang (kodi, db/tp, tanggal, total verifikasi)
- [x] H2: UI chatbot multi-baris + pratinjau tabel + saran & buat produk baru
- [x] I1-I3: faktur otomatis + editor template + ukuran kertas fleksibel
- [x] I4: ikon aksi faktur (WhatsApp/Unduh/Cetak) + tooltip di daftar, detail, dialog sukses
- [x] Verifikasi akhir: typecheck/build, uji integrasi, browser end-to-end
      - typecheck exit 0, build exit 0
      - 14 suite integrasi lulus (0 gagal), uji-reset-data 70/0 di server terisolasi :3017
      - smoke browser: login → chatbot Pembelian (urai + pratinjau per size + verifikasi
        Total = 15 kd ✔), Dashboard, Master Produk — API 200, tanpa error console
