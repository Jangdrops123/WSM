// Uji integrasi Reset Data (28):
//   - ringkasan per modul, guard Admin utama, konfirmasi RESET + kata sandi
//   - urutan hapus detail → induk (pemicu tetap dihormati)
//   - nomor urut dokumen kembali ke awal sesuai pilihan
//   - pengaturan & pengguna tetap (transaksi/master) vs kembali bawaan (total)
//   - log aktivitas tercatat, cadangan pengaman dibuat & bisa dipulihkan
//
// Jalankan pada DATABASE & PORT TERPISAH supaya data dev tidak tersentuh:
//   TEST_DATABASE_URL=postgresql://nusa:sandi@127.0.0.1:5432/nusapos_uji API_PORT=3017 npx tsx server/index.ts   (terminal 1)
//   DATABASE_URL=<sama dengan TEST_DATABASE_URL> BASE=http://127.0.0.1:3017 npx tsx scripts/uji-reset-data.ts (terminal 2)
//
// Skrip menolak berjalan bila DATABASE_URL menunjuk database produksi (`nusapos`).
import { all, get, pool, run } from '../server/db.pg.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pulihkanBackup } from '../server/lib/sistem.ts';
import { jalankanReset, type JenisReset } from '../server/lib/resetData.ts';
import { headerUji } from './sesi-uji.mjs';

const API_PORT = process.env.API_PORT ?? '3017';
const BASE = process.env.BASE ?? `http://127.0.0.1:${API_PORT}`;
const USERNAME = process.env.UJI_USERNAME ?? 'admin';
const SANDI = process.env.UJI_SANDI ?? 'admin123';

/* Pengaman: jangan pernah reset database produksi dari skrip uji. */
{
  const url = process.env.DATABASE_URL ?? '';
  const namaDb = (/\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? '').toLowerCase();
  if (!namaDb || /(^|_)nusapos$/.test(namaDb)) {
    console.error(`BATAL: DATABASE_URL menunjuk '${namaDb || '(kosong)'}'. Arahkan ke database uji (mis. nusapos_uji).`);
    process.exit(2);
  }
}

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown, extra?: Record<string, string>) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: await headerUji(extra),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* bukan json */
  }
  return { status: res.status, data };
}

const q1 = async (sql: string, ...p: unknown[]) => (await get(sql, ...(p as never[]))) as Record<string, unknown> | undefined;
const hitung = async (tabel: string, saring = ''): Promise<number> =>
  Number((await get<{ c: number }>(`SELECT COUNT(*) AS c FROM "${tabel}"${saring ? ` WHERE ${saring}` : ''}`))?.c ?? 0);
const ins = async (sql: string, ...p: unknown[]): Promise<number> =>
  Number((await run(sql, ...(p as never[]))).lastInsertRowid);

/** Tabel yang dipertahankan (konfigurasi & keadaan awal) — tidak ikut dibersihkan. */
const SIMPAN = new Set([
  'roles',
  'role_permissions',
  'role_hak_khusus',
  'sessions',
  'password_resets',
  'recovery_codes',
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

const semuaTabel = async (): Promise<string[]> =>
  ((await all<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`)) as { name: string }[])
    .map((r) => r.name);

/** Kembalikan DB ke keadaan awal: hanya Admin + peran Administrator. */
async function bersihkan(): Promise<void> {
  // Pemicu perlindungan dihormati saat pembersihan juga: jurnal disahkan
  // dibuka dulu, lalu tabel yang dicek pemicu "produk bertransaksi" dikosongkan
  // sebelum products.
  try {
    await run(`UPDATE journals SET status = 'batal' WHERE status = 'disahkan'`);
  } catch {
    /* belum ada jurnal */
  }
  // Pengguna non-admin & peran non-Administrator dari uji sebelumnya dibuang
  // agar hitungan deterministik (siapkan membuatnya ulang). PG menegakkan FK:
  // pengguna dihapus SETELAH tabel-tabel yang merujuknya (di bawah).
  const admin = await q1(`SELECT id FROM users WHERE lower(username) = 'admin' ORDER BY id LIMIT 1`);
  // Tabel transaksi: anak dulu, induk kemudian (kunci asing langsung diperiksa).
  for (const t of [
    'sale_return_items', 'sale_returns', 'receivables', 'sale_payments', 'sale_items', 'sales',
    'held_sales', 'cashier_shifts', 'payments', 'invoices', 'payables', 'purchase_scan_logs',
    'purchase_chat_logs', 'purchase_items', 'purchases', 'sub_stock_items', 'sub_stock_docs',
    'opname_scans', 'opname_items', 'opname_sessions', 'stock_transfer_items', 'stock_transfers',
    'journal_lines', 'journals', 'cash_transactions', 'stock_ledger', 'stock_balances',
  ]) {
    try { await run(`DELETE FROM "${t}"`); } catch { /* kosong / sudah bersih */ }
  }
  // Master & pengguna: anak dulu, induk kemudian.
  for (const t of ['unit_conversions', 'pack_items', 'products', 'packs', 'locations', 'warehouses',
    'customers', 'suppliers', 'categories', 'brands', 'units', 'document_counters',
    'import_errors', 'import_batches', 'report_files', 'saved_reports', 'annual_processes',
    'audit_logs', 'stores']) {
    try { await run(`DELETE FROM "${t}"`); } catch { /* kosong / sudah bersih */ }
  }
  // Sesi & token milik pengguna uji dibuang dulu (FK ke users; sesi admin
  // sendiri dipertahankan agar skrip tetap masuk). Audit sudah dikosongkan
  // pada putaran master di atas.
  if (admin) {
    const idAdmin = Number(admin.id);
    for (const t of ['sessions', 'password_resets', 'recovery_codes', 'pengaturan_dashboard', 'pengaturan_dashboard_peran']) {
      try { await run(`DELETE FROM "${t}" WHERE user_id <> ?`, idAdmin); } catch { /* kosong / tanpa kolom itu */ }
    }
    await run(`DELETE FROM users WHERE id <> ?`, idAdmin);
  }
  await run(`DELETE FROM roles WHERE lower(nama) <> 'administrator'`);
  // Rincian profil buatan ikut dihapus sebelum induknya (size_profiles),
  // termasuk baris yatim peninggalan penghapusan lama.
  await run(`DELETE FROM size_profile_sizes WHERE profile_id IN (SELECT id FROM size_profiles WHERE bawaan = FALSE)`);
  await run(`DELETE FROM size_profiles WHERE bawaan = FALSE`);
  await run(
    `DELETE FROM size_profile_sizes
      WHERE profile_id NOT IN (SELECT id FROM size_profiles)`,
  );
}

interface Fiks {
  adminId: number;
  kasirId: number;
  gudangId: number;
  gudang2Id: number;
  lokasiId: number;
  unitId: number;
  unit2Id: number;
  kategoriId: number;
  merekId: number;
  profilId: number;
  produkId: number;
  pelangganId: number;
  pemasokId: number;
  packId: number;
  shiftId: number;
}

/** Data uji: satu baris tiap tabel yang disentuh reset, ditandai 'Uji Reset'. */
async function siapkan(): Promise<Fiks> {
  const adminId = Number((await q1(`SELECT id FROM users WHERE lower(username) = 'admin' ORDER BY id LIMIT 1`))!.id);
  const kasirRoleId = await ins(`INSERT INTO roles (nama) VALUES ('Kasir')`);
  const kasirId = await ins(
    `INSERT INTO users (nama, username, password_hash, role_id) VALUES ('Kasir Uji', 'kasir_uji', '!', ?)`,
    await kasirRoleId,
  );
  const gudangId = await ins(`INSERT INTO warehouses (kode, nama) VALUES ('GD-UJI-1', 'Gudang Uji 1')`);
  const gudang2Id = await ins(`INSERT INTO warehouses (kode, nama) VALUES ('GD-UJI-2', 'Gudang Uji 2')`);
  const lokasiId = await ins(`INSERT INTO locations (warehouse_id, kode_lokasi, zona, rak, bin) VALUES (?, 'UJI-01', 'U', '01', '01')`, gudangId);
  const unitId = await ins(`INSERT INTO units (kode, nama) VALUES ('PCS-UJI', 'Pcs Uji')`);
  const unit2Id = await ins(`INSERT INTO units (kode, nama) VALUES ('DUS-UJI', 'Dus Uji')`);
  const kategoriId = await ins(`INSERT INTO categories (nama) VALUES ('Kategori Uji')`);
  const merekId = await ins(`INSERT INTO brands (nama) VALUES ('Merek Uji')`);
  const profilId = await ins(
    `INSERT INTO size_profiles (kode, nama, bawaan) VALUES ('UJI-PROFIL', 'Profil Uji', FALSE)`,
  );
  await run(`INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan) VALUES (?, 'M', 1, 1)`, profilId);
  const produkId = await ins(
    `INSERT INTO products (nama, sku, kode_item, category_id, brand_id, satuan_dasar_id, harga_beli, harga_jual, size_profile_id)
     VALUES ('Produk Uji Reset', 'UJI-SKU-1', 'UJI-001', ?, ?, ?, 50000, 75000, ?)`,
    kategoriId, merekId, unitId, profilId,
  );
  await run(`INSERT INTO unit_conversions (product_id, unit_id, jumlah_per_satuan_dasar) VALUES (?, ?, 12)`, produkId, unit2Id);
  const packId = await ins(`INSERT INTO packs (kode_box, nama) VALUES ('UJI-BOX-1', 'Pak Uji')`);
  await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, 6)`, packId, produkId);
  const pelangganId = await ins(`INSERT INTO customers (nama) VALUES ('Pelanggan Uji')`);
  const pemasokId = await ins(`INSERT INTO suppliers (nama) VALUES ('Pemasok Uji')`);

  // Stok & kartu stok.
  await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty) VALUES (?, ?, 100)`, produkId, gudangId);
  await run(
    `INSERT INTO stock_ledger (product_id, warehouse_id, tipe_dokumen, qty_masuk, saldo, nilai_unit)
     VALUES (?, ?, 'penyesuaian', 100, 100, 50000)`,
    produkId, gudangId);

  // Penjualan (POS) + turunannya + piutang + retur + faktur.
  const saleId = await ins(
    `INSERT INTO sales (no_dokumen, kasir_id, customer_id, warehouse_id, subtotal, total, status)
     VALUES ('POS-UJI-1', ?, ?, ?, 100000, 100000, 'disahkan')`,
    adminId, pelangganId, gudangId,
  );
  await run(
    `INSERT INTO sale_items (sale_id, product_id, nama_produk, sku, qty, harga, subtotal)
     VALUES (?, ?, 'Produk Uji Reset', 'UJI-SKU-1', 2, 50000, 100000)`,
    saleId, produkId);
  await run(`INSERT INTO sale_payments (sale_id, metode, jumlah) VALUES (?, 'tunai', 100000)`, saleId);
  await run(
    `INSERT INTO receivables (sale_id, customer_id, total, status)
     VALUES (?, ?, 100000, 'belum')`,
    saleId, pelangganId);
  const returId = await ins(`INSERT INTO sale_returns (no_dokumen, sale_id, total, status) VALUES ('RET-UJI-1', ?, 50000, 'disahkan')`,
    saleId,
  );
  await run(
    `INSERT INTO sale_return_items (return_id, product_id, nama_produk, sku, qty, harga)
     VALUES (?, ?, 'Produk Uji Reset', 'UJI-SKU-1', 1, 50000)`,
    returId, produkId);
  await run(
    `INSERT INTO invoices (no_faktur, jenis, sumber_tipe, sumber_id, tanggal, pihak_nama, total, status)
     VALUES ('INV-UJI-1', 'penjualan', 'penjualan', ?, now(), 'Pelanggan Uji', 100000, 'terbit')`,
    saleId);

  // Pembelian (disahkan) + turunannya + hutang + log chat/scan.
  const beliId = await ins(
    `INSERT INTO purchases (no_dokumen, supplier_id, warehouse_id, total, status)
     VALUES ('PB-UJI-1', ?, ?, 200000, 'disahkan')`,
    pemasokId, gudangId,
  );
  await run(
    `INSERT INTO purchase_items (purchase_id, product_id, nama_produk, sku, qty, harga_beli, subtotal)
     VALUES (?, ?, 'Produk Uji Reset', 'UJI-SKU-1', 4, 50000, 200000)`,
    beliId, produkId);
  await run(`INSERT INTO payables (purchase_id, supplier_id, total, status) VALUES (?, ?, 200000, 'belum')`, beliId, pemasokId);
  await run(`INSERT INTO purchase_scan_logs (purchase_id, barcode, tipe) VALUES (?, 'UJI-BARCODE-1', 'satuan')`, beliId);
  await run(
    `INSERT INTO purchase_chat_logs (purchase_id, pesan_user, pesan_bot)
     VALUES (?, 'beli 4 produk uji', 'siap')`,
    beliId);

  // Item Masuk, Opname, Transfer.
  const docId = await ins(
    `INSERT INTO sub_stock_docs (no_dokumen, arah, warehouse_id, alasan, status)
     VALUES ('PSM-UJI-1', 'masuk', ?, 'lainnya', 'disahkan')`,
    gudangId,
  );
  await run(`INSERT INTO sub_stock_items (doc_id, product_id, qty) VALUES (?, ?, 5)`, docId, produkId);
  const opnId = await ins(
    `INSERT INTO opname_sessions (no_dokumen, warehouse_id, location_id, penanggung_jawab_id, status)
     VALUES ('OPN-UJI-1', ?, ?, ?, 'draft')`,
    gudangId, lokasiId, adminId,
  );
  await run(
    `INSERT INTO opname_items (session_id, product_id, location_id, qty_sistem, qty_fisik)
     VALUES (?, ?, ?, 100, 100)`,
    opnId, produkId, lokasiId);
  await run(`INSERT INTO opname_scans (session_id, barcode, product_id) VALUES (?, 'UJI-BARCODE-1', ?)`, opnId, produkId);
  const trfId = await ins(`INSERT INTO stock_transfers (no_dokumen, dari_warehouse, ke_warehouse, status) VALUES ('TRF-UJI-1', ?, ?, 'draft')`,
    gudangId, gudang2Id,
  );
  await run(`INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES (?, ?, 10)`, trfId, produkId);

  // Jurnal berstatus disahkan (akun dibuat dulu — COA dipertahankan reset).
  const periodId = Number((await q1(`SELECT id FROM periods WHERE tahun = 2099 AND bulan = 1`))?.id ??
    (await ins(`INSERT INTO periods (tahun, bulan, status) VALUES (2099, 1, 'buka')`)));
  const akun1 = Number((await q1(`SELECT id FROM accounts WHERE kode = 'UJI-1100'`))?.id ??
    (await ins(`INSERT INTO accounts (kode, nama, tipe) VALUES ('UJI-1100', 'Kas Uji', 'aset')`)));
  const akun2 = Number((await q1(`SELECT id FROM accounts WHERE kode = 'UJI-4100'`))?.id ??
    (await ins(`INSERT INTO accounts (kode, nama, tipe) VALUES ('UJI-4100', 'Pendapatan Uji', 'pendapatan')`)));
  const jurnalId = await ins(
    `INSERT INTO journals (no_jurnal, period_id, sumber_tipe, keterangan, status) VALUES ('JU-UJI-1', ?, 'manual', 'Jurnal uji reset', 'draft')`,
    periodId,
  );
  await run(`INSERT INTO journal_lines (journal_id, account_id, debit, kredit) VALUES (?, ?, 50000, 0)`, jurnalId, akun1);
  await run(`INSERT INTO journal_lines (journal_id, account_id, debit, kredit) VALUES (?, ?, 0, 50000)`, jurnalId, akun2);
  // Disahkan setelah baris lengkap (seimbang) — memancing pemicu
  // "jurnal disahkan tidak dapat diubah" saat reset menghapusnya.
  await run(`UPDATE journals SET status = 'disahkan' WHERE id = ?`, jurnalId);

  // Kas, shift, tahanan POS.
  const kasId = Number((await q1(`SELECT id FROM cash_accounts WHERE kode = 'UJI-KAS'`))?.id ??
    (await ins(`INSERT INTO cash_accounts (kode, nama) VALUES ('UJI-KAS', 'Kas Uji')`)));
  await run(
    `INSERT INTO cash_transactions (tipe, nomor, cash_account_id, jumlah, keterangan)
     VALUES ('masuk', 'KM-UJI-1', ?, 50000, 'Kas uji reset')`,
    kasId);
  const shiftId = await ins(`INSERT INTO cashier_shifts (user_id, kas_awal) VALUES (?, 100000)`, adminId);
  await run(`INSERT INTO held_sales (kasir_id, data_json) VALUES (?, '{}')`, adminId);

  // Riwayat yang hanya dihapus Reset Total.
  const batchId = await ins(
    `INSERT INTO import_batches (modul, nama_file, total_baris, baris_valid, baris_error, status, user_id)
     VALUES ('produk', 'uji.xlsx', 2, 1, 1, 'selesai', ?)`,
    adminId,
  );
  await run(`INSERT INTO import_errors (batch_id, nomor_baris, pesan) VALUES (?, 2, 'Baris uji')`, batchId);
  const repId = await ins(`INSERT INTO saved_reports (nama, laporan) VALUES ('Laporan Uji', 'penjualan')`);
  await run(`INSERT INTO report_files (saved_report_id, laporan, nama) VALUES (?, 'penjualan', 'uji.pdf')`, repId);
  await run(
    `INSERT INTO annual_processes (no_proses, gudang_id, sampai, periode_baru_dari, user_id)
     VALUES ('THN-UJI-1', ?, '2099-12-31', '2100-01-01', ?)`,
    gudangId, adminId);

  // Toko uji (dirujuk gudang — dilepas saat reset master, dihapus saat total).
  await run(`INSERT INTO stores (kode, nama, warehouse_id) VALUES ('TUJI', 'Toko Uji Reset', ?)`, gudangId);

  // Log aktivitas lama (2 baris — dihitung terpisah dari log sesi).
  await run(
    `INSERT INTO audit_logs (user_id, aksi, tabel, record_id, alasan)
     VALUES (?, 'tambah', 'uji', '1', 'baris uji 1')`,
    adminId);
  await run(
    `INSERT INTO audit_logs (user_id, aksi, tabel, record_id, alasan)
     VALUES (?, 'ubah', 'uji', '1', 'baris uji 2')`,
    adminId);

  // Counter nomor urut: dua transaksi (inv, pb) + dua non-transaksi.
  await run(`INSERT INTO document_counters (kunci, terakhir) VALUES ('inv-2099', 5)`);
  await run(`INSERT INTO document_counters (kunci, terakhir) VALUES ('pb-2099-01', 3)`);
  await run(`INSERT INTO document_counters (kunci, terakhir) VALUES ('lain-1', 7)`);
  await run(`INSERT INTO document_counters (kunci, terakhir) VALUES ('lain-2', 9)`);

  // Pengaturan kustom (bertahan di transaksi/master, kembali bawaan di total).
  await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES ('gudang_bawaan', ?, 'uji') ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, keterangan = EXCLUDED.keterangan`,
    String(gudangId));
  await run(`INSERT INTO settings (kunci, nilai, keterangan) VALUES ('size_profile_default', 'UJI-PROFIL', 'uji') ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, keterangan = EXCLUDED.keterangan`);
  await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES ('peng.umum-regional.satuan_bawaan', ?, 'uji') ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, keterangan = EXCLUDED.keterangan`,
    String(unitId));
  await run(`INSERT INTO settings (kunci, nilai, keterangan) VALUES ('nama_usaha', 'Toko Uji Reset', 'uji') ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, keterangan = EXCLUDED.keterangan`);

  return {
    adminId, kasirId, gudangId, gudang2Id, lokasiId, unitId, unit2Id, kategoriId, merekId,
    profilId, produkId, pelangganId, pemasokId, packId, shiftId,
  };
}

/** Tabel yang harus kosong setelah Reset Transaksi. */
const TABEL_TRANSAKSI = [
  'sale_return_items', 'sale_returns', 'receivables', 'sale_payments', 'sale_items', 'sales',
  'held_sales', 'cashier_shifts', 'payments', 'invoices', 'payables', 'purchase_scan_logs',
  'purchase_chat_logs', 'purchase_items', 'purchases', 'sub_stock_items', 'sub_stock_docs',
  'opname_scans', 'opname_items', 'opname_sessions', 'stock_transfer_items', 'stock_transfers',
  'journal_lines', 'journals', 'cash_transactions', 'stock_ledger', 'stock_balances',
];

const TABEL_MASTER = [
  'unit_conversions', 'pack_items', 'products', 'packs', 'categories', 'brands', 'units',
  'customers', 'suppliers', 'locations', 'warehouses',
];

const cadanganDibuat: string[] = [];
const cadanganAwal = fs.existsSync(path.join('data', 'backups')) ? fs.readdirSync(path.join('data', 'backups')) : [];

// Isolasi ROTASI (batas jumlah cadangan): batas jumlah cadangan dinaikkan
// sementara sebelum tiap reset sehingga banyaknya cadangan buatan uji tidak
// membuat rotasi menghapus berkas cadangan lama pengguna — invarian yang diuji
// di akhir: seluruh berkas awal tetap utuh.
const JUMLAH_BACKUP = 'peng.database.jumlah_backup';
let jumlahBackupSebelum: string | null | undefined;
async function naikkanCadangan(): Promise<void> {
  const s = await q1(`SELECT nilai FROM settings WHERE kunci = ?`, JUMLAH_BACKUP);
  if (s) {
    jumlahBackupSebelum = s ? String(s.nilai) : null; // null = tidak ada (aturan: pakai bawaan 14)
  }
  await run(
    `INSERT INTO settings (kunci, nilai, keterangan) VALUES (?, '100', 'uji')
     ON CONFLICT(kunci) DO UPDATE SET nilai = '100'`,
    JUMLAH_BACKUP);
}
async function pulihkanBatasCadangan(): Promise<void> {
  if (jumlahBackupSebelum === undefined) return;
  if (jumlahBackupSebelum === null) await run(`DELETE FROM settings WHERE kunci = ?`, JUMLAH_BACKUP);
  else await run(`UPDATE settings SET nilai = ? WHERE kunci = ?`, jumlahBackupSebelum, JUMLAH_BACKUP);
  jumlahBackupSebelum = undefined;
}

/** Jalankan reset lewat API; bila gagal, ulangi langsung di proses ini untuk
 *  mendapatkan stack trace lengkap (jalankanReset diimpor langsung). */
async function resetAtauDiag(jenis: JenisReset) {
  await naikkanCadangan();
  const r = await req('POST', '/api/pengaturan/sistem/reset', { jenis, konfirmasi: 'RESET', sandi: SANDI });
  if (r.status !== 200) {
    try {
      await jalankanReset(jenis, null, 'admin');
      console.log(`(diagnosis langsung: jalankanReset('${jenis}') OK — masalah di HTTP/middleware)`);
    } catch (e) {
      console.log(`(diagnosis langsung: ${(e as Error)?.stack ?? String(e)})`);
    }
  }
  return r;
}

async function main(): Promise<void> {
  await bersihkan();
  const f = await siapkan();
  const tahun = new Date().getFullYear();

  /* ---------------- Langkah 1: ringkasan per modul ---------------- */
  let r = await req('GET', `/api/pengaturan/sistem/reset/ringkasan?jenis=transaksi`);
  await cek('ringkasan transaksi → 200', r.status === 200, `status ${r.status}`);
  const rt = r.data as {
    total: number; dipertahankan: string[];
    modul: { kode: string; label: string; jumlah: number }[];
  };
  const modulTransaksi = ['retur', 'faktur', 'penjualan', 'pembelian', 'item_masuk_keluar', 'opname', 'transfer', 'jurnal', 'kas', 'stok', 'nomor_urut'];
  await cek('semua modul transaksi berjumlah > 0',
    modulTransaksi.every((k) => rt.modul.find((m) => m.kode === k)?.jumlah > 0),
    JSON.stringify(rt.modul.map((m) => `${m.kode}=${m.jumlah}`)),
  );
  await cek('ringkasan transaksi tanpa modul produk', !rt.modul.some((m) => m.kode === 'produk'));
  await cek('total & daftar dipertahankan', rt.total > 0 && rt.dipertahankan.length > 0);

  r = await req('GET', `/api/pengaturan/sistem/reset/ringkasan?jenis=master`);
  const rm = r.data as typeof rt;
  const modulMaster = [...modulTransaksi, 'produk', 'kategori_merek', 'satuan', 'pelanggan', 'pemasok', 'gudang', 'profil_size'];
  await cek('semua modul master berjumlah > 0',
    modulMaster.every((k) => rm.modul.find((m) => m.kode === k)?.jumlah > 0),
    JSON.stringify(rm.modul.map((m) => `${m.kode}=${m.jumlah}`)),
  );
  await cek('ringkasan master memuat modul produk', rm.modul.some((m) => m.kode === 'produk'));

  r = await req('GET', `/api/pengaturan/sistem/reset/ringkasan?jenis=total`);
  const rg = r.data as typeof rt;
  await cek('semua modul total terdaftar',
    ['toko', 'laporan_tersimpan', 'riwayat_impor', 'riwayat_proses', 'log_aktivitas', 'pengguna', 'pengaturan', 'nomor_urut']
      .every((k) => rg.modul.find((m) => m.kode === k)?.jumlah >= 0),
    JSON.stringify(rg.modul.map((m) => `${m.kode}=${m.jumlah}`)),
  );
  await cek('ringkasan total: pengguna non-admin = 1', rg.modul.find((m) => m.kode === 'pengguna')?.jumlah === 1);
  await cek('ringkasan total: toko = 1', rg.modul.find((m) => m.kode === 'toko')?.jumlah === 1);

  /* ---------------- Guard: hanya Admin utama ---------------- */
  r = await req('GET', `/api/pengaturan/sistem/reset/ringkasan?jenis=transaksi`, undefined, { 'x-peran': 'kasir' });
  await cek('ringkasan oleh kasir → 403', r.status === 403, `status ${r.status}`);
  r = await req('POST', '/api/pengaturan/sistem/reset', { jenis: 'transaksi', konfirmasi: 'RESET', sandi: SANDI }, { 'x-peran': 'kasir' });
  await cek('reset oleh kasir → 403', r.status === 403, `status ${r.status}`);
  await cek('fiksur utuh setelah guard menolak', (await hitung('stores')) === 1 && (await hitung('annual_processes')) === 1);

  /* ---------------- Validasi input ---------------- */
  r = await req('POST', '/api/pengaturan/sistem/reset', { jenis: 'salah', konfirmasi: 'RESET', sandi: SANDI });
  await cek('jenis tidak dikenal → 400', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pengaturan/sistem/reset', { jenis: 'transaksi', konfirmasi: 'SALAH', sandi: SANDI });
  await cek('konfirmasi salah → 400', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pengaturan/sistem/reset', { jenis: 'transaksi', sandi: SANDI });
  await cek('konfirmasi hilang → 400', r.status === 400, `status ${r.status}`);
  r = await req('POST', '/api/pengaturan/sistem/reset', { jenis: 'transaksi', konfirmasi: 'RESET', sandi: 'salah-xyz' });
  await cek('kata sandi salah → 401', r.status === 401, `status ${r.status}`);
  await cek('data utuh setelah validasi gagal',
    (await hitung('products')) === 1 && (await hitung('stores')) === 1 && (await hitung('users')) === 2);

  // Baris uji dihitung terpisah: sejak modul Log In, login berhasil/
  // gagal juga dicatat ke Log Aktivitas dan tidak boleh mengubah ekspektasi ini.
  const logSebelum = await hitung('audit_logs');
  const masukSebelum = await hitung('audit_logs', `aksi = 'login'`);
  await cek('log awal tercatat', logSebelum >= 3, `audit=${logSebelum}`);

  /* ---------------- Reset Transaksi ---------------- */
  r = await resetAtauDiag('transaksi');
  await cek('reset transaksi → 200', r.status === 200, `status ${r.status}`);
  const h1 = r.data as {
    label: string; total: number; nomor_urut: number;
    cadangan_pengaman: string; dilewati: string[];
    modul: { kode: string; jumlah: number }[];
  };
  await cek('tanpa tabel dilewati', Array.isArray(h1.dilewati) && h1.dilewati.length === 0, JSON.stringify(h1.dilewati));
  await cek('counter transaksi terhapus 2', h1.nomor_urut === 2, `nomor_urut=${h1.nomor_urut}`);
  await cek('total baris dihitung', h1.total > 0, `total=${h1.total}`);
  await cek('modul terperinci', Array.isArray(h1.modul) && h1.modul.length > 0, `${h1.modul.length} modul`);
  await cek('pesan sukses', String((r.data as { pesan?: unknown })?.pesan ?? '').includes('selesai'), String((r.data as { pesan?: unknown })?.pesan ?? ''));
  await cek('cadangan pengaman dibuat', typeof h1.cadangan_pengaman === 'string' && h1.cadangan_pengaman.endsWith('.dump'), String(h1.cadangan_pengaman));
  cadanganDibuat.push(h1.cadangan_pengaman);

  const sisaTransaksi: string[] = [];
  for (const t of TABEL_TRANSAKSI) {
    const n = await hitung(t);
    if (n > 0) sisaTransaksi.push(`${t}=${n}`);
  }
  await cek('semua tabel transaksi kosong', sisaTransaksi.length === 0, sisaTransaksi.join(', '));
  const masterUtuh: string[] = [];
  for (const t of TABEL_MASTER) if ((await hitung(t)) === 0) masterUtuh.push(t);
  await cek('semua tabel master utuh', masterUtuh.length === 0, masterUtuh.join(', '));
  await cek('counter transaksi habis', (await hitung('document_counters', `kunci LIKE 'inv-%' OR kunci LIKE 'pb-%'`)) === 0);
  await cek('counter non-transaksi utuh', (await hitung('document_counters')) === 2, String(await hitung('document_counters')));
  await cek('pengaturan kustom bertahan', (await q1(`SELECT nilai FROM settings WHERE kunci = 'nama_usaha'`))?.nilai === 'Toko Uji Reset');
  await cek('audit bertambah 1 baris reset; login tercatat',
    (await hitung('audit_logs')) === logSebelum + 1 &&
      (await hitung('audit_logs', `aksi = 'login'`)) === masukSebelum &&
      (await hitung('audit_logs')) >= 1,
    `total=${await hitung('audit_logs')} login=${await hitung('audit_logs', `aksi = 'login'`)}`);
  const logReset = await q1<{ data_sesudah: string }>(`SELECT data_sesudah FROM audit_logs WHERE aksi = 'reset' ORDER BY id DESC LIMIT 1`);
  await cek('entri log memuat jenis reset & cadangan',
    String(logReset?.data_sesudah ?? '').includes('Reset Transaksi') &&
      String(logReset?.data_sesudah ?? '').includes('cadangan_pengaman'),
    String(logReset?.data_sesudah),
  );

  // Nomor urut kembali ke awal: dokumen berikutnya nomor 0001.
  r = await req('POST', '/api/pembelian/', {
    supplier_id: f.pemasokId, warehouse_id: f.gudangId,
    items: [{ product_id: f.produkId, qty: 1, harga_beli: 10000 }],
  });
  const noBaru = String((r.data as { data?: { no_dokumen?: unknown }; no_dokumen?: unknown })?.data?.no_dokumen
    ?? (r.data as { no_dokumen?: unknown })?.no_dokumen ?? '');
  await cek('dokumen baru nomor urut 0001', r.status === 201 && noBaru.endsWith('-0001'), `${r.status} ${noBaru}`);

  r = await req('GET', `/api/pengaturan/sistem/reset/ringkasan?jenis=transaksi`);
  const pascaModul = (r.data as typeof rt).modul.find((m) => m.kode === 'pembelian')?.jumlah;
  await cek('ringkasan pembelian = 2 baris', pascaModul === 2, `pembelian=${pascaModul}`);

  /* ---------------- Reset Transaksi + Master ---------------- */
  r = await resetAtauDiag('master');
  await cek('reset master → 200', r.status === 200, `status ${r.status}`);
  const h2 = r.data as typeof h1;
  cadanganDibuat.push(h2.cadangan_pengaman);
  await cek('master: tanpa tabel dilewati', Array.isArray(h2.dilewati) && h2.dilewati.length === 0, JSON.stringify(h2.dilewati));

  const masterKosong: string[] = [];
  for (const t of TABEL_MASTER) if ((await hitung(t)) > 0) masterKosong.push(`${t}=${await hitung(t)}`);
  await cek('semua tabel master kosong', masterKosong.length === 0, masterKosong.join(', '));
  const masihAda: string[] = [];
  for (const t of TABEL_TRANSAKSI) {
    const n = await hitung(t);
    if (n > 0 && t !== 'purchases' && t !== 'purchase_items') masihAda.push(`${t}=${n}`);
  }
  await cek('transaksi tetap kosong (di luar pembelian uji pasca-reset)', masihAda.length === 0, masihAda.join(', '));
  // Reset master mempertahankan profil bawaan (beserta ukurannya) by design —
  // yang harus habis: profil kustom + tidak ada ukuran yatim.
  await cek('profil size kustom habis', (await hitung('size_profiles', 'bawaan = FALSE')) === 0 && (await hitung('size_profile_sizes', 'profile_id NOT IN (SELECT id FROM size_profiles)')) === 0);
  await cek('rujukan gudang toko dilepas', (await hitung('stores')) === 1 && (await q1(`SELECT warehouse_id FROM stores LIMIT 1`))?.warehouse_id === null);
  await cek('rujukan gudang proses tahunan dilepas', (await hitung('annual_processes')) === 1 && (await q1(`SELECT gudang_id FROM annual_processes LIMIT 1`))?.gudang_id === null);
  await cek('pengguna & peran utuh', (await hitung('users')) === 2 && (await hitung('roles')) === 2);
  await cek('nama usaha kustom bertahan', (await q1(`SELECT nilai FROM settings WHERE kunci = 'nama_usaha'`))?.nilai === 'Toko Uji Reset');
  await cek('counter: 2 non-transaksi (counter pembelian ikut tereset master)', (await hitung('document_counters')) === 2, String(await hitung('document_counters')));

  /* ---------------- Reset Total ---------------- */
  // Cadangan pengaman Reset Total merekam kondisi SEBELUM reset dijalankan —
  // itulah isi yang harus kembali setelah pemulihan.
  const sebelumTotal = {
    pengguna: await hitung('users'),
    produk: await hitung('products'),
    pelanggan: await hitung('customers'),
  };
  r = await resetAtauDiag('total');
  await cek('reset total → 200', r.status === 200, `status ${r.status}`);
  const h3 = r.data as typeof h1;
  const cadanganTotal = String(h3.cadangan_pengaman);
  cadanganDibuat.push(cadanganTotal);
  await cek('total: tanpa tabel dilewati', Array.isArray(h3.dilewati) && h3.dilewati.length === 0, JSON.stringify(h3.dilewati));
  await cek('pengguna selain admin terhapus', (await hitung('users')) === 1 && (await q1(`SELECT username FROM users LIMIT 1`))?.username === 'admin');
  await cek('pengaturan kembali ≥ 4 bawaan', (await hitung('settings')) >= 4, `settings=${await hitung('settings')}`);
  await cek('tabel kept & log terisi',
    (await hitung('audit_logs')) > 0 && (await hitung('settings')) > 0 && (await hitung('users')) > 0);
  await cek('peran dipertahankan', (await hitung('roles')) === 2, `roles=${await hitung('roles')}`);
  await cek('riwayat & toko habis',
    (await hitung('stores')) + (await hitung('saved_reports')) + (await hitung('import_batches')) + (await hitung('annual_processes')) === 0,
    `stores=${await hitung('stores')} reports=${await hitung('saved_reports')} impor=${await hitung('import_batches')} proses=${await hitung('annual_processes')}`);
  await cek('counter habis total', (await hitung('document_counters')) === 0, String(await hitung('document_counters')));
  await cek('nama usaha kembali bawaan', (await q1(`SELECT nilai FROM settings WHERE kunci = 'nama_usaha'`))?.nilai === 'Toko Retail');
  await cek('pin supervisor kembali bawaan',
    (await q1(`SELECT nilai FROM settings WHERE kunci = 'pin_supervisor'`))?.nilai ===
      crypto.createHash('sha256').update('1234').digest('hex'));
  await cek('nilai pengaturan berupa string', typeof (await q1(`SELECT nilai FROM settings WHERE kunci = 'akuntansi_pemetaan'`))?.nilai === 'string');
  await cek('log reset satu-satunya baris & admin satu-satunya pengguna',
    (await hitung('audit_logs')) === 1 && (await hitung('users')) === 1,
    `baris=${await hitung('audit_logs')}`);

  // Kata sandi masih diterima setelah pengaturan dibersihkan.
  r = await req('POST', '/api/auth/masuk', { username: USERNAME, sandi: SANDI });
  void r;
  const masukUlang = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, sandi: SANDI }),
  });
  await cek('masuk ulang setelah total → 200', masukUlang.status === 200, `status ${masukUlang.status}`);
  cadanganDibuat.push(String((r.data as { cadangan_pengaman?: unknown })?.cadangan_pengaman ?? ''));

  // Log aktivitas menampilkan reset (aksi tercatat via HTTP).
  r = await req('GET', '/api/pengaturan/log/aktivitas?batas=50');
  const adaReset = ((r.data as { data?: { aksi?: unknown }[] })?.data ?? []).filter((x) => x.aksi === 'reset');
  await cek('log aktivitas menampilkan reset', adaReset.length > 0,
    `jumlah=${adaReset.length}`);

  /* ---------------- Pulihkan dari Backup ---------------- */
  r = await req('POST', '/api/pengaturan/sistem/pulihkan', { nama: cadanganTotal, konfirmasi: 'PULIHKAN' });
  await cek('pulihkan cadangan pengaman → 200', r.status === 200, `status ${r.status} ${(r.data as { pesan?: unknown })?.pesan ?? ''}`);
  if (r.status !== 200) {
    // Lacak baris SQL yang gagal — ulangi langsung dengan stack trace penuh.
    try {
      await pulihkanBackup(cadanganTotal);
      console.log('(diagnosis langsung: pulihkanBackup OK — masalah di HTTP/middleware)');
    } catch (e) {
      console.log(`(diagnosis langsung: ${(e as Error)?.stack ?? String(e)})`);
    }
  }
  await cek('data kembali setelah pemulihan',
    (await hitung('users')) === sebelumTotal.pengguna && (await hitung('products')) === sebelumTotal.produk && (await hitung('customers')) === sebelumTotal.pelanggan,
    `users=${await hitung('users')}/${sebelumTotal.pengguna} produk=${await hitung('products')}/${sebelumTotal.produk} pelanggan=${await hitung('customers')}/${sebelumTotal.pelanggan}`);
  await cek('pengaturan kustom kembali', (await q1(`SELECT nilai FROM settings WHERE kunci = 'nama_usaha'`))?.nilai === 'Toko Uji Reset');

  r = await req('POST', '/api/pengaturan/sistem/pulihkan', { nama: cadanganTotal, konfirmasi: 'salah' });
  await cek('pulihkan tanpa konfirmasi PULIHKAN → 400', r.status === 400, `status ${r.status}`);

  // Unggahan file backup (.dump) dari komputer.
  const berkas = fs.readFileSync(path.join('data', 'backups', cadanganTotal));
  const unggah = await fetch(`${BASE}/api/pengaturan/sistem/pulihkan/unggah?konfirmasi=PULIHKAN`, {
    method: 'POST',
    headers: await headerUji({ 'content-type': 'application/octet-stream' }),
    body: berkas,
  });
  const dataUnggah = (await unggah.json().catch(() => null)) as { nama?: unknown } | null;
  await cek('unggah cadangan → 200', unggah.status === 200, `status ${unggah.status}`);
  if (dataUnggah?.nama) cadanganDibuat.push(String(dataUnggah.nama));
  await cek('data kembali setelah pemulihan unggahan',
    (await hitung('users')) === sebelumTotal.pengguna && (await hitung('products')) === sebelumTotal.produk,
    `users=${await hitung('users')}/${sebelumTotal.pengguna} produk=${await hitung('products')}/${sebelumTotal.produk}`);

  const gagalUnggah = await fetch(`${BASE}/api/pengaturan/sistem/pulihkan/unggah?konfirmasi=PULIHKAN`, {
    method: 'POST',
    headers: await headerUji({ 'content-type': 'application/octet-stream' }),
    body: Buffer.from('ini bukan cadangan pg_dump'),
  });
  await cek('unggah berkas bukan dump → 400', gagalUnggah.status === 400, `status ${gagalUnggah.status}`);
  const tanpaKonfirmasi = await fetch(`${BASE}/api/pengaturan/sistem/pulihkan/unggah?konfirmasi=salah`, {
    method: 'POST',
    headers: await headerUji({ 'content-type': 'application/octet-stream' }),
    body: berkas,
  });
  await cek('unggah tanpa konfirmasi PULIHKAN → 400', tanpaKonfirmasi.status === 400, `status ${tanpaKonfirmasi.status}`);

  /* ---------------- Bersihkan berkas cadangan uji ---------------- */
  for (const n of [...new Set(cadanganDibuat)]) {
    if (!n) continue;
    try {
      fs.unlinkSync(path.join('data', 'backups', n));
    } catch {
      /* sudah tidak ada */
    }
  }
  const hilang = cadanganAwal.filter((f) => !fs.existsSync(path.join('data', 'backups', f)));
  await pulihkanBatasCadangan();
  await cek('tidak ada cadangan lama terhapus rotasi', hilang.length === 0, hilang.join(', '));

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
  await pool.end();
  if (gagal > 0) process.exit(1);
}

await main().catch(async (e: unknown) => {
  // Berkas cadangan buatan uji tetap dibersihkan walau uji gagal, supaya tidak
  // menumpuk dan memicu rotasi yang menghapus cadangan asli pengguna.
  try { await pulihkanBatasCadangan(); } catch { /* abaikan */ }
  for (const n of [...new Set(cadanganDibuat)]) {
    if (!n) continue;
    try {
      fs.unlinkSync(path.join('data', 'backups', n));
    } catch {
      /* berkas sudah tidak ada — abaikan */
    }
  }
  console.error('GAGAL:', e instanceof Error ? e.message : e);
  try { await pool.end(); } catch { /* abaikan */ }
  process.exit(1);
});
