# LAPORAN AV5 — TAHAP 1 (UJI DAN LAPOR, TANPA UBAH KODE APLIKASI)

- Tanggal: 2026-10-30 (sesi uji)
- DB uji: `data/uji-av.db` (API :3029) dan `data/uji-reset.db` (API :3017, khusus reset/pulih)
- Data nyata: `data/app.db` TIDAK tersentuh (mtime tetap 2026-10-29; tidak ada skrip tahap 1 yang menulis ke sana)
- Kode aplikasi (`server/`, `src/`) TIDAK diubah pada tahap 1. Yang diubah hanya skrip uji
  (`scripts/uji-av1-ketat.mjs`, fungsi bersih) dan data builder/fixture di DB uji
- Log mentah: `.freebuff/uji-av1/*.log`

## Ringkasan per modul (otomatis)

| Modul | Suite | Lulus | Gagal | Status |
|---|---|---|---|---|
| O/P Keamanan & konkurensi (injeksi, XSS, balapan stok, klik ganda) | uji-av1-ketat | 9 | 0 | LULUS |
| A-04 Isolasi gudang + A-05 matriks + Q1–Q2 angka | uji-av1-isonasi | 25 | 0 | LULUS |
| M Backup/Reset | uji-reset-data-av1 | 69 | 1 | 1 temuan (FIND-01) |
| M Pulihkan | uji-pulih-av1 | 9 | 0 | LULUS |
| D Produk (CRUD, kode_item, impor 2 tahap, foto, audit) | uji-produk-av1 | 30 | 2 | 1 temuan (FIND-04) |
| F Stok (saldo, masuk/keluar, transfer, opname dasar) | uji-stok-av1 | 42 | 0 | LULUS |
| G Pembelian (biasa, PO→GRN→Faktur, retur) | uji-pembelian-av1 | 70 | 0 | LULUS |
| G-03 Chatbot (parser, profil size, alias, koreksi) | uji-chat-av1 | 58 | 0 | LULUS |
| G-02 Scan barcode | uji-scan-av1 | 24 | 0 | LULUS |
| D Master generik (kategori, satuan, dsb.) | uji-master-av1 | 29 | 0 | LULUS (dengan catatan FIND-03) |
| E Impor Excel produk | uji-impor-av1 | 6 | 0 | LULUS |
| D Aksi massal + undo + ekspor | uji-massal-av1 | 25 | 0 | LULUS |
| H POS (shift, tahan, jual atomik, void/retur, struk) | uji-pos-av1 | 47 | 0 | LULUS |
| J Akuntansi (jurnal otomatis, HPP, buku besar, neraca) | uji-akuntansi-av1 | 74 | 0 | LULUS |
| Dashboard + widget | uji-dashboard-av1 | 38 | 0 | LULUS (rerun setelah FIND-03) |
| D/G Profil size (Db/Tp, AF1–AF7) | uji-profil-size-av1 | 44 | 4 | 1 temuan (FIND-02) |
| A-05/A-06 Hak akses peran | uji-akses | 29 | 78 | Diblokir skrip usang (FIND-05) |
| L Pengaturan + A-01 kunci akun | uji-pengaturan | 64 | 22 | Diblokir skrip usang (FIND-05) |
| L Identitas aplikasi | uji-identitas | 36 | 1 | 1 temuan P3 (FIND-06) |
| Toko | uji-toko | 16 | 0 | LULUS |
| Kontras tema | uji-kontras | 76 | 0 | LULUS |
| Seed 24 produk (data skala P) | uji-tambah-banyak | — | — | OK (tanpa asersi) |

Total otomatis: ±810 lulus, ±108 gagal — 100 dari 108 gagal berasal dari 2 skrip usang
(uji-akses, uji-pengaturan) yang mengasumsikan model peran lama; 4 dari aturan chatbot;
2 dari ekspektasi template usang; 1 versi identitas; 1 simulasi peran tanpa peran.

## Temuan tahap 1

### FIND-01 — P2 — Validasi nama peran tak dikenal diam-diam (endpoint izin tab)
- ID/Skenario: M-01 guard — `PUT /pengaturan/pengguna/akses/penomoran {peran:['Manajer']}` → 200
  `"Izin tab diperbarui untuk 0 peran."`
- Hasil sebenarnya: 200 walau tidak ada peran yang diubah (nama peran tidak ada di DB).
- Harapan: 400/404 "peran tidak dikenal" agar salah ketik/role drift ketahuan.
- Bukti: `.freebuff/uji-av1/uji-reset-data-av1.log` (baris `ringkasan ditolak untuk Manajer`)
  + reproduksi `GET /sistem/reset/ringkasan` x-peran manajer → 200.
- Analisis akar: BUKAN bug otorisasi — sesi pemilik tetap admin sehingga 200 benar;
  override `x-peran` gagal diam-diam karena peran `Manajer` tidak ada di DB uji
  (migrasi `031_peran_template.sql` menghapus peran legacy tak terpakai).
  Masalah sebenarnya hanya pada pesan 200-untuk-0-peran di atas.
- Keparahan: P2 (konfigurasi bisa tampak berhasil padahal tidak ada yang berubah).
- Saran tahap 2: kembalikan 400 bila daftar peran hasil kosong/tak dikenal; tambah 1 uji penjaga.

### FIND-02 — P1 — Aturan Db/Tp profil Wanita menyimpang dari spek G-03 (AF7.2, AF5)
- Skenario: `amara hitam 1 kd db 37 tp 40` → spek AV4 G-03: `37:10, 38:5, 39:5, 40:0`,
  total 20, status hijau.
- Hasil sebenarnya: `37:10, 38:5, 39:5, 40:5` (total 25, sisa 25, tidak hijau).
- Skenario AF5: `zamora mocca 6 kd (2kd db 44 tp 40)` → pesan harapan
  `Tp 40 menyisakan 16 pasang per kodi` + aksi seimbangkan; hasil: saran
  "Buat produk otomatis …" untuk size 39–43.
- Bukti: `.freebuff/uji-av1/uji-profil-size-av1.ts.log` (4 baris ✘).
- Langkah mengulang: `DB_FILE=data/uji-av.db BASE=http://127.0.0.1:3029 UJI_SANDI=UjiAv1234
  npx tsx scripts/uji-profil-size-av1.ts`.
- Dugaan penyebab: semantik operator Db/Tp pada profil komposit di `server/lib/urai.ts`.
- Saran tahap 2: selaraskan implementasi ke spek G-03 (atau koreksi spek bila perilaku
  baru disengaja), kunci dengan 4 asersi yang gagal ini.

### FIND-03 — P2 (proses/uji) — Cleanup `uji-master-av1.mjs` terlalu luas
- `DELETE FROM products WHERE nama LIKE 'UJI%'` menghapus fixture suite lain
  (menyebabkan kegagalan semu dashboard `Tidak ada produk uji` pada run pertama).
- Bukti: audit `hapus` + log dashboard run-1 vs run-2 (38/38 setelah seed ulang).
- Saran tahap 2: persempit ke prefix milik suite (`UF-…`/pola existing) dan jadikan
  aturan: cleanup skrip HANYA boleh menyentuh prefix fiksurnya sendiri.

### FIND-04 — P2 (drift skrip) — Ekspektasi template/ekspor produk kedaluwarsa
- Server (sengaja, untuk round-trip E-06): header template = KOLOM + `gudang,stok_awal,stok`,
  kolom `profil_size` ikut (lihat `server/routes/master/produk.ts:111-112`).
  Skrip `uji-produk-av1.ts` masih mengharapkan 13 kolom tanpa keduanya → 2 ✘.
- Komentar `src/pages/master/kolomProduk.ts` ("stok … tidak ikut template impor")
  sudah tidak sesuai perilaku server — perlu diselaraskan (dok, bukan perilaku).
- Saran tahap 2: mutakhirkan skrip (bukan kode aplikasi), kecuali diputuskan
  `stok` tidak boleh di template — itu keputusan produk.

### FIND-05 — Diblokir (drift skrip) — `uji-akses.ts` & `uji-pengaturan.ts` pakai model peran lama
- Skrip mengasumsikan peran `Manajer`/`Akuntan` (dihapus migrasi 031 bila tak terpakai)
  dan membuat pengguna tanpa `cakupan_toko` (ditolak aturan AS2 "Pilih minimal satu gudang").
- Akibat: 78 + 22 gagal, SEMUANYA kaskade dari 2 akar di atas — bukan bug aplikasi.
  Bagian yang mencakup peran existing (Administrator/Kasir/Gudang/peran kustom
  default-deny, anti-eskalasi, halaman awal) LULUS 29 + 64.
- Bukti: `.freebuff/uji-av1/uji-akses.ts.log`, `uji-pengaturan.ts.log`;
  probe `POST /api/pengguna/` tanpa cakupan → 400 "Pilih minimal satu gudang."
- Saran tahap 2: tulis ulang skrip ke model peran saat ini
  (Administrator/Owner/Operator/Supervisor/Viewer/Kasir/Gudang + peran kustom),
  selalu kirim `cakupan_toko`, dan buat peran Manajer/Akuntan HANYA bila AV1
  menghendakinya sebagai peran seed bernama itu.

### FIND-06 — P3 — Versi identitas 1→1 pada penulisan pertama
- `app_identitas_versi` default tampil `1`; penulisan pertama menghitung `0+1=1`
  sehingga asersi "versi naik" gagal semu. Penulisan berikutnya normal (7→8 terverifikasi).
- Saran: inisialisasi kunci versi `0`, atau skrip menoleransi kasus awal.

### FIND-07 — Catatan operasional (bukan bug)
- Setelah uji M-02 (ganti kata sandi), kredensial uji berubah; seluruh skrip memakai
  `UJI_SANDI`. Sandi DB uji saat ini: `UjiAv1234` (HANYA untuk DB uji, jangan pakai di data nyata).
- `data/app.db` tidak tersentuh sepanjang tahap 1 (mtime 2026-10-29).

## Cakupan yang belum otomatis (jadwal manual/visual)
- AV2 matriks lingkungan (tema/skala/kepadatan/layar/browser/HP) — perlu cek manual + Playwright.
- AV3 kriteria global per halaman (konsol, scroll, tooltip, keyboard) — perlu cek visual.
- AV4: Q3–Q5 (retur jual, opname selisih, laba rugi 40.000) dengan angka — TERVERIFIKASI
  manual-API 2026-10-30 (produk `UJI-Q-LABA`, GD-1, lihat Lampiran Q di bawah).
  Q1–Q2 juga terverifikasi di isonasi (beli 10/25, jual 4 HPP 200.000, GD-2 tak terpengaruh).
- K (13+6 laporan, konsistensi omzet), I, N (kamera/barcode), E-07 (10.000 baris),
  P (paginasi 370/10.000, autocomplete <150 ms) — sebagian baru tercakup tidak langsung.
- O ketahanan API (injeksi/XSS/balap/klik-ganda) LULUS 9/9; O tingkat browser (refresh,
  dua tab, dua kasir konkuren sungguhan) masih manual.

## Lampiran Q — verifikasi angka Q1–Q5 (GD-1, produk UJI-Q-LABA, 30 Okt 2026)

Alur: beli 10 @50.000 → sahkan (stok 10) → buka shift → jual 4 @80.000 tunai (stok 6,
HPP 4×50.000=200.000) → retur 1 pcs PIN supervisor (stok 7, retur Rp80.000 tercatat)
→ opname fisik 6 vs sistem 7 → selisih -1, nilai_kurang Rp50.000, disahkan
→ laba-rugi delta +Rp40.000 (bersih 0→40.000; penjualan 320.000, HPP 200.000).

- Kartu Stok konsisten: pembelian +10 → penjualan −4 → retur +1 → opname −1, saldo 6.
- Laba rugi API: penjualan 320.000, HPP 200.000, laba_bersih 40.000 = 240.000−150.000−50.000. ✓
- Catatan model: Akuntansi Dasar — penjualan/retur POS TIDAK membuat jurnal
  (kas & HPP di `sale_items`; terverifikasi di uji-pos-av1); retur wajib PIN supervisor
  (probe awal 403 tanpa PIN = perilaku benar, bukan bug).
- Fixture Q dibiarkan di DB uji (produk UJI-Q-LABA + dokumen PB/SJ/RET/OPN) sebagai bukti.

## Ringkasan 5 poin
1. Isolasi gudang (A-04) TERBUKTI di 25/25 cek API + angka Q1–Q2 benar per gudang.
2. Backup/Reset/Pulihkan (M) lulus 78/79; satu-satunya ganjalan adalah pesan
   200-untuk-0-peran (FIND-01, P2), bukan kebocoran otorisasi.
3. Impor/Ekspor (E) inti lulus; sisa 2 ✘ adalah ekspektasi skrip kedaluwarsa (FIND-04).
4. Satu-satunya penyimpangan perilaku aplikasi vs spek adalah aturan chatbot Db/Tp (FIND-02, P1).
5. 100 kegagalan lain adalah drift skrip uji vs model peran/gudang terbaru (FIND-05) +
   1 cleanup terlalu luas (FIND-03) + 1 kosmetik versi (FIND-06) — diperbaiki di tahap 2
   tanpa menyentuh kode aplikasi.
