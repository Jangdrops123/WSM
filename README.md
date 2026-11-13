<<<<<<< HEAD
# pos
aplikasi inventory &amp; pos
=======
# NusaSuite — POS · WMS · Akuntansi

Aplikasi web terpadu untuk usaha retail di Indonesia: Point of Sale, Warehouse Management, dan Akuntansi dalam satu sistem dengan basis data relasional.

**Status saat ini: kerangka aplikasi + modul Master Data, Stok & POS Mode Foto lengkap** — layout, navigasi, migrasi database, modul Master Data (produk, varian, konversi satuan, paket, kategori, merek, satuan, pelanggan, pemasok, gudang/lokasi) beserta impor/ekspor Excel, modul Stok (saldo per gudang/lokasi, Kartu Stok, transfer antar gudang, pengaturan stok minus, valuasi rata-rata bergerak), serta POS Mode Foto (`/penjualan/pos/foto`: grid produk berfoto, keyboard penuh, scan barcode, pembayaran campuran, shift kasir, void & retur PIN supervisor, penjualan atomik) — POS kini menjadi bagian modul Penjualan bersama tab Riwayat/Retur/Piutang, dengan rute lama `/pos*` dialihkan 301. Modul lain menyusul.

## Menjalankan

```bash
npm install        # sekali saja
npm run dev        # migrasi + API (:3001) + Vite dev server (:5173)
```

Buka `http://localhost:5173`, lalu menu **Master Data**.

## Menguji kamera / pemindai barcode di HP

Pop up **Pindai barcode / QR** punya tiga jalur: **Kamera** (langsung),
**Foto** (ambil foto / galeri — berfungsi juga di HTTP biasa), dan **Ketik**
(manual + alat pemindai USB/Bluetooth). Kamera langsung hanya tersedia di
konteks aman (HTTPS atau `localhost`); di luar itu pop up menampilkan kartu
info kuning (bukan error merah) dan jalur Foto/Ketik tetap bisa dipakai.

```bash
# Opsi 1 — HTTPS lokal (disarankan untuk uji kamera via Wi-Fi):
npm run dev:https   # Vite https://<ip-lokal>:5173 + API :3001 (proxy /api)
```

1. Pastikan HP dan komputer satu Wi-Fi, lalu di HP buka alamat `https://…`
   yang tampil di terminal dan **terima peringatan sertifikat lokal**.
   Contoh: `https://192.168.1.10:5173` (ganti dengan IP komputer Anda).
2. Izinkan akses kamera saat diminta. Mode berkelanjutan (Opname, Pembelian,
   Item Masuk/Keluar, POS) berbunyi + bergetar tiap kode dan jeda 1 detik
   anti-baca ganda.

```bash
# Opsi 2 — lewat kabel USB (tanpa Wi-Fi):
adb reverse tcp:5173 tcp:5173   # lalu di HP buka http://localhost:5173
# Opsi 3 — Chrome di HP: chrome://flags → "Insecure origins treated as
# secure" → isi http://192.168.1.10:5173 (tidak disarankan untuk rutin).
```

- Frontend **tidak memanggil backend dengan alamat tetap**: seluruh API
  memakai jalur relatif `/api` (diproksi Vite ke `127.0.0.1:API_PORT` saat
  dev, dilayani proses yang sama saat produksi), jadi tidak ada mixed content.
- Produksi: sajikan lewat **HTTPS** (domain + sertifikat otomatis, mis.
  reverse proxy TLS). Server mengirim `Permissions-Policy: camera=(self)`.
- Bila API perlu dijangkau perangkat lain di LAN (uji HP ke server produksi),
  jalankan dengan `HOST=0.0.0.0 npm start` (bawaan hanya loopback).

Perintah lain:

```bash
npm run db:migrate   # terapkan migrasi saja (idempoten)
npm run typecheck    # pemeriksaan TypeScript
npm run build        # typecheck + build frontend ke dist/
npm start            # mode produksi: API menyajikan dist/ di :3001
node scripts/uji-master.mjs     # uji integrasi API Master Data (server harus hidup)
npx tsx scripts/uji-stok.ts     # uji integrasi API Stok: 42 pemeriksaan (server harus hidup)
npx tsx scripts/uji-pos.ts      # uji integrasi API POS: 47 pemeriksaan (server harus hidup)
npx tsx scripts/isi-stok-demo.ts # isi data demo Stok (idempoten, lewat jalur ubahStok)
```

## Keamanan & Pemulihan Akun (Log In)

- **Log In** — semua halaman otomatis diarahkan ke Log In bila belum masuk,
  termasuk saat membuka URL langsung. Password disimpan ter-hash (bcrypt) dan
  tidak pernah ditampilkan sebagai teks biasa. Centang **Ingat saya** agar
  sesi lebih panjang; sesi berakhir otomatis setelah tidak aktif (durasi di
  Pengaturan ▸ Keamanan, `sesi_menit`).
- **Akun terkunci** — 5× salah → terkunci 15 menit (dapat diatur:
  `masuk_coba_maks`, `masuk_terkunci_menit`). Buka kunci lewat Pengaturan ▸
  Pengguna & Hak Akses (ikon *Buka Kunci*), atau tunggu masa berlalu.
- **Wajib ganti password** — akun awal Admin dan hasil *Reset Password* oleh
  Admin ditandai "wajib ganti saat login berikutnya"; layar ganti password
  tampil sebelum aplikasi dapat dipakai.
- **Hak akses** — Pengaturan ▸ Halaman Awal & Peran (matriks modul × aksi,
  pilih-per-baris/per-kolom, hak khusus, cakupan toko) dan Pengaturan ▸
  Pengguna & Hak Akses (akun, peran, status). Perubahan langsung berlaku tanpa
  login ulang: menu yang tidak diizinkan disembunyikan dari sidebar **dan**
  dicek ulang di sisi server — URL/API tanpa izin dijawab 403 (halaman
  "Tidak punya akses").
- **Lupa password** — alur mandiri (tautan reset berlaku 30 menit, sekali
  pakai, maksimal 3× per jam per akun) hanya tampil bila email/WhatsApp sudah
  dikonfigurasi di Pengaturan ▸ Notifikasi; bila belum, halaman menampilkan
  petunjuk "Hubungi Admin untuk reset password". Balasan selalu netral —
  tidak membocorkan apakah akun terdaftar.
- **Kode Pemulihan (khusus akun Admin utama)** — Pengaturan ▸ Keamanan ▸
  *Buat 10 kode baru*. Kesepuluh kode hanya tampil sekali (cetak/unduh lalu
  simpan aman), tiap kode sekali pakai, dan membuat kode baru membatalkan
  seluruh kode lama. Masukkan satu kode di halaman Lupa password untuk
  membuat password baru.

### Jika Kode Pemulihan hilang

Jalur terakhir adalah reset langsung dari server/database — sengaja **tidak
ditampilkan di aplikasi publik**:

```bash
npx tsx scripts/reset-sandi-admin.ts               # sandi acak, dicetak sekali
npx tsx scripts/reset-sandi-admin.ts "Baru1234"    # sandi pilihan sendiri
```

Perintah ini mengeluarkan seluruh sesi lama akun tersebut, menandai *wajib
ganti password* pada login berikutnya, dan mereset hitungan salah/masa
terkunci. Untuk database server uji terpisah, awali dengan
`DB_FILE=data/uji-reset.db`.

## Pilihan teknologi

| Bagian   | Teknologi | Alasan |
| -------- | --------- | ------ |
| Frontend | React 19 + Vite + React Router | cepat, komponen modular, mudah dikembangkan per modul |
| Backend  | Express 5 (TypeScript via tsx)   | sederhana, siap untuk middleware auth/audit |
| Database | SQLite via `node:sqlite` bawaan Node | tanpa dependensi native, transaksi ACID, WAL |

## Struktur

```
server/
  db.ts                 # koneksi DB, pragma, withTransaction(), penomoran dokumen
  migrate.ts             # runner migrasi (idempoten, tercatat di schema_migrations)
  index.ts               # server Express (API + penyaji frontend produksi)
  lib/
    http.ts akses.ts audit.ts excel.ts
  routes/master/         # API Master Data: umum (generik), produk, paket
  routes/stock.ts        # API Stok: saldo, kartu stok, pengaturan, transfer
  routes/pos.ts          # API POS: grid produk, shift, tertahan, penjualan atomik, void/retur
  migrations/
    001_skema_awal.sql    # SELURUH skema relasional + trigger penjaga aturan
    002_seed_awal.sql     # peran bawaan + pengaturan default
    003_indeks_pencarian.sql  # indeks cepat: nama/kode + (sku, barcode sudah UNIQUE)
    004_stok_transfer.sql     # kolom kirim/terima transfer + indeks kartu stok
src/
  App.tsx                # rute mengikuti menu sidebar
  config/menu.ts         # sumber kebenaran menu navigasi (kode = role_permissions.menu)
  layout/AppLayout.tsx   # sidebar + topbar + konten (responsif, laci di HP)
  components/crud/       # Modal, Toast, HalamanGenerik (tabel+paginasi+form+impor/ekspor)
  pages/                 # Dashboard + kerangka tiap modul
  pages/master/          # Produk, Konversi, Paket, Gudang/Lokasi, halaman umum
  pages/stok/            # Saldo Stok, Kartu Stok, Transfer Antar Gudang
  pages/pos/             # POS Mode Foto (layar penuh): grid + keranjang + dialog bayar/shift/layanan + struk
  lib/format.ts          # format Rupiah "Rp 1.250.000", tanggal dd/mm/yyyy
scripts/uji-master.mjs   # uji integrasi API Master Data (29 pemeriksaan)
scripts/uji-stok.ts      # uji integrasi API Stok (42 pemeriksaan)
scripts/uji-pos.ts       # uji integrasi API POS (47 pemeriksaan, idempoten)
scripts/isi-stok-demo.ts # pengisi data demo Stok (idempoten)
data/app.db             # basis data (dibuat otomatis, masuk .gitignore)
```

## Skema database

43 tabel sesuai spesifikasi (akses/audit, master data, stok, POS, pembelian, opname, akuntansi, impor massal) ditambah 3 tabel infrastruktur:

- `schema_migrations` — catatan migrasi yang sudah diterapkan
- `document_counters` — penomoran `no_dokumen` otomatis per kunci/periode
- `settings` — pengaturan aplikasi (stok minus, pajak, nama usaha, dll.)

Aturan yang dijaga di level database (trigger + constraint, sudah diuji):

1. Jurnal hanya bisa disahkan jika punya baris dan **total debit = total kredit**.
2. Dokumen berstatus **disahkan terkunci** — hanya bisa diubah menjadi `batal` (void/retur).
3. `stock_balances` **UNIQUE** per (variant, warehouse, location); setiap perubahan wajib disertai baris `stock_ledger` dalam transaksi yang sama (dijamin lapisan aplikasi via `withTransaction()`).
4. Status hanya menerima `draft` / `disahkan` / `batal`; qty & harga tidak negatif; baris jurnal tidak boleh debit+kredit sekaligus.
5. Foreign key selalu aktif (`PRAGMA foreign_keys = ON`).

## Konvensi

- Bahasa antarmuka **Indonesia**, mata uang **Rupiah**, tanggal **dd/mm/yyyy**.
- Setiap tabel transaksi punya `id`, `no_dokumen` otomatis, `status`, `dibuat_oleh`, `dibuat_pada`, `diubah_pada`.
- Semua operasi multi-tulis dibungkus `withTransaction()` — gagal sebagi = batal semua.
- Audit: setiap aksi pada dokumen dicatat ke `audit_logs` (modul Master Data sudah aktif: tambah/ubah/hapus/impor/`ubah_harga`).

## Modul Master Data (sudah berjalan)

| Halaman | Fitur |
| ------- | ----- |
| Produk | form multi-varian (size × warna), tombol **Buat varian otomatis**, harga beli/eceran/grosir, stok min, foto URL |
| Konversi Satuan | 1 lusin = 12 pcs, 1 kodi = 20 pcs — per varian, lintas produk |
| Paket / Box | kode_box, barcode_box, isi (varian × qty), total pcs otomatis |
| Kategori, Merek, Satuan, Pelanggan, Pemasok | CRUD + pencarian + paginasi + impor/ekspor Excel |
| Gudang & Lokasi | gudang + lokasi `zona › rak › bin` dengan `kode_lokasi` unik & filter per gudang |

Aturan yang dijaga server:

- SKU & barcode unik; barcode varian tidak boleh sama dengan barcode box (dan sebaliknya).
- Harga wajib ≥ 0; setiap perubahan harga tercatat di audit log (`ubah_harga`).
- Produk/varian yang sudah tercatat di transaksi/stok tidak bisa dihapus — hanya dinonaktifkan.
- Endpoint hapus & perubahan harga dibungkus guard `wajibAdmin` (Owner/Admin) — saat ini semua permintaan dianggap Administrator karena modul login belum dibangun; saat auth dibangun cukup ganti `penggunaSaatIni()` di `server/lib/akses.ts`.
- Pencarian cepat: indeks pada `products.nama`, `categories.nama`, dst.; `sku`/`barcode` sudah UNIQUE-terindeks untuk POS & autocomplete.

## Modul Stok (sudah berjalan)

| Halaman | Fitur |
| ------- | ----- |
| Saldo Stok (`/stok`) | saldo per varian × gudang × lokasi; cari SKU/barcode/nama; filter gudang → lokasi & kategori; indikator **di bawah minimum**; nilai memakai rata-rata bergerak; pengaturan stok minus |
| Kartu Stok (`/stok/kartu`) | mutasi per varian: tanggal, dokumen sumber, masuk, keluar, saldo, harga satuan, pengguna; filter gudang; deteksi selisih kartu vs saldo |
| Transfer (`/stok/transfer`) | alur **Draft → Kirim → Terima** (pilih lokasi tujuan), batal dengan alasan + pemulikan pergerakan, filter tahap/gudang, audit lengkap |

Aturan yang dijaga server:

- **Satu jalur perubahan stok**: semua mutasi melewati `ubahStok()` di `server/lib/stok.ts` yang menulis `stock_balances` + `stock_ledger` (Kartu Stok) dalam satu transaksi — tidak ada cara mengubah stok tanpa kartu stok.
- Stok minus **tidak diizinkan** secara default; pengeluaran melebihi saldo ditolak 409 kecuali diaktifkan di Pengaturan Stok (guard `wajibAdmin`, tercatat di audit log).
- Valuasi **rata-rata bergerak** per lokasi: masuk menghitung rata-rata baru, keluar memakai rata-rata saat itu — nilai unit tersimpan di tiap baris kartu stok.
- Transfer: draft tidak menggerakkan stok; **Kirim** mengurangi gudang asal (distribusi lintas lokasi), **Terima** menambah gudang tujuan membawa rata-rata sumber; batal membalikkan pergerakan (ditolak 409 bila stok tujuan sudah terpakai — selesaikan lewat Opname).
- Invarian teruji: setiap baris `stock_balances` = jumlah `stock_ledger` per (varian, gudang, lokasi) — 42/42 pemeriksaan di `scripts/uji-stok.ts`.

## POS Mode Foto (sudah berjalan — dalam modul Penjualan)

| Halaman | Fitur |
| ------- | ----- |
| `/penjualan/pos/foto` | layar penuh: kiri grid kartu produk (foto, nama, harga, stok per gudang terpilih) + kategori & pencarian; kanan keranjang + subtotal, diskon, pajak, total |
| `/penjualan` | halaman Penjualan: tab Riwayat \| Retur \| Piutang, tombol "Transaksi Baru (POS)", aksi ikon (lihat, cetak ulang, kirim, retur) |
| Rute lama | `/pos`, `/pos/foto`, `/pos/cepat`, `/pos/tanpa-foto` → redirect 301 ke rute di atas (Express + Vite dev) |
| Keyboard | F2 fokus pencarian · panah berpindah kartu · Enter tambah/scan · +/− ubah jumlah · Delete hapus item · F4 bayar · F8 tahan · F9 tertahan · Esc tutup dialog/kosongkan · F1 panel pintasan di pojok |
| Pembayaran | campuran tunai/transfer/QRIS/kredit (kredit wajib pelanggan → piutang), uang cepat, kembalian, struk thermal 58/80mm & PDF |
| Shift kasir | buka dengan kas awal, tutup dengan hitungan fisik → selisih; ringkasan transaksi & tunai |
| Void & retur | dari Riwayat & Layanan, PIN supervisor (SHA-256 di `settings.pin_supervisor`, bawaan `1234`), alasan tercatat di audit log |

Aturan yang dijaga server (`server/routes/pos.ts`):

- **Penjualan atomik**: satu `withTransaction()` — baris penjualan + potong stok lintas lokasi (kartu stok ikut via `ubahStok`) + pembayaran (+ piutang bila kredit) + jurnal penjualan disahkan (Kas/Bank/QRIS/Piutang vs Penjualan/PPN) + jurnal HPP disahkan (HPP vs Persediaan).
- Penjualan hanya bisa terjadi saat ada **shift aktif**; nomor dokumen `SJ-YYYY-MM-NNNN` otomatis.
- Void: stok kembali, jurnal penjualan & HPP dibatalkan, piutang dibatalkan, audit log tercatat — hanya penjualan `disahkan`.
- Retur: qty ≤ sisa terjual, stok kembali, jurnal retur (debit penjualan, kredit kas + balik HPP) seimbang & disahkan.
- Uji atomik penuh: 47/47 pemeriksaan di `scripts/uji-pos.ts` (stok, kartu stok, jurnal, piutang, PIN, shift, tertahan, bersih data uji).
>>>>>>> e44298f (Initial commit: Dockerized app with PostgreSQL setup)
