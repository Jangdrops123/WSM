/**
 * Tutorial per modul — pengganti tur lama (Driver.js).
 *
 * Setiap modul punya SATU popup tutorial yang tampil OTOMATIS hanya 1x
 * saat modul itu pertama kali dibuka (flag di localStorage per kunci).
 * Pengguna bisa membukanya lagi kapan saja lewat tombol "Panduan".
 *
 * Isinya panduan lengkap per fitur dalam bentuk langkah teks di dalam
 * popup (tanpa sorot elemen), sehingga tidak pernah macet walau halaman
 * kosong / strukturnya beda — dan mencakup SEMUA modul + sub-modul.
 */

export interface LangkahTutorial {
  judul: string;
  isi: string;
}

export interface TutorialModul {
  /** Kunci unik — dipakai untuk flag "sudah dilihat" di localStorage. */
  kunci: string;
  /** Awalan rute tempat tutorial ini berlaku (cocok persis / prefix). */
  rute: string[];
  /** Judul popup, mis. "Panduan Dashboard". */
  judul: string;
  /** Satu kalimat ringkasan di atas langkah-langkah. */
  ringkasan: string;
  langkah: LangkahTutorial[];
}

export const VERSI_TUTORIAL = 'v1';

export const DAFTAR_TUTORIAL: TutorialModul[] = [
  {
    kunci: 'dashboard',
    rute: ['/'],
    judul: 'Panduan Dashboard',
    ringkasan:
      'Halaman ringkasan usaha: pantau angka penting hari ini, atur sendiri kartu yang tampil, dan bayar tagihan yang hampir jatuh tempo langsung dari sini.',
    langkah: [
      {
        judul: 'Sapaan & status koneksi',
        isi: 'Bagian atas menyapa sesuai jam dan nama usaha (dari Pengaturan ▸ Identitas Aplikasi), plus status "Database terhubung". Kalau status memuat terus, server API belum jalan.',
      },
      {
        judul: 'Kartu angka (widget)',
        isi: 'Setiap kartu = satu angka penting (omzet, transaksi, stok menipis, kas, piutang/hutang). Klik kartu untuk melompat ke modul terkait. Angka mengikuti data asli yang tersimpan.',
      },
      {
        judul: 'Atur tampilan sesukamu',
        isi: 'Tombol "Atur tampilan": seret kartu untuk menyusun ulang, ubah ukuran/isi kartu, duplikat, hapus, atau tambah widget baru dari katalog. Ada preset per peran (pemilik, kasir, gudang) dan tersimpan per pengguna.',
      },
      {
        judul: 'Pengingat faktur belum lunas',
        isi: 'Panel pengingat menampilkan piutang (pelanggan belum bayar) dan hutang (ke pemasok) yang belum lunas. Pindah tab Piutang/Hutang, klik Bayar untuk melunasi sebagian atau penuh langsung dari Dashboard.',
      },
      {
        judul: 'Tombol cepat & pintasan',
        isi: 'Header selalu punya tombol POS (atau tekan F9) untuk langsung kasir, tombol tema Terang/Gelap, dan Mode Fokus (Ctrl+Shift+F) untuk menyembunyikan sidebar saat layar sempit.',
      },
    ],
  },
  {
    kunci: 'master-produk',
    rute: ['/master/produk'],
    judul: 'Panduan Master Produk',
    ringkasan:
      'Katalog pusat semua barang dagangan: kode, harga, stok awal, foto, dan barcode. Data di sini dipakai POS, Pembelian, dan Stok.',
    langkah: [
      {
        judul: 'Cari produk',
        isi: 'Kolom cari menerima kode item, nama, SKU, atau barcode. Ikon kamera membuka pemindai barcode HP. Hasil tersaring otomatis — halaman kembali ke 1 setiap ganti kata kunci.',
      },
      {
        judul: 'Tambah produk baru',
        isi: 'Tombol "+ Tambah Produk": isi kode (unik), nama, kategori, merek, satuan dasar, harga jual & harga beli, stok awal + gudang, foto, dan barcode. Simpan — produk langsung bisa dijual di POS.',
      },
      {
        judul: 'Ubah, nonaktifkan, hapus',
        isi: 'Setiap baris punya aksi ubah (pensil), nonaktif/aktif, dan hapus. Produk yang sudah pernah dipakai transaksi sebaiknya dinonaktifkan saja, bukan dihapus, agar riwayat tetap utuh.',
      },
      {
        judul: 'Impor & ekspor massal',
        isi: 'Tombol impor/ekspor Excel memindahkan ratusan produk sekaligus. Unduh dulu format contohnya, isi di Excel, lalu unggah. Foto massal bisa diunggah terpisah dan dicocokkan otomatis per kode/SKU.',
      },
      {
        judul: 'Produk memengaruhi modul lain',
        isi: 'Harga & satuan dasar dipakai POS dan Pembelian; perubahan harga berlaku untuk transaksi BARU (transaksi lama tidak berubah). Stok awal masuk sebagai mutasi "Saldo Awal" di Kartu Stok.',
      },
    ],
  },
  {
    kunci: 'master-konversi',
    rute: ['/master/konversi', '/master/konversi-satuan'],
    judul: 'Panduan Konversi Satuan',
    ringkasan:
      'Atur kelipatan satuan tiap produk: mis. 1 Lusin = 12 Pcs, 1 Kodi = 20 Pcs. Dipakai POS dan Pembelian.',
    langkah: [
      {
        judul: 'Pilih produk dulu',
        isi: 'Pilih produk dari daftar — tabel menampilkan semua konversi miliknya: satuan, faktor (jumlah per satuan dasar), dan harga khusus satuan itu bila ada.',
      },
      {
        judul: 'Tambah konversi',
        isi: 'Tombol tambah: pilih satuan (mis. Lusin), isi faktor (mis. 12), opsional harga jual khusus. Faktor harus bilangan bulat positif.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Di POS/Pembelian, kolom satuan tiap baris menawarkan satuan dasar + semua konversi (mis. "1 kodi kaos" → 20 pcs).',
      },
      {
        judul: 'Hapus dengan aman',
        isi: 'Konversi yang sudah dipakai transaksi lama tidak bisa dihapus (ditolak server) — nonaktifkan pemakaiannya dengan tidak memilihnya di transaksi baru.',
      },
    ],
  },
  {
    kunci: 'master-paket',
    rute: ['/master/paket', '/master/paket-box'],
    judul: 'Panduan Paket / Box',
    ringkasan:
      'Bundling produk: jual 1 box berisi beberapa item sekaligus. Stok komponen berkurang otomatis saat paket terjual.',
    langkah: [
      {
        judul: 'Buat paket',
        isi: 'Tombol tambah: beri kode + nama paket (mis. "BOX-KAOS-ISI-12"), tentukan harga paket, lalu tambah komponen (produk + jumlah tiap komponen).',
      },
      {
        judul: 'Scan barcode box',
        isi: 'Tempel 1 barcode pada kemasan box. Di Pembelian mode Scan atau POS, pindai barcode box — seluruh komponen masuk sekaligus ke tabel.',
      },
      {
        judul: 'Stok ikut berkurang',
        isi: 'Saat paket terjual/keluar, stok tiap komponen berkurang sesuai jumlahnya. Bila satu komponen habis, paket tidak bisa dijual (stok minus ditolak kecuali diizinkan di Pengaturan Stok).',
      },
      {
        judul: 'Ubah & nonaktifkan',
        isi: 'Komposisi paket bisa diubah kapan saja dan berlaku untuk transaksi baru. Nonaktifkan paket yang sudah tidak dijual agar tidak muncul di pencarian POS.',
      },
    ],
  },
  {
    kunci: 'master-kategori',
    rute: ['/master/kategori'],
    judul: 'Panduan Kategori',
    ringkasan:
      'Kelompok produk (mis. Kaos, Celana, Aksesoris). Dipakai filter laporan, filter stok, dan profil size barang.',
    langkah: [
      {
        judul: 'Tambah kategori',
        isi: 'Tombol tambah: isi nama kategori (unik). Opsional pilih "Profil size" untuk menandai ukuran yang lazim pada kategori ini (S/M/L/XL).',
      },
      {
        judul: 'Profil size',
        isi: 'Kategori pakaian biasanya punya profil size (mis. "Kaos Dewasa": S–XL). Profil ini dipakai saat produk butuh pola ukuran tetap.',
      },
      {
        judul: 'Ubah massal',
        isi: 'Aksi massal "Atur Profil size" mengubah banyak kategori sekaligus — hemat waktu saat awal setup toko.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Filter Kategori ada di Stok Saat Ini, Laporan Stok/Pembelian/Penjualan, dan form produk. Menghapus kategori yang masih dipakai produk akan ditolak server.',
      },
    ],
  },
  {
    kunci: 'master-merek',
    rute: ['/master/merek'],
    judul: 'Panduan Merek',
    ringkasan: 'Daftar brand produk (mis. Nike, Lokal, Sendiri). Sederhana: tambah, ubah, hapus.',
    langkah: [
      {
        judul: 'Tambah merek',
        isi: 'Tombol tambah: isi nama merek (unik). Langsung bisa dipilih di form produk dan filter laporan.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Kolom merek tampil di katalog produk dan bisa disaring di Laporan Penjualan/Pembelian per barang. Merek yang masih dipakai produk tidak bisa dihapus.',
      },
    ],
  },
  {
    kunci: 'master-satuan',
    rute: ['/master/satuan'],
    judul: 'Panduan Satuan',
    ringkasan: 'Daftar satuan dasar (Pcs, Lusin, Kodi, Dus…). Satuan dasar produk dipilih dari sini; kelipatannya diatur di Konversi Satuan.',
    langkah: [
      {
        judul: 'Tambah satuan',
        isi: 'Tombol tambah: isi kode (mis. PCS) dan nama (mis. Pcs). Kode dipakai cepat di pencarian POS ("20*kaos" memakai satuan dasar).',
      },
      {
        judul: 'Alur yang benar',
        isi: '1) Daftarkan satuan di sini → 2) pilih sebagai satuan dasar di Produk → 3) tambah kelipatan di Konversi Satuan (mis. 1 Lusin = 12 Pcs).',
      },
    ],
  },
  {
    kunci: 'master-pelanggan',
    rute: ['/master/pelanggan'],
    judul: 'Panduan Pelanggan',
    ringkasan:
      'Data pelanggan + limit piutang. Dipakai POS (nota atas nama), Piutang, dan pengiriman WhatsApp.',
    langkah: [
      {
        judul: 'Tambah pelanggan',
        isi: 'Tombol tambah: nama (wajib), telepon (untuk kirim struk/faktur via WA), alamat, limit piutang (0 = tanpa kredit), dan status aktif.',
      },
      {
        judul: 'Limit piutang',
        isi: 'Penjualan kredit ke pelanggan ini ditolak bila total tagihan berjalan melebihi limit. Naikkan limit untuk pelanggan terpercaya, turunkan untuk yang sering telat.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Dipilih di POS (pelanggan transaksi), halaman Piutang (tagihan per pelanggan + umur/aging), Laporan Pelanggan, dan dialog kirim WhatsApp.',
      },
    ],
  },
  {
    kunci: 'master-pemasok',
    rute: ['/master/pemasok'],
    judul: 'Panduan Pemasok',
    ringkasan:
      'Data supplier + termin pembayaran. Dipakai form Pembelian, Hutang, dan riwayat per pemasok.',
    langkah: [
      {
        judul: 'Tambah pemasok',
        isi: 'Tombol tambah: nama (wajib), telepon, alamat, termin dalam hari (mis. 30 = jatuh tempo 30 hari setelah faktur), dan status aktif.',
      },
      {
        judul: 'Termin pembayaran',
        isi: 'Termin menentukan tanggal jatuh tempo otomatis tiap faktur pembelian. Dipakai pengingat Dashboard dan kolom umur (aging) Hutang.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Dipilih wajib di form Pembelian, tercatat di Hutang per supplier, dan bisa disaring di Laporan Pembelian per pemasok.',
      },
    ],
  },
  {
    kunci: 'master-gudang',
    rute: ['/master/gudang', '/master/gudang-lokasi'],
    judul: 'Panduan Gudang & Lokasi',
    ringkasan:
      'Gudang/cabang + lokasi detail (Zona › Rak › Bin). Stok dicatat per produk per gudang.',
    langkah: [
      {
        judul: 'Tambah gudang',
        isi: 'Tabel atas: tombol tambah, isi kode (mis. G1) dan nama (mis. Gudang Utama). Gudang baru langsung muncul sebagai pilihan di Pembelian, Stok, Transfer, dan Opname.',
      },
      {
        judul: 'Tambah lokasi',
        isi: 'Tabel bawah: lokasi detail per gudang — kode lokasi unik (mis. G1-A-01-01) + zona/rak/bin. Dipakai penempatan fisik dan filter lokasi di Transfer/Opname.',
      },
      {
        judul: 'Filter lokasi',
        isi: 'Dropdown saring lokasi per gudang. Memudahkan gudang besar dengan ratusan titik penyimpanan.',
      },
      {
        judul: 'Dipakai di mana',
        isi: 'Setiap mutasi stok selalu terikat satu gudang. Laporan stok, kartu stok, dan opname bisa dibatasi per gudang agar tidak tercampur antar cabang.',
      },
    ],
  },
  {
    kunci: 'stok-saldo',
    rute: ['/stok'],
    judul: 'Panduan Stok Saat Ini',
    ringkasan:
      'Saldo tiap produk per gudang + nilai persediaan. Pintu masuk semua penyesuaian stok.',
    langkah: [
      {
        judul: 'Cari & saring',
        isi: 'Ketik nama/kode/SKU/barcode (atau ikon kamera untuk scan HP). Saring per gudang, kategori, atau centang "stok menipis saja" untuk fokus ke yang perlu dipesan.',
      },
      {
        judul: 'Ringkasan atas',
        isi: 'Kartu ringkasan: total qty, jumlah item menipis, nilai halaman ini, dan nilai seluruh persediaan (qty × harga beli terakhir).',
      },
      {
        judul: 'Aksi per baris',
        isi: 'Klik baris untuk membuka Kartu Stok (riwayat mutasi produk itu). Tombol aksi: tambah/kurangi lewat Item Masuk-Keluar, atau pindah via Transfer.',
      },
      {
        judul: 'Sakelar stok minus',
        isi: 'Secara bawaan penjualan melebihi stok DITOLAK. Bila usahamu mengizinkan jual dulu–catat kemudian, aktifkan "Izinkan stok minus" — tercatat di log dan bisa dimatikan lagi kapan saja.',
      },
      {
        judul: 'Ke mana selanjutnya',
        isi: 'Sub-menu Stok: Kartu Stok (riwayat), Transfer Antar Gudang, Item Masuk, Item Keluar, dan Opname (penghitungan fisik).',
      },
    ],
  },
  {
    kunci: 'stok-kartu',
    rute: ['/stok/kartu'],
    judul: 'Panduan Kartu Stok',
    ringkasan:
      'Buku riwayat tiap produk: dari mana masuk, ke mana keluar, sisa tiap langkah. Alat utama menelusuri selisih stok.',
    langkah: [
      {
        judul: 'Pilih produk + gudang',
        isi: 'Wajib pilih produk dulu (ketik nama/kode), opsional batasi per gudang. Tanpa produk terpilih tabel kosong — itu normal, bukan error.',
      },
      {
        judul: 'Baca mutasi',
        isi: 'Setiap baris: tanggal, tipe (Penjualan, Pembelian, Transfer, Retur, Opname, Penyesuaian, Saldo Awal), masuk/keluar, dan sisa berjalan. Urut kronologis sehingga alur barang mudah diikuti.',
      },
      {
        judul: 'Lacak selisih',
        isi: 'Stok tidak cocok? Cari tipe tak terduga (mis. penyesuaian manual) atau tanggal loncat. Klik nomor dokumen bila tersedia untuk membuka sumbernya.',
      },
    ],
  },
  {
    kunci: 'stok-transfer',
    rute: ['/stok/transfer'],
    judul: 'Panduan Transfer Antar Gudang',
    ringkasan:
      'Pindahkan stok antar cabang dalam 3 tahap: Draft → Terkirim → Selesai. Stok berkurang di asal hanya saat diterima.',
    langkah: [
      {
        judul: 'Buat draft transfer',
        isi: 'Tombol buat: pilih gudang asal & tujuan (harus beda), tambah produk + qty. Daftar produk hanya menampilkan yang ADA stok di gudang asal.',
      },
      {
        judul: 'Kirim & terima',
        isi: 'Tahap "Terkirim" = barang di jalan (stok asal belum berkurang). Gudang tujuan menekan "Terima" (+ lokasi terima) → stok asal berkurang, stok tujuan bertambah, tahap "Selesai".',
      },
      {
        judul: 'Batalkan bila perlu',
        isi: 'Draft bisa diubah/batal kapan saja (wajib isi alasan). Transfer yang sudah Selesai tidak bisa dibatalkan — buat transfer balik sebagai koreksinya.',
      },
      {
        judul: 'Filter & cari',
        isi: 'Saring per tahap (Draft/Terkirim/Selesai/Batal) dan per gudang, atau cari nomor transfer. Berguna saat transfer menumpuk antar cabang.',
      },
    ],
  },
  {
    kunci: 'stok-masuk',
    rute: ['/stok/masuk'],
    judul: 'Panduan Item Masuk',
    ringkasan:
      'Tambah stok di luar pembelian: stok awal, temuan, koreksi (+), hadiah supplier. Perubahan terjadi saat Simpan.',
    langkah: [
      {
        judul: 'Cara input cepat',
        isi: 'Ketik kode/nama di kolom Kode Item — saran muncul sejak 1 huruf (Enter = masukkan). Trik "20*kaos" = 20 pcs sekaligus. ↑/↓ pindah baris, Tab pindah kolom, Del hapus baris. Bisa scan barcode/USB atau kamera HP.',
      },
      {
        judul: 'Isi header',
        isi: 'Pilih gudang tujuan + tanggal + alasan (stok awal/temuan/koreksi/lainnya). Alasan tercatat di Kartu Stok sehingga audit tahu asal barang.',
      },
      {
        judul: 'Simpan & riwayat',
        isi: 'Tombol Simpan mencatat semua baris sekaligus. Riwayat di bawah menampilkan dokumen masuk sebelumnya — klik untuk lihat detail atau batalkan (selama belum dipakai transaksi lain).',
      },
    ],
  },
  {
    kunci: 'stok-keluar',
    rute: ['/stok/keluar'],
    judul: 'Panduan Item Keluar',
    ringkasan:
      'Kurangi stok di luar penjualan: rusak, hilang, sampel, koreksi (−). Cerminan dari Item Masuk.',
    langkah: [
      {
        judul: 'Cara input cepat',
        isi: 'Sama seperti Item Masuk: ketik/scan di kolom Kode Item, saran sejak 1 huruf, "5*kaos" = 5 pcs, navigasi keyboard penuh (↑/↓/Tab/Del).',
      },
      {
        judul: 'Isi header',
        isi: 'Pilih gudang asal + tanggal + alasan (rusak/hilang/sampel/koreksi/lainnya). Stok yang tidak cukup akan ditolak kecuali sakelar stok minus aktif.',
      },
      {
        judul: 'Simpan & riwayat',
        isi: 'Simpan mencatat sekaligus + mengurangi stok. Riwayat di bawah untuk audit — setiap dokumen keluar tercatat siapa, kapan, dan alasannya.',
      },
    ],
  },
  {
    kunci: 'stok-opname',
    rute: ['/stok/opname'],
    judul: 'Panduan Opname (Stok Fisik)',
    ringkasan:
      'Hitung fisik barang lalu sahkan selisihnya. Alur: buat sesi → hitung (manual/scan/impor) → tinjau selisih → sahkan (stok menyesuaikan).',
    langkah: [
      {
        judul: 'Buat sesi opname',
        isi: 'Tombol buat: pilih gudang (+ lokasi bila perlu), tanggal, penanggung jawab, metode (Manual/Scan/Gabungan). Satu gudang = satu sesi aktif agar tidak tabrakan.',
      },
      {
        judul: 'Tab status',
        isi: 'Saring sesi per tahap: Semua, Draft, Sedang Dihitung, Menunggu Persetujuan, Disahkan. Klik sesi untuk masuk ke ruang hitung.',
      },
      {
        judul: 'Ruang hitung (sesi)',
        isi: 'Di dalam sesi: ketik/scan barcode tiap barang (1 scan = +1), atau impor Excel hasil hitungan. Centang "hanya selisih" untuk fokus ke yang beda dari sistem.',
      },
      {
        judul: 'Tinjau & sahkan',
        isi: 'Tab Tinjau menampilkan selisih (sistem vs fisik). Pengesahan memerlukan izin Sahkan Opname — setelah disahkan stok sistem menyesuaikan ke stok fisik + tercatat sebagai mutasi "Opname" di Kartu Stok.',
      },
      {
        judul: 'Cetak berita acara',
        isi: 'Lembar hitung (checklist fisik) dan Berita Acara (tanda tangan) bisa dicetak/diunduh untuk arsip.',
      },
    ],
  },
  {
    kunci: 'pembelian-input',
    rute: ['/pembelian'],
    judul: 'Panduan Input Pembelian',
    ringkasan:
      'Catat barang masuk dari supplier. Alur dokumen: Draft (PO) → Diterima (GRN) → Disahkan (Faktur, stok + hutang tercatat).',
    langkah: [
      {
        judul: 'Pilih metode input',
        isi: 'Biasa = form manual (cari barang, isi jumlah/satuan/harga per baris). Scan Barcode = pindai box/pcs — hasil masuk tabel draft yang bisa direvisi sebelum disimpan.',
      },
      {
        judul: 'Isi pemasok & gudang dulu',
        isi: 'Pemasok dan gudang tujuan WAJIB sebelum tambah barang (harga & stok mengikuti pilihan ini). Tanggal, nomor PO manual (opsional), dan pajak persen menyusul.',
      },
      {
        judul: 'Tambah barang ke tabel',
        isi: 'Ketik/scan di kolom cari — harga beli terisi otomatis dari pembelian terakhir. Atur qty, satuan (dasar + konversi), diskon Rp/%, dan hapus baris yang salah.',
      },
      {
        judul: 'Simpan Draft (PO)',
        isi: 'Tombol "Simpan Draft (PO)" menyimpan tanpa mengubah stok — aman untuk pesanan yang belum datang.',
      },
      {
        judul: 'Terima & sahkan',
        isi: 'Saat barang datang: tandai Diterima (GRN), lalu Sahkan → stok bertambah + faktur pembelian terbit (+ hutang bila belum lunas). Dokumen bisa dicetak/kirim WA dari Riwayat & Dokumen.',
      },
    ],
  },
  {
    kunci: 'pembelian-riwayat',
    rute: ['/pembelian/riwayat'],
    judul: 'Panduan Riwayat Pembelian',
    ringkasan:
      'Semua dokumen pembelian (PO, GRN, Faktur) + filter periode. Dari sini lanjutkan alur, cetak, atau kirim via WhatsApp.',
    langkah: [
      {
        judul: 'Filter periode',
        isi: 'Bilah periode: hari/minggu/bulan ini atau rentang tanggal sendiri. Ringkasan menampilkan jumlah dokumen + total pada rentang tampil.',
      },
      {
        judul: 'Lencana status',
        isi: 'Draft (PO) = pesanan, Diterima (GRN) = barang datang, Disahkan (Faktur) = stok & hutang tercatat, Batal = dibatalkan. Warna lencana membedakan sekilas.',
      },
      {
        judul: 'Aksi per dokumen',
        isi: 'Buka detail untuk Terima/Sahkan/Batalkan, cetak ulang, simpan PDF, kirim WA ke pemasok, atau lihat faktur terkait. Dokumen yang disahkan tidak bisa diubah — batalkan lalu buat baru bila salah.',
      },
      {
        judul: 'Cari cepat',
        isi: 'Cari nomor PO/faktur atau nama pemasok. Berguna saat supplier menagih — ketik namanya, langsung ketemu semua faktur berjalan.',
      },
    ],
  },
  {
    kunci: 'penjualan-riwayat',
    rute: ['/penjualan'],
    judul: 'Panduan Riwayat Penjualan',
    ringkasan:
      'Semua transaksi POS + faktur terbit. Cetak ulang struk, proses retur, dan pantau piutang dari satu halaman.',
    langkah: [
      {
        judul: 'Buka kasir (Transaksi Baru)',
        isi: 'Tombol "Transaksi Baru (POS)": klik utama membuka mode terakhir, panah kecil memilih Mode Foto (grid gambar) atau Tanpa Foto (cepat). Pintasan F9 dari mana saja.',
      },
      {
        judul: 'Filter periode',
        isi: 'Bilah periode membatasi riwayat per hari/minggu/bulan/rentang. Judul menampilkan rentang + jumlah transaksi + total faktur periode tampil.',
      },
      {
        judul: 'Aksi per transaksi',
        isi: 'Klik baris untuk detail: cetak ulang struk, simpan PDF, kirim WA ke pelanggan, atau buka faktur. Retur butuh PIN supervisor dan mengembalikan stok + tercatat di tab Retur.',
      },
      {
        judul: 'Bagian Dokumen (faktur)',
        isi: 'Di bawah riwayat: daftar faktur penjualan periode tampil — buka detail faktur, kirim WA, atau cetak. Nomor faktur mengikuti penomoran di Pengaturan.',
      },
    ],
  },
  {
    kunci: 'penjualan-retur',
    rute: ['/penjualan/retur'],
    judul: 'Panduan Retur Penjualan',
    ringkasan:
      'Daftar barang yang dikembalikan pelanggan. Retur menambah stok kembali + menyesuaikan piutang/pembayaran.',
    langkah: [
      {
        judul: 'Dari mana retur berasal',
        isi: 'Retur dibuat dari Riwayat Penjualan (aksi Retur per transaksi, butuh PIN supervisor). Alasan wajib diisi — tercatat permanen untuk analisis (cacat/salah ukuran/dll).',
      },
      {
        judul: 'Baca daftar retur',
        isi: 'Kolom: nomor dokumen retur, tanggal, nomor penjualan asal, pelanggan, kasir, alasan, total, dan status. Cari per nomor/pelanggan bila daftar panjang.',
      },
      {
        judul: 'Dampak stok & uang',
        isi: 'Stok barang retur kembali bertambah (mutasi "Retur" di Kartu Stok). Bila penjualan asal belum lunas, sisa piutang berkurang; bila sudah lunas, kasir memproses pengembalian dana manual + catat di Kas Keluar.',
      },
    ],
  },
  {
    kunci: 'penjualan-piutang',
    rute: ['/penjualan/piutang'],
    judul: 'Panduan Piutang Penjualan',
    ringkasan:
      'Tagihan kredit pelanggan dari POS: jatuh tempo, sisa, dan pelunasan. Terhubung ke Piutang Akuntansi.',
    langkah: [
      {
        judul: 'Baca daftar piutang',
        isi: 'Kolom: nomor dokumen, tanggal, pelanggan, total, sudah terbayar, sisa, jatuh tempo, dan status (lancar/jatuh tempo/terlambat). Baris terlambat ditandai warna.',
      },
      {
        judul: 'Lunasi sebagian atau penuh',
        isi: 'Tombol Bayar per baris: isi jumlah + metode (tunai/transfer) + rekening kas. Bisa dicicil berkali-kali; riwayat pembayaran tersimpan per tagihan.',
      },
      {
        judul: 'Batas limit pelanggan',
        isi: 'Pelanggan punya limit piutang (Master Data). Transaksi kredit baru ditolak bila melewati limit — naikkan limitnya atau lunasi dulu tagihan lama.',
      },
    ],
  },
  {
    kunci: 'pos-foto',
    rute: ['/penjualan/pos/foto'],
    judul: 'Panduan POS Mode Foto',
    ringkasan:
      'Kasir bergambar untuk layar sentuh: ketuk produk, atur keranjang, bayar tunai/non-tunai/kredit, cetak struk atau kirim WA.',
    langkah: [
      {
        judul: 'Buka & tutup kasir (shift)',
        isi: 'Pertama: "Buka Kasir" + isi kas awal (modal laci). Di akhir jaga: "Tutup Kasir" — ringkasan shift (transaksi, tunai, selisih) tersimpan dan bisa dicetak.',
      },
      {
        judul: 'Cari & ketuk produk',
        isi: 'Grid menampilkan foto produk. Ketik nama/SKU/barcode untuk menyaring, atau pindai barcode. Ketuk = +1 ke keranjang. Trik "20*kaos" = 20 pcs sekaligus.',
      },
      {
        judul: 'Atur keranjang',
        isi: 'Tiap baris: ubah qty, harga, diskon, dan satuan (dasar + konversi). Pilih pelanggan (untuk nota nama/kredit) dan catat bila perlu.',
      },
      {
        judul: 'Bayar (F4) & tahan (F8)',
        isi: 'Bayar: tunai (hitung kembalian otomatis), transfer/e-wallet (pilih rekening kas), atau kredit (pilih pelanggan + jatuh tempo). Tahan menyimpan keranjang untuk dilanjutkan nanti.',
      },
      {
        judul: 'Setelah bayar',
        isi: 'Struk tampil: cetak thermal, simpan PDF, atau kirim WA. Stok berkurang + penjualan tercatat di Riwayat. Pindah ke Mode Tanpa Foto lewat tombol di header bila ingin input super cepat.',
      },
    ],
  },
  {
    kunci: 'pos-cepat',
    rute: ['/penjualan/pos/tanpa-foto'],
    judul: 'Panduan POS Mode Tanpa Foto',
    ringkasan:
      'Kasir keyboard tercepat: tanpa gambar, semua lewat ketik + Enter. Favorit kasir berpengalaman dan toko dengan ribuan SKU.',
    langkah: [
      {
        judul: 'Buka & tutup kasir (shift)',
        isi: 'Sama seperti Mode Foto: Buka Kasir + kas awal saat mulai jaga, Tutup Kasir + cocokkan laci saat selesai. Riwayat shift tersimpan.',
      },
      {
        judul: 'Ketik untuk jual',
        isi: 'Kolom cari-cepat: ketik 1 huruf langsung muncul saran (nama + stok, urut A-Z). ↑/↓ pilih, Enter masukkan ke tabel, fokus lompat ke Qty. Scan barcode kilat juga didukung.',
      },
      {
        judul: 'Navigasi keyboard penuh',
        isi: '↑/↓ pindah baris, Tab pindah kolom (qty→diskon→harga), Delete hapus baris, F4 Bayar, F8 Tahan. Qty diubah cukup dengan angka — tanpa klik tombol +/-.',
      },
      {
        judul: 'Bayar & selesai',
        isi: 'Dialog bayar sama dengan Mode Foto (tunai/transfer/kredit + kembalian otomatis). Setelah bayar: cetak/Kirim WA struk, stok berkurang, tercatat di Riwayat Penjualan.',
      },
    ],
  },
  {
    kunci: 'faktur-detail',
    rute: ['/dokumen', '/pembelian/dokumen', '/penjualan/dokumen'],
    judul: 'Panduan Detail Faktur',
    ringkasan:
      'Dokumen resmi tiap transaksi: kop usaha, rincian item, total, dan status. Dibuka dari Riwayat Pembelian/Penjualan.',
    langkah: [
      {
        judul: 'Isi faktur',
        isi: 'Kop usaha (nama/logo/alamat dari Identitas Aplikasi), nomor faktur (penomoran di Pengaturan), tanggal, pihak (pelanggan/pemasok), tabel item, total + pajak, dan status (lunas/belum).',
      },
      {
        judul: 'Kirim via WhatsApp',
        isi: 'Ikon WA: nomor diambil dari data pelanggan/pemasok, pesan + tautan/PDF faktur otomatis. Edit pesan sebelum kirim bila perlu.',
      },
      {
        judul: 'Simpan PDF & cetak',
        isi: 'Ikon unduh menyimpan PDF (ukuran kertas mengikuti Template Faktur: A4/A5/thermal). Ikon cetak membuka dialog cetak. Parameter "?cetak=1" langsung membuka cetak (dipakai tombol cepat dari daftar).',
      },
      {
        judul: 'Kembali ke sumber',
        isi: 'Tautan sumber kembali ke transaksi asal (/penjualan atau /pembelian). Nomor dokumen sumber tercantum agar mudah dirunut saat audit.',
      },
    ],
  },
  {
    kunci: 'akuntansi-kas',
    rute: ['/akuntansi/kas'],
    judul: 'Panduan Kas & Bank',
    ringkasan:
      'Semua rekening kas/bank/e-wallet + arus Kas Masuk, Kas Keluar, dan Transfer. Tanpa debit/kredit — cukup catat uang masuk/keluar.',
    langkah: [
      {
        judul: 'Kelola rekening',
        isi: 'Kartu per rekening: kode, nama, jenis (Kas/Bank/E-Wallet), saldo awal, saldo kini. Tambah/ubah/nonaktifkan dari tombol di kepala kartu. Nonaktif menyembunyikan dari pilihan transaksi.',
      },
      {
        judul: 'Kas Masuk & Kas Keluar',
        isi: 'Tombol "+ Kas Masuk" / "− Kas Keluar": tanggal, rekening, kategori (opsional), jumlah, keterangan. Penjualan tunai POS otomatis tercatat sebagai Kas Masuk — jangan catat ganda.',
      },
      {
        judul: 'Transfer antar rekening',
        isi: 'Tombol "⇄ Transfer": pindah dana antar rekening sendiri (mis. Kas → Bank saat setor). Bukan biaya, bukan pendapatan — saldo total tetap.',
      },
      {
        judul: 'Mutasi & ekspor',
        isi: 'Tabel mutasi bisa disaring periode tanggal. Tombol Ekspor mengunduh Excel untuk arsip/akuntan. Data jurnal lama (bila ada) diekspor dulu lalu dihapus dari banner kuning.',
      },
    ],
  },
  {
    kunci: 'akuntansi-pengeluaran',
    rute: ['/akuntansi/pengeluaran'],
    judul: 'Panduan Pengeluaran / Biaya',
    ringkasan:
      'Catat biaya operasional (gaji, sewa, listrik, transport…) per kategori + rekening kas. Setiap catatan = Kas Keluar berkategori.',
    langkah: [
      {
        judul: 'Kelola kategori biaya',
        isi: 'Tombol kategori: tambah/ubah daftar (Gaji, Sewa, Listrik…). Kategori dipakai filter + Laporan Laba Rugi Sederhana.',
      },
      {
        judul: 'Catat biaya',
        isi: 'Tombol catat: tanggal, rekening kas sumber, kategori, jumlah, keterangan. Simpan → langsung mengurangi saldo rekening + muncul di Mutasi Kas.',
      },
      {
        judul: 'Filter & hapus',
        isi: 'Saring per rentang tanggal. Hapus mengembalikan saldo rekening (kasus salah input — lebih baik hapus lalu catat ulang yang benar). Hanya Admin/Akuntan yang boleh ubah.',
      },
    ],
  },
  {
    kunci: 'akuntansi-pemasukan',
    rute: ['/akuntansi/pemasukan'],
    judul: 'Panduan Pemasukan Lain',
    ringkasan:
      'Pendapatan di luar penjualan (jasa, sewa aset, lain-lain) per kategori. Setiap catatan = Kas Masuk berkategori.',
    langkah: [
      {
        judul: 'Kelola kategori pemasukan',
        isi: 'Tombol kategori: tambah/ubah (Jasa, Sewa, Lain-lain…). Beda dengan kategori biaya — keduanya dipakai terpisah di Laba Rugi Sederhana.',
      },
      {
        judul: 'Catat pemasukan',
        isi: 'Tombol catat: tanggal, rekening kas tujuan, kategori, jumlah, keterangan. Simpan → menambah saldo rekening + muncul di Mutasi Kas.',
      },
      {
        judul: 'Bukan penjualan',
        isi: 'Halaman ini KHUSUS non-penjualan. Penjualan POS otomatis tercatat sendiri — jangan catat ulang di sini agar omzet tidak ganda.',
      },
    ],
  },
  {
    kunci: 'akuntansi-piutang',
    rute: ['/akuntansi/piutang'],
    judul: 'Panduan Piutang (Akuntansi)',
    ringkasan:
      'Rekap SEMUA piutang usaha per pelanggan + umur tagihan (aging) + pelunasan. Sumbernya penjualan kredit POS.',
    langkah: [
      {
        judul: 'Baca kartu umur (aging)',
        isi: 'Empat ember: 0–30, 31–60, 61–90, >90 hari + total sisa. Makin banyak di ember kanan, makin mendesak ditagih.',
      },
      {
        judul: 'Lunasi tagihan',
        isi: 'Tombol Bayar per baris: jumlah (boleh sebagian/cicil), metode, rekening kas. Lunas penuh mengubah status jadi Lunas + Kas Masuk tercatat otomatis.',
      },
      {
        judul: 'Riwayat pembayaran',
        isi: 'Ikon riwayat per baris: siapa membayar, kapan, lewat rekening apa, berapa. Jejak lengkap untuk sengketa atau konfirmasi pelanggan.',
      },
    ],
  },
  {
    kunci: 'akuntansi-hutang',
    rute: ['/akuntansi/hutang'],
    judul: 'Panduan Hutang (Akuntansi)',
    ringkasan:
      'Rekap SEMUA hutang ke pemasok + umur (aging) + pembayaran. Sumbernya faktur pembelian yang disahkan.',
    langkah: [
      {
        judul: 'Baca kartu umur (aging)',
        isi: 'Sama seperti piutang: 0–30 / 31–60 / 61–90 / >90 hari + total sisa. Prioritaskan yang jatuh tempo dekat agar tidak kena denda supplier.',
      },
      {
        judul: 'Bayar hutang',
        isi: 'Tombol Bayar: jumlah (boleh cicil), metode, rekening kas sumber. Simpan → mengurangi saldo kas + sisa hutang berkurang, tercatat di Mutasi Kas.',
      },
      {
        judul: 'Riwayat pembayaran',
        isi: 'Ikon riwayat per baris untuk audit: tanggal, jumlah, rekening, pencatat. Cocokkan dengan bukti transfer/bank saat rekonsiliasi.',
      },
    ],
  },
  {
    kunci: 'akuntansi-laporan',
    rute: ['/akuntansi/laporan'],
    judul: 'Panduan Laporan Dasar',
    ringkasan:
      'Empat laporan siap pakai tanpa akuntansi rumit: Kas & Bank, Laba Rugi Sederhana, Rekap Piutang, Rekap Hutang.',
    langkah: [
      {
        judul: 'Pilih jenis laporan',
        isi: 'Empat tab: Kas & Bank (saldo awal/masuk/keluar/akhir per rekening), Laba Rugi (omzet − HPP − biaya + pemasukan lain), Rekap Piutang, Rekap Hutang (per pelanggan/pemasok + sisa).',
      },
      {
        judul: 'Atur periode',
        isi: 'Isi tanggal Dari–Sampai lalu laporan termuat ulang. Periode tersimpan di URL sehingga bisa dibookmark atau dibagikan.',
      },
      {
        judul: 'Cetak & ekspor',
        isi: 'Tombol cetak membuka pratinjau kertas; Ekspor mengunduh Excel. Butuh analisis lebih dalam? Lanjut ke modul Laporan (keuangan lengkap: neraca, arus kas, buku besar).',
      },
    ],
  },
  {
    kunci: 'laporan-ringkasan',
    rute: ['/laporan'],
    judul: 'Panduan Ringkasan Laporan',
    ringkasan:
      'Pintu masuk semua laporan: KPI, 5 barang terlaris, pencarian laporan, dan pintasan kategori.',
    langkah: [
      {
        judul: 'Filter global',
        isi: 'Tombol Filter (dengan jumlah filter aktif) membuka panel: periode (hari/minggu/bulan/rentang), gudang, kasir, pelanggan/pemasok, dan sakelar "Bandingkan" (vs periode sebelumnya, menampilkan % naik/turun di tiap KPI). Berlaku untuk SEMUA laporan.',
      },
      {
        judul: 'Kartu KPI',
        isi: 'Kartu angka penting periode ini; grafik hanya tampil di Dashboard. Klik kartu untuk membuka laporan detailnya.',
      },
      {
        judul: 'Barang terlaris & cari laporan',
        isi: 'Lima besar produk periode berjalan (qty + omzet). Kolom cari menemukan laporan tanpa membuka kategori satu per satu — ketik mis. "retur" atau "aging".',
      },
      {
        judul: 'Pintasan kategori',
        isi: 'Tujuh kartu kategori: Penjualan, Pembelian, Stok, Opname, Keuangan, Pajak, Piutang & Utang. Hak per peran: kasir hanya Penjualan; manajer tanpa Keuangan/Pajak; gudang hanya Stok/Opname/Pembelian.',
      },
    ],
  },
  {
    kunci: 'laporan-kategori',
    rute: ['/laporan/penjualan', '/laporan/pembelian', '/laporan/stok', '/laporan/opname', '/laporan/keuangan', '/laporan/pajak', '/laporan/piutang'],
    judul: 'Panduan Daftar Laporan',
    ringkasan:
      'Daftar laporan dalam satu kategori: pilih kartu untuk membuka tabel + rincian barang + drill-down-nya.',
    langkah: [
      {
        judul: 'Pilih laporan',
        isi: 'Setiap kartu = satu laporan (judul + deskripsi + kolom kunci). Klik untuk membuka halaman generiknya — filter global dari Ringkasan ikut terbawa.',
      },
      {
        judul: 'Kembali ke Ringkasan',
        isi: 'Tombol "Ringkasan" kembali ke pintu masuk. Breadcrumb kategori membantu saat berpindah antar laporan sejenis.',
      },
    ],
  },
  {
    kunci: 'laporan-detail',
    rute: ['/laporan/l'],
    judul: 'Panduan Isi Laporan',
    ringkasan:
      'Anatomi satu laporan: kartu ringkasan, tabel + rincian barang, drill-down sampai struk, plus ekspor/cetak/kirim/simpan.',
    langkah: [
      {
        judul: 'Ringkasan & rincian',
        isi: 'Atas: kartu angka periode ini. Klik baris tabel untuk membuka rincian barang ke bawah; baris rekap bisa drill-down sampai struk.',
      },
      {
        judul: 'Tabel + drill-down',
        isi: 'Tabel bisa diurut + paginasi. Baris rekap bisa diklik → daftar transaksi periode itu → klik lagi → pratinjau struk. Jejak drill-down tampil agar tidak tersesat.',
      },
      {
        judul: 'Aksi laporan',
        isi: 'Ikon aksi: ekspor Excel, ekspor PDF, cetak, kirim (WA/email), simpan sebagai Laporan Tersimpan, dan segarkan data. Aksi memakai filter & periode aktif.',
      },
    ],
  },
  {
    kunci: 'laporan-tersimpan',
    rute: ['/laporan/tersimpan'],
    judul: 'Panduan Laporan Tersimpan',
    ringkasan:
      'Simpan konfigurasi laporan favorit + jadwal otomatis (harian/mingguan/bulanan). Hasil tersimpan sebagai berkas.',
    langkah: [
      {
        judul: 'Simpan dari laporan',
        isi: 'Di halaman laporan mana pun: aksi Simpan → beri nama. Parameter (filter, periode relatif) ikut tersimpan sehingga bulan depan tinggal jalankan ulang.',
      },
      {
        judul: 'Jalankan & buka',
        isi: 'Tombol jalankan sekarang menghasilkan berkas (muncul di daftar berkas bawah). "Buka" membuka laporan dengan parameter tersimpan untuk eksplorasi manual.',
      },
      {
        judul: 'Jadwal otomatis',
        isi: 'Atur jadwal Harian/Mingguan/Bulanan + aktifkan — server menjalankannya otomatis di latar. Kolom "terakhir jalan" memastikan jadwal benar-benar bekerja.',
      },
      {
        judul: 'Hapus yang usang',
        isi: 'Hapus laporan tersimpan yang tidak dipakai + berkas lama agar daftar tetap rapi dan penyimpanan hemat.',
      },
    ],
  },
  {
    kunci: 'pengaturan',
    rute: ['/pengaturan'],
    judul: 'Panduan Pengaturan',
    ringkasan:
      'Kendali seluruh aplikasi: identitas, toko, tampilan, nomor dokumen, pajak, pengguna & hak akses, hingga template cetak. Khusus Admin (+ sebagian untuk peran lain).',
    langkah: [
      {
        judul: 'Navigasi kiri + cari',
        isi: 'Daftar tab dikelompokkan (Dasar, Umum, Transaksi, Keuangan, Keamanan & Sistem). Kolom cari di atas menemukan tab tanpa menggulir — mis. ketik "pajak" atau "struk". Di layar sempit daftar menjadi baris chip geser.',
      },
      {
        judul: 'Tab penting pertama',
        isi: 'Identitas Aplikasi (nama, tagline, logo — tampil di sidebar, tab browser, struk & faktur) dan Toko/Cabang (data kop dokumen). Tampilan mengatur tema, kepadatan, dan ukuran font per pengguna.',
      },
      {
        judul: 'Transaksi & penomoran',
        isi: 'Atur pajak default, format nomor PO/faktur/struk (prefix + counter per periode), metode bayar → rekening kas, dan stok (izinkan minus, metode valuasi).',
      },
      {
        judul: 'Pengguna & hak akses',
        isi: 'Kelola akun, peran (admin/manajer/kasir/gudang/akuntan), dan matriks modul → aksi (lihat/tambah/ubah/hapus). Menu sidebar dan gerbang rute mengikuti matriks ini — yang dicabut hilang dari sidebar DAN diblokir via URL langsung.',
      },
      {
        judul: 'Simpan & kembalikan',
        isi: 'Setiap tab: tombol Simpan, "Kembalikan ke Bawaan", dan peringatan bila ada perubahan belum disimpan. Tab lama (Template Faktur, Aturan Kodi, Struk, Proses Tahunan) hanya untuk Admin via daftar "Dasar".',
      },
      {
        judul: 'Template & proses khusus',
        isi: 'Template Faktur = ukuran kertas + tata letak + pratinjau langsung. Struk = profil thermal POS. Proses Tahunan = tutup tahun (hapus riwayat + jadikan saldo awal) — baca peringatan merahnya dua kali sebelum jalan.',
      },
    ],
  },
];

/** Tutorial yang berlaku untuk sebuah pathname (awalan rute terpanjang menang). */
export function tutorialUntukPath(pathname: string): TutorialModul | undefined {
  let cocok: TutorialModul | undefined;
  for (const t of DAFTAR_TUTORIAL) {
    const kena = t.rute.some((r) =>
      r === '/' ? pathname === '/' : pathname === r || pathname.startsWith(`${r}/`),
    );
    if (kena && (!cocok || t.rute[0].length > (cocok.rute[0]?.length ?? -1))) cocok = t;
  }
  return cocok;
}

function kunciSimpan(kunci: string): string {
  return `tutorial-dilihat:${VERSI_TUTORIAL}:${kunci}`;
}

export function sudahDilihat(kunci: string): boolean {
  try {
    return localStorage.getItem(kunciSimpan(kunci)) === '1';
  } catch {
    return false;
  }
}

export function tandaiDilihat(kunci: string): void {
  try {
    localStorage.setItem(kunciSimpan(kunci), '1');
  } catch {
    /* abaikan */
  }
}

/** Tampilkan ulang semua tutorial (untuk tombol "Ulangi panduan" / pengujian). */
export function aturUlangSemuaTutorial(): void {
  try {
    const awalan = `tutorial-dilihat:${VERSI_TUTORIAL}:`;
    const hapus: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(awalan)) hapus.push(k);
    }
    hapus.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* abaikan */
  }
}
