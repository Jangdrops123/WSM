// PROSES TAHUNAN — hapus riwayat transaksi ≤ batas periode TANPA merusak
// stok & saldo yang berjalan.
//
// AKUNTANSI DASAR (revisi "konversi saldo ke saldo awal"): tanpa jurnal
// pembuka/penutup, tanpa Laba Ditahan, tanpa Bagan Akun. Tidak ada saldo
// yang hilang. Saldo yang dibawa menjadi SALDO AWAL hanya untuk: stok,
// piutang, hutang, dan saldo Kas/Bank.
//   1. Stok dihitung pada batas tanggal → baris kartu stok bertipe
//      'saldo_awal' (per produk/gudang). Kas/Bank: saldo_awal rekening
//      ditetapkan ke saldo pada batas, lalu mutasi kas ≤ batas dihapus.
//      Piutang/hutang (receivables/payables) belum lunas dipertahankan utuh.
//   2. Dokumen transaksi ≤ batas dihapus (Master Data TIDAK disentuh);
//      transaksi belum selesai — draft, piutang/hutang belum lunas, sesi
//      opname/transfer berjalan — dipertahankan.
//   3. Seluruh berjalan dalam SATU transaksi database: gagal = batal semua.
//   4. Setiap proses dicatat di annual_processes + Log Aktivitas dan bisa
//      dipulihkan dari file backup (.xlsx) bila admin salah hapus.
//   5. Proses berikutnya menghitung ulang saldo awal: baris penanda lama
//      ikut terhapus lalu digabung menjadi saldo awal yang baru.
//   6. Jurnal LAMA (bila ada dari versi sebelumnya) ikut dibackup lalu
//      dihapus agar tidak ada sisa modul jurnal.

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { all, formatDocumentNumber, get, nextDocumentSequence, run, withTransaction } from '../db.pg.ts';
import { catatAudit } from './audit.ts';
import { saldoKas } from './dasarKas.ts';
import { bacaExcelMulti, type SheetExcel } from './excel.ts';
import { tolak } from './http.ts';
import { sapuTransaksiBatal } from './pembersihanTransaksi.ts';

export interface Lingkup {
  /** gudangId null = semua toko/gudang. */
  gudangId: number | null;
  /** Batas tanggal periode (inclusive), format yyyy-mm-dd. */
  sampai: string;
}

// ---------------------------------------------------------------------------
// Utilitas tanggal
// ---------------------------------------------------------------------------

const dd = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd hari SETELAH tanggal (batas eksklusif untuk predikat <). */
export function hariBerikutnya(tgl: string): string {
  const d = new Date(`${tgl}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
}

/** Tanggal yyyy-mm-dd → ISO dengan tengah malam lokal (kolom timestamp). */
function isoLokal(tgl: string): string {
  return new Date(`${tgl}T00:00:00`).toISOString();
}

function validTanggal(tgl: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(tgl) && !Number.isNaN(new Date(`${tgl}T00:00:00`).getTime());
}

// ---------------------------------------------------------------------------
// Fragment WHERE bersama (ringkasan, pratinjau, backup, dan penghapusan)
// memakai predikat yang SAMA persis sehingga jumlah = yang benar-benar dihapus.
// ---------------------------------------------------------------------------

interface Frag {
  where: string;
  params: unknown[];
}

/** Penjualan yang boleh dihapus: selesai/batal, ≤ batas, tanpa piutang belum lunas. */
function fragSales(l: Lingkup, batas: string): Frag {
  const where = `s.tanggal < ?${l.gudangId != null ? ' AND s.warehouse_id = ?' : ''}
    AND s.status IN ('disahkan', 'batal')
    AND NOT EXISTS (
      SELECT 1 FROM receivables rv WHERE rv.sale_id = s.id AND rv.status IN ('belum', 'sebagian')
    )`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId] : [batas];
  return { where, params };
}

/** Pembelian (retur keluar = status batal) yang boleh dihapus. */
function fragPurchases(l: Lingkup, batas: string, status: 'disahkan' | 'batal'): Frag {
  const where = `p.tanggal < ?${l.gudangId != null ? ' AND p.warehouse_id = ?' : ''}
    AND p.status = '${status}'
    AND NOT EXISTS (
      SELECT 1 FROM payables y WHERE y.purchase_id = p.id AND y.status IN ('belum', 'sebagian')
    )`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId] : [batas];
  return { where, params };
}

/** Retur masuk hanya ikut dihapus bila induk penjualannya ikut dihapus.
 *  Lingkup gudang ikut lewat predikat induk (fs) — tidak ada kolom s di luar. */
function fragReturMasuk(l: Lingkup, batas: string): Frag {
  const fs = fragSales(l, batas);
  const where = `r.tanggal < ?
    AND r.status IN ('disahkan', 'batal')
    AND EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id AND ${fs.where})`;
  const params: unknown[] = [batas, ...fs.params];
  return { where, params };
}

function fragSub(l: Lingkup, batas: string): Frag {
  const where = `d.tanggal < ?${l.gudangId != null ? ' AND d.warehouse_id = ?' : ''}
    AND d.status IN ('disahkan', 'batal')`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId] : [batas];
  return { where, params };
}

function fragOpname(l: Lingkup, batas: string): Frag {
  const where = `o.tanggal < ?${l.gudangId != null ? ' AND o.warehouse_id = ?' : ''}
    AND o.status IN ('disahkan', 'batal')`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId] : [batas];
  return { where, params };
}

function fragTransfer(l: Lingkup, batas: string): Frag {
  const scope = l.gudangId != null ? ' AND (t.dari_warehouse = ? OR t.ke_warehouse = ?)' : '';
  const where = `t.tanggal < ?${scope} AND t.status IN ('disahkan', 'batal')`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId, l.gudangId] : [batas];
  return { where, params };
}

function fragLedger(l: Lingkup, batas: string): Frag {
  const where = `tanggal < ?${l.gudangId != null ? ' AND warehouse_id = ?' : ''}`;
  const params: unknown[] = l.gudangId != null ? [batas, l.gudangId] : [batas];
  return { where, params };
}

async function idList(sql: string, ...params: unknown[]): Promise<number[]> {
  return await (await all<{ id: number }>(sql, ...params)).map((r) => r.id);
}

function uang(v: number): string {
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

// ---------------------------------------------------------------------------
// LANGKAH 1 — ringkasan jumlah data + peringatan transaksi tertahan
// ---------------------------------------------------------------------------

export interface Tertahan {
  penjualanDraft: number;
  penjualanPiutang: number;
  piutangSisa: number;
  pembelianDraft: number;
  pembelianHutang: number;
  hutangSisa: number;
  returDraft: number;
  opnameDraft: number;
  transferDraft: number;
  jurnalDraft: number;
  held: number;
}

export interface Ringkasan {
  batas: string;
  periodeBaruDari: string;
  ringkas: {
    penjualan: number;
    pembelian: number;
    retur_masuk: number;
    retur_keluar: number;
    persediaan_sub: number;
    opname: number;
    mutasi: number;
    jurnal: number;
    total: number;
  };
  tertahan: Tertahan;
  peringatan: string[];
}

export interface Kumpulan {
  salesHapus: number[];
  returHapus: number[];
  pembelianHapus: number[];
  returKeluarHapus: number[];
  subHapus: number[];
  opnameHapus: number[];
  transferHapus: number[];
  jurnalHapus: number[];
  tertahan: Tertahan;
}

export async function kumpulan(l: Lingkup): Promise<Kumpulan> {
  const batas = hariBerikutnya(l.sampai);
  const fs = fragSales(l, batas);
  const fpDis = fragPurchases(l, batas, 'disahkan');
  const fpBatal = fragPurchases(l, batas, 'batal');
  const fr = fragReturMasuk(l, batas);
  const fsub = fragSub(l, batas);
  const fop = fragOpname(l, batas);
  const ftr = fragTransfer(l, batas);

  const salesHapus = await idList(`SELECT s.id FROM sales s WHERE ${fs.where}`, ...fs.params);
  const returHapus = await idList(`SELECT r.id FROM sale_returns r WHERE ${fr.where}`, ...fr.params);
  const pembelianHapus = await idList(`SELECT p.id FROM purchases p WHERE ${fpDis.where}`, ...fpDis.params);
  const returKeluarHapus = await idList(`SELECT p.id FROM purchases p WHERE ${fpBatal.where}`, ...fpBatal.params);
  const subHapus = await idList(`SELECT d.id FROM sub_stock_docs d WHERE ${fsub.where}`, ...fsub.params);
  const opnameHapus = await idList(`SELECT o.id FROM opname_sessions o WHERE ${fop.where}`, ...fop.params);
  const transferHapus = await idList(`SELECT t.id FROM stock_transfers t WHERE ${ftr.where}`, ...ftr.params);
  const jurnalHapus = await idList(
    `SELECT id FROM journals WHERE tanggal < ? AND status IN ('disahkan', 'batal')`,
    batas,
  );

  // --- Transaksi yang TIDAK ikut dihapus (peringatan) ---
  const scope = l.gudangId != null ? l.gudangId : null;

  const penjualanDraft =
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sales s WHERE s.tanggal < ?${scope != null ? ' AND s.warehouse_id = ?' : ''} AND s.status = 'draft'`,
      batas,
      ...(scope != null ? [scope] : []),
    )))?.n ?? 0;

  const piutang =
    (await get<{ n: number; sisa: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(rv.total - rv.terbayar), 0) AS sisa
       FROM receivables rv JOIN sales s ON s.id = rv.sale_id
       WHERE s.tanggal < ?${scope != null ? ' AND s.warehouse_id = ?' : ''} AND rv.status IN ('belum', 'sebagian')`,
      batas,
      ...(scope != null ? [scope] : []),
    )) ?? { n: 0, sisa: 0 };

  const pembelianDraft =
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM purchases p WHERE p.tanggal < ?${scope != null ? ' AND p.warehouse_id = ?' : ''} AND p.status = 'draft'`,
      batas,
      ...(scope != null ? [scope] : []),
    )))?.n ?? 0;

  const hutang =
    (await get<{ n: number; sisa: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(y.total - y.terbayar), 0) AS sisa
       FROM payables y JOIN purchases p ON p.id = y.purchase_id
       WHERE p.tanggal < ?${scope != null ? ' AND p.warehouse_id = ?' : ''} AND y.status IN ('belum', 'sebagian')`,
      batas,
      ...(scope != null ? [scope] : []),
    )) ?? { n: 0, sisa: 0 };

  const returDraft =
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sale_returns r WHERE r.tanggal < ?${
        scope != null ? ' AND EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id AND s.warehouse_id = ?)' : ''
      } AND r.status = 'draft'`,
      batas,
      ...(scope != null ? [scope] : []),
    )))?.n ?? 0;

  const opnameDraft =
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opname_sessions o WHERE o.tanggal < ?${scope != null ? ' AND o.warehouse_id = ?' : ''} AND o.status = 'draft'`,
      batas,
      ...(scope != null ? [scope] : []),
    )))?.n ?? 0;

  const transferDraft =
    await ((await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM stock_transfers t WHERE t.tanggal < ?${
        scope != null ? ' AND (t.dari_warehouse = ? OR t.ke_warehouse = ?)' : ''
      } AND t.status = 'draft'`,
      batas,
      ...(scope != null ? [scope, scope] : []),
    )))?.n ?? 0;

  const jurnalDraft =
    await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM journals WHERE tanggal < ? AND status = 'draft'`, batas)))?.n ?? 0;

  const held = await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM held_sales`)))?.n ?? 0;

  return {
    salesHapus,
    returHapus,
    pembelianHapus,
    returKeluarHapus,
    subHapus,
    opnameHapus,
    transferHapus,
    jurnalHapus,
    tertahan: {
      penjualanDraft,
      penjualanPiutang: piutang.n,
      piutangSisa: piutang.sisa,
      pembelianDraft,
      pembelianHutang: hutang.n,
      hutangSisa: hutang.sisa,
      returDraft,
      opnameDraft,
      transferDraft,
      jurnalDraft,
      held,
    },
  };
}

function buatPeringatan(t: Tertahan): string[] {
  const p: string[] = [];
  if (t.penjualanDraft) p.push(`${t.penjualanDraft} penjualan berstatus draft tidak ikut dihapus.`);
  if (t.penjualanPiutang)
    p.push(`${t.penjualanPiutang} penjualan dengan piutang belum lunas (${uang(t.piutangSisa)}) dipertahankan.`);
  if (t.pembelianDraft) p.push(`${t.pembelianDraft} pembelian berstatus draft tidak ikut dihapus.`);
  if (t.pembelianHutang)
    p.push(`${t.pembelianHutang} pembelian dengan hutang belum lunas (${uang(t.hutangSisa)}) dipertahankan.`);
  if (t.returDraft) p.push(`${t.returDraft} retur masuk masih draft tidak ikut dihapus.`);
  if (t.opnameDraft) p.push(`${t.opnameDraft} sesi opname masih berjalan (draft) tidak ikut dihapus.`);
  if (t.transferDraft) p.push(`${t.transferDraft} mutasi/transfer masih draft tidak ikut dihapus.`);
  if (t.jurnalDraft) p.push(`${t.jurnalDraft} jurnal masih draft tidak ikut dihapus.`);
  if (t.held) p.push(`${t.held} penjualan ditahan (held) di POS tidak ikut dihapus.`);
  return p;
}

export async  function ringkasProses(l: Lingkup): Promise<Ringkasan> {
  if (!validTanggal(l.sampai)) throw tolak(400, 'Tanggal batas tidak valid (format yyyy-mm-dd).');
  const k = await kumpulan(l);
  const r = {
    penjualan: k.salesHapus.length,
    pembelian: k.pembelianHapus.length,
    retur_masuk: k.returHapus.length,
    retur_keluar: k.returKeluarHapus.length,
    persediaan_sub: k.subHapus.length,
    opname: k.opnameHapus.length,
    mutasi: k.transferHapus.length,
    jurnal: k.jurnalHapus.length,
    total: 0,
  };
  r.total =
    r.penjualan + r.pembelian + r.retur_masuk + r.retur_keluar + r.persediaan_sub + r.opname + r.mutasi + r.jurnal;
  return {
    batas: hariBerikutnya(l.sampai),
    periodeBaruDari: hariBerikutnya(l.sampai),
    ringkas: r,
    tertahan: k.tertahan,
    peringatan: buatPeringatan(k.tertahan),
  };
}

// ---------------------------------------------------------------------------
// LANGKAH 3 — pratinjau konversi saldo awal (tabel dua sisi + penyebab)
// ---------------------------------------------------------------------------

export interface BarisKategori {
  kategori: string;
  sebelum: number;
  sesudah: number;
  selisih: number;
  alasan: string | null;
}

export interface RincianStok {
  product_id: number;
  warehouse_id: number;
  produk: string;
  gudang: string;
  qty: number;
  nilai: number;
  tertulis: number;
}
export interface RincianPiutang {
  pelanggan: string;
  sisa: number;
}
export interface RincianHutang {
  supplier: string;
  sisa: number;
}
export interface RincianKas {
  kode: string;
  nama: string;
  jenis: string;
  saldo: number;
}

export interface Pratinjau {
  batas: string;
  periodeBaruDari: string;
  baris: BarisKategori[];
  rincian: {
    stok: RincianStok[];
    piutang: RincianPiutang[];
    hutang: RincianHutang[];
    kas: RincianKas[];
  };
  stokTotal: number;
  kasTotal: number;
  cocok: boolean;
  penyebab: string[];
  catatan: string[];
}

/** Daftar rekening kas/bank + saldo pada batas periode (untuk konversi Saldo Awal). */
async function kasBankSampai(batas: string): Promise<{ id: number; kode: string; nama: string; jenis: string; saldo: number }[]> {
  return await await Promise.all((await all<{ id: number; kode: string; nama: string; jenis: string }>(
    `SELECT id, kode, nama, jenis FROM cash_accounts WHERE aktif = TRUE ORDER BY kode`,
  )).map(async (a) => ({ ...a, saldo: await saldoKas(a.id, batas) })));
}

export async function pratinjauProses(l: Lingkup): Promise<Pratinjau> {
  if (!validTanggal(l.sampai)) throw tolak(400, 'Tanggal batas tidak valid (format yyyy-mm-dd).');
  const batas = hariBerikutnya(l.sampai);
  const penyebab: string[] = [];
  const catatan: string[] = [];

  // --- Stok per produk/gudang (dari Kartu Stok) ---
  const fl = fragLedger(l, batas);
  const stokRows = await all<{
    product_id: number;
    warehouse_id: number;
    produk: string;
    gudang: string;
    qty: number;
    nilai: number;
  }>(
    `SELECT sl.product_id, sl.warehouse_id, p.nama AS produk, w.nama AS gudang,
            SUM(sl.qty_masuk - sl.qty_keluar) AS qty,
            SUM((sl.qty_masuk - sl.qty_keluar) * sl.nilai_unit) AS nilai
     FROM stock_ledger sl
     JOIN products p ON p.id = sl.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     WHERE ${fl.where}
     GROUP BY sl.product_id, sl.warehouse_id`,
    ...fl.params,
  );

  const stok: RincianStok[] = stokRows.map((r) => {
    const qty = Number(r.qty ?? 0);
    const nilai = Number(r.nilai ?? 0);
    const tertulis = qty === 0 ? 0 : nilai; // qty 0 tidak bisa menjadi baris saldo awal
    if (qty === 0 && Math.abs(nilai) > 1) {
      penyebab.push(
        `Stok ${r.produk} di ${r.gudang} bernilai ${uang(nilai)} tetapi jumlahnya 0 — tidak bisa dijadikan Saldo Awal. Periksa Kartu Stok produk ini.`,
      );
    }
    return { product_id: r.product_id, warehouse_id: r.warehouse_id, produk: r.produk, gudang: r.gudang, qty, nilai, tertulis };
  });
  const stokSebelum = stok.reduce((n, s) => n + s.nilai, 0);
  const stokSesudah = stok.reduce((n, s) => n + s.tertulis, 0);

  // --- Kas & Bank: saldo pada batas periode (dibawa jadi Saldo Awal) ---
  const kasRows = await kasBankSampai(batas);
  const kasSebelum = kasRows.reduce((n, a) => n + a.saldo, 0);
  const kas: RincianKas[] = kasRows.map((a) => ({ kode: a.kode, nama: a.nama, jenis: a.jenis, saldo: a.saldo }));

  // --- Rincian piutang/hutang per pelanggan/supplier (saat ini) ---
  const piutangRows = await (await all<{ pelanggan: string; sisa: number }>(
    `SELECT c.nama AS pelanggan, SUM(rv.total - rv.terbayar) AS sisa
     FROM receivables rv
     JOIN sales s ON s.id = rv.sale_id
     JOIN customers c ON c.id = rv.customer_id
     WHERE rv.status IN ('belum', 'sebagian')${l.gudangId != null ? ' AND s.warehouse_id = ?' : ''}
     GROUP BY c.nama ORDER BY sisa DESC`,
    ...(l.gudangId != null ? [l.gudangId] : []),
  )).map((r) => ({ pelanggan: r.pelanggan, sisa: Number(r.sisa ?? 0) }));

  const hutangRows = await (await all<{ supplier: string; sisa: number }>(
    `SELECT sp.nama AS supplier, SUM(y.total - y.terbayar) AS sisa
     FROM payables y
     JOIN purchases p ON p.id = y.purchase_id
     JOIN suppliers sp ON sp.id = y.supplier_id
     WHERE y.status IN ('belum', 'sebagian')${l.gudangId != null ? ' AND p.warehouse_id = ?' : ''}
     GROUP BY sp.nama ORDER BY sisa DESC`,
    ...(l.gudangId != null ? [l.gudangId] : []),
  )).map((r) => ({ supplier: r.supplier, sisa: Number(r.sisa ?? 0) }));

  // --- Tabel perbandingan dua sisi per kategori ---
  // AKUNTANSI DASAR — tanpa jurnal, tanpa Laba Ditahan. Saldo yang dibawa
  // menjadi Saldo Awal hanya: stok, piutang, hutang, dan Kas/Bank.
  const R = (v: number) => Math.round(v);
  const baris: BarisKategori[] = [];
  const tambah = (kategori: string, sebelum: number, sesudah: number, alasan: string | null = null) => {
    const s = R(sebelum);
    const e = R(sesudah);
    baris.push({ kategori, sebelum: s, sesudah: e, selisih: s - e, alasan });
  };

  const piutangSebelum = piutangRows.reduce((n, r) => n + r.sisa, 0);
  const hutangSebelum = hutangRows.reduce((n, r) => n + r.sisa, 0);

  tambah('Stok (per produk & gudang)', stokSebelum, stokSesudah, null);
  tambah('Piutang', piutangSebelum, piutangSebelum, null);
  tambah('Hutang', hutangSebelum, hutangSebelum, null);
  tambah('Kas/Bank', kasSebelum, kasSebelum, null);

  for (const b of baris) {
    if (!b.alasan && Math.abs(b.selisih) > 1) {
      penyebab.push(`Kategori ${b.kategori}: selisih ${uang(b.selisih)} antara Saldo Akhir dan Saldo Awal.`);
    }
  }

  catatan.push(
    'Akuntansi Dasar: Saldo Awal hanya untuk stok, piutang, hutang, dan Kas/Bank — tanpa jurnal pembuka/penutup dan tanpa Laba Ditahan.',
  );

  return {
    batas,
    periodeBaruDari: batas,
    baris,
    rincian: { stok, piutang: piutangRows, hutang: hutangRows, kas },
    stokTotal: stokSebelum,
    kasTotal: kasSebelum,
    cocok: penyebab.length === 0,
    penyebab,
    catatan,
  };
}

// ---------------------------------------------------------------------------
// LANGKAH 2 — backup .xlsx (semua data pada periode terpilih)
// ---------------------------------------------------------------------------

function sheetDari(judul: string, baris: Record<string, unknown>[]): SheetExcel {
  if (baris.length === 0) return { judul, kolom: [{ key: '_kosong', label: '(tidak ada data)' }], baris: [] };
  return { judul, kolom: Object.keys(baris[0]).map((k) => ({ key: k, label: k })), baris };
}

export async function sheetsBackup(l: Lingkup): Promise<SheetExcel[]> {
  const batas = hariBerikutnya(l.sampai);
  const fs = fragSales(l, batas);
  const fpDis = fragPurchases(l, batas, 'disahkan');
  const fpBatal = fragPurchases(l, batas, 'batal');
  const fpGabung: Frag = { where: `(${fpDis.where}) OR (${fpBatal.where})`, params: [...fpDis.params, ...fpBatal.params] };
  const fr = fragReturMasuk(l, batas);
  const fsub = fragSub(l, batas);
  const fop = fragOpname(l, batas);
  const ftr = fragTransfer(l, batas);
  const fl = fragLedger(l, batas);

  const sheets: SheetExcel[] = [];

  // Meta — dipakai lagi untuk memverifikasi file saat "Pulihkan dari Backup".
  const gudangNama =
    l.gudangId != null
      ? await ((await get<{ nama: string }>(`SELECT nama FROM warehouses WHERE id = ?`, l.gudangId)))?.nama ?? ''
      : 'Semua Toko/Gudang';
  sheets.push({
    judul: 'Proses',
    kolom: [
      { key: 'kunci', label: 'kunci' },
      { key: 'nilai', label: 'nilai' },
    ],
    baris: [
      { kunci: 'jenis', nilai: 'backup-proses-tahunan' },
      { kunci: 'gudang_id', nilai: l.gudangId ?? '' },
      { kunci: 'gudang', nilai: gudangNama },
      { kunci: 'sampai', nilai: l.sampai },
      { kunci: 'diunduh_pada', nilai: new Date().toISOString() },
      { kunci: 'aplikasi', nilai: 'NusaSuite' },
    ],
  });

  sheets.push(sheetDari('Penjualan', (await all(`SELECT s.* FROM sales s WHERE ${fs.where} ORDER BY s.id`, ...fs.params))));
  sheets.push(
    sheetDari('Baris Penjualan', (await all(`SELECT si.* FROM sale_items si WHERE si.sale_id IN (SELECT s.id FROM sales s WHERE ${fs.where}) ORDER BY si.id`, ...fs.params))),
  );
  sheets.push(
    sheetDari('Pembayaran Penjualan', (await all(`SELECT sp.* FROM sale_payments sp WHERE sp.sale_id IN (SELECT s.id FROM sales s WHERE ${fs.where}) ORDER BY sp.id`, ...fs.params))),
  );
  sheets.push(
    sheetDari('Piutang', (await all(`SELECT rv.* FROM receivables rv WHERE rv.sale_id IN (SELECT s.id FROM sales s WHERE ${fs.where}) ORDER BY rv.id`, ...fs.params))),
  );
  sheets.push(sheetDari('Retur Masuk', (await all(`SELECT r.* FROM sale_returns r WHERE ${fr.where} ORDER BY r.id`, ...fr.params))));
  sheets.push(
    sheetDari('Baris Retur Masuk', (await all(`SELECT ri.* FROM sale_return_items ri WHERE ri.return_id IN (SELECT r.id FROM sale_returns r WHERE ${fr.where}) ORDER BY ri.id`, ...fr.params))),
  );
  sheets.push(sheetDari('Pembelian', (await all(`SELECT p.* FROM purchases p WHERE ${fpDis.where} ORDER BY p.id`, ...fpDis.params))));
  sheets.push(sheetDari('Retur Keluar', (await all(`SELECT p.* FROM purchases p WHERE ${fpBatal.where} ORDER BY p.id`, ...fpBatal.params))));
  sheets.push(
    sheetDari('Baris Pembelian', (await all(`SELECT pi.* FROM purchase_items pi WHERE pi.purchase_id IN (SELECT p.id FROM purchases p WHERE ${fpGabung.where}) ORDER BY pi.id`, ...fpGabung.params))),
  );
  sheets.push(
    sheetDari('Log Chat Pembelian', (await all(`SELECT cl.* FROM purchase_chat_logs cl WHERE cl.purchase_id IN (SELECT p.id FROM purchases p WHERE ${fpGabung.where}) ORDER BY cl.id`, ...fpGabung.params))),
  );
  sheets.push(
    sheetDari('Hutang', (await all(`SELECT y.* FROM payables y WHERE y.purchase_id IN (SELECT p.id FROM purchases p WHERE ${fpGabung.where}) ORDER BY y.id`, ...fpGabung.params))),
  );
  sheets.push(sheetDari('Persediaan Sub', (await all(`SELECT d.* FROM sub_stock_docs d WHERE ${fsub.where} ORDER BY d.id`, ...fsub.params))));
  sheets.push(
    sheetDari('Baris Persediaan Sub', (await all(`SELECT si.* FROM sub_stock_items si WHERE si.doc_id IN (SELECT d.id FROM sub_stock_docs d WHERE ${fsub.where}) ORDER BY si.id`, ...fsub.params))),
  );
  sheets.push(sheetDari('Opname', (await all(`SELECT o.* FROM opname_sessions o WHERE ${fop.where} ORDER BY o.id`, ...fop.params))));
  sheets.push(
    sheetDari('Baris Opname', (await all(`SELECT oi.* FROM opname_items oi WHERE oi.session_id IN (SELECT o.id FROM opname_sessions o WHERE ${fop.where}) ORDER BY oi.id`, ...fop.params))),
  );
  sheets.push(
    sheetDari('Pindai Opname', (await all(`SELECT os.* FROM opname_scans os WHERE os.session_id IN (SELECT o.id FROM opname_sessions o WHERE ${fop.where}) ORDER BY os.id`, ...fop.params))),
  );
  sheets.push(sheetDari('Mutasi', (await all(`SELECT t.* FROM stock_transfers t WHERE ${ftr.where} ORDER BY t.id`, ...ftr.params))));
  sheets.push(
    sheetDari('Baris Mutasi', (await all(`SELECT ti.* FROM stock_transfer_items ti WHERE ti.transfer_id IN (SELECT t.id FROM stock_transfers t WHERE ${ftr.where}) ORDER BY ti.id`, ...ftr.params))),
  );
  sheets.push(sheetDari('Kartu Stok', (await all(`SELECT sl.* FROM stock_ledger sl WHERE ${fl.where} ORDER BY sl.id`, ...fl.params))));
  sheets.push(
    sheetDari('Jurnal', (await all(`SELECT j.* FROM journals j WHERE j.tanggal < ? AND j.status IN ('disahkan', 'batal') ORDER BY j.id`, batas))),
  );
  sheets.push(
    sheetDari('Baris Jurnal', (await all(
      `SELECT jl.* FROM journal_lines jl WHERE jl.journal_id IN (
         SELECT j.id FROM journals j WHERE j.tanggal < ? AND j.status IN ('disahkan', 'batal')
       ) ORDER BY jl.id`,
      batas,
    ))),
  );

  return sheets;
}

// AKUNTANSI DASAR — tanpa penulisan jurnal (tidak ada jurnal pembuka/penutup).

// ---------------------------------------------------------------------------
// LANGKAH 4 — eksekusi (satu transaksi atomik)
// ---------------------------------------------------------------------------

export interface LaporanProses {
  no_proses: string;
  id: number;
  sampai: string;
  periode_baru_dari: string;
  dihapus: Ringkasan['ringkas'];
  dipertahankan: Tertahan;
  saldo_awal: {
    produk: number;
    nilai_stok: number;
    piutang: number;
    hutang: number;
    kasbank: number;
  };
  stok: { sebelum: number; sesudah: number; sama: boolean };
  penyebab: string[];
  catatan: string[];
}

export async function jalankanProses(l: Lingkup, userId: number | null): Promise<LaporanProses> {
  if (!validTanggal(l.sampai)) throw tolak(400, 'Tanggal batas tidak valid (format yyyy-mm-dd).');
  // Periode yang SAMA belum boleh diproses ulang selama hasilnya masih aktif —
  // jurnal penutup/pembuka periode itu sudah berada di dalam hitungan, memproses
  // ulang tanpa pemulihan akan menggandakan pengaruhnya. Setelah dipulihkan,
  // proses untuk tanggal ini boleh dijalankan lagi.
  const aktif = await get<{ no_proses: string }>(
    `SELECT no_proses FROM annual_processes WHERE sampai = ? AND dipulihkan_pada IS NULL LIMIT 1`,
    l.sampai,
  );
  if (aktif) {
    throw tolak(409, `Periode s.d. ${l.sampai} sudah diproses (${aktif.no_proses}) dan belum dipulihkan — pulihkan dulu bila ingin mengulang.`);
  }
  const gudangNama =
    l.gudangId != null
      ? await ((await get<{ nama: string }>(`SELECT nama FROM warehouses WHERE id = ?`, l.gudangId)))?.nama
      : undefined;
  if (l.gudangId != null && !gudangNama) throw tolak(404, 'Gudang/toko tidak ditemukan.');

  return await withTransaction(async () => {
    // Dihitung SEBELUM penghapusan — inilah jumlah yang benar-benar dihapus.
    const k = await kumpulan(l);
    const p = await pratinjauProses(l);
    if (!p.cocok) {
      throw tolak(409, `Pratinjau saldo awal tidak cocok — proses dibatalkan. ${p.penyebab[0] ?? ''}`);
    }

    // Kebijakan No Retain: seluruh dokumen yang sudah dibatalkan dihapus
    // permanen tanpa memandang tanggal, sehingga tidak ada log "batal"
    // yang tertinggal setelah proses.
    await sapuTransaksiBatal();

    const stokSebelum = Number(await ((await get<{ n: number }>(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances`)))?.n ?? 0);

    const tahun = l.sampai.slice(0, 4);
    const noProses = formatDocumentNumber('PT', tahun, (await nextDocumentSequence(`proses-tahunan-${tahun}`)));
    const idProses = Number(
      await ((await run(
        `INSERT INTO annual_processes (no_proses, gudang_id, sampai, periode_baru_dari, user_id)
         VALUES (?, ?, ?, ?, ?)`,
        noProses,
        l.gudangId,
        l.sampai,
        p.periodeBaruDari,
        userId,
      ))).lastInsertRowid,
    );

    // --- 1) AKUNTANSI DASAR — tanpa jurnal penutup/pembuka & tanpa Laba
    //     Ditahan. Saldo Kas/Bank pada batas periode dikonversi menjadi
    //     Saldo Awal: saldo_awal tiap rekening ditetapkan ke saldo pada
    //     batas, lalu mutasi kas ≤ batas dihapus (pada blok hapus di bawah).
    const kasKonversi = await kasBankSampai(p.batas);
    const kasBankNilai = kasKonversi.reduce((n, a) => n + a.saldo, 0);
    for (const a of kasKonversi) {
      await run(`UPDATE cash_accounts SET saldo_awal = ? WHERE id = ?`, a.saldo, a.id);
    }

    // --- 2) Hapus riwayat transaksi ≤ batas (urut anak → induk) ---
    const fs = fragSales(l, p.batas);
    const fpDis = fragPurchases(l, p.batas, 'disahkan');
    const fpBatal = fragPurchases(l, p.batas, 'batal');
    const fr = fragReturMasuk(l, p.batas);
    const fsub = fragSub(l, p.batas);
    const fop = fragOpname(l, p.batas);
    const ftr = fragTransfer(l, p.batas);
    const fl = fragLedger(l, p.batas);

    // Fragmen WHERE memakai alias (s/p/r/…) — penghapusan dibungkus subquery
    // SELECT id agar alias tetap sah di pernyataan DELETE.
    await run(`DELETE FROM sale_returns WHERE id IN (SELECT r.id FROM sale_returns r WHERE ${fr.where})`, ...fr.params);
    await run(`DELETE FROM receivables WHERE sale_id IN (SELECT s.id FROM sales s WHERE ${fs.where})`, ...fs.params);
    await run(`DELETE FROM sales WHERE id IN (SELECT s.id FROM sales s WHERE ${fs.where})`, ...fs.params);
    await run(
      `DELETE FROM payables WHERE purchase_id IN (SELECT p.id FROM purchases p WHERE ${fpDis.where} OR ${fpBatal.where})`,
      ...fpDis.params,
      ...fpBatal.params,
    );
    await run(`DELETE FROM purchases WHERE id IN (SELECT p.id FROM purchases p WHERE ${fpDis.where})`, ...fpDis.params);
    await run(`DELETE FROM purchases WHERE id IN (SELECT p.id FROM purchases p WHERE ${fpBatal.where})`, ...fpBatal.params);
    await run(`DELETE FROM sub_stock_docs WHERE id IN (SELECT d.id FROM sub_stock_docs d WHERE ${fsub.where})`, ...fsub.params);
    await run(`DELETE FROM opname_sessions WHERE id IN (SELECT o.id FROM opname_sessions o WHERE ${fop.where})`, ...fop.params);
    await run(`DELETE FROM stock_transfers WHERE id IN (SELECT t.id FROM stock_transfers t WHERE ${ftr.where})`, ...ftr.params);

    // Jurnal: disahkan → batal dulu (diizinkan trigger), lalu hapus (baris CASCADE).
    // Jurnal penutup & pembuka milik proses INI tidak boleh ikut terhapus
    // (penutup bertanggal ≤ batas); penanda proses lama memang ikut dihitung ulang.
    await run(
      `UPDATE journals SET status = 'batal'
       WHERE tanggal < ? AND status = 'disahkan'
         AND NOT (sumber_tipe IN ('jurnal_penutup', 'saldo_awal') AND sumber_id = ?)`,
      p.batas,
      idProses,
    );
    await run(
      `DELETE FROM journals WHERE tanggal < ? AND status = 'batal'
         AND NOT (sumber_tipe IN ('jurnal_penutup', 'saldo_awal') AND sumber_id = ?)`,
      p.batas,
      idProses,
    );

    // Kartu stok ≤ batas — termasuk penanda saldo awal proses lama (digabung).
    await run(`DELETE FROM stock_ledger WHERE ${fl.where}`, ...fl.params);

    // --- 4) Tulis baris Saldo Awal di kartu stok ---
    let nilaiStok = 0;
    let produkSaldoAwal = 0;
    for (const s of p.rincian.stok) {
      if (s.qty === 0 || s.tertulis === 0) continue;
      const nilaiUnit = s.nilai / s.qty; // (masuk − keluar) × nilai_unit kembali persis = nilai cutoff
      await run(
        `INSERT INTO stock_ledger (tanggal, product_id, warehouse_id, location_id, tipe_dokumen, dokumen_id,
                                   qty_masuk, qty_keluar, saldo, nilai_unit, user_id)
         VALUES (?, ?, ?, NULL, 'saldo_awal', ?, ?, ?, ?, ?, ?)`,
        isoLokal(p.periodeBaruDari),
        s.product_id,
        s.warehouse_id,
        idProses,
        s.qty > 0 ? s.qty : 0,
        s.qty < 0 ? -s.qty : 0,
        s.qty,
        nilaiUnit,
        userId,
      );
      nilaiStok += s.nilai;
      produkSaldoAwal++;
    }

    // --- 5) Ringkasan, verifikasi stok, dan audit ---
    const ringkas: Ringkasan['ringkas'] = {
      penjualan: k.salesHapus.length,
      pembelian: k.pembelianHapus.length,
      retur_masuk: k.returHapus.length,
      retur_keluar: k.returKeluarHapus.length,
      persediaan_sub: k.subHapus.length,
      opname: k.opnameHapus.length,
      mutasi: k.transferHapus.length,
      jurnal: k.jurnalHapus.length,
      total: 0,
    };
    ringkas.total =
      ringkas.penjualan +
      ringkas.pembelian +
      ringkas.retur_masuk +
      ringkas.retur_keluar +
      ringkas.persediaan_sub +
      ringkas.opname +
      ringkas.mutasi +
      ringkas.jurnal;

    const stokSesudah = Number(await ((await get<{ n: number }>(`SELECT COALESCE(SUM(qty), 0) AS n FROM stock_balances`)))?.n ?? 0);
    if (stokSesudah !== stokSebelum) {
      throw tolak(500, 'Jumlah stok berubah saat proses — transaksi dibatalkan semua.');
    }

    const laporan: LaporanProses = {
      no_proses: noProses,
      id: idProses,
      sampai: l.sampai,
      periode_baru_dari: p.periodeBaruDari,
      dihapus: ringkas,
      dipertahankan: k.tertahan,
      saldo_awal: {
        produk: produkSaldoAwal,
        nilai_stok: nilaiStok,
        piutang: p.baris.find((b) => b.kategori === 'Piutang')?.sesudah ?? 0,
        hutang: p.baris.find((b) => b.kategori === 'Hutang')?.sesudah ?? 0,
        kasbank: kasBankNilai,
      },
      stok: { sebelum: stokSebelum, sesudah: stokSesudah, sama: true },
      penyebab: p.penyebab,
      catatan: p.catatan,
    };

    await run(
      `UPDATE annual_processes SET jumlah_hapus = ?, pratinjau = ? WHERE id = ?`,
      JSON.stringify(ringkas),
      JSON.stringify({ ...p, dipertahankan: k.tertahan, no_proses: noProses }),
      idProses,
    );

    await catatAudit({
      userId,
      aksi: 'proses_tahunan',
      tabel: 'annual_processes',
      recordId: idProses,
      sesudah: {
        no_proses: noProses,
        sampai: l.sampai,
        periode_baru_dari: p.periodeBaruDari,
        gudang: gudangNama ?? 'Semua Toko/Gudang',
        jumlah: ringkas,
      },
      alasan: `Proses Tahunan ${noProses} — hapus riwayat s.d. ${l.sampai}`,
    });

    return laporan;
  });
}

// ---------------------------------------------------------------------------
// Riwayat proses & Bukti Saldo Awal
// ---------------------------------------------------------------------------

export async function daftarProses(): Promise<Record<string, unknown>[]> {
  return await all(
    `SELECT a.id, a.no_proses, a.sampai, a.periode_baru_dari, a.dibuat_pada, a.dipulihkan_pada,
            a.jumlah_hapus, w.nama AS gudang, u.nama AS pengguna
     FROM annual_processes a
     LEFT JOIN warehouses w ON w.id = a.gudang_id
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC`,
  );
}

/** Bukti Saldo Awal: ringkasan + rincian stok/piutang/hutang/kas (Excel). */
export async function buktiProses(id: number): Promise<SheetExcel[]> {
  const pr = await get<{
    id: number;
    no_proses: string;
    sampai: string;
    periode_baru_dari: string;
    jumlah_hapus: string;
    pratinjau: string;
    dibuat_pada: string;
    dipulihkan_pada: string | null;
    gudang: string | null;
    pengguna: string | null;
  }>(
    `SELECT a.id, a.no_proses, a.sampai, a.periode_baru_dari, a.jumlah_hapus, a.pratinjau,
            a.dibuat_pada, a.dipulihkan_pada, w.nama AS gudang, u.nama AS pengguna
     FROM annual_processes a
     LEFT JOIN warehouses w ON w.id = a.gudang_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = ?`,
    id,
  );
  if (!pr) throw tolak(404, 'Proses tahunan tidak ditemukan.');
  const p = JSON.parse(pr.pratinjau || '{}') as Partial<Pratinjau> & { dipertahankan?: Tertahan };
  const jumlah = JSON.parse(pr.jumlah_hapus || '{}') as Partial<Ringkasan['ringkas']>;

  const kunci = (kunci: string, nilai: unknown): Record<string, unknown> => ({ kunci, nilai });
  const sheets: SheetExcel[] = [
    {
      judul: 'Bukti Saldo Awal',
      kolom: [
        { key: 'kunci', label: 'Uraian' },
        { key: 'nilai', label: 'Nilai' },
      ],
      baris: [
        kunci('No. Proses', pr.no_proses),
        kunci('Batas periode (s.d.)', pr.sampai),
        kunci('Saldo Awal berlaku sejak', pr.periode_baru_dari),
        kunci('Toko/Gudang', pr.gudang ?? 'Semua Toko/Gudang'),
        kunci('Dijalankan oleh', pr.pengguna ?? 'Administrator'),
        kunci('Waktu', pr.dibuat_pada),
        kunci('Status', pr.dipulihkan_pada ? `Dipulihkan ${pr.dipulihkan_pada}` : 'Aktif'),
        kunci('', ''),
        kunci('Transaksi terhapus — Penjualan', jumlah.penjualan ?? 0),
        kunci('Transaksi terhapus — Pembelian', jumlah.pembelian ?? 0),
        kunci('Transaksi terhapus — Retur Masuk', jumlah.retur_masuk ?? 0),
        kunci('Transaksi terhapus — Retur Keluar', jumlah.retur_keluar ?? 0),
        kunci('Transaksi terhapus — Persediaan Sub', jumlah.persediaan_sub ?? 0),
        kunci('Transaksi terhapus — Opname', jumlah.opname ?? 0),
        kunci('Transaksi terhapus — Mutasi', jumlah.mutasi ?? 0),
        kunci('Transaksi terhapus — Jurnal', jumlah.jurnal ?? 0),
        kunci('Transaksi terhapus — Total', jumlah.total ?? 0),
      ],
    },
    {
      judul: 'Saldo Akhir vs Saldo Awal',
      kolom: [
        { key: 'kategori', label: 'Kategori' },
        { key: 'sebelum', label: 'Saldo Akhir Sebelum' },
        { key: 'sesudah', label: 'Saldo Awal Sesudah' },
        { key: 'selisih', label: 'Selisih' },
        { key: 'alasan', label: 'Keterangan' },
      ],
      baris: (p.baris ?? []).map((b) => ({ ...b, alasan: b.alasan ?? '' })),
    },
    sheetDari(
      'Saldo Awal Stok',
      (p.rincian?.stok ?? []).map((s) => ({
        produk: s.produk,
        gudang: s.gudang,
        qty: s.qty,
        nilai: s.nilai,
        label: 'Saldo Awal',
      })),
    ),
    sheetDari(
      'Saldo Awal Piutang',
      (p.rincian?.piutang ?? []).map((s) => ({ pelanggan: s.pelanggan, sisa_saldo_akhir: s.sisa, label: 'Saldo Awal' })),
    ),
    sheetDari(
      'Saldo Awal Hutang',
      (p.rincian?.hutang ?? []).map((s) => ({ supplier: s.supplier, sisa_saldo_akhir: s.sisa, label: 'Saldo Awal' })),
    ),
    sheetDari(
      'Saldo Awal Kas/Bank',
      (p.rincian?.kas ?? []).map((a) => ({
        kode: a.kode,
        rekening: a.nama,
        jenis: a.jenis,
        saldo_akhir: a.saldo,
        saldo_awal: a.saldo,
        label: 'Saldo Awal',
      })),
    ),
  ];

  sheets.push(
    sheetDari('Penyebab Diblokir', (p.penyebab ?? []).map((x) => ({ penyebab: x }))),
    sheetDari('Catatan', (p.catatan ?? []).map((x) => ({ catatan: x }))),
  );
  return sheets;
}

// ---------------------------------------------------------------------------
// Pulihkan dari Backup (impor file .xlsx)
// ---------------------------------------------------------------------------

/** Urutan induk → anak; sheet 'Proses' dibaca sebagai meta verifikasi. */
const PETA_PULIH: { sheet: string; tabel: string }[] = [
  { sheet: 'Penjualan', tabel: 'sales' },
  { sheet: 'Baris Penjualan', tabel: 'sale_items' },
  { sheet: 'Pembayaran Penjualan', tabel: 'sale_payments' },
  { sheet: 'Piutang', tabel: 'receivables' },
  { sheet: 'Retur Masuk', tabel: 'sale_returns' },
  { sheet: 'Baris Retur Masuk', tabel: 'sale_return_items' },
  { sheet: 'Pembelian', tabel: 'purchases' },
  { sheet: 'Retur Keluar', tabel: 'purchases' },
  { sheet: 'Baris Pembelian', tabel: 'purchase_items' },
  { sheet: 'Log Chat Pembelian', tabel: 'purchase_chat_logs' },
  { sheet: 'Hutang', tabel: 'payables' },
  { sheet: 'Persediaan Sub', tabel: 'sub_stock_docs' },
  { sheet: 'Baris Persediaan Sub', tabel: 'sub_stock_items' },
  { sheet: 'Opname', tabel: 'opname_sessions' },
  { sheet: 'Baris Opname', tabel: 'opname_items' },
  { sheet: 'Pindai Opname', tabel: 'opname_scans' },
  { sheet: 'Mutasi', tabel: 'stock_transfers' },
  { sheet: 'Baris Mutasi', tabel: 'stock_transfer_items' },
  { sheet: 'Kartu Stok', tabel: 'stock_ledger' },
  { sheet: 'Jurnal', tabel: 'journals' },
  { sheet: 'Baris Jurnal', tabel: 'journal_lines' },
];

interface KolomTabel {
  nama: string;
  tipe: string;
}

async function kolomTabel(tabel: string): Promise<KolomTabel[]> {
  const rows = await all<{ name: string; type: string }>(
    `SELECT column_name AS name, data_type AS type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
    tabel,
  );
  return rows.map((r) => ({ nama: r.name, tipe: r.type ?? 'TEXT' }));
}

function konversiNilai(tipe: string, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return null;
  const t = tipe.toUpperCase();
  if (t.includes('INT')) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (t.includes('REAL') || t.includes('DOUB') || t.includes('NUM')) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'string' || typeof v === 'number' ? v : String(v);
}

export interface LaporanPulih {
  no_proses: string;
  dipulihkan_pada: string;
  per_sheet: { sheet: string; tabel: string; baris: number; dilewati: number }[];
}

export async function pulihkanProses(
  noProses: string,
  buffer: Buffer,
  userId: number | null,
): Promise<LaporanPulih> {
  const pr = await get<{ id: number; sampai: string; gudang_id: number | null; dipulihkan_pada: string | null }>(
    `SELECT id, sampai, gudang_id, dipulihkan_pada FROM annual_processes WHERE no_proses = ?`,
    noProses,
  );
  if (!pr) throw tolak(404, `Proses ${noProses} tidak ditemukan.`);
  if (pr.dipulihkan_pada) throw tolak(409, `Proses ${noProses} sudah pernah dipulihkan.`);

  // Proses lebih baru yang BELUM dipulihkan? — pulihkan dari yang terbaru dulu.
  // (Proses lebih baru yang sudah dipulihkan tidak menghalangi: status database
  //  sudah kembali ke kondisi setelah proses ini, jadi rantai pemulihan boleh lanjut.)
  const lebihBaru = await get<{ no_proses: string }>(
    `SELECT no_proses FROM annual_processes WHERE id > ? AND dipulihkan_pada IS NULL ORDER BY id LIMIT 1`,
    pr.id,
  );
  if (lebihBaru) {
    throw tolak(409, `Sudah ada proses lebih baru (${lebihBaru.no_proses}) — pulihkan proses terbaru terlebih dahulu.`);
  }

  const dokumen = await bacaExcelMulti(buffer);
  const meta = dokumen.find((s) => s.judul === 'Proses');
  if (!meta || !meta.baris.some((r) => String(r.kunci ?? '') === 'jenis' && String(r.nilai ?? '') === 'backup-proses-tahunan')) {
    throw tolak(400, 'Bukan file backup Proses Tahunan yang valid.');
  }
  const metaMap = new Map(meta.baris.map((r) => [String(r.kunci ?? ''), String(r.nilai ?? '')]));
  if (metaMap.get('sampai') && metaMap.get('sampai') !== pr.sampai) {
    throw tolak(409, `File backup untuk s.d. ${metaMap.get('sampai')}, sedangkan proses ${noProses} untuk s.d. ${pr.sampai}.`);
  }

  const per_sheet: LaporanPulih['per_sheet'] = [];
  // Status asli jurnal disimpan saat insert (masuk sebagai 'draft') lalu
  // dikembalikan setelah semua baris jurnal masuk.
  const statusJurnal: { id: number; status: string }[] = [];

  const hasil = await withTransaction(async () => {
    // 1) Hapus penanda proses ini: jurnal penutup/pembuka & baris saldo_awal.
    const jurnals = await all<{ id: number }>(
      `SELECT id FROM journals WHERE sumber_tipe IN ('jurnal_penutup', 'saldo_awal') AND sumber_id = ?`,
      pr.id,
    );
    if (jurnals.length) {
      await run(
        `UPDATE journals SET status = 'batal' WHERE id IN (${jurnals.map(() => '?').join(',')}) AND status = 'disahkan'`,
        ...jurnals.map((j) => j.id),
      );
      await run(
        `DELETE FROM journals WHERE id IN (${jurnals.map(() => '?').join(',')})`,
        ...jurnals.map((j) => j.id),
      );
    }
    await run(`DELETE FROM stock_ledger WHERE tipe_dokumen = 'saldo_awal' AND dokumen_id = ?`, pr.id);

    // 2) Masukkan kembali baris backup per sheet (induk → anak).
    for (const peta of PETA_PULIH) {
      const sh = dokumen.find((s) => s.judul === peta.sheet);
      if (!sh) continue;
      const baris = sh.baris.filter((r) => Object.values(r).some((v) => v !== null && v !== ''));
      const kolom = await kolomTabel(peta.tabel);
      const namaKolom = new Set(kolom.map((c) => c.nama));
      const tipeKolom = new Map(kolom.map((c) => [c.nama, c.tipe]));
      let masuk = 0;
      let dilewati = 0;

      for (const baris_ of baris) {
        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(baris_)) {
          if (!namaKolom.has(k)) continue;
          cols.push(k);
          vals.push(konversiNilai(tipeKolom.get(k) ?? 'TEXT', v));
        }
        if (cols.length === 0) continue;
        const id = Number((baris_ as { id?: unknown }).id ?? NaN);
        const ada =
          Number.isFinite(id) && (await get<{ id: number }>(`SELECT id FROM ${peta.tabel} WHERE id = ?`, id) ? true : false);
        if (ada) {
          dilewati++;
          continue;
        }
        if (peta.tabel === 'journals') {
          // Baris jurnal dimasukkan sebagai 'draft' dulu; status asli dikembalikan
          // setelah semua baris jurnal & barisnya masuk (trigger induk disahkan).
          const statusAsli = String((baris_ as { status?: unknown }).status ?? 'draft');
          const i = cols.indexOf('status');
          if (i >= 0) vals[i] = 'draft';
          else {
            cols.push('status');
            vals.push('draft');
          }
          await run(`INSERT INTO ${peta.tabel} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals);
          const idBaru = Number((baris_ as { id?: unknown }).id);
          if (Number.isFinite(idBaru)) statusJurnal.push({ id: idBaru, status: statusAsli });
          masuk++;
          continue;
        }
        await run(`INSERT INTO ${peta.tabel} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals);
        masuk++;
      }
      per_sheet.push({ sheet: peta.sheet, tabel: peta.tabel, baris: masuk, dilewati });
    }

    // 2b) Kembalikan status jurnal asli (draft → disahkan/batal; baris sudah lengkap).
    for (const j of statusJurnal) {
      if (j.status === 'draft') continue;
      await run(`UPDATE journals SET status = ? WHERE id = ?`, j.status, j.id);
    }

    // 3) Tandai proses sebagai dipulihkan + audit.
    const waktu = new Date().toISOString();
    await run(`UPDATE annual_processes SET dipulihkan_pada = ? WHERE id = ?`, waktu, pr.id);
    await catatAudit({
      userId,
      aksi: 'pulihkan',
      tabel: 'annual_processes',
      recordId: pr.id,
      alasan: `Pulihkan dari backup Proses Tahunan ${noProses}`,
    });
    return waktu;
  });

  return { no_proses: noProses, dipulihkan_pada: hasil, per_sheet };
}

// ---------------------------------------------------------------------------
// Verifikasi ulang kata sandi (Langkah 4)
// ---------------------------------------------------------------------------

/**
 * Verifikasi kata sandi PENGGUNA AKTIF (bcrypt) untuk aksi sensitif.
 * Standar baru: hash diambil dari akun yang sedang login (userId), bukan
 * pengguna pertama di tabel. PIN supervisor HANYA fallback bila akun belum
 * punya sandi ('!' / kosong) — bukan pengganti verifikasi utama.
 */
export async function verifikasiSandiAktif(userId: number, input: string): Promise<boolean> {
  if (!input || !Number.isInteger(userId)) return false;
  const u = await get<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = ?`, userId);
  const hash = u?.password_hash ?? null;
  if (hash && hash !== '!' && hash.startsWith('$2')) {
    try { if (bcrypt.compareSync(input, hash)) return true; } catch { /* jatuh ke PIN */ }
    return false;
  }
  // Fallback lama (akun tanpa sandi): SHA-256 cocok dengan PIN supervisor.
  const sha = crypto.createHash('sha256').update(input).digest('hex');
  const pin = await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'pin_supervisor'`);
  return !!pin?.nilai && pin.nilai === sha;
}

/**
 * Kompat lama: verifikasi terhadap pengguna pertama (dipakai bila userId
 * tidak tersedia). Rute reset/proses-tahunan WAJIB memakai verifikasiSandiAktif.
 * @deprecated gunakan verifikasiSandiAktif(userId, input).
 */
export async function cocokKataSandi(input: string): Promise<boolean> {
  if (!input) return false;
  const u = await get<{ id: number; password_hash: string }>(`SELECT id, password_hash FROM users ORDER BY id LIMIT 1`);
  if (u && await verifikasiSandiAktif(Number(u.id), input)) return true;
  // Kompat ekstra: hash SHA-256 lama (pra-bcrypt) + PIN supervisor.
  const sha = crypto.createHash('sha256').update(input).digest('hex');
  if (u?.password_hash && u.password_hash !== '!' && u.password_hash === sha) return true;
  const pin = await get<{ nilai: string | null }>(`SELECT nilai FROM settings WHERE kunci = 'pin_supervisor'`);
  if (pin?.nilai && pin.nilai === sha) return true;
  return false;
}
