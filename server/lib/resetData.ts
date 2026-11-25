// Reset Data — Pengaturan ▸ Database & Backup (hanya Admin utama).
//
// Tiga pilihan, makin luas cakupannya:
//   1. transaksi — penjualan, pembelian, retur, Item Masuk/Keluar, Opname,
//      transfer, jurnal, kas; stok kembali 0. Master, pengguna & pengaturan tetap.
//   2. master    — transaksi di atas + produk, kategori, pelanggan, pemasok,
//      gudang (dan turunannya). Pengguna & pengaturan tetap.
//   3. total     — semua di atas + toko, pengguna selain Admin utama, riwayat;
//      pengaturan kembali ke bawaan. Hanya akun Admin utama yang dipertahankan.
//
// Aturan yang dipegang:
//   * Urutan penghapusan SELALU detail dulu baru induk (baris anak → baris
//     induk) — PostgreSQL memeriksa kunci asing langsung per statement,
//     jadi urutan inilah yang menentukan; pemicu (trigger) tetap dihormati
//     saat statement dijalankan.
//   * Setiap DELETE dijalankan di dalam SAVEPOINT (`dalamSavepoint`). Tanpa ini
//     satu pelanggaran kunci asing membuat SELURUH transaksi PostgreSQL aborted
//     (25P02) sehingga semua statement berikutnya — termasuk COMMIT — ditolak
//     dan API menjawab HTTP 500. Dengan savepoint, statement yang gagal
//     (mis. sisa baris anak) dicatat lalu DICOBA ULANG setelah induk lain
//     dibersihkan.
//   * Saldo stok (`stock_balances`) dihapus SEBELUM `products`/`warehouses`
//     pada Reset Transaksi + Master Data: barisnya NOT NULL merujuk keduanya
//     tanpa ON DELETE CASCADE, sehingga produk/gudang tidak akan pernah bisa
//     dihapus selama saldo stok masih ada.
//   * Nomor urut dokumen (`document_counters`) direset sesuai pilihan: counter
//     transaksi saja untuk pilihan 1/2, seluruh counter untuk pilihan total.
//   * Sebelum eksekusi selalu dibuat cadangan pengaman (pg_dump), sehingga
//     reset yang keliru tetap bisa dibatalkan lewat "Pulihkan dari Backup".
//   * Setiap reset tercatat di Log Aktivitas (siapa/peran, kapan, jenis reset,
//     jumlah data per modul, nama cadangan pengaman).
import { all, get, run, withTransaction } from '../db.pg.ts';
import { catatAudit } from './audit.ts';
import { tolak } from './http.ts';
import { JENIS_NOMOR } from './pengaturanBaru.ts';
import { buatBackup } from './sistem.ts';
import { nolkanStok } from './pembersihanTransaksi.ts';
import { kosongkanIndeksCocok } from './cocok.ts';
import { bersihCacheLaporan } from './laporanDasar.ts';

export type JenisReset = 'transaksi' | 'master' | 'total';

export const JENIS_RESET: { kode: JenisReset; label: string; ket: string }[] = [
  {
    kode: 'transaksi',
    label: 'Reset Transaksi',
    ket: 'Hapus permanen seluruh riwayat transaksi (penjualan, pembelian, retur, Item Masuk/Keluar, Opname, transfer, mutasi stok, jurnal, kas) — termasuk transaksi yang sudah dibatalkan — lalu kembalikan stok fisik, nilai persediaan, dan kartu stok ke 0. Master Barang, pengguna, dan pengaturan tetap dipertahankan.'
  },
  {
    kode: 'master',
    label: 'Reset Transaksi + Master Data',
    ket: 'Semua isi Reset Transaksi, ditambah produk, kategori, pelanggan, pemasok, dan gudang beserta turunannya. Pengguna dan pengaturan tetap.',
  },
  {
    kode: 'total',
    label: 'Reset Total',
    ket: 'Kembalikan aplikasi ke kondisi awal (data kosong). Hanya akun Admin utama yang dipertahankan, pengaturan kembali ke bawaan.',
  },
];

export function labelReset(jenis: string): string {
  return JENIS_RESET.find((j) => j.kode === jenis)?.label ?? jenis;
}

/** Satu baris tabel yang dikosongkan. `saring` = klausa WHERE (tanpa WHERE). */
interface Sasaran {
  tabel: string;
  saring?: string;
}

/** Statement pembersihan yang gagal (dicoba ulang / dilaporkan ke pengguna). */
interface GagalHapus {
  label: string;
  sasaran: Sasaran;
  galat: string;
}

export interface ModulReset {
  kode: string;
  label: string;
  tabel: Sasaran[];
  /** Penghapusan ditangani khusus (pengguna / pengaturan / nomor urut). */
  khusus?: 'pengguna' | 'pengaturan' | 'nomor_urut';
}

/* ------------------------- dasar kunci nomor urut ------------------------ */

/** Dasar kunci counter dokumen transaksi (mis. `inv`, `pb`, `persediaan-masuk`). */
const DASAR_NOMOR = [
  ...new Set(JENIS_NOMOR.flatMap((j) => [j.dasarKunci ?? '', j.prefix.toLowerCase()]).filter(Boolean)),
];

/**
 * WHERE untuk counter transaksi. Kunci counter berbentuk `<dasar>-<periode>`
 * (mis. `inv-2026`, `pb-2026-10`), jadi pencocokan awalan memastikan seluruh
 * periode ikut direset — nomor dokumen berikutnya kembali ke 0001.
 */
const saringNomorTransaksi = DASAR_NOMOR.map(
  (d) => `(kunci = '${d}' OR kunci LIKE '${d}-%')`,
).join(' OR ');

/* ----------------------------- modul transaksi --------------------------- */

const MODUL_TRANSAKSI: ModulReset[] = [
  {
    kode: 'retur',
    label: 'Retur Penjualan',
    tabel: [{ tabel: 'sale_return_items' }, { tabel: 'sale_returns' }],
  },
  { kode: 'faktur', label: 'Faktur (dokumen)', tabel: [{ tabel: 'invoices' }] },
  {
    kode: 'penjualan',
    label: 'Penjualan (POS)',
    tabel: [
      { tabel: 'receivables' },
      { tabel: 'sale_payments' },
      { tabel: 'sale_items' },
      { tabel: 'sales' },
      { tabel: 'held_sales' },
      { tabel: 'cashier_shifts' },
    ],
  },
  { kode: 'pembayaran', label: 'Pembayaran piutang/hutang', tabel: [{ tabel: 'payments' }] },
  {
    kode: 'pembelian',
    label: 'Pembelian',
    tabel: [
      { tabel: 'payables' },
      // Log parser/chatbot pembelian & PO (riwayat pencocokan teks) — ikut
      // dibersihkan agar tidak menyisakan jejak dokumen yang sudah dihapus.
      { tabel: 'chat_match_logs' },
      { tabel: 'purchase_scan_logs' },
      { tabel: 'purchase_chat_logs' },
      { tabel: 'purchase_items' },
      { tabel: 'purchases' },
    ],
  },
  {
    kode: 'po',
    label: 'Purchase Order (PO) & penerimaan barang',
    // Urutan anak → induk. `po_receipts.po_id` memakai ON DELETE SET NULL, jadi
    // header PO baru boleh dihapus SETELAH penerimaannya — kalau tidak, GRN
    // tertinggal sebagai dokumen yatim tanpa PO.
    tabel: [
      { tabel: 'po_receipt_items' },
      { tabel: 'po_receipts' },
      { tabel: 'purchase_order_items' },
      { tabel: 'purchase_orders' },
    ],
  },
  {
    kode: 'item_masuk_keluar',
    label: 'Item Masuk / Keluar',
    tabel: [{ tabel: 'sub_stock_items' }, { tabel: 'sub_stock_docs' }],
  },
  {
    kode: 'opname',
    label: 'Opname',
    tabel: [{ tabel: 'opname_scans' }, { tabel: 'opname_items' }, { tabel: 'opname_sessions' }],
  },
  {
    kode: 'transfer',
    label: 'Transfer Gudang',
    tabel: [{ tabel: 'stock_transfer_items' }, { tabel: 'stock_transfers' }],
  },
  {
    kode: 'jurnal',
    label: 'Jurnal',
    // Pemicu "jurnal disahkan tidak dapat diubah" dilepas dulu (status → batal,
    // diizinkan pemicu) sebelum baris & baris jurnalnya dihapus.
    tabel: [{ tabel: 'journal_lines' }, { tabel: 'journals' }],
  },
  { kode: 'kas', label: 'Kas & bank (mutasi kas)', tabel: [{ tabel: 'cash_transactions' }] },
  {
    kode: 'stok',
    label: 'Stok (kartu stok & saldo)',
    // `stock_balances` TIDAK dihapus — baris saldo per produk/gudang dipertahankan
    // dengan qty 0 oleh nolkanStok() agar pencarian produk tetap menemukan
    // master barang setelah reset. Hanya riwayat kartu stok yang dikosongkan.
    tabel: [{ tabel: 'stock_ledger' }],
  },
];

const MODUL_NOMOR_TRANSAKSI: ModulReset = {
  kode: 'nomor_urut',
  label: 'Nomor urut dokumen transaksi',
  tabel: [{ tabel: 'document_counters', saring: saringNomorTransaksi }],
  khusus: 'nomor_urut',
};

/* ------------------------------ modul master ----------------------------- */

const MODUL_MASTER: ModulReset[] = [
  {
    // WAJIB paling awal: `stock_balances.product_id` & `.warehouse_id` NOT NULL
    // tanpa CASCADE — bila barisnya tersisa, penghapusan products/warehouses
    // gagal dan transaksi ikut aborted (penyebab HTTP 500 pada reset master).
    kode: 'saldo_stok',
    label: 'Saldo stok per produk & gudang',
    tabel: [{ tabel: 'stock_balances' }],
  },
  {
    kode: 'produk',
    label: 'Produk, paket & konversi satuan',
    tabel: [
      { tabel: 'unit_conversions' },
      { tabel: 'pack_items' },
      { tabel: 'products' },
      { tabel: 'packs' },
    ],
  },
  {
    kode: 'kategori_merek',
    label: 'Kategori & merek',
    tabel: [{ tabel: 'categories' }, { tabel: 'brands' }],
  },
  { kode: 'satuan', label: 'Satuan', tabel: [{ tabel: 'units' }] },
  { kode: 'pelanggan', label: 'Pelanggan', tabel: [{ tabel: 'customers' }] },
  { kode: 'pemasok', label: 'Pemasok', tabel: [{ tabel: 'suppliers' }] },
  {
    kode: 'gudang',
    label: 'Gudang & lokasi',
    tabel: [{ tabel: 'locations' }, { tabel: 'warehouses' }],
  },
  {
    kode: 'profil_size',
    label: 'Profil size buatan',
    // Profil bawaan (bawaan = TRUE) termasuk "kondisi awal" — hanya profil buatan
    // pengguna yang dihapus beserta rinciannya.
    tabel: [
      {
        tabel: 'size_profile_sizes',
        saring: 'profile_id IN (SELECT id FROM size_profiles WHERE bawaan = FALSE)',
      },
      { tabel: 'size_profiles', saring: 'bawaan = FALSE' },
    ],
  },
];

/* ---------------------------- modul khusus total ------------------------- */

function modulTotal(adminId: number | null): ModulReset[] {
  return [
    { kode: 'toko', label: 'Toko', tabel: [{ tabel: 'stores' }] },
    {
      kode: 'laporan_tersimpan',
      label: 'Laporan tersimpan',
      tabel: [{ tabel: 'report_files' }, { tabel: 'saved_reports' }],
    },
    {
      kode: 'riwayat_impor',
      label: 'Riwayat impor',
      tabel: [{ tabel: 'import_errors' }, { tabel: 'import_batches' }],
    },
    {
      kode: 'riwayat_proses',
      label: 'Riwayat Proses Tahunan',
      tabel: [{ tabel: 'annual_processes' }],
    },
    { kode: 'log_aktivitas', label: 'Log Aktivitas lama', tabel: [{ tabel: 'audit_logs' }] },
    {
      kode: 'pengguna',
      label: 'Pengguna selain Admin utama',
      tabel: [{ tabel: 'users', saring: adminId === null ? undefined : `id <> ${adminId}` }],
      khusus: 'pengguna',
    },
    {
      kode: 'pengaturan',
      label: 'Pengaturan (kembali ke bawaan)',
      tabel: [{ tabel: 'settings' }],
      khusus: 'pengaturan',
    },
    {
      kode: 'nomor_urut',
      label: 'Nomor urut seluruh dokumen',
      tabel: [{ tabel: 'document_counters' }],
      khusus: 'nomor_urut',
    },
  ];
}

/* --------------------------- daftar per pilihan -------------------------- */

/** Tabel yang TIDAK disentuh reset total (konfigurasi & keadaan awal). */
const TABEL_DIPERTAHANKAN = new Set([
  'schema_migrations',
  'roles',
  'role_permissions',
  // TAHAP 1/2 — hak akses & keadaan login ikut "pengguna yang dipertahankan":
  // sesi aktif tidak boleh putus di tengah reset, kode pemulihan & hak khusus
  // per peran adalah konfigurasi (bisa sudah dicetak/disetel Admin).
  'role_hak_khusus',
  'sessions',
  'password_resets',
  'recovery_codes',
  'users',
  'settings',
  'accounts',
  'periods',
  'cash_accounts',
  'expense_categories',
  'payment_method_accounts',
  'struk_profil',
  'invoice_templates',
  'size_profiles',
  'size_profile_sizes',
  'dashboard_layout',
  'dashboard_layout_peran',
  'pengaturan_dashboard',
  'pengaturan_dashboard_peran',
]);

/**
 * Tabel inti master: bila salah satunya masih berisi data setelah semua
 * putaran, reset master/total dianggap gagal dan penyebabnya dilaporkan —
 * bukan dibiarkan "sukses" dengan data setengah terhapus.
 */
const TABEL_KRITIS_MASTER = new Set([
  'stock_balances',
  'products',
  'categories',
  'brands',
  'units',
  'customers',
  'suppliers',
  'locations',
  'warehouses',
]);

const DIPERTAHANKAN: Record<JenisReset, string[]> = {
  transaksi: [
    'Master data (produk, kategori, pelanggan, pemasok, gudang, satuan, profil size)',
    'Pengguna & peran',
    'Pengaturan sistem',
    'Toko & riwayat impor/laporan tersimpan',
    'COA, periode akuntansi, template faktur & struk',
    'Log Aktivitas',
  ],
  master: [
    'Pengguna & peran',
    'Pengaturan sistem',
    'Profil size bawaan',
    'Toko & riwayat impor/laporan tersimpan',
    'COA, periode akuntansi, template faktur & struk',
    'Log Aktivitas',
  ],
  total: [
    'Akun Admin utama',
    'Peran & matriks hak akses',
    'Pengaturan sistem (dikembalikan ke bawaan)',
    'COA, periode akuntansi, kas/bank, kategori biaya',
    'Profil size bawaan, template faktur & struk',
    'Susunan kartu dashboard',
  ],
};

/** Id akun Admin utama: peran Administrator/Owner terlama (fallback: terlama). */
export async function adminUtamaId(): Promise<number | null> {
  const dariPeran = await get<{ id: number }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(r.nama) IN ('administrator', 'owner', 'admin')
      ORDER BY u.id LIMIT 1`,
  );
  if (dariPeran) return Number(dariPeran.id);
  const terlama = await get<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1');
  return terlama ? Number(terlama.id) : null;
}

export async  function modulUntuk(jenis: JenisReset): Promise<ModulReset[]> {
  if (jenis === 'transaksi') return [...MODUL_TRANSAKSI, MODUL_NOMOR_TRANSAKSI];
  if (jenis === 'master') return [...MODUL_TRANSAKSI, ...MODUL_MASTER, MODUL_NOMOR_TRANSAKSI];
  return [...MODUL_TRANSAKSI, ...MODUL_MASTER, ...modulTotal(await adminUtamaId())];
}

async function jumlahSasaran(s: Sasaran): Promise<number> {
  try {
    const n = await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "${s.tabel}"${s.saring ? ` WHERE ${s.saring}` : ''}`,
    );
    return Number(n?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface BarisRingkasan {
  kode: string;
  label: string;
  jumlah: number;
}

export interface RingkasanReset {
  jenis: JenisReset;
  label: string;
  ket: string;
  modul: BarisRingkasan[];
  total: number;
  dipertahankan: string[];
}

/** Langkah 1 — ringkasan jumlah data yang akan dihapus per modul. */
export async  function ringkasanReset(jenis: JenisReset): Promise<RingkasanReset> {
  const info = JENIS_RESET.find((j) => j.kode === jenis);
  if (!info) throw tolak(400, 'Jenis reset tidak dikenal (transaksi / master / total).');
  const modul: BarisRingkasan[] = [];
  for (const m of await modulUntuk(jenis)) {
    let jumlah = 0;
    for (const s of m.tabel) jumlah += await jumlahSasaran(s);
    modul.push({ kode: m.kode, label: m.label, jumlah });
  }
  return {
    jenis,
    label: info.label,
    ket: info.ket,
    modul,
    total: modul.reduce((a, m) => a + m.jumlah, 0),
    dipertahankan: DIPERTAHANKAN[jenis],
  };
}

/* ------------------------------ penghapusan ------------------------------ */

/** Pesan galat SQL yang informatif (kode PG + pesan asli). */
function pesanGalat(e: unknown): string {
  const kode = (e as { code?: string } | null)?.code;
  const pesan = e instanceof Error ? e.message : String(e);
  return kode ? `${kode} ${pesan}` : pesan;
}

/** Hasil satu statement best-effort di dalam SAVEPOINT. */
type HasilHapus = { ok: true; changes: number } | { ok: false; galat: string };

/**
 * Jalankan SATU statement pembersihan di dalam savepoint (withTransaction
 * bersarang). Statement yang gagal hanya membatalkan savepoint-nya sendiri —
 * transaksi induk tetap sehat, sehingga sisa proses reset bisa lanjut dan
 * kegagalannya dilaporkan dengan pesan asli PostgreSQL.
 */
async function dalamSavepoint<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; hasil: T } | { ok: false; galat: string }> {
  try {
    return { ok: true, hasil: await withTransaction(fn) };
  } catch (e) {
    return { ok: false, galat: pesanGalat(e) };
  }
}

/** Buka kunci pemicu jurnal: baris disahkan diubah ke `batal` dulu (diizinkan
 * pemicu "terkunci"), baru baris jurnal & barisnya boleh dihapus. */
async function bukaKunciJurnal(): Promise<void> {
  const h = await dalamSavepoint(() => run(`UPDATE journals SET status = 'batal' WHERE status = 'disahkan'`));
  if (!h.ok) throw tolak(500, `Gagal membuka kunci jurnal: ${h.galat}`, true);
}

/**
 * Lepas rujukan gudang pada tabel yang dipertahankan (toko & riwayat Proses
 * Tahunan) sebelum gudang dihapus pada pilihan master/total.
 */
async function lepasRujukanGudang(): Promise<void> {
  for (const [tabel, kolom] of [
    ['stores', 'warehouse_id'],
    ['annual_processes', 'gudang_id'],
  ] as const) {
    const hasil = await dalamSavepoint(() =>
      run(`UPDATE "${tabel}" SET "${kolom}" = NULL WHERE "${kolom}" IS NOT NULL`),
    );
    if (!hasil.ok) {
      throw tolak(500, `Gagal melepas rujukan gudang pada ${tabel}: ${hasil.galat}`, true);
    }
  }
}

/**
 * Lepas rujukan ke pengguna yang akan dihapus dari tabel yang dipertahankan:
 * kolom yang boleh kosong di-set NULL, kolom NOT NULL (mis. preferensi
 * dashboard) barisnya ikut dihapus. Dilakukan sebelum baris pengguna dihapus.
 */
async function lepasRujukanUser(idHapus: number[]): Promise<void> {
  if (!idHapus.length) return;
  const daftar = idHapus.map(() => '?').join(',');
  const tabel = (await all<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  )).map((r) => r.name);
  for (const t of tabel) {
    // Kolom tabel ini yang merujuk ke users(id) — via information_schema.
    const fks = await all<{ dari: string }>(
      `SELECT kcu.column_name AS dari
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND tc.table_name = ? AND ccu.table_name = 'users'`,
      t,
    );
    for (const fk of fks) {
      try {
        const kolom = (await all<{ nama: string; wajib: boolean }>(
          `SELECT column_name AS nama, (is_nullable = 'NO') AS wajib
             FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
          t,
        )).find((c) => c.nama === fk.dari);
        // Savepoint: kolom NOT NULL yang masih dirujuk tidak boleh meng-abort
        // transaksi reset — baris pengguna yang gagal dilepas dilaporkan lewat
        // kegagalan DELETE users (dengan pesan kunci asing aslinya).
        await dalamSavepoint(() =>
          kolom && kolom.wajib
            ? run(`DELETE FROM "${t}" WHERE "${fk.dari}" IN (${daftar})`, ...idHapus)
            : run(`UPDATE "${t}" SET "${fk.dari}" = NULL WHERE "${fk.dari}" IN (${daftar})`, ...idHapus),
        );
      } catch {
        /* relasi tidak relevan — dilewati, transaksi tetap atomik */
      }
    }
  }
}

/**
 * Pengaturan kembali ke bawaan = baris `settings` seperti keadaan awal hasil
 * migrasi (seed 002/008/012/017/022). Kunci yang tidak pernah di-seed dihapus
 * saja — pembaca tab Pengaturan jatuh ke nilai bawaan registry.
 *
 * Dua kunci wajib ikut dikembalikan supaya aplikasi tetap jalan setelah reset:
 * `pin_supervisor` (verifikasi ulang kata sandi & PIN void/retur) dan
 * `akuntansi_pemetaan` (semua kode jurnal otomatis).
 */
const PENGATURAN_BAWAAN: { kunci: string; nilai: string; keterangan: string }[] = [
  { kunci: 'stok_minus_izinkan', nilai: 'false', keterangan: 'Izinkan stok menjadi minus jika stok fisik kurang' },
  { kunci: 'pajak_persen', nilai: '0', keterangan: 'Persentase pajak penjualan (PPN) bawaan' },
  { kunci: 'mata_uang', nilai: 'IDR', keterangan: 'Mata uang aplikasi (Rupiah)' },
  { kunci: 'format_tanggal', nilai: 'dd/mm/yyyy', keterangan: 'Format tanggal tampilan aplikasi' },
  { kunci: 'nama_usaha', nilai: 'Toko Retail', keterangan: 'Nama usaha/cabang pada dokumen dan struk' },
  {
    kunci: 'pin_supervisor',
    // SHA-256 dari '1234' (bawaan) — dipakai verifikasi ulang kata sandi.
    nilai: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    keterangan: 'PIN supervisor void/retur (SHA-256; bawaan 1234)',
  },
  { kunci: 'faktur_prefix_penjualan', nilai: 'INV', keterangan: 'Prefix nomor faktur penjualan (mis. INV-2026-0001)' },
  { kunci: 'faktur_prefix_pembelian', nilai: 'PB', keterangan: 'Prefix nomor faktur pembelian (mis. PB-2026-0001)' },
  { kunci: 'alamat_usaha', nilai: '', keterangan: 'Alamat toko pada faktur & dokumen' },
  { kunci: 'telepon_usaha', nilai: '', keterangan: 'Telepon toko pada faktur & dokumen' },
  { kunci: 'logo_usaha', nilai: '', keterangan: 'URL/logo toko pada faktur (opsional)' },
  {
    kunci: 'size_profile_default',
    nilai: 'sepatu-pria',
    keterangan: 'Profil size default barang (kode profil)',
  },
  {
    kunci: 'akuntansi_pemetaan',
    nilai:
      '{"peran":{"kas_kasir":"1-1100","kas_besar":"1-1110","bank":"1-1200","kas_dalam_penyelesaian":"1-1210","piutang":"1-1300","persediaan":"1-1400","ppn_masukan":"1-1500","uang_muka_pembelian":"1-1600","hutang_usaha":"2-1100","ppn_keluaran":"2-1200","uang_muka_pelanggan":"2-1400","laba_ditahan":"3-3000","penjualan":"4-1100","diskon_penjualan":"4-1200","retur_penjualan":"4-1300","pendapatan_lain":"4-2000","selisih_stok_lebih":"4-2100","hpp":"5-1000","diskon_pembelian":"5-2000","selisih_stok_kurang":"6-1900","selisih_kas":"6-1950","beban_admin_bank":"6-1700"},"metode":{"tunai":"kas_kasir","transfer":"bank","qris":"kas_dalam_penyelesaian","kredit":"piutang"}}',
    keterangan: 'Pemetaan peran akun otomatis & metode bayar → kode akun COA',
  },
  {
    kunci: 'akuntansi_ppn',
    nilai: '{"aktif":false,"tarif":11,"harga_termasuk":false}',
    keterangan: 'Pengaturan PPN: aktif (PKP), tarif %, harga sudah termasuk PPN',
  },
];

async function kembalikanPengaturanBawaan(): Promise<number> {
  const h = await dalamSavepoint(async () => {
    const sebelum = await jumlahSasaran({ tabel: 'settings' });
    await run('DELETE FROM settings');
    for (const p of PENGATURAN_BAWAAN) {
      await run(
        'INSERT INTO settings (kunci, nilai, keterangan) VALUES (?, ?, ?)',
        p.kunci,
        p.nilai,
        p.keterangan,
      );
    }
    return sebelum;
  });
  if (!h.ok) throw tolak(500, `Gagal mengembalikan pengaturan bawaan: ${h.galat}`, true);
  return h.hasil;
}

/**
 * Setelah master dihapus, rujukan pengaturan yang menggantung (gudang/satuan/
 * profil size yang sudah tidak ada) dikembalikan ke bawaan supaya tidak
 * menunjuk data yang sudah tidak ada.
 */
async function bersihkanRujukanMaster(): Promise<void> {
  const hilang = async (kunci: string, cek: (nilai: string) => boolean | Promise<boolean>): Promise<void> => {
    // Savepoint: kegagalan satu pembersihan rujukan tidak boleh meng-abort
    // transaksi reset (nolkanStok & audit setelahnya akan ikut gagal).
    await dalamSavepoint(async () => {
      const nilai = (await get<{ nilai: string | null }>('SELECT nilai FROM settings WHERE kunci = ?', kunci))
        ?.nilai;
      if (nilai && !(await cek(nilai))) await run('DELETE FROM settings WHERE kunci = ?', kunci);
      return true;
    });
  };
  await hilang('gudang_bawaan', async (v) => Boolean((await get('SELECT id FROM warehouses WHERE id = ?', v))));
  await hilang('peng.umum-regional.satuan_bawaan', async (v) =>
    Boolean((await get('SELECT id FROM units WHERE id = ?', v))),
  );
  await hilang('size_profile_default', async (v) => Boolean((await get('SELECT id FROM size_profiles WHERE kode = ?', v))));
}

/* -------------------------------- hasil ---------------------------------- */

export interface HasilReset {
  jenis: JenisReset;
  label: string;
  waktu: string;
  modul: BarisRingkasan[];
  total: number;
  nomor_urut: number;
  /** Jumlah sequence PRIMARY KEY yang dikembalikan ke 1. */
  urutan_direset: number;
  pengguna_dihapus: number;
  pengguna_dipertahankan: number;
  pengaturan: number;
  log_dihapus: number;
  cadangan_pengaman: string;
  dipertahankan: string[];
  dilewati: string[];
}

/**
 * Jalankan reset. Seluruh tahap berjalan dalam SATU transaksi: gagal di tengah
 * berarti tidak ada data yang hilang. Cadangan pengaman dibuat di luar
 * transaksi (pg_dump memakai koneksinya sendiri) sehingga selalu ada
 * untuk fitur "Pulihkan dari Backup".
 */
export async function jalankanReset(jenis: JenisReset, userId: number | null, peran: string): Promise<HasilReset> {
  const info = JENIS_RESET.find((j) => j.kode === jenis);
  if (!info) throw tolak(400, 'Jenis reset tidak dikenal (transaksi / master / total).');

  const adminId = await adminUtamaId();
  const daftarModul = await modulUntuk(jenis);
  const dihitung: BarisRingkasan[] = [];
  for (const m of daftarModul) {
    let jumlah = 0;
    for (const s of m.tabel) jumlah += await jumlahSasaran(s);
    dihitung.push({ kode: m.kode, label: m.label, jumlah });
  }
  const total = dihitung.reduce((a, m) => a + m.jumlah, 0);
  const jumlahModul = (kode: string): number => dihitung.find((m) => m.kode === kode)?.jumlah ?? 0;

  // Cadangan pengaman — dibuat sebelum satu baris pun dihapus.
  const cadangan = await buatBackup(`sebelum ${info.label}`);

  const hasilReset = await withTransaction(async () => {
    // PostgreSQL memeriksa kunci asing langsung per statement: urutan
    // detail → induk di bawah tetap dijalankan agar kunci asing maupun
    // pemicu penghapusan tidak menolak statement.

    const dilewati: string[] = [];
    let nomorUrut = 0;
    let penggunaHapus = 0;
    let pengaturan = 0;
    /** Statement yang gagal pada putaran pertama — dicoba ulang sesudahnya. */
    let gagal: GagalHapus[] = [];
    /** Tabel yang benar-benar kosong — aman untuk RESTART identitas. */
    const kosong = new Set<string>();

    // Tabel yang benar-benar ada di database ini. Modul yang menyebut tabel
    // dari migrasi yang belum diterapkan (mis. PO di salinan uji lama) dilewati
    // diam-diam — bukan dicatat sebagai kegagalan reset.
    const ada = new Set(
      (
        await all<{ name: string }>(
          `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
        )
      ).map((r) => r.name),
    );

    const hapusDaftar = async (label: string, sasaran: Sasaran[]): Promise<number> => {
      let jumlah = 0;
      for (const s of sasaran) {
        if (!ada.has(s.tabel)) continue;
        const h = await hapusSatu(s);
        if (h.ok) {
          jumlah += h.changes;
          if (!s.saring) kosong.add(s.tabel);
        } else {
          gagal.push({ label, sasaran: s, galat: h.galat });
        }
      }
      return jumlah;
    };

    for (const m of daftarModul) {
      if (m.khusus === 'pengaturan') {
        pengaturan = await kembalikanPengaturanBawaan();
        continue;
      }
      if (m.khusus === 'pengguna') {
        if (adminId !== null) {
          const lain = (await all<{ id: number }>('SELECT id FROM users WHERE id <> ?', adminId)).map((r) =>
            Number(r.id),
          );
          await lepasRujukanUser(lain);
        }
        penggunaHapus = await hapusDaftar(m.label, m.tabel);
        continue;
      }
      if (m.khusus === 'nomor_urut') {
        nomorUrut = await hapusDaftar(m.label, m.tabel);
        continue;
      }
      if (m.kode === 'jurnal') await bukaKunciJurnal();
      if (m.kode === 'gudang') await lepasRujukanGudang();
      await hapusDaftar(m.label, m.tabel);
    }

    // Putaran ulang: baris yang tadi masih dirujuk anak (mis. produk yang masih
    // punya saldo stok) dicoba lagi setelah modul berikutnya bersih. Karena
    // tiap statement berjalan di savepoint, transaksi tetap sehat dan putaran
    // ini benar-benar dieksekusi — bukan sekadar melempar galat.
    for (let putaran = 0; gagal.length && putaran < 8;) {
      const masih: GagalHapus[] = [];
      for (const g of gagal) {
        const h = await hapusSatu(g.sasaran);
        if (h.ok) {
          if (!g.sasaran.saring) kosong.add(g.sasaran.tabel);
        } else {
          masih.push({ ...g, galat: h.galat });
        }
      }
      if (masih.length === gagal.length) break; // tidak ada kemajuan
      gagal = masih;
      putaran++;
    }
    for (const g of gagal) {
      dilewati.push(`Gagal mengosongkan ${g.label} (${g.sasaran.tabel}): ${g.galat}`);
    }

    // Tabel inti master yang gagal dikosongkan berarti reset tidak sah: laporkan
    // penyebab aslinya (kunci asing) alih-alih "terjadi masalah pada server".
    const kritis = gagal.filter((g) => TABEL_KRITIS_MASTER.has(g.sasaran.tabel));
    if (jenis !== 'transaksi' && kritis.length) {
      throw tolak(
        500,
        `Gagal mengosongkan master data: ${kritis
          .map((g) => `${g.sasaran.tabel} — ${g.galat}`)
          .join('; ')}`,
        true,
      );
    }

    if (jenis === 'master') await bersihkanRujukanMaster();
    if (jenis === 'total') await sapuTabelLain(dilewati, kosong);

    // Nomor urut PRIMARY KEY kembali ke 1 untuk tabel yang benar-benar kosong
    // (nomor dokumen sendiri sudah lewat `document_counters`).
    const urutanDireset = await resetUrutanIdentitas(kosong);

    // Kebijakan No Retain: stok fisik, nilai persediaan, dan kartu stok
    // dipastikan 0 setelah pembersihan (Master Barang tetap utuh).
    await nolkanStok();

    // Log Aktivitas: reset dicatat setelah pembersihan — pada Reset Total
    // inilah satu-satunya (dan yang paling penting) baris log yang tersisa.
    await catatAudit({
      userId,
      aksi: 'reset',
      tabel: 'pengaturan',
      recordId: jenis,
      sesudah: {
        jenis: info.label,
        peran,
        total_dihapus: total,
        modul: Object.fromEntries(dihitung.map((m) => [m.kode, m.jumlah])),
        nomor_urut: nomorUrut,
        urutan_direset: urutanDireset,
        cadangan_pengaman: cadangan,
        dilewati,
      },
      alasan: `Reset Data — ${info.label}`,
    });

    return {
      jenis,
      label: info.label,
      waktu: new Date().toISOString(),
      modul: dihitung,
      total,
      nomor_urut: nomorUrut,
      urutan_direset: urutanDireset,
      pengguna_dihapus: penggunaHapus,
      pengguna_dipertahankan: Number(
        await ((await get<{ n: number }>('SELECT COUNT(*) AS n FROM users')))?.n ?? 0,
      ),
      pengaturan,
      log_dihapus: jumlahModul('log_aktivitas'),
      cadangan_pengaman: cadangan,
      dipertahankan: DIPERTAHANKAN[jenis],
      dilewati,
    } satisfies HasilReset;
  });

  // Invalidation cache server SETELAH commit: laporan agregat (TTL 60 dtk) dan
  // indeks pencocokan produk/pemasok. Tanpa ini, layar bisa masih menampilkan
  // hasil pra-reset walau data sudah dibersihkan.
  bersihCacheLaporan();
  kosongkanIndeksCocok();

  return hasilReset;
}

/** Hapus satu sasaran di dalam savepoint (tidak meng-abort transaksi reset). */
async function hapusSatu(s: Sasaran): Promise<HasilHapus> {
  const h = await dalamSavepoint(() =>
    run(`DELETE FROM "${s.tabel}"${s.saring ? ` WHERE ${s.saring}` : ''}`),
  );
  return h.ok ? { ok: true, changes: h.hasil.changes } : h;
}

/**
 * Kembalikan nomor urut PRIMARY KEY (identity/serial) ke 1 untuk tabel yang
 * benar-benar sudah kosong. Tabel yang masih menyimpan baris (mis. `users`
 * dengan Admin utama, `size_profiles`, counter bertanda saring) TIDAK ikut
 * direset agar tidak bentrok dengan id yang sudah ada.
 *
 * Hanya berjalan di PostgreSQL: `pg_get_serial_sequence` mengenali identity
 * (`BIGINT GENERATED BY DEFAULT AS IDENTITY`) maupun serial.
 */
async function resetUrutanIdentitas(kosong: Set<string>): Promise<number> {
  let jumlah = 0;
  for (const tabel of kosong) {
    if (TABEL_DIPERTAHANKAN.has(tabel)) continue;
    // Seluruh langkah (baca nama sequence + ALTER) di satu savepoint: kegagalan
    // satu tabel tidak boleh meng-abort transaksi reset.
    const h = await dalamSavepoint(async () => {
      const urut = (
        await get<{ seq: string | null }>('SELECT pg_get_serial_sequence(?, ?) AS seq', `public.${tabel}`, 'id')
      )?.seq;
      if (!urut) return false; // tabel tanpa kolom id ber-sequence
      await run(`ALTER SEQUENCE ${urut} RESTART WITH 1`);
      return true;
    });
    if (h.ok && h.hasil) jumlah++;
  }
  return jumlah;
}

/**
 * Sapu tabel yang tidak termasuk daftar mana pun (termasuk tabel baru hasil
 * migrasi mendatang) supaya Reset Total benar-benar menyisakan "data kosong".
 * Kegagalan satu tabel dicatat sebagai `dilewati` — tidak membatalkan reset.
 */
async function sapuTabelLain(dilewati: string[], kosong: Set<string>): Promise<void> {
  const dipertahankan = new Set(TABEL_DIPERTAHANKAN);
  const dipakai = new Set(
    [...MODUL_TRANSAKSI, ...MODUL_MASTER, ...modulTotal(await adminUtamaId())].flatMap((m) =>
      m.tabel.map((s) => s.tabel),
    ),
  );
  const semua = (await all<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY name`,
  )).map((r) => r.name);
  // PostgreSQL memeriksa kunci asing langsung per statement (tanpa penundaan
  // PRAGMA seperti SQLite), jadi tabel dihapus berputar-putar: yang gagal
  // karena masih dirujuk dicoba lagi setelah tabel anaknya terkosongkan.
  let sisa = semua.filter((t) => !dipertahankan.has(t) && !dipakai.has(t));
  const galatAkhir = new Map<string, string>();
  for (let putaran = 0; sisa.length && putaran < 20; putaran++) {
    const gagal: string[] = [];
    for (const t of sisa) {
      // Savepoint WAJIB: tanpa itu satu FK yang masih dirujuk meng-abort
      // seluruh transaksi dan putaran berikutnya tidak pernah berjalan.
      const h = await dalamSavepoint(() => run(`DELETE FROM "${t}"`));
      if (h.ok) kosong.add(t);
      else {
        gagal.push(t);
        galatAkhir.set(t, h.galat);
      }
    }
    if (gagal.length === sisa.length) break; // tidak ada kemajuan — sisanya dilewati
    sisa = gagal;
  }
  for (const t of sisa) dilewati.push(`Gagal mengosongkan ${t}: ${galatAkhir.get(t) ?? 'gagal'}`);
}
