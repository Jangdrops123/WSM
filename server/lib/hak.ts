// ============================================================================
// HAK AKSES — SATU KEBENARAN MATRIKS PERAN (BAGIAN AX)
// ============================================================================
// Satu-satunya penentu hak akses adalah matriks peran di database
// (role_permissions: modul × {lihat, tambah, ubah, hapus, sahkan, impor,
// ekspor, cetak}). TIDAK ada kode izin tambahan (terima/batal/batal_disahkan/
// sahkan sbg kode terpisah), TIDAK ada pemeriksaan nama peran di kode —
// kecuali satu penanda Owner/Admin tertinggi (req.konteks.admin) yang selalu
// lolos pemeriksaan izin (tetap tunduk pada keadaan dokumen & periode).
//
// PETA AKSI → SEL (AX2, tetap, satu tempat):
//   Lihat  : daftar, detail, riwayat, kartu stok, pop up detail.
//   Tambah : dokumen baru (draft), salin ke draft baru, transaksi baru
//            (POS, Item Masuk/Keluar, retur), kas masuk/keluar, pelunasan.
//   Ubah   : ubah draft/dokumen belum final; langkah operasional tanpa
//            posting finansial — Terima barang (GRN), tahan & lanjutkan,
//            Transfer dikirim & diterima, "Kembali Hitung"/hitung/scan/
//            selesai/buka sesi Opname; edit data master; set-aktif massal.
//   Hapus  : batalkan/hapus (soft) dokumen: Batal draft atau GRN, Void;
//            hapus data master; hapus massal.
//   Sahkan : langkah yang memposting stok & jurnal — mengesahkan Faktur
//            Pembelian, mengesahkan Opname, menyetujui retur, pelunasan
//            hutang/piutang, posting jurnal.
//   Impor / Ekspor / Cetak : sesuai namanya (cetak termasuk simpan PDF &
//            kirim WhatsApp).
//   Aksi gabungan "Batal & Pulihkan" pada dokumen yang sudah disahkan
//   membutuhkan Hapus DAN Sahkan (membalik posting stok & jurnal).
// ============================================================================
import type { Request, RequestHandler } from 'express';
import { all, get } from '../db.pg.ts';
import { idGudangDiizinkan } from './aksesGudang.ts';
import { tolak } from './http.ts';

/** Delapan sel matriks — satu-satunya kode aksi yang sah. */
export type AksiIzin = 'lihat' | 'tambah' | 'ubah' | 'hapus' | 'sahkan' | 'impor' | 'ekspor' | 'cetak';

export const AKSI_MATRIKS: readonly AksiIzin[] = [
  'lihat',
  'tambah',
  'ubah',
  'hapus',
  'sahkan',
  'impor',
  'ekspor',
  'cetak',
];

export const LABEL_AKSI: Record<AksiIzin, string> = {
  lihat: 'Lihat',
  tambah: 'Tambah',
  ubah: 'Ubah',
  hapus: 'Hapus',
  sahkan: 'Sahkan',
  impor: 'Impor',
  ekspor: 'Ekspor',
  cetak: 'Cetak',
};

export const LABEL_MODUL: Record<string, string> = {
  dashboard: 'Dashboard',
  'pos-kasir': 'POS Kasir',
  penjualan: 'Penjualan',
  pembelian: 'Pembelian',
  'purchase-order': 'Purchase Order (PO)',
  'persediaan-daftar': 'Persediaan',
  'persediaan-sub': 'Item Masuk/Keluar',
  'persediaan-opname': 'Opname',
  opname: 'Opname',
  stok: 'Stok',
  pelanggan: 'Pelanggan',
  pemasok: 'Pemasok',
  produk: 'Produk',
  kategori: 'Kategori',
  satuan: 'Satuan',
  merek: 'Merek',
  profil: 'Profil Ukuran',
  toko: 'Toko',
  gudang: 'Gudang',
  pengguna: 'Pengguna',
  peran: 'Peran',
  laporan: 'Laporan',
  akuntansi: 'Akuntansi',
  pengaturan: 'Pengaturan',
  'proses-tahunan': 'Proses Tahunan',
  'produk-umum': 'Master Umum',
  'produk-paket': 'Paket',
  master: 'Master Data',
};

/** Keterangan kolom matriks (AX2) — dipakai sebagai tooltip judul kolom. */
export const TOOLTIP_KOLOM: Record<AksiIzin, string> = {
  lihat: 'Melihat daftar, detail, riwayat, kartu stok, dan pop up detail.',
  tambah: 'Membuat dokumen baru (draft), menyalin ke draft baru, transaksi baru (POS, Item Masuk/Keluar, retur).',
  ubah: 'Mengubah draft atau dokumen belum final; langkah operasional: Terima barang (GRN), tahan & lanjutkan, Transfer dikirim & diterima, hitung/scan/selesai sesi Opname; edit data master.',
  hapus: 'Membatalkan atau menghapus (soft) dokumen: Batal draft atau GRN, Void; hapus data master; hapus massal.',
  sahkan: 'Langkah yang memposting stok & jurnal: mengesahkan Faktur Pembelian, mengesahkan Opname, menyetujui retur, pelunasan hutang/piutang.',
  impor: 'Impor data dari Excel.',
  ekspor: 'Ekspor data ke Excel/PDF.',
  cetak: 'Cetak dokumen, simpan PDF, kirim WhatsApp.',
};

/** Satu baris legenda di bawah matriks (AX2). */
export const LEGENDA_MATRIKS =
  'Ubah mencakup Terima barang (GRN) & kirim/terima Transfer • ' +
  'Hapus mencakup Batal draft/GRN & Void • ' +
  'Sahkan mencakup pengesahan faktur/opname & pelunasan • ' +
  '"Batal & Pulihkan" dokumen yang sudah disahkan butuh Hapus dan Sahkan.';

// ---------------------------------------------------------------------------
// can() — SATU-SATUNYA fungsi izin. Dipakai tombol, API, dan aksi latar.
// Top (Owner/Admin tertinggi) selalu lolos; sel yang belum dicentang = tolak.
// Izin dibaca LANGSUNG dari database setiap permintaan (tanpa cache) sehingga
// perubahan Admin berlaku pada permintaan berikutnya tanpa login ulang.
// ---------------------------------------------------------------------------
export async function can(req: Request, menu: string, aksi: string): Promise<boolean> {
  if (req.konteks?.admin === true) return true;
  const peranId = req.konteks?.roleId ?? null;
  if (peranId === null) return false;
  if (!AKSI_MATRIKS.includes(aksi as AksiIzin)) return false;
  const baris = await get<{ id: number }>(
    'SELECT id FROM role_permissions WHERE role_id = ? AND menu = ? AND aksi = ?',
    peranId,
    menu,
    aksi,
  );
  return Boolean(baris);
}

function namaPeran(req: Request): string {
  return req.konteks?.roleNama ?? 'Pengguna';
}

function labelModul(menu: string): string {
  return LABEL_MODUL[menu] ?? menu;
}

/** Frasa "dibutuhkan untuk …" dari kata kunci path (kosakata operasional). */
const BUTUH_UNTUK: [RegExp, string][] = [
  [/terima/, 'Terima barang'],
  [/sahkan|setuju/, 'Mengesahkan dokumen'],
  [/pulih/, 'Batal & Pulihkan dokumen'],
  [/batal/, 'Membatalkan dokumen'],
  [/void/, 'Void transaksi'],
  [/retur/, 'mencatat retur'],
  [/kirim/, 'mengirim Transfer'],
  [/hitung|scan|selesai|buka sesi/, 'mencatat hasil Opname'],
  [/salin|duplikat/, 'menyalin dokumen'],
  [/bayar|lunas/, 'pelunasan'],
  [/hapus/, 'Menghapus data'],
  [/impor/, 'impor Excel'],
  [/ekspor|unduh/, 'ekspor data'],
  [/cetak|print|whatsapp/, 'mencetak dokumen'],
  [/tambah|baru/, 'membuat dokumen baru'],
  [/ubah|edit/, 'mengubah data'],
];

function operasiDariPath(path: string, aksi: AksiIzin): string {
  const p = path.toLowerCase();
  for (const [pola, frasa] of BUTUH_UNTUK) if (pola.test(p)) return frasa;
  return `melakukan aksi '${LABEL_AKSI[aksi]}'`;
}

/**
 * Penolakan memakai kosakata matriks (AX4). Satu sel:
 * "Peran Operator belum memiliki izin 'Ubah' pada Pembelian (dibutuhkan untuk
 * Terima barang). Admin dapat mengaktifkannya di Pengaturan > Pengguna & Hak
 * Akses > Peran."
 */
export async function tolakMatriks(req: Request, menu: string, sel: AksiIzin | AksiIzin[], path = ''): Promise<never> {
  const daftar = Array.isArray(sel) ? sel : [sel];
  const modul = labelModul(menu);
  if (daftar.length > 1) {
    const kurang: string[] = [];
    for (const s of daftar) {
      if (!(await can(req, menu, s))) kurang.push(`'${LABEL_AKSI[s]}'`);
    }
    throw tolak(
      403,
      `Dibutuhkan izin ${daftar.map((s) => `'${LABEL_AKSI[s]}'`).join(' dan ')} pada ${modul}; ` +
        `peran Anda belum memiliki ${kurang.join(' dan ') || 'izin tersebut'}.`,
    );
  }
  const aksi = daftar[0];
  throw tolak(
    403,
    `Peran ${namaPeran(req)} belum memiliki izin '${LABEL_AKSI[aksi]}' pada ${modul} ` +
      `(dibutuhkan untuk ${operasiDariPath(path, aksi)}). ` +
      `Admin dapat mengaktifkannya di Pengaturan > Pengguna & Hak Akses > Peran.`,
  );
}

/**
 * Token Edit/Batal transaksi: Administrator ATAU peran yang diberi Hak Khusus
 * "Hapus transaksi" (Pengaturan ▸ Pengguna & Hak Akses ▸ Hak Khusus).
 * Matriks modul tetap dicek terpisah lewat wajibSel().
 */
export function bolehKelolaTransaksi(req: Request): boolean {
  const k = req.konteks;
  return k?.admin === true || k?.khusus.hapus_transaksi === true;
}

/** Wajib bolehKelolaTransaksi — melempar 403 dengan pesan yang jelas. */
export function wajibKelolaTransaksi(req: Request, aksi: 'edit' | 'batal' = 'edit'): void {
  if (bolehKelolaTransaksi(req)) return;
  throw tolak(
    403,
    `Peran ${namaPeran(req)} belum memiliki Hak Khusus "Hapus transaksi" yang dibutuhkan untuk ` +
      `${aksi === 'edit' ? 'mengubah' : 'membatalkan'} transaksi. ` +
      'Admin dapat mengaktifkannya di Pengaturan > Pengguna & Hak Akses > Hak Khusus.',
  );
}

/**
 * Wajibkan satu/lebih sel matriks — melempar 403 kosakata matriks bila kurang.
 * Untuk aksi gabungan (mis. Batal & Pulihkan): wajibSel(req, 'pembelian',
 * 'hapus', 'sahkan').
 */
export async function wajibSel(req: Request, menu: string, ...sel: AksiIzin[]): Promise<void> {
  if (req.konteks?.admin === true) return;
  for (const s of sel) {
    if (!(await can(req, menu, s))) await tolakMatriks(req, menu, sel, (req.path ?? '') as string);
  }
}

// ---------------------------------------------------------------------------
// Pemetaan rute → (menu, aksi). Satu tempat, mengikuti PETA AX2.
// ---------------------------------------------------------------------------
type AturanAksi = { pola: RegExp; aksi: AksiIzin };

const ATURAN_AKSI: AturanAksi[] = [
  { pola: /cetak|print|whatsapp|kirim-wa/, aksi: 'cetak' },
  { pola: /ekspor|export|unduh|download|backup|xlsx?/, aksi: 'ekspor' },
  { pola: /impor|import|upload/, aksi: 'impor' },
  { pola: /hapus|void|batal/, aksi: 'hapus' },
  // Pelunasan hutang/piutang menggerakkan kas (posting finansial) = Sahkan.
  { pola: /sahkan|setuju|posting|bayar|lunas/, aksi: 'sahkan' },
  { pola: /terima|kirim|hitung|scan|selesai|\/buka|lanjut|tahan|saldo-awal|aktif|nonaktif/, aksi: 'ubah' },
];

export function aksiDariRute(path: string, method: string): AksiIzin {
  const p = path.toLowerCase();
  for (const a of ATURAN_AKSI) if (a.pola.test(p)) return a.aksi;
  switch (method.toUpperCase()) {
    case 'POST':
      return 'tambah';
    case 'PUT':
    case 'PATCH':
      return 'ubah';
    case 'DELETE':
      return 'hapus';
    default:
      return 'lihat';
  }
}

const PETA_MODUL: { prefix: string; menu: string[] }[] = [
  { prefix: '/pembelian', menu: ['pembelian'] },
  // /po sengaja TIDAK dipetakan di sini: izin modul PO diperiksa di routerPo()
  // (sel Lihat) + wajibSel per aksi di tiap handler, karena aksi tulis PO
  // (kirim/terima/tutup/status) tidak bisa disimpulkan dari pola path.
  { prefix: '/opname', menu: ['opname'] },
  { prefix: '/persediaan', menu: ['persediaan-daftar', 'persediaan-sub'] },
  { prefix: '/stock/transfer', menu: ['stok'] },
  { prefix: '/stock', menu: ['stok'] },
  { prefix: '/stok', menu: ['stok'] },
  { prefix: '/pos/retur', menu: ['penjualan'] },
  { prefix: '/pos/void', menu: ['penjualan'] },
  { prefix: '/pos', menu: ['penjualan', 'pos-kasir'] },
  { prefix: '/penjualan', menu: ['penjualan'] },
  { prefix: '/akuntansi', menu: ['akuntansi'] },
  { prefix: '/laporan', menu: ['laporan'] },
  { prefix: '/master', menu: ['master'] },
  { prefix: '/pelanggan', menu: ['pelanggan'] },
  { prefix: '/pemasok', menu: ['pemasok'] },
  { prefix: '/pengguna', menu: ['pengguna', 'peran'] },
  { prefix: '/tampilan', menu: ['pengaturan'] },
  { prefix: '/pengaturan', menu: ['pengaturan'] },
  { prefix: '/proses-tahunan', menu: ['proses-tahunan'] },
  { prefix: '/dashboard', menu: ['dashboard'] },
];

export function modulDariRute(path: string): string[] | null {
  const p = path.toLowerCase();
  for (const m of PETA_MODUL) if (p === m.prefix || p.startsWith(`${m.prefix}/`)) return m.menu;
  return null;
}

/**
 * Middleware matriks global. Melewatkan: Top; rute di luar peta (dijaga
 * handler/aturan sendiri); opsi preflight & berkas statik. Menolak memakai
 * kosakata matriks (403) bila tidak ada satu pun menu peta yang mengizinkan.
 */
export const wajibModul: RequestHandler = (req, _res, next) => {
  (async () => {
    if (req.konteks?.admin === true) return next();
    // Identitas publik dibaca sebelum login (layar muat & provider root) dan
    // tidak boleh bergantung pada sel matriks "Pengaturan > Lihat" — kalau
    // tidak, peran tanpa akses Pengaturan selalu jatuh ke nama/logo bawaan.
    if (req.path.toLowerCase() === '/tampilan/identitas-publik') return next();
    const menu = modulDariRute(req.path);
    if (!menu) return next();
    const aksi = aksiDariRute(req.path, req.method);
    for (const m of menu) {
      if (await can(req, m, aksi)) return next();
    }
    await tolakMatriks(req, menu[0], aksi, req.path);
  })().catch(next);
};

// ---------------------------------------------------------------------------
// Cakupan gudang — diperiksa TERPISAH dari matriks (AX3): dokumen harus
// berada di gudang yang diizinkan untuk pengguna, walau sel matriks penuh.
// ---------------------------------------------------------------------------
/**
 * Id gudang yang boleh dilihat sesi: null = semua (Top/tanpa pembatasan);
 * [] = tanpa akses. Dipetakan dari cakupan kode gudang sesi (aksesGudang).
 */
export async  function idGudangSesi(req: Request): Promise<number[] | null> {
  if (req.konteks?.admin === true) return null;
  // WI2 — gudang efektif sesi (kolom default/akses/kunci) menang bila ada;
  // cakupan kode gudang tetap menjadi cadangan untuk DB lama.
  const gudang = req.konteks?.gudang;
  if (gudang) return gudang.ids === null ? null : [...gudang.ids];
  const izin = await idGudangDiizinkan(req.konteks?.cakupanToko ?? null);
  return izin === null ? null : [...izin];
}

/** Fragmen {sql, params} untuk daftar + hitung total (kolom = alias penuh). */
export async  function syaratGudangSesi(req: Request, kolom: string): Promise<{ sql: string; params: number[] }> {
  const ids = await idGudangSesi(req);
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${kolom} IN (${ids.map(() => '?').join(', ')})`, params: ids };
}

/**
 * Klausa string untuk syarat.push(`1 = 1${auto}`) (id literal aman dari DB).
 * '' = semua; ' AND 1 = 0' = tanpa akses.
 */
export async  function klausaGudangOtomatis(req: Request, kolom: string): Promise<string> {
  const ids = await idGudangSesi(req);
  if (ids === null) return '';
  if (ids.length === 0) return ' AND 1 = 0';
  return ` AND ${kolom} IN (${ids.map((n) => Number(n)).join(', ')})`;
}

export async  function wajibGudangDiizinkan(req: Request, warehouseId: number): Promise<void> {
  if (req.konteks?.admin === true) return;
  const boleh = await idGudangSesi(req) ?? [];
  if (!boleh.includes(warehouseId)) {
    throw tolak(403, 'Dokumen ini berada di gudang yang tidak diizinkan untuk peran Anda. Minta Admin menambah cakupan gudang pengguna ini.');
  }
}

// ---------------------------------------------------------------------------
// MASKING HARGA (kebijakan privasi, bukan izin aksi — tetap dipertahankan)
// ---------------------------------------------------------------------------
export const HARGA_UTUH_TRANSAKSI = new Set(['pembelian', 'opname', 'persediaan-sub']);

export async  function samarkanHarga(req: Request, menu: string, baris: Record<string, unknown>): Promise<void> {
  if (HARGA_UTUH_TRANSAKSI.has(menu)) return;
  if (req.konteks?.admin === true) return;
  if (await can(req, menu, 'sahkan')) return;
  for (const kunci of ['harga_beli', 'harga_modal', 'nilai_persediaan', 'total_modal']) {
    if (kunci in baris) baris[kunci] = null;
  }
}

// ---------------------------------------------------------------------------
// AX6 — laporan satu kali kepada Owner: kemampuan tiap peran DARI MATRIKS.
// Dicetak ke log server saat migrasi 035 diterapkan (tanpa auto-grant).
// ---------------------------------------------------------------------------
const MODUL_LAPOR = ['pembelian', 'penjualan', 'opname', 'persediaan-sub', 'stok', 'akuntansi', 'master', 'laporan'] as const;

export async function laporanKapabilitasAX(): Promise<string[]> {
  const keluar: string[] = [];
  const peran = await all<{ id: number; nama: string }>('SELECT id, nama FROM roles ORDER BY id');
  const sel = async (roleId: number, menu: string, aksi: string): Promise<boolean> =>
    Boolean(
      (await get('SELECT id FROM role_permissions WHERE role_id = ? AND menu = ? AND aksi = ?', roleId, menu, aksi)),
    );
  for (const p of peran) {
    const bisa: string[] = [];
    for (const m of MODUL_LAPOR) {
      const s: string[] = [];
      for (const a of AKSI_MATRIKS) {
        if (await sel(p.id, m, a)) s.push(LABEL_AKSI[a]);
      }
      if (s.length > 0) bisa.push(`${LABEL_MODUL[m] ?? m}: ${s.join(', ')}`);
    }
    keluar.push(`Peran ${p.nama} sekarang dapat: ${bisa.length ? bisa.join(' • ') : '(tidak ada)'}`);
  }
  return keluar;
}
