import { Router } from 'express';
import { all, get, run } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { tulisExcelMulti, type SheetExcel } from '../lib/excel.ts';
import {
  bacaFilter,
  bersihCacheLaporan,
  denganCache,
  klausaStatus,
  klausulLingkup,
  ringkasFilter,
  type FilterLaporan,
} from '../lib/laporanDasar.ts';
import { labelZona, regional } from '../lib/zonaWaktu.ts';
import { rincianPembelianBersih } from '../lib/pembelianBersih.ts';
import { idGudangSesi, wajibGudangDiizinkan } from '../lib/hak.ts';

/* ========================= Tipe dasar laporan (N4) ======================== */

export interface KolomLaporan {
  kunci: string;
  label: string;
  tipe: 'teks' | 'angka' | 'rupiah' | 'tanggal' | 'waktu' | 'persen';
}

export interface KartuLaporan {
  kunci: string;
  label: string;
  nilai: number;
  format: 'rupiah' | 'angka' | 'persen';
  /** Nilai periode pembanding bila filter "Bandingkan" aktif (N1). */
  lalu?: number | null;
}

export interface HasilLaporan {
  kartu: KartuLaporan[];
  rows: Record<string, unknown>[];
  terbatas?: boolean;
}

export interface DefLaporan {
  judul: string;
  kategori: string;
  deskripsi: string;
  kolom: KolomLaporan[];
  grafik: 'garis' | 'batang' | 'donat' | null;
  /** Kolom sumbu-x & seri grafik (kunci harus ada pada rows). */
  grafikKunci?: { x: string; seri: string[] };
  /** Kunci kolom yang dijadikan kartu ringkasan (bawaan: kolom numerik pertama). */
  kartuKunci?: { kunci: string; label: string; format: 'rupiah' | 'angka' | 'persen' }[];
  jalan: (f: FilterLaporan, q: Record<string, string>) => Promise<HasilLaporan>;
}

type Baris = Record<string, unknown>;

/* ============================ Pembantu SQL (N6) =========================== */

/** Bandingkan tanggal aman untuk format "…Z" maupun "… …". */
const tgl = (kolom: string): string => kolom;
const argPeriode = (f: FilterLaporan): unknown[] => [f.batasAwal, f.batasAkhir];
const wherePeriode = (kolom: string): string => `${tgl(kolom)} >= ?::timestamptz AND ${tgl(kolom)} <= ?::timestamptz`;

/** WHERE penjualan dengan seluruh filter global (alias tabel `s`). */
/** Terapkan filter gudang eksplisit ATAU isolasi sesi ("Semua gudang"). */
function pakaiGudang(f: FilterLaporan, s: string[], a: unknown[], kondisi: string, alias: string): void {
  if (f.gudang) {
    s.push(kondisi);
    a.push(f.gudang);
    return;
  }
  const b = klausulLingkup(f, alias);
  if (b.sql) {
    s.push(b.sql);
    a.push(...b.arg);
  }
}

function wherePenjualan(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const s: string[] = [wherePeriode('s.tanggal')];
  const a: unknown[] = argPeriode(f);
  const st = klausaStatus('s.status', f);
  if (st.sql) {
    s.push(st.sql.replace(/^ AND /, ''));
    a.push(...st.arg);
  }
  pakaiGudang(f, s, a, 's.warehouse_id = ?', 's');
  if (f.kasir) { s.push('s.kasir_id = ?'); a.push(f.kasir); }
  if (f.pelanggan) { s.push('s.customer_id = ?'); a.push(f.pelanggan); }
  if (f.metode) { s.push(`EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.metode = ?)`); a.push(f.metode); }
  return { sql: `WHERE ${s.join(' AND ')}`, arg: a };
}

/** WHERE pembelian (alias `p`). */
function wherePembelian(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const s: string[] = [wherePeriode('p.tanggal')];
  const a: unknown[] = argPeriode(f);
  const st = klausaStatus('p.status', f);
  if (st.sql) {
    s.push(st.sql.replace(/^ AND /, ''));
    a.push(...st.arg);
  }
  pakaiGudang(f, s, a, 'p.warehouse_id = ?', 'p');
  if (f.pemasok) { s.push('p.supplier_id = ?'); a.push(f.pemasok); }
  return { sql: `WHERE ${s.join(' AND ')}`, arg: a };
}

/** WHERE item penjualan (join wajib `sales s ON s.id = si.sale_id`). */
function whereItemPenjualan(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const w = wherePenjualan(f);
  const s = [w.sql.slice('WHERE '.length)];
  const a = [...w.arg];
  if (f.kategori) { s.push('p.category_id = ?'); a.push(f.kategori); }
  if (f.merek) { s.push('p.brand_id = ?'); a.push(f.merek); }
  if (f.produk) { s.push('si.product_id = ?'); a.push(f.produk); }
  return { sql: `WHERE ${s.join(' AND ')}`, arg: a };
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Format qty REAL tanpa ".0" (6 → "6", 1.5 → "1.5") untuk rincian barang. */
const FMT_QTY = (k: string): string =>
  `CASE WHEN ${k} = CAST(${k} AS INTEGER) THEN CAST(CAST(${k} AS INTEGER) AS TEXT) ELSE CAST(${k} AS TEXT) END`;

/** Sub-kueri rincian "nama ×qty" tiap dokumen (dipakai laporan transaksi). */
const RINCI_JUAL = (fk: string): string =>
  `COALESCE((SELECT GROUP_CONCAT(si.nama_produk || ' ×' || ${FMT_QTY('si.qty')}, '; ') FROM sale_items si WHERE si.sale_id = ${fk}), '—')`;
const RINCI_BELI = (fk: string): string =>
  `COALESCE((SELECT GROUP_CONCAT(pi.nama_produk || ' ×' || ${FMT_QTY('pi.qty')}, '; ') FROM purchase_items pi WHERE pi.purchase_id = ${fk}), '—')`;
const RINCI_RETUR_JUAL = (fk: string): string =>
  `COALESCE((SELECT GROUP_CONCAT(sri.nama_produk || ' ×' || ${FMT_QTY('sri.qty')}, '; ') FROM sale_return_items sri WHERE sri.return_id = ${fk}), '—')`;

/** Sub-kueri rata-rata bergerak per (produk, gudang) — valuasi HPP (alias `sb`). */
const SUB_RATA = `(
  SELECT CASE WHEN COALESCE(SUM(l.qty_masuk) - SUM(l.qty_keluar), 0) > 0
    THEN (COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0) - COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0))
         / (SUM(l.qty_masuk) - SUM(l.qty_keluar))
    ELSE 0 END
  FROM stock_ledger l
  WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id
)`;

/** WHERE laporan pembelian per item (alias `pi`, join `products pr`, `purchases p`). */
function whereItemPembelian(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const w = wherePembelian(f);
  const s = [w.sql.replace(/^WHERE /, '')];
  const a = [...w.arg];
  if (f.kategori) { s.push('pr.category_id = ?'); a.push(f.kategori); }
  if (f.merek) { s.push('pr.brand_id = ?'); a.push(f.merek); }
  if (f.produk) { s.push('pi.product_id = ?'); a.push(f.produk); }
  return { sql: `WHERE ${s.join(' AND ')}`, arg: a };
}

/** Jumlah item berbeda maksimum dalam sel rincian agregat (sisanya "+N lainnya"). */
const RINCI_BATAS = 15;

/** Filter global penjualan untuk sub-kueri rincian per baris (alias dalam: s2/si2/p2). */
function saringRinciJual(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const s: string[] = [`${tgl('s2.tanggal')} >= ?::timestamptz`, `${tgl('s2.tanggal')} <= ?::timestamptz`];
  const a: unknown[] = [f.batasAwal, f.batasAkhir];
  const st = klausaStatus('s2.status', f);
  if (st.sql) { s.push(st.sql.replace(/^ AND /, '')); a.push(...st.arg); }
  pakaiGudang(f, s, a, 's2.warehouse_id = ?', 's2');
  if (f.kasir) { s.push('s2.kasir_id = ?'); a.push(f.kasir); }
  if (f.pelanggan) { s.push('s2.customer_id = ?'); a.push(f.pelanggan); }
  if (f.metode) { s.push('EXISTS (SELECT 1 FROM sale_payments sp2 WHERE sp2.sale_id = s2.id AND sp2.metode = ?)'); a.push(f.metode); }
  if (f.kategori) { s.push('p2.category_id = ?'); a.push(f.kategori); }
  if (f.merek) { s.push('p2.brand_id = ?'); a.push(f.merek); }
  if (f.produk) { s.push('si2.product_id = ?'); a.push(f.produk); }
  return { sql: s.join(' AND '), arg: a };
}

/** Filter global pembelian untuk sub-kueri rincian per baris (alias dalam: pp2/pi2/pr2). */
function saringRinciBeli(f: FilterLaporan): { sql: string; arg: unknown[] } {
  const s: string[] = [`${tgl('pp2.tanggal')} >= ?::timestamptz`, `${tgl('pp2.tanggal')} <= ?::timestamptz`];
  const a: unknown[] = [f.batasAwal, f.batasAkhir];
  const st = klausaStatus('pp2.status', f);
  if (st.sql) { s.push(st.sql.replace(/^ AND /, '')); a.push(...st.arg); }
  pakaiGudang(f, s, a, 'pp2.warehouse_id = ?', 'pp2');
  if (f.pemasok) { s.push('pp2.supplier_id = ?'); a.push(f.pemasok); }
  if (f.kategori) { s.push('pr2.category_id = ?'); a.push(f.kategori); }
  if (f.merek) { s.push('pr2.brand_id = ?'); a.push(f.merek); }
  if (f.produk) { s.push('pi2.product_id = ?'); a.push(f.produk); }
  return { sql: s.join(' AND '), arg: a };
}

/**
 * Kolom "rincian_barang" untuk laporan agregat penjualan: 15 barang teratas
 * per grup ("Nama ×qty; …") plus "… (+N lainnya)" bila lebih. Satu CTE `d`
 * dipakai untuk menghitung & menggabung sehingga argumen placeholder sekali.
 */
function kolomRinciJual(f: FilterLaporan, kunciGrup: string): { sql: string; arg: unknown[] } {
  const w = saringRinciJual(f);
  const d = `SELECT si2.nama_produk AS nama_produk, SUM(si2.qty) AS qty
     FROM sale_items si2
     JOIN sales s2 ON s2.id = si2.sale_id
     JOIN products p2 ON p2.id = si2.product_id
     WHERE ${w.sql} AND ${kunciGrup}
     GROUP BY si2.product_id, si2.nama_produk
     ORDER BY SUM(si2.qty) DESC`;
  const gabung = `SELECT GROUP_CONCAT(y.nama_produk || ' ×' || ${FMT_QTY('y.qty')}, '; ') FROM (SELECT * FROM d LIMIT ${RINCI_BATAS}) y`;
  const sql = `COALESCE((WITH d AS (${d})
    SELECT CASE WHEN (SELECT COUNT(*) FROM d) > ${RINCI_BATAS}
      THEN (${gabung}) || ' … (+' || ((SELECT COUNT(*) FROM d) - ${RINCI_BATAS}) || ' lainnya)'
      ELSE (${gabung}) END), '—') AS rincian_barang`;
  return { sql, arg: w.arg };
}

/** Kolom "rincian_barang" untuk laporan agregat pembelian (cermin penjualan). */
function kolomRinciBeli(f: FilterLaporan, kunciGrup: string): { sql: string; arg: unknown[] } {
  const w = saringRinciBeli(f);
  const d = `SELECT pi2.nama_produk AS nama_produk, SUM(pi2.qty) AS qty
     FROM purchase_items pi2
     JOIN purchases pp2 ON pp2.id = pi2.purchase_id
     JOIN products pr2 ON pr2.id = pi2.product_id
     WHERE ${w.sql} AND ${kunciGrup}
     GROUP BY pi2.product_id, pi2.nama_produk
     ORDER BY SUM(pi2.qty) DESC`;
  const gabung = `SELECT GROUP_CONCAT(y.nama_produk || ' ×' || ${FMT_QTY('y.qty')}, '; ') FROM (SELECT * FROM d LIMIT ${RINCI_BATAS}) y`;
  const sql = `COALESCE((WITH d AS (${d})
    SELECT CASE WHEN (SELECT COUNT(*) FROM d) > ${RINCI_BATAS}
      THEN (${gabung}) || ' … (+' || ((SELECT COUNT(*) FROM d) - ${RINCI_BATAS}) || ' lainnya)'
      ELSE (${gabung}) END), '—') AS rincian_barang`;
  return { sql, arg: w.arg };
}

/** Maksimum baris item per grup pada rincian_detail JSON (UI + PDF + Excel). */
const RINCI_DETAIL_BATAS = 50;

/**
 * Rincian item penjualan per grup sebagai JSON (template "terbuka ke bawah").
 * Kolom: tanggal, nomor, barang, qty, harga, subtotal, laba.
 * `kondisiGrup` memakai alias dalam s2/si2/p2 vs alias luar
 * (cth: 's2.customer_id IS NOT DISTINCT FROM s.customer_id' — padanan
 * NULL-aman dari `IS` SQLite; `IS` biner TIDAK valid di PostgreSQL).
 */
function detailRinciJual(f: FilterLaporan, kondisiGrup: string, batas = RINCI_DETAIL_BATAS): { sql: string; arg: unknown[] } {
  const w = saringRinciJual(f);
  const inner = `SELECT (s2.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, s2.no_dokumen AS nomor, si2.nama_produk AS barang, si2.qty AS qty, si2.harga AS harga, (si2.subtotal - si2.diskon) AS subtotal, (si2.subtotal - si2.diskon - si2.hpp) AS laba FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id JOIN products p2 ON p2.id = si2.product_id WHERE ${w.sql} AND ${kondisiGrup} ORDER BY s2.tanggal DESC, si2.id DESC LIMIT ${batas}`;
  const sql = `COALESCE((SELECT jsonb_agg(jsonb_build_object('tanggal', x.tanggal, 'nomor', x.nomor, 'barang', x.barang, 'qty', x.qty, 'harga', x.harga, 'subtotal', x.subtotal, 'laba', x.laba)) FROM (${inner}) x), '[]') AS rincian_detail`;
  return { sql, arg: w.arg };
}

/** Rincian item pembelian per grup sebagai JSON (tanpa laba). */
function detailRinciBeli(f: FilterLaporan, kondisiGrup: string, batas = RINCI_DETAIL_BATAS): { sql: string; arg: unknown[] } {
  const w = saringRinciBeli(f);
  const inner = `SELECT (pp2.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, pp2.no_dokumen AS nomor, pi2.nama_produk AS barang, pi2.qty AS qty, pi2.harga_beli AS harga, pi2.subtotal AS subtotal FROM purchase_items pi2 JOIN purchases pp2 ON pp2.id = pi2.purchase_id JOIN products pr2 ON pr2.id = pi2.product_id WHERE ${w.sql} AND ${kondisiGrup} ORDER BY pp2.tanggal DESC, pi2.id DESC LIMIT ${batas}`;
  const sql = `COALESCE((SELECT jsonb_agg(jsonb_build_object('tanggal', x.tanggal, 'nomor', x.nomor, 'barang', x.barang, 'qty', x.qty, 'harga', x.harga, 'subtotal', x.subtotal)) FROM (${inner}) x), '[]') AS rincian_detail`;
  return { sql, arg: w.arg };
}

/** Rincian satu dokumen penjualan (tanpa filter global — ikut baris dokumennya). */
const detailDokJual = (fkLuar: string, batas = 200, zona = 'Asia/Jakarta'): string =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('tanggal', x.tanggal, 'nomor', x.nomor, 'barang', x.barang, 'qty', x.qty, 'harga', x.harga, 'subtotal', x.subtotal, 'laba', x.laba)) FROM (SELECT (s2.tanggal AT TIME ZONE '${zona}') AS tanggal, s2.no_dokumen AS nomor, si2.nama_produk AS barang, si2.qty AS qty, si2.harga AS harga, (si2.subtotal - si2.diskon) AS subtotal, (si2.subtotal - si2.diskon - si2.hpp) AS laba FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id WHERE si2.sale_id = ${fkLuar} ORDER BY si2.id LIMIT ${batas}) x), '[]') AS rincian_detail`;

/** Rincian satu dokumen pembelian. */
const detailDokBeli = (fkLuar: string, batas = 200, zona = 'Asia/Jakarta'): string =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('tanggal', x.tanggal, 'nomor', x.nomor, 'barang', x.barang, 'qty', x.qty, 'harga', x.harga, 'subtotal', x.subtotal)) FROM (SELECT (pp2.tanggal AT TIME ZONE '${zona}') AS tanggal, pp2.no_dokumen AS nomor, pi2.nama_produk AS barang, pi2.qty AS qty, pi2.harga_beli AS harga, pi2.subtotal AS subtotal FROM purchase_items pi2 JOIN purchases pp2 ON pp2.id = pi2.purchase_id WHERE pi2.purchase_id = ${fkLuar} ORDER BY pi2.id LIMIT ${batas}) x), '[]') AS rincian_detail`;

/** Rincian satu dokumen retur penjualan. */
const detailDokReturJual = (fkLuar: string, batas = 200, zona = 'Asia/Jakarta'): string =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('tanggal', x.tanggal, 'nomor', x.nomor, 'barang', x.barang, 'qty', x.qty, 'harga', x.harga, 'subtotal', x.subtotal)) FROM (SELECT (sr2.tanggal AT TIME ZONE '${zona}') AS tanggal, sr2.no_dokumen AS nomor, sri2.nama_produk AS barang, sri2.qty AS qty, sri2.harga AS harga, (sri2.qty * sri2.harga) AS subtotal FROM sale_return_items sri2 JOIN sale_returns sr2 ON sr2.id = sri2.return_id WHERE sri2.return_id = ${fkLuar} ORDER BY sri2.id LIMIT ${batas}) x), '[]') AS rincian_detail`;

/**
 * Gabung agregat item per penjualan (satu baris per struk) untuk laporan agregat.
 * Mencegah penggandaan jumlah level-struk (omzet, diskon, pajak) saat satu
 * penjualan memuat banyak barang — template "Total rincian = Omzet" menuntut ini.
 * Filter produk/kategori/merek dibawa di dalam sub-kueri (argumen g.arg).
 */
function gabungItemJual(f: FilterLaporan, aliasLuar = 's'): { join: string; arg: unknown[] } {
  const s: string[] = [];
  const a: unknown[] = [];
  if (f.kategori) { s.push('p.category_id = ?'); a.push(f.kategori); }
  if (f.merek) { s.push('p.brand_id = ?'); a.push(f.merek); }
  if (f.produk) { s.push('si.product_id = ?'); a.push(f.produk); }
  const w = s.length ? `WHERE ${s.join(' AND ')}` : '';
  return {
    join: `JOIN (SELECT si.sale_id AS sale_id, COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS lb, COALESCE(SUM(si.qty), 0) AS qty FROM sale_items si JOIN products p ON p.id = si.product_id ${w} GROUP BY si.sale_id) si ON si.sale_id = ${aliasLuar}.id`,
    arg: a,
  };
}

/** Rincian satu sesi opname (hanya selisih). */
const detailDokOpname = (fkLuar: string, batas = 200): string =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('barang', x.barang, 'qty', x.selisih, 'sistem', x.sistem, 'fisik', x.fisik, 'selisih', x.selisih)) FROM (SELECT pr.nama AS barang, oi2.qty_sistem AS sistem, oi2.qty_fisik AS fisik, oi2.selisih AS selisih FROM opname_items oi2 JOIN products pr ON pr.id = oi2.product_id WHERE oi2.session_id = ${fkLuar} AND oi2.selisih <> 0 ORDER BY ABS(oi2.selisih) DESC LIMIT ${batas}) x), '[]') AS rincian_detail`;

/** Akun kas/bank/QRIS untuk laporan keuangan. */
const AKUN_KAS = `(a.kode IN ('1001', '1002', '1003')
  OR (a.tipe = 'aset' AND (UPPER(a.nama) LIKE '%KAS%' OR UPPER(a.nama) LIKE '%BANK%' OR UPPER(a.nama) LIKE '%QRIS%')))`;

/** Total baris numerik — dipakai baris "Total" di bawah tabel (persen = rata-rata). */
function hitungTotal(rows: Baris[], kolom: KolomLaporan[]): Baris {
  const t: Baris = { _total: true };
  for (const k of kolom) {
    if (k.tipe === 'rupiah' || k.tipe === 'angka') {
      t[k.kunci] = rows.reduce((a, r) => a + num(r[k.kunci]), 0);
    } else if (k.tipe === 'persen') {
      t[k.kunci] = rows.length
        ? Math.round((rows.reduce((a, r) => a + num(r[k.kunci]), 0) / rows.length) * 10) / 10
        : 0;
    }
  }
  return t;
}

function kartuDari(
  def: Pick<DefLaporan, 'kolom' | 'kartuKunci'>,
  rows: Baris[],
): KartuLaporan[] {
  const pilihan =
    def.kartuKunci ??
    def.kolom
      .filter((k) => k.tipe === 'rupiah' || k.tipe === 'angka')
      .slice(0, 3)
      .map((k) => ({ kunci: k.kunci, label: k.label, format: (k.tipe === 'rupiah' ? 'rupiah' : 'angka') as 'rupiah' | 'angka' }));
  return pilihan.map((p) => {
    const jumlah = rows.reduce((a, r) => a + num(r[p.kunci]), 0);
    const nilai = p.format === 'persen' && rows.length ? jumlah / rows.length : jumlah;
    return { kunci: p.kunci, label: p.label, nilai, format: p.format };
  });
}

/** Agregat qty pembelian per dokumen (LEFT JOIN — dokumen tanpa item tetap dihitung). */
function gabungItemBeli(): { join: string } {
  return {
    join: `LEFT JOIN (SELECT pi.purchase_id AS purchase_id, COALESCE(SUM(pi.qty), 0) AS qty FROM purchase_items pi GROUP BY pi.purchase_id) pi ON pi.purchase_id = p.id`,
  };
}

/**
 * Kontribusi % tiap baris terhadap total kolom nilai (dihitung di JS agar
 * konsisten dengan angka yang tampil; 1 desimal; 0 bila total kosong).
 */
function denganKontribusi(rows: Baris[], kunciNilai: string): Baris[] {
  const total = rows.reduce((a, r) => a + num(r[kunciNilai]), 0);
  for (const r of rows) {
    r.kontribusi = total > 0 ? Math.round((num(r[kunciNilai]) / total) * 1000) / 10 : 0;
  }
  return rows;
}

/**
 * Empat kartu ringkasan standar sub-laporan dimensi (bagian atas laporan):
 * Total Transaksi | Total Qty | Total Nominal | Rata-rata per Transaksi.
 */
function kartuEmpat(rows: Baris[], labelQty: string, labelNominal: string, kunciNominal: string): KartuLaporan[] {
  const trx = rows.reduce((a, r) => a + num(r.jumlah_transaksi), 0);
  const qty = rows.reduce((a, r) => a + num(r.qty), 0);
  const nominal = rows.reduce((a, r) => a + num(r[kunciNominal]), 0);
  return [
    { kunci: 'jumlah_transaksi', label: 'Total Transaksi', nilai: trx, format: 'angka' },
    { kunci: 'qty', label: labelQty, nilai: qty, format: 'angka' },
    { kunci: kunciNominal, label: labelNominal, nilai: nominal, format: 'rupiah' },
    { kunci: 'aov', label: 'Rata-rata / Transaksi', nilai: trx > 0 ? Math.round(nominal / trx) : 0, format: 'rupiah' },
  ];
}

/** Pindahkan filter ke rentang pembanding (N1). */
export function filterBanding(f: FilterLaporan): FilterLaporan {
  return {
    ...f,
    dari: f.bandingDari,
    sampai: f.bandingSampai,
    batasAwal: f.bandingAwal,
    batasAkhir: f.bandingAkhir,
  };
}

/* ============================= Registri laporan =========================== */

const KOLS = (...k: [string, string, KolomLaporan['tipe']][]): KolomLaporan[] =>
  k.map(([kunci, label, tipe]) => ({ kunci, label, tipe }));

/** Nilai persediaan pada batas waktu tertentu (rata-rata bergerak per gudang). */
async function nilaiPersediaan(batas: string | null, f: FilterLaporan): Promise<number> {
  // ISOLASI GUDANG — nilai stok hanya dari gudang filter/sesi.
  let saring = f.gudang ? 'AND sb.warehouse_id = ?' : '';
  const arg: unknown[] = f.gudang ? [f.gudang] : [];
  if (!f.gudang) {
    const b = klausulLingkup(f, 'sb');
    if (b.sql === '1 = 0') return 0;
    if (b.sql) {
      saring = `AND ${b.sql}`;
      arg.push(...b.arg);
    }
  }
  const batasSql = batas ? `AND l.tanggal <= ?::timestamptz` : '';
  const argBatas = batas ? [batas] : [];
  const row = await get<{ nilai: number | null }>(
    `SELECT COALESCE(SUM(qty_c * CASE WHEN qty_c > 0 THEN nilai_c / qty_c ELSE 0 END), 0) AS nilai
     FROM (
       SELECT sb.product_id, sb.warehouse_id,
         (SELECT COALESCE(SUM(l.qty_masuk - l.qty_keluar), 0) FROM stock_ledger l
           WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id ${batasSql}) AS qty_c,
         (SELECT COALESCE(SUM(l.qty_masuk * l.nilai_unit) - SUM(l.qty_keluar * l.nilai_unit), 0) FROM stock_ledger l
           WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id ${batasSql}) AS nilai_c
       FROM stock_balances sb
       WHERE 1 = 1 ${saring}
     )`,
    ...argBatas,
    ...argBatas,
    ...arg,
  );
  return num(row?.nilai);
}

/** Kartu Ringkasan (N1): KPI + perbandingan periode sebelumnya. */
async function ringkasanKPI(f: FilterLaporan): Promise<KartuLaporan[]> {
  const omzet = async (x: FilterLaporan): Promise<number> =>
    num(await ((await get<{ v: number }>(
      `SELECT COALESCE(SUM(s.subtotal - s.diskon), 0) AS v FROM sales s ${wherePenjualan(x).sql}`,
      ...wherePenjualan(x).arg,
    )))?.v);
  const laba = async (x: FilterLaporan): Promise<number> =>
    num(await ((await get<{ v: number }>(
      `SELECT COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS v
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id ${whereItemPenjualan(x).sql}`,
      ...whereItemPenjualan(x).arg,
    )))?.v);
  const jmlTrx = async (x: FilterLaporan): Promise<number> =>
    num(await ((await get<{ v: number }>(`SELECT COUNT(*) AS v FROM sales s ${wherePenjualan(x).sql}`, ...wherePenjualan(x).arg)))?.v);
  const pembelian = async (x: FilterLaporan): Promise<number> =>
    num(await ((await get<{ v: number }>(`SELECT COALESCE(SUM(p.total), 0) AS v FROM purchases p ${wherePembelian(x).sql}`, ...wherePembelian(x).arg)))?.v);
  // ISOLASI GUDANG — piutang/utang hanya dari dokumen gudang filter/sesi.
  const batasPiu = (x: FilterLaporan): { sql: string; arg: unknown[] } => {
    if (x.gudang) return { sql: ' AND s.warehouse_id = ?', arg: [x.gudang] };
    const b = klausulLingkup(x, 's');
    return b.sql ? { sql: ` AND ${b.sql}`, arg: b.arg } : { sql: '', arg: [] };
  };
  const batasUta = (x: FilterLaporan): { sql: string; arg: unknown[] } => {
    if (x.gudang) return { sql: ' AND p.warehouse_id = ?', arg: [x.gudang] };
    const b = klausulLingkup(x, 'p');
    return b.sql ? { sql: ` AND ${b.sql}`, arg: b.arg } : { sql: '', arg: [] };
  };
  const piutang = async (x: FilterLaporan): Promise<number> => {
    const b = batasPiu(x);
    return num(await ((await get<{ v: number }>(
      `SELECT COALESCE(SUM(r.total - r.terbayar), 0) AS v FROM receivables r
       JOIN sales s ON s.id = r.sale_id
       WHERE ${wherePeriode('s.tanggal')} AND r.status <> 'batal'${b.sql}`,
      ...argPeriode(x),
      ...b.arg,
    )))?.v);
  };
  const utang = async (x: FilterLaporan): Promise<number> => {
    const b = batasUta(x);
    return num(await ((await get<{ v: number }>(
      `SELECT COALESCE(SUM(py.total - py.terbayar), 0) AS v FROM payables py
       JOIN purchases p ON p.id = py.purchase_id
       WHERE ${wherePeriode('p.tanggal')} AND py.status <> 'batal'${b.sql}`,
      ...argPeriode(x),
      ...b.arg,
    )))?.v);
  };

  const kini: Record<string, number> = {
    penjualan: await omzet(f),
    laba: await laba(f),
    transaksi: await jmlTrx(f),
    pembelian: await pembelian(f),
    nilai_stok: await nilaiPersediaan(f.batasAkhir, f),
    piutang: await piutang(f),
    utang: await utang(f),
  };
  const lalu: Record<string, number> | null = f.bandingkan
    ? {
        penjualan: await omzet(filterBanding(f)),
        laba: await laba(filterBanding(f)),
        transaksi: await jmlTrx(filterBanding(f)),
        pembelian: await pembelian(filterBanding(f)),
        nilai_stok: await nilaiPersediaan(f.bandingAkhir, f),
        piutang: await piutang(filterBanding(f)),
        utang: await utang(filterBanding(f)),
      }
    : null;

  const daftar: [string, string, 'rupiah' | 'angka'][] = [
    ['penjualan', 'Penjualan (omzet)', 'rupiah'],
    ['laba', 'Laba Kotor', 'rupiah'],
    ['transaksi', 'Jumlah Transaksi', 'angka'],
    ['pembelian', 'Pembelian', 'rupiah'],
    ['nilai_stok', 'Nilai Stok', 'rupiah'],
    ['piutang', 'Piutang', 'rupiah'],
    ['utang', 'Utang', 'rupiah'],
  ];
  return daftar.map(([kunci, label, format]) => ({
    kunci,
    label,
    nilai: kini[kunci],
    format,
    lalu: lalu ? lalu[kunci] : null,
  }));
}

/** Kode laporan + judul (dipakai pencarian cepat & pintasan Ringkasan). */
export const LAPORAN: Record<string, DefLaporan> = {
  /* ------------------------------ A. Penjualan --------------------------- */
  'penjualan-rekap': {
    judul: 'Rekap Penjualan',
    kategori: 'penjualan',
    deskripsi: 'Rekap harian/mingguan/bulanan: transaksi, omzet, diskon, pajak, laba kotor. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['periode', 'Periode', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['diskon', 'Diskon', 'rupiah'],
      ['pajak', 'Pajak', 'rupiah'],
      ['laba_kotor', 'Laba Kotor', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'garis',
    grafikKunci: { x: 'periode', seri: ['omzet', 'laba_kotor'] },
    kartuKunci: [
      { kunci: 'omzet', label: 'Omzet', format: 'rupiah' },
      { kunci: 'laba_kotor', label: 'Laba Kotor', format: 'rupiah' },
      { kunci: 'jumlah_transaksi', label: 'Transaksi', format: 'angka' },
    ],
    jalan: async (f, q) => {
      const grup = q.grup === 'mingguan' ? 'mingguan' : q.grup === 'bulanan' ? 'bulanan' : 'harian';
      // Kunci periode dari kolom tanggal baris (bukan parameter $1) — bila
      // memakai kolom mentah s.tanggal di sub-kueri berkorelasi, PG menolak
      // karena kolomnya tidak ada di GROUP BY; karena itu agregasi berjalan
      // di atas tabel turunan yang sudah membawa kolom `periode`.
      const exprPeriode = (alias: string): string =>
        grup === 'harian'
          ? `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 10)`
          : grup === 'mingguan'
            ? `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 4) || '-W' || TO_CHAR(${alias}.tanggal, 'IW')`
            : `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 7)`;
      const w = wherePenjualan(f);
      const kunciRinci = `${exprPeriode('s2')} = sub.periode`;
      const rinci = kolomRinciJual(f, kunciRinci);
      const det = detailRinciJual(f, kunciRinci);
      const g = gabungItemJual(f, 'sub');
      const rows = await all<Baris>(
        `SELECT sub.periode AS periode,
                COUNT(DISTINCT sub.id) AS jumlah_transaksi,
                COALESCE(SUM(sub.subtotal - sub.diskon), 0) AS omzet,
                COALESCE(SUM(sub.diskon), 0) AS diskon,
                COALESCE(SUM(sub.pajak), 0) AS pajak,
                COALESCE(SUM(si.lb), 0) AS laba_kotor,
                ${rinci.sql},
                ${det.sql}
         FROM (SELECT s.id AS id, s.subtotal AS subtotal, s.diskon AS diskon, s.pajak AS pajak,
                      ${exprPeriode('s')} AS periode
               FROM sales s ${w.sql}) sub
         ${g.join}
         GROUP BY sub.periode ORDER BY sub.periode`,
        ...rinci.arg,
        ...det.arg,
        ...g.arg,
        ...w.arg,
      );
      return { kartu: [], rows };
    },
  },

  'penjualan-barang': {
    judul: 'Penjualan per Barang',
    kategori: 'penjualan',
    deskripsi: 'Qty terjual, omzet, HPP, dan laba tiap barang — klik ikon "Barang Terlaris" untuk versi peringkat.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['hpp', 'HPP', 'rupiah'],
      ['laba', 'Laba', 'rupiah'],
      ['margin_persen', 'Margin %', 'persen'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['omzet'] },
    kartuKunci: [
      { kunci: 'omzet', label: 'Omzet', format: 'rupiah' },
      { kunci: 'laba', label: 'Laba', format: 'rupiah' },
      { kunci: 'qty', label: 'Qty Terjual', format: 'angka' },
    ],
    jalan: async (f, q) => {
      const w = whereItemPenjualan(f);
      const urut = q.urut === 'laba' ? 'laba DESC' : q.urut === 'qty' ? 'qty DESC' : 'omzet DESC';
      const rows = await all<Baris>(
        `SELECT si.product_id AS product_id, si.nama_produk, si.sku,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet,
                COALESCE(SUM(si.hpp), 0) AS hpp,
                COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS laba,
                CASE WHEN COALESCE(SUM(si.subtotal - si.diskon), 0) > 0
                     THEN ROUND(100.0 * COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) / SUM(si.subtotal - si.diskon), 1)
                     ELSE 0 END AS margin_persen
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         ${w.sql}
         GROUP BY si.product_id, si.nama_produk, si.sku
         ORDER BY ${urut}
         LIMIT 1000`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'penjualan-laba-barang': {
    judul: 'Laba Rugi per Barang',
    kategori: 'penjualan',
    deskripsi: 'Margin laba per barang (persen) pada periode terpilih.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['hpp', 'HPP', 'rupiah'],
      ['laba', 'Laba', 'rupiah'],
      ['margin_persen', 'Margin %', 'persen'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['laba'] },
    kartuKunci: [
      { kunci: 'laba', label: 'Total Laba', format: 'rupiah' },
      { kunci: 'omzet', label: 'Omzet', format: 'rupiah' },
      { kunci: 'margin_persen', label: 'Rata-rata Margin', format: 'persen' },
    ],
    jalan: (f, q) => LAPORAN['penjualan-barang'].jalan(f, q),
  },

  'penjualan-kategori': {
    judul: 'Penjualan per Kategori',
    kategori: 'penjualan',
    deskripsi: 'Omzet & laba dikelompokkan per kategori produk. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['kelompok', 'Kategori', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['laba', 'Laba', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'kelompok', seri: ['omzet'] },
    kartuKunci: [{ kunci: 'omzet', label: 'Omzet', format: 'rupiah' }, { kunci: 'laba', label: 'Laba', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = whereItemPenjualan(f);
      const rinciKat = kolomRinciJual(f, 'p2.category_id IS NOT DISTINCT FROM c.id');
      const detKat = detailRinciJual(f, 'p2.category_id IS NOT DISTINCT FROM c.id');
      const rows = await all<Baris>(
        `SELECT COALESCE(c.nama, '(Tanpa kategori)') AS kelompok,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet,
                COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS laba,
                ${rinciKat.sql},
                ${detKat.sql}
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         ${w.sql}
         GROUP BY c.id, c.nama ORDER BY omzet DESC`,
        ...rinciKat.arg,
        ...detKat.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'omzet'), 'Qty Terjual', 'Total Omzet', 'omzet'), rows };
    },
  },

  'penjualan-merek': {
    judul: 'Penjualan per Merek',
    kategori: 'penjualan',
    deskripsi: 'Omzet & laba dikelompokkan per merek produk. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['kelompok', 'Merek', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['laba', 'Laba', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'kelompok', seri: ['omzet'] },
    kartuKunci: [{ kunci: 'omzet', label: 'Omzet', format: 'rupiah' }, { kunci: 'laba', label: 'Laba', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = whereItemPenjualan(f);
      const rinciMer = kolomRinciJual(f, 'p2.brand_id IS NOT DISTINCT FROM b.id');
      const detMer = detailRinciJual(f, 'p2.brand_id IS NOT DISTINCT FROM b.id');
      const rows = await all<Baris>(
        `SELECT COALESCE(b.nama, '(Tanpa merek)') AS kelompok,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet,
                COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS laba,
                ${rinciMer.sql},
                ${detMer.sql}
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
         ${w.sql}
         GROUP BY b.id, b.nama ORDER BY omzet DESC`,
        ...rinciMer.arg,
        ...detMer.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'omzet'), 'Qty Terjual', 'Total Omzet', 'omzet'), rows };
    },
  },

  'penjualan-pelanggan': {
    judul: 'Penjualan per Pelanggan',
    kategori: 'penjualan',
    deskripsi: 'Kontribusi tiap pelanggan pada periode terpilih. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['pelanggan', 'Pelanggan', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['laba', 'Laba', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'pelanggan', seri: ['omzet'] },
    kartuKunci: [{ kunci: 'omzet', label: 'Omzet', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePenjualan(f);
      const rinci = kolomRinciJual(f, 's2.customer_id IS NOT DISTINCT FROM s.customer_id');
      const detPel = detailRinciJual(f, 's2.customer_id IS NOT DISTINCT FROM s.customer_id');
      const gPel = gabungItemJual(f);
      const rows = await all<Baris>(
        `SELECT s.customer_id AS pelanggan_id, COALESCE(c.nama, 'Umum') AS pelanggan,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(s.subtotal - s.diskon), 0) AS omzet,
                COALESCE(SUM(si.lb), 0) AS laba,
                ${rinci.sql},
                ${detPel.sql}
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ${gPel.join}
         ${w.sql}
         GROUP BY s.customer_id, c.nama ORDER BY omzet DESC LIMIT 200`,
        ...rinci.arg,
        ...detPel.arg,
        ...gPel.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'omzet'), 'Qty Terjual', 'Total Omzet', 'omzet'), rows, terbatas: rows.length >= 200 };
    },
  },

  'penjualan-kasir': {
    judul: 'Penjualan per Kasir',
    kategori: 'penjualan',
    deskripsi: 'Omzet, transaksi, dan laba per kasir/pengguna. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['kasir', 'Kasir', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['laba', 'Laba', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'kasir', seri: ['omzet'] },
    kartuKunci: [{ kunci: 'omzet', label: 'Omzet', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePenjualan(f);
      const rinciKas = kolomRinciJual(f, 's2.kasir_id IS NOT DISTINCT FROM s.kasir_id');
      const detKas = detailRinciJual(f, 's2.kasir_id IS NOT DISTINCT FROM s.kasir_id');
      const gKas = gabungItemJual(f);
      const rows = await all<Baris>(
        `SELECT s.kasir_id AS kasir_id, COALESCE(u.nama, '—') AS kasir,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(s.subtotal - s.diskon), 0) AS omzet,
                COALESCE(SUM(si.lb), 0) AS laba,
                ${rinciKas.sql},
                ${detKas.sql}
         FROM sales s
         LEFT JOIN users u ON u.id = s.kasir_id
         ${gKas.join}
         ${w.sql}
         GROUP BY s.kasir_id, u.nama ORDER BY omzet DESC`,
        ...rinciKas.arg,
        ...detKas.arg,
        ...gKas.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'omzet'), 'Qty Terjual', 'Total Omzet', 'omzet'), rows };
    },
  },

  'penjualan-shift': {
    judul: 'Penjualan per Shift',
    kategori: 'penjualan',
    deskripsi: 'Transaksi & omzet dikelompokkan per shift kasir. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['shift', 'Shift', 'teks'],
      ['kasir', 'Kasir', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['tunai', 'Tunai', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'omzet', label: 'Omzet', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePenjualan(f);
      const rinciShift = kolomRinciJual(f, 's2.shift_id IS NOT DISTINCT FROM s.shift_id');
      const detShift = detailRinciJual(f, 's2.shift_id IS NOT DISTINCT FROM s.shift_id');
      const gShift = gabungItemJual(f);
      const rows = await all<Baris>(
        `SELECT 'Shift #' || COALESCE(s.shift_id, 0) AS shift,
                COALESCE(u.nama, '—') AS kasir,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(s.subtotal - s.diskon), 0) AS omzet,
                COALESCE(SUM(pm.tunai), 0) AS tunai,
                ${rinciShift.sql},
                ${detShift.sql}
         FROM sales s
         LEFT JOIN users u ON u.id = s.kasir_id
         ${gShift.join}
         LEFT JOIN (SELECT sp.sale_id AS sale_id,
                      COALESCE(SUM(CASE WHEN sp.metode = 'tunai' THEN sp.jumlah ELSE 0 END), 0) AS tunai
                   FROM sale_payments sp GROUP BY sp.sale_id) pm ON pm.sale_id = s.id
         ${w.sql}
         GROUP BY s.shift_id, u.nama
         ORDER BY (s.shift_id IS NULL), s.shift_id DESC`,
        ...rinciShift.arg,
        ...detShift.arg,
        ...gShift.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'omzet'), 'Qty Terjual', 'Total Omzet', 'omzet'), rows };
    },
  },

  'penjualan-metode': {
    judul: 'Penjualan per Metode Bayar',
    kategori: 'penjualan',
    deskripsi: 'Komposisi penerimaan per metode: tunai, transfer, QRIS, kredit, dll. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['metode', 'Metode', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['jumlah', 'Diterima', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'metode', seri: ['jumlah'] },
    kartuKunci: [{ kunci: 'jumlah', label: 'Total Diterima', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePenjualan(f);
      const rows = await all<Baris>(
        `SELECT sp.metode,
                COUNT(DISTINCT s.id) AS jumlah_transaksi,
                COALESCE(SUM(sp.jumlah), 0) AS jumlah,
                ${kolomRinciJual(f, 'EXISTS (SELECT 1 FROM sale_payments spx WHERE spx.sale_id = s2.id AND spx.metode = sp.metode)').sql},
                ${detailRinciJual(f, 'EXISTS (SELECT 1 FROM sale_payments spx WHERE spx.sale_id = s2.id AND spx.metode = sp.metode)').sql}
         FROM sales s JOIN sale_payments sp ON sp.sale_id = s.id
         ${w.sql}
         GROUP BY sp.metode ORDER BY jumlah DESC`,
        ...kolomRinciJual(f, 'EXISTS (SELECT 1 FROM sale_payments spx WHERE spx.sale_id = s2.id AND spx.metode = sp.metode)').arg,
        ...detailRinciJual(f, 'EXISTS (SELECT 1 FROM sale_payments spx WHERE spx.sale_id = s2.id AND spx.metode = sp.metode)').arg,
        ...w.arg,
      );
      return { kartu: [], rows };
    },
  },

  'penjualan-detail': {
    judul: 'Detail Transaksi / Daftar Struk',
    kategori: 'penjualan',
    deskripsi: 'Daftar struk beserta rincian barang tiap transaksi; klik baris untuk membuka pratinjau struk.',
    kolom: KOLS(
      ['no_dokumen', 'No. Dokumen', 'teks'],
      ['waktu', 'Waktu', 'waktu'],
      ['pelanggan', 'Pelanggan', 'teks'],
      ['kasir', 'Kasir', 'teks'],
      ['metode', 'Metode', 'teks'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
      ['subtotal', 'Subtotal', 'rupiah'],
      ['diskon', 'Diskon', 'rupiah'],
      ['pajak', 'Pajak', 'rupiah'],
      ['total', 'Total', 'rupiah'],
      ['status', 'Status', 'teks'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'total', label: 'Total', format: 'rupiah' }, { kunci: 'diskon', label: 'Diskon', format: 'rupiah' }],
    jalan: async (f, q) => {
      const w = wherePenjualan(f);
      const batas = Math.min(1000, Math.max(50, Number(q.batas ?? 1000) || 1000));
      const rows = await all<Baris>(
        `SELECT s.id, s.no_dokumen, (s.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS waktu,
                COALESCE(c.nama, 'Umum') AS pelanggan, COALESCE(u.nama, '—') AS kasir,
                COALESCE((SELECT GROUP_CONCAT(DISTINCT sp.metode) FROM sale_payments sp WHERE sp.sale_id = s.id), '—') AS metode,
                ${RINCI_JUAL('s.id')} AS rincian_barang,
                ${detailDokJual('s.id', 200, f.zona)},
                s.subtotal, s.diskon, s.pajak, s.total, s.status
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.kasir_id
         ${w.sql}
         ORDER BY s.id DESC LIMIT ?`,
        ...w.arg,
        batas,
      );
      return { kartu: [], rows, terbatas: rows.length >= batas };
    },
  },

  'penjualan-retur': {
    judul: 'Retur Penjualan',
    kategori: 'penjualan',
    deskripsi: 'Daftar retur penjualan beserta alasan, rincian barang, & nilainya.',
    kolom: KOLS(
      ['no_dokumen', 'No. Retur', 'teks'],
      ['no_penjualan', 'No. Penjualan', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['pelanggan', 'Pelanggan', 'teks'],
      ['alasan', 'Alasan', 'teks'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
      ['total', 'Nilai Retur', 'rupiah'],
      ['status', 'Status', 'teks'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'total', label: 'Nilai Retur', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [wherePeriode('sr.tanggal')];
      const a: unknown[] = argPeriode(f);
      if (f.status === 'semua') {
        // tampilkan semua status
      } else if (['draft', 'disahkan', 'batal'].includes(f.status)) {
        s.push('sr.status = ?'); a.push(f.status);
      } else {
        // N6: default tanpa status batal
        s.push(`sr.status <> 'batal'`);
      }
      pakaiGudang(f, s, a, 's.warehouse_id = ?', 's');
      if (f.kasir) { s.push('sr.dibuat_oleh = ?'); a.push(f.kasir); }
      if (f.pelanggan) { s.push('s.customer_id = ?'); a.push(f.pelanggan); }
      const rows = await all<Baris>(
        `SELECT sr.no_dokumen, s.no_dokumen AS no_penjualan, ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal,
                COALESCE(c.nama, 'Umum') AS pelanggan, sr.alasan,
                ${RINCI_RETUR_JUAL('sr.id')} AS rincian_barang, ${detailDokReturJual('sr.id', 200, f.zona)}, sr.total, sr.status
         FROM sale_returns sr
         JOIN sales s ON s.id = sr.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE ${s.join(' AND ')}
         ORDER BY sr.id DESC LIMIT 1000`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'penjualan-terlaris': {
    judul: 'Barang Terlaris & Kurang Laku',
    kategori: 'penjualan',
    deskripsi: 'Peringkat terlaris (qty) — ganti urutan ke "laba" untuk melihat slow moving di dasar daftar.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['omzet', 'Omzet', 'rupiah'],
      ['laba', 'Laba', 'rupiah'],
      ['sisa_transaksi', 'Frekuensi Terjual', 'angka'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['qty'] },
    kartuKunci: [{ kunci: 'qty', label: 'Qty Terjual', format: 'angka' }],
    jalan: async (f, q) => {
      const w = whereItemPenjualan(f);
      const urut = q.urut === 'lambat' ? 'qty ASC, omzet ASC' : 'qty DESC, omzet DESC';
      const rows = await all<Baris>(
        `SELECT si.nama_produk,
                COALESCE(SUM(si.qty), 0) AS qty,
                COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet,
                COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS laba,
                COUNT(DISTINCT s.id) AS sisa_transaksi
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         ${w.sql}
         GROUP BY si.product_id, si.nama_produk
         ORDER BY ${urut} LIMIT 500`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 500 };
    },
  },

  'penjualan-rincian': {
    judul: 'Rincian Barang Terjual',
    kategori: 'penjualan',
    deskripsi: 'Setiap barang terjual per transaksi: tanggal, dokumen, pelanggan, qty, harga, dan subtotal — siap diekspor Excel/PDF.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_dokumen', 'No. Dokumen', 'teks'],
      ['pelanggan', 'Pelanggan', 'teks'],
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['harga', 'Harga', 'rupiah'],
      ['diskon', 'Diskon', 'rupiah'],
      ['subtotal', 'Subtotal', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'subtotal', label: 'Total', format: 'rupiah' },
      { kunci: 'qty', label: 'Qty Terjual', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const w = whereItemPenjualan(f);
      const rows = await all<Baris>(
        `SELECT (s.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, s.no_dokumen,
                COALESCE(c.nama, 'Umum') AS pelanggan,
                si.nama_produk, si.sku, si.qty, si.harga, si.diskon, si.subtotal
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN customers c ON c.id = s.customer_id
         ${w.sql}
         ORDER BY s.tanggal DESC, si.id DESC LIMIT 1000`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  /* ------------------------------ B. Pembelian --------------------------- */
  'pembelian-rekap': {
    judul: 'Rekap Pembelian',
    kategori: 'pembelian',
    deskripsi: 'Rekap harian/mingguan/bulanan: transaksi, subtotal, diskon, pajak, total. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['periode', 'Periode', 'teks'],
      ['jumlah_transaksi', 'Transaksi', 'angka'],
      ['subtotal', 'Subtotal', 'rupiah'],
      ['diskon', 'Diskon', 'rupiah'],
      ['pajak', 'Pajak', 'rupiah'],
      ['total', 'Total', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'garis',
    grafikKunci: { x: 'periode', seri: ['total'] },
    kartuKunci: [
      { kunci: 'total', label: 'Total Pembelian', format: 'rupiah' },
      { kunci: 'jumlah_transaksi', label: 'Transaksi', format: 'angka' },
    ],
    jalan: async (f, q) => {
      const grup = q.grup === 'mingguan' ? 'mingguan' : q.grup === 'bulanan' ? 'bulanan' : 'harian';
      const exprPeriode = (alias: string): string =>
        grup === 'harian'
          ? `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 10)`
          : grup === 'mingguan'
            ? `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 4) || '-W' || TO_CHAR(${alias}.tanggal, 'IW')`
            : `substr((${alias}.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 7)`;
      const w = wherePembelian(f);
      const kunciRinciBeli = `${exprPeriode('pp2')} = sub.periode`;
      const rinciBeli = kolomRinciBeli(f, kunciRinciBeli);
      const detBeli = detailRinciBeli(f, kunciRinciBeli);
      const rows = await all<Baris>(
        `SELECT sub.periode AS periode,
                COUNT(DISTINCT sub.id) AS jumlah_transaksi,
                COALESCE(SUM(sub.subtotal), 0) AS subtotal,
                COALESCE(SUM(sub.diskon), 0) AS diskon,
                COALESCE(SUM(sub.pajak), 0) AS pajak,
                COALESCE(SUM(sub.total), 0) AS total,
                ${rinciBeli.sql},
                ${detBeli.sql}
         FROM (SELECT p.id AS id, p.subtotal AS subtotal, p.diskon AS diskon, p.pajak AS pajak, p.total AS total,
                      ${exprPeriode('p')} AS periode
               FROM purchases p ${w.sql}) sub
         GROUP BY sub.periode ORDER BY sub.periode`,
        ...rinciBeli.arg,
        ...detBeli.arg,
        ...w.arg,
      );
      return { kartu: [], rows };
    },
  },

  /**
   * Sumber angka yang SAMA dengan widget Pembelian di Dashboard:
   * pembelian langsung + PO yang sudah diterima − retur pembelian.
   * Dibuka dari tombol "Detail" kartu Pembelian agar pengguna bisa melihat
   * dari mana angka Dashboard berasal (transparan, tidak dobel hitung).
   */
  'pembelian-gabungan': {
    judul: 'Pembelian Gabungan (Langsung + PO)',
    kategori: 'pembelian',
    deskripsi:
      'Rincian sumber nilai Pembelian pada periode terpilih: pembelian langsung (faktur pembelian disahkan) dan Purchase Order yang barangnya sudah diterima (tidak dobel dengan faktur yang memakai nomor PO sama).',
    kolom: KOLS(['sumber', 'Sumber', 'teks'], ['total', 'Nilai', 'rupiah']),
    grafik: null,
    kartuKunci: [{ kunci: 'total', label: 'Pembelian Bersih', format: 'rupiah' }],
    jalan: async (f) => {
      const r = await rincianPembelianBersih(
        { gudang: f.gudang, lingkup: f.lingkup, zona: f.zona },
        f.dari,
        f.sampai,
      );
      // Dua baris sumber; kartu "Pembelian Bersih" = jumlah keduanya, jadi
      // angkanya sama dengan widget Dashboard.
      const rows: Baris[] = [
        { sumber: 'Pembelian Langsung (faktur disahkan)', total: r.langsung },
        { sumber: 'Purchase Order (barang diterima)', total: r.po },
      ];
      return { kartu: [], rows };
    },
  },

  'pembelian-pemasok': {
    judul: 'Pembelian per Pemasok',
    kategori: 'pembelian',
    deskripsi: 'Kontribusi tiap pemasok pada periode terpilih. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['pemasok', 'Pemasok', 'teks'],
      ['jumlah_transaksi', 'Jumlah PO', 'angka'],
      ['qty', 'Qty Diterima', 'angka'],
      ['subtotal', 'Subtotal', 'rupiah'],
      ['total', 'Total Pembelian', 'rupiah'],
      ['kontribusi', 'Kontribusi %', 'persen'],
      ['sisa_po', 'Sisa PO', 'angka'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'pemasok', seri: ['total'] },
    kartuKunci: [{ kunci: 'total', label: 'Total Pembelian', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePembelian(f);
      const rinciPemasok = kolomRinciBeli(f, 'pp2.supplier_id IS NOT DISTINCT FROM p.supplier_id');
      const detPemasok = detailRinciBeli(f, 'pp2.supplier_id IS NOT DISTINCT FROM p.supplier_id');
      const gBeli = gabungItemBeli();
      const rows = await all<Baris>(
        `SELECT p.supplier_id AS pemasok_id, COALESCE(s.nama, '(tanpa pemasok)') AS pemasok,
                COUNT(DISTINCT p.id) AS jumlah_transaksi,
                COALESCE(SUM(pi.qty), 0) AS qty,
                COALESCE(SUM(p.subtotal), 0) AS subtotal,
                COALESCE(SUM(p.total), 0) AS total,
                COUNT(DISTINCT CASE WHEN p.status IN ('draft', 'diterima') THEN p.id END) AS sisa_po,
                ${rinciPemasok.sql},
                ${detPemasok.sql}
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
         ${gBeli.join}
         ${w.sql}
         GROUP BY p.supplier_id, s.nama ORDER BY total DESC LIMIT 200`,
        ...rinciPemasok.arg,
        ...detPemasok.arg,
        ...w.arg,
      );
      return { kartu: kartuEmpat(denganKontribusi(rows, 'total'), 'Qty Dibeli', 'Total Pembelian', 'total'), rows, terbatas: rows.length >= 200 };
    },
  },

  'pembelian-barang': {
    judul: 'Pembelian per Barang',
    kategori: 'pembelian',
    deskripsi: 'Qty beli, total, rata-rata harga beli, serta rentang harga (min–maks) sebagai indikator perubahan harga.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['total_beli', 'Total Beli', 'rupiah'],
      ['rata_harga', 'Rata-rata Harga', 'rupiah'],
      ['harga_min', 'Harga Min', 'rupiah'],
      ['harga_max', 'Harga Maks', 'rupiah'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['total_beli'] },
    kartuKunci: [
      { kunci: 'total_beli', label: 'Total Beli', format: 'rupiah' },
      { kunci: 'qty', label: 'Qty Dibeli', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const w = whereItemPembelian(f);
      const rows = await all<Baris>(
        `SELECT pi.nama_produk, pi.sku,
                COALESCE(SUM(pi.qty), 0) AS qty,
                COALESCE(SUM(pi.subtotal), 0) AS total_beli,
                CASE WHEN SUM(pi.qty) > 0 THEN ROUND(SUM(pi.subtotal) / SUM(pi.qty), 0) ELSE 0 END AS rata_harga,
                COALESCE(MIN(pi.harga_beli), 0) AS harga_min,
                COALESCE(MAX(pi.harga_beli), 0) AS harga_max
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         JOIN products pr ON pr.id = pi.product_id
         ${w.sql}
         GROUP BY pi.product_id, pi.nama_produk, pi.sku
         ORDER BY total_beli DESC LIMIT 1000`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'pembelian-riwayat-harga': {
    judul: 'Riwayat Harga Beli',
    kategori: 'pembelian',
    deskripsi: 'Riwayat harga beli per barang dan pemasok — berguna memantau kenaikan/penurunan harga.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_dokumen', 'No. Dokumen', 'teks'],
      ['pemasok', 'Pemasok', 'teks'],
      ['nama_produk', 'Barang', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['harga_beli', 'Harga Beli', 'rupiah'],
      ['subtotal', 'Subtotal', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'subtotal', label: 'Total', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = whereItemPembelian(f);
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, p.no_dokumen,
                COALESCE(s.nama, '(tanpa pemasok)') AS pemasok,
                pi.nama_produk, pi.qty, pi.harga_beli, pi.subtotal
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         JOIN products pr ON pr.id = pi.product_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         ${w.sql}
         ORDER BY p.tanggal DESC, pi.id DESC LIMIT 1000`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'pembelian-retur': {
    judul: 'Retur / Pembatalan Pembelian',
    kategori: 'pembelian',
    deskripsi: 'Baris kartu stok "pembelian batal" — pengembalian/pembatalan barang ke pemasok pada periode terpilih.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_dokumen', 'No. Pembelian', 'teks'],
      ['pemasok', 'Pemasok', 'teks'],
      ['nama_produk', 'Barang', 'teks'],
      ['qty_keluar', 'Qty Keluar', 'angka'],
      ['nilai', 'Nilai', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'nilai', label: 'Nilai Retur', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [wherePeriode('l.tanggal')];
      const a: unknown[] = argPeriode(f);
      pakaiGudang(f, s, a, 'l.warehouse_id = ?', 'l');
      if (f.produk) { s.push('l.product_id = ?'); a.push(f.produk); }
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, COALESCE(p.no_dokumen, '—') AS no_dokumen,
                COALESCE(s2.nama, '(tanpa pemasok)') AS pemasok, pr.nama AS nama_produk,
                l.qty_keluar, ROUND(l.qty_keluar * l.nilai_unit, 0) AS nilai
         FROM stock_ledger l
         JOIN products pr ON pr.id = l.product_id
         LEFT JOIN purchases p ON p.id = l.dokumen_id
         LEFT JOIN suppliers s2 ON s2.id = p.supplier_id
         WHERE l.tipe_dokumen = 'pembelian_batal' AND ${s.join(' AND ')}
         ORDER BY l.tanggal DESC LIMIT 1000`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'pembelian-status': {
    judul: 'Status PO / GRN / Faktur',
    kategori: 'pembelian',
    deskripsi: 'Daftar dokumen pembelian beserta nomor PO, GRN, faktur, rincian barang, dan status (draft, diterima, disahkan).',
    kolom: KOLS(
      ['no_dokumen', 'No. Dokumen', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['pemasok', 'Pemasok', 'teks'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
      ['no_po', 'No. PO', 'teks'],
      ['no_grn', 'No. GRN', 'teks'],
      ['no_faktur', 'No. Faktur', 'teks'],
      ['total', 'Total', 'rupiah'],
      ['status', 'Status', 'teks'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'total', label: 'Total', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const w = wherePembelian(f);
      const rows = await all<Baris>(
        `SELECT p.id, p.no_dokumen, (p.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal,
                COALESCE(s.nama, '(tanpa pemasok)') AS pemasok,
                ${RINCI_BELI('p.id')} AS rincian_barang,
                ${detailDokBeli('p.id', 200, f.zona)},
                COALESCE(p.no_po, '—') AS no_po, COALESCE(p.no_grn, '—') AS no_grn,
                COALESCE(p.no_faktur, '—') AS no_faktur, p.total, p.status
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
         ${w.sql}
         ORDER BY p.tanggal DESC, p.id DESC LIMIT 1000`,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'pembelian-po': {
    judul: 'Purchase Order',
    kategori: 'pembelian',
    deskripsi: 'Daftar Purchase Order berdasarkan periode, pemasok, gudang, status, jumlah dipesan, diterima, sisa, dan nilai pesanan.',
    kolom: KOLS(
      ['no_po', 'No. PO', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['pemasok', 'Pemasok', 'teks'],
      ['gudang', 'Gudang', 'teks'],
      ['status', 'Status', 'teks'],
      ['jumlah_pesanan', 'Qty Dipesan', 'angka'],
      ['jumlah_diterima', 'Qty Diterima', 'angka'],
      ['sisa', 'Sisa Qty', 'angka'],
      ['total_harga', 'Nilai Pesanan', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'total_harga', label: 'Nilai Pesanan', format: 'rupiah' },
      { kunci: 'jumlah_po', label: 'Jumlah PO', format: 'angka' },
      { kunci: 'sisa', label: 'Sisa Qty', format: 'angka' },
    ],
    jalan: async (f, q) => {
      const syarat = [wherePeriode('p.tanggal')];
      const arg: unknown[] = argPeriode(f);
      const statusPo = String(q.status_po ?? '').trim();
      const statusValid = ['draft', 'terkirim', 'sebagian', 'lebih', 'selesai', 'selesai_kurang', 'kadaluwarsa', 'batal'];
      if (statusPo && statusValid.includes(statusPo)) {
        syarat.push('p.status = ?');
        arg.push(statusPo);
      }
      if (f.pemasok) { syarat.push('p.supplier_id = ?'); arg.push(f.pemasok); }
      pakaiGudang(f, syarat, arg, 'p.warehouse_id = ?', 'p');
      const ringkas = await get<Baris>(
        `SELECT COUNT(*) AS jumlah_po, COALESCE(SUM(p.total_harga), 0) AS total_harga,
                COALESCE(SUM(GREATEST(0, p.total_pcs - COALESCE((SELECT SUM(ri.qty_datang) FROM po_receipt_items ri
                  JOIN po_receipts r ON r.id = ri.receipt_id WHERE r.po_id = p.id), 0))), 0) AS sisa
         FROM purchase_orders p WHERE ${syarat.join(' AND ')}`,
        ...arg,
      );
      const rows = await all<Baris>(
        `SELECT p.id, p.no_po, (p.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal,
                COALESCE(s.nama, '(tanpa pemasok)') AS pemasok, COALESCE(w.nama, '—') AS gudang,
                p.status, p.total_pcs AS jumlah_pesanan, p.total_harga,
                'po' AS rincian_tipe,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'tanggal', (p.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'),
                    'nomor', p.no_po,
                    'barang', pr.nama,
                    'qty', poi.qty_pesan,
                    'dipesan', poi.qty_pesan,
                    'diterima', COALESCE((SELECT SUM(ri.qty_datang) FROM po_receipt_items ri
                                          JOIN po_receipts r ON r.id = ri.receipt_id
                                          WHERE r.po_id = p.id AND ri.product_id = poi.product_id), 0),
                    'sisa', GREATEST(0, poi.qty_pesan - COALESCE((SELECT SUM(ri.qty_datang) FROM po_receipt_items ri
                                          JOIN po_receipts r ON r.id = ri.receipt_id
                                          WHERE r.po_id = p.id AND ri.product_id = poi.product_id), 0)),
                    'harga', poi.harga_beli,
                    'subtotal', poi.qty_pesan * poi.harga_beli
                  ) ORDER BY pr.nama)
                  FROM purchase_order_items poi JOIN products pr ON pr.id = poi.product_id
                  WHERE poi.po_id = p.id), '[]'::jsonb) AS rincian_detail,
                COALESCE((SELECT SUM(ri.qty_datang) FROM po_receipt_items ri
                          JOIN po_receipts r ON r.id = ri.receipt_id WHERE r.po_id = p.id), 0) AS jumlah_diterima,
                GREATEST(0, p.total_pcs - COALESCE((SELECT SUM(ri.qty_datang) FROM po_receipt_items ri
                          JOIN po_receipts r ON r.id = ri.receipt_id WHERE r.po_id = p.id), 0)) AS sisa
         FROM purchase_orders p
         JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN warehouses w ON w.id = p.warehouse_id
         WHERE ${syarat.join(' AND ')}
         ORDER BY p.tanggal DESC, p.id DESC LIMIT 1000`,
        ...arg,
      );
      return {
        kartu: [
          { kunci: 'jumlah_po', label: 'Jumlah PO', nilai: num(ringkas?.jumlah_po), format: 'angka' },
          { kunci: 'total_harga', label: 'Nilai Pesanan', nilai: num(ringkas?.total_harga), format: 'rupiah' },
          { kunci: 'sisa', label: 'Sisa Qty', nilai: num(ringkas?.sisa), format: 'angka' },
        ],
        rows,
        terbatas: rows.length >= 1000,
      };
    },
  },

  /* --------------------------- C. Stok & Persediaan ---------------------- */
  'stok-saat-ini': {
    judul: 'Stok Saat Ini',
    kategori: 'stok',
    deskripsi: 'Saldo stok per gudang/lokasi lengkap dengan nilai persediaan (rata-rata bergerak). Periode tidak berpengaruh — ini posisi terkini.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['gudang', 'Gudang', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['stok_min', 'Minimum', 'angka'],
      ['nilai', 'Nilai Stok', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'nilai', label: 'Nilai Persediaan', format: 'rupiah' },
      { kunci: 'qty', label: 'Total Qty', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const s: string[] = ['sb.qty <> 0'];
      const a: unknown[] = [];
      pakaiGudang(f, s, a, 'sb.warehouse_id = ?', 'sb');
      if (f.produk) { s.push('sb.product_id = ?'); a.push(f.produk); }
      if (f.kategori) { s.push('p.category_id = ?'); a.push(f.kategori); }
      if (f.merek) { s.push('p.brand_id = ?'); a.push(f.merek); }
      const rows = await all<Baris>(
        `SELECT p.nama AS nama_produk, p.sku, COALESCE(w.nama, '—') AS gudang,
                sb.qty, COALESCE(p.stok_min, 0) AS stok_min,
                ROUND(sb.qty * ${SUB_RATA}, 0) AS nilai
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id
         LEFT JOIN warehouses w ON w.id = sb.warehouse_id
         WHERE p.deleted_at IS NULL AND ${s.join(' AND ')}
         ORDER BY nilai DESC LIMIT 2000`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 2000 };
    },
  },

  'stok-kartu': {
    judul: 'Kartu Stok',
    kategori: 'stok',
    deskripsi: 'Mutasi per barang: masuk, keluar, saldo, dan referensi dokumen. Pilih filter Produk untuk kartu satu barang; tanpa filter menampilkan ringkasan per barang.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['nama_produk', 'Barang', 'teks'],
      ['jenis', 'Jenis', 'teks'],
      ['dokumen', 'Referensi Dokumen', 'teks'],
      ['masuk', 'Masuk', 'angka'],
      ['keluar', 'Keluar', 'angka'],
      ['saldo', 'Saldo', 'angka'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'masuk', label: 'Total Masuk', format: 'angka' },
      { kunci: 'keluar', label: 'Total Keluar', format: 'angka' },
    ],
    jalan: async (f, q) => {
      const w = wherePeriode('l.tanggal');
      const arg: unknown[] = argPeriode(f);
      let s = w;
      if (f.gudang) { s += ' AND l.warehouse_id = ?'; arg.push(f.gudang); }
      else { const b = klausulLingkup(f, 'l'); if (b.sql) { s += ` AND ${b.sql}`; arg.push(...b.arg); } }
      if (f.produk) {
        s += ' AND l.product_id = ?';
        arg.push(f.produk);
        const batas = Math.min(2000, Math.max(50, Number(q.batas ?? 2000) || 2000));
        const rows = await all<Baris>(
          `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, p.nama AS nama_produk,
                  l.tipe_dokumen AS jenis,
                  CASE WHEN l.dokumen_id IS NULL THEN '—' ELSE l.tipe_dokumen || ' #' || l.dokumen_id END AS dokumen,
                  l.qty_masuk AS masuk, l.qty_keluar AS keluar, l.saldo
           FROM stock_ledger l JOIN products p ON p.id = l.product_id
           WHERE ${s}
           ORDER BY l.tanggal DESC, l.id DESC LIMIT ?`,
          ...arg,
          batas,
        );
        return { kartu: [], rows, terbatas: rows.length >= batas };
      }
      // Tanpa filter produk: ringkasan mutasi per barang pada periode.
      const rows = await all<Baris>(
        `SELECT '(ringkasan per barang)' AS tanggal, p.nama AS nama_produk, 'periode' AS jenis,
                '—' AS dokumen,
                COALESCE(SUM(l.qty_masuk), 0) AS masuk,
                COALESCE(SUM(l.qty_keluar), 0) AS keluar,
                COALESCE(MAX(l.saldo), 0) AS saldo
         FROM stock_ledger l JOIN products p ON p.id = l.product_id
         WHERE ${s}
         GROUP BY l.product_id, p.nama
         ORDER BY p.nama LIMIT 2000`,
        ...arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 2000 };
    },
  },

  'stok-menipis': {
    judul: 'Stok Menipis & Kosong',
    kategori: 'stok',
    deskripsi: 'Barang di bawah stok minimum dan barang dengan stok kosong (nol).',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['gudang', 'Gudang', 'teks'],
      ['qty', 'Qty', 'angka'],
      ['stok_min', 'Minimum', 'angka'],
      ['selisih', 'Selisih', 'angka'],
      ['status', 'Status', 'teks'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'status', seri: ['qty'] },
    kartuKunci: [
      { kunci: 'stok_min', label: 'Total Minimum', format: 'angka' },
      { kunci: 'qty', label: 'Qty Tersedia', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [];
      const a: unknown[] = [];
      pakaiGudang(f, s, a, 'sb.warehouse_id = ?', 'sb');
      if (f.produk) { s.push('sb.product_id = ?'); a.push(f.produk); }
      if (f.kategori) { s.push('p.category_id = ?'); a.push(f.kategori); }
      if (f.merek) { s.push('p.brand_id = ?'); a.push(f.merek); }
      const syarat = [
        'p.deleted_at IS NULL',
        'p.aktif = TRUE',
        `(COALESCE(sb.qty, 0) <= 0 OR (COALESCE(p.stok_min, 0) > 0 AND COALESCE(sb.qty, 0) <= p.stok_min))`,
        ...s,
      ];
      const rows = await all<Baris>(
        `SELECT p.nama AS nama_produk, p.sku, COALESCE(w.nama, '—') AS gudang,
                COALESCE(sb.qty, 0) AS qty, COALESCE(p.stok_min, 0) AS stok_min,
                COALESCE(sb.qty, 0) - COALESCE(p.stok_min, 0) AS selisih,
                CASE WHEN COALESCE(sb.qty, 0) <= 0 THEN 'Kosong' ELSE 'Menipis' END AS status
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         LEFT JOIN warehouses w ON w.id = sb.warehouse_id
         WHERE ${syarat.join(' AND ')}
         ORDER BY status, selisih ASC, p.nama LIMIT 1000`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'stok-mutasi': {
    judul: 'Mutasi Stok',
    kategori: 'stok',
    deskripsi: 'Ringkasan mutasi per jenis dokumen: item masuk, item keluar, dan transfer antar gudang.',
    kolom: KOLS(
      ['jenis', 'Jenis Dokumen', 'teks'],
      ['jumlah', 'Jumlah Mutasi', 'angka'],
      ['qty_masuk', 'Qty Masuk', 'angka'],
      ['qty_keluar', 'Qty Keluar', 'angka'],
      ['nilai_masuk', 'Nilai Masuk', 'rupiah'],
      ['nilai_keluar', 'Nilai Keluar', 'rupiah'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'jenis', seri: ['qty_masuk'] },
    kartuKunci: [
      { kunci: 'jumlah', label: 'Jumlah Mutasi', format: 'angka' },
      { kunci: 'nilai_masuk', label: 'Nilai Masuk', format: 'rupiah' },
      { kunci: 'nilai_keluar', label: 'Nilai Keluar', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [wherePeriode('l.tanggal')];
      const a: unknown[] = argPeriode(f);
      pakaiGudang(f, s, a, 'l.warehouse_id = ?', 'l');
      if (f.produk) { s.push('l.product_id = ?'); a.push(f.produk); }
      const rows = await all<Baris>(
        `SELECT l.tipe_dokumen AS jenis, COUNT(*) AS jumlah,
                COALESCE(SUM(l.qty_masuk), 0) AS qty_masuk,
                COALESCE(SUM(l.qty_keluar), 0) AS qty_keluar,
                ROUND(COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0), 0) AS nilai_masuk,
                ROUND(COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0), 0) AS nilai_keluar
         FROM stock_ledger l
         WHERE ${s.join(' AND ')}
         GROUP BY l.tipe_dokumen ORDER BY jumlah DESC`,
        ...a,
      );
      return { kartu: [], rows };
    },
  },

  'stok-nilai': {
    judul: 'Nilai Persediaan',
    kategori: 'stok',
    deskripsi: 'Nilai persediaan per gudang dengan metode rata-rata bergerak (HPP) sesuai pengaturan aplikasi.',
    kolom: KOLS(
      ['gudang', 'Gudang', 'teks'],
      ['jumlah_produk', 'Jenis Barang', 'angka'],
      ['qty', 'Total Qty', 'angka'],
      ['nilai', 'Nilai', 'rupiah'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'gudang', seri: ['nilai'] },
    kartuKunci: [
      { kunci: 'nilai', label: 'Total Nilai', format: 'rupiah' },
      { kunci: 'qty', label: 'Total Qty', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const s: string[] = ['sb.qty <> 0'];
      const a: unknown[] = [];
      pakaiGudang(f, s, a, 'sb.warehouse_id = ?', 'sb');
      if (f.kategori) { s.push('p.category_id = ?'); a.push(f.kategori); }
      if (f.merek) { s.push('p.brand_id = ?'); a.push(f.merek); }
      const rows = await all<Baris>(
        `SELECT COALESCE(w.nama, '—') AS gudang, COUNT(DISTINCT sb.product_id) AS jumlah_produk,
                SUM(sb.qty) AS qty, ROUND(SUM(sb.qty * ${SUB_RATA}), 0) AS nilai
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id
         LEFT JOIN warehouses w ON w.id = sb.warehouse_id
         WHERE p.deleted_at IS NULL AND ${s.join(' AND ')}
         GROUP BY sb.warehouse_id, w.nama ORDER BY nilai DESC`,
        ...a,
      );
      return { kartu: [], rows };
    },
  },

  'stok-perputaran': {
    judul: 'Perputaran & Umur Stok',
    kategori: 'stok',
    deskripsi: 'Turnover (qty keluar pada periode ÷ saldo) dan umur stok sejak mutasi terakhir — sampel aging 0–30, 31–60, 61–90, >90 hari.',
    kolom: KOLS(
      ['nama_produk', 'Barang', 'teks'],
      ['sku', 'SKU', 'teks'],
      ['saldo', 'Saldo', 'angka'],
      ['qty_keluar', 'Keluar Periode', 'angka'],
      ['perputaran', 'Perputaran (x)', 'angka'],
      ['umur_hari', 'Umur (hari)', 'angka'],
      ['aging', 'Aging', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['qty_keluar'] },
    kartuKunci: [
      { kunci: 'qty_keluar', label: 'Keluar Periode', format: 'angka' },
      { kunci: 'saldo', label: 'Saldo', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const argKeluar: unknown[] = [...argPeriode(f)];
      let saringKeluar = wherePeriode('l.tanggal');
      if (f.gudang) { saringKeluar += ' AND l.warehouse_id = ?'; argKeluar.push(f.gudang); }
      else { const b = klausulLingkup(f, 'l'); if (b.sql) { saringKeluar += ` AND ${b.sql}`; argKeluar.push(...b.arg); } }
      const argSaldo: unknown[] = [];
      let saringSaldo = '1 = 1';
      if (f.gudang) { saringSaldo += ' AND sb.warehouse_id = ?'; argSaldo.push(f.gudang); }
      else { const b = klausulLingkup(f, 'sb'); if (b.sql) { saringSaldo += ` AND ${b.sql}`; argSaldo.push(...b.arg); } }
      const rows = await all<Baris>(
        `SELECT p.nama AS nama_produk, p.sku,
                COALESCE((SELECT SUM(sb2.qty) FROM stock_balances sb2 WHERE sb2.product_id = p.id AND ${saringSaldo}), 0) AS saldo,
                COALESCE((SELECT SUM(l.qty_masuk - l.qty_keluar) FROM stock_ledger l
                          WHERE l.product_id = p.id AND ${saringKeluar}), 0) AS netto_periode,
                COALESCE((SELECT SUM(l.qty_keluar) FROM stock_ledger l
                          WHERE l.product_id = p.id AND ${saringKeluar}), 0) AS qty_keluar,
                (SELECT MAX(l.tanggal) FROM stock_ledger l WHERE l.product_id = p.id) AS mutasi_terakhir
         FROM products p
         WHERE p.deleted_at IS NULL
         ORDER BY qty_keluar DESC, p.nama LIMIT 1000`,
        ...argSaldo,
        ...argKeluar,
        ...argKeluar,
      );
      const acuan = Date.parse(`${f.sampai}T00:00:00Z`);
      const hasil = rows.map((r) => {
        const saldo = num(r.saldo);
        const keluar = num(r.qty_keluar);
        const perputaran = saldo > 0 ? Math.round((keluar / saldo) * 100) / 100 : 0;
        const tgl = r.mutasi_terakhir ? Date.parse(String(r.mutasi_terakhir).slice(0, 10) + 'T00:00:00Z') : NaN;
        const umur = Number.isNaN(tgl) ? 0 : Math.max(0, Math.round((acuan - tgl) / 86_400_000));
        const aging = umur <= 30 ? '0–30 hari' : umur <= 60 ? '31–60 hari' : umur <= 90 ? '61–90 hari' : '>90 hari';
        return { nama_produk: r.nama_produk, sku: r.sku, saldo, qty_keluar: keluar, perputaran, umur_hari: umur, aging };
      });
      return { kartu: [], rows: hasil, terbatas: rows.length >= 1000 };
    },
  },

  /* ------------------------------- D. Opname ---------------------------- */
  'opname-riwayat': {
    judul: 'Riwayat Opname',
    kategori: 'opname',
    deskripsi: 'Sesi opname pada periode: jumlah barang, selisih, nilai selisih Rp, dan berita acara (catatan). Klik baris untuk rincian barang selisih.',
    kolom: KOLS(
      ['no_dokumen', 'No. Opname', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['gudang', 'Gudang', 'teks'],
      ['status', 'Status', 'teks'],
      ['jumlah_barang', 'Barang', 'angka'],
      ['jumlah_selisih', 'Barang Selisih', 'angka'],
      ['nilai_selisih', 'Nilai Selisih', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
      ['berita_acara', 'Berita Acara', 'teks'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'nilai_selisih', label: 'Nilai Selisih', format: 'rupiah' },
      { kunci: 'jumlah_selisih', label: 'Barang Selisih', format: 'angka' },
    ],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [wherePeriode('os.tanggal')];
      const a: unknown[] = argPeriode(f);
      pakaiGudang(f, s, a, 'os.warehouse_id = ?', 'os');
      if (f.status === 'draft' || f.status === 'disahkan' || f.status === 'batal') {
        s.push('os.status = ?');
        a.push(f.status);
      }
      const rows = await all<Baris>(
        `SELECT os.id AS session_id, os.no_dokumen, ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal,
                COALESCE(w.nama, '—') AS gudang, os.status,
                COUNT(oi.id) AS jumlah_barang,
                SUM(CASE WHEN oi.selisih <> 0 THEN 1 ELSE 0 END) AS jumlah_selisih,
                COALESCE((WITH d AS (
                  SELECT pr.nama AS nama_produk, oi2.selisih AS sl
                  FROM opname_items oi2 JOIN products pr ON pr.id = oi2.product_id
                  WHERE oi2.session_id = os.id AND oi2.selisih <> 0
                  ORDER BY ABS(oi2.selisih) DESC)
                SELECT CASE WHEN (SELECT COUNT(*) FROM d) > 15
                  THEN (SELECT GROUP_CONCAT(y.nama_produk || ' ×' || CASE WHEN y.sl = CAST(y.sl AS INTEGER) THEN CAST(CAST(y.sl AS INTEGER) AS TEXT) ELSE CAST(y.sl AS TEXT) END, '; ') FROM (SELECT * FROM d LIMIT 15) y) || ' … (+' || ((SELECT COUNT(*) FROM d) - 15) || ' lainnya)'
                  ELSE (SELECT GROUP_CONCAT(y.nama_produk || ' ×' || CASE WHEN y.sl = CAST(y.sl AS INTEGER) THEN CAST(CAST(y.sl AS INTEGER) AS TEXT) ELSE CAST(y.sl AS TEXT) END, '; ') FROM d y) END), '—') AS rincian_barang,
                ${detailDokOpname('os.id')},
                ROUND(COALESCE(SUM(ABS(oi.selisih) * (
                  SELECT CASE WHEN COALESCE(SUM(l.qty_masuk) - SUM(l.qty_keluar), 0) > 0
                    THEN (COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0) - COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0))
                         / (SUM(l.qty_masuk) - SUM(l.qty_keluar))
                    ELSE 0 END
                  FROM stock_ledger l
                  WHERE l.product_id = oi.product_id AND l.warehouse_id = os.warehouse_id
                )), 0), 0) AS nilai_selisih,
                COALESCE(os.catatan, '—') AS berita_acara
         FROM opname_sessions os
         LEFT JOIN opname_items oi ON oi.session_id = os.id
         LEFT JOIN warehouses w ON w.id = os.warehouse_id
         WHERE ${s.join(' AND ')}
         GROUP BY os.id, w.nama
         ORDER BY os.tanggal DESC LIMIT 500`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 500 };
    },
  },

  'opname-selisih': {
    judul: 'Selisih Opname',
    kategori: 'opname',
    deskripsi: 'Rincian selisih per barang: qty sistem, qty fisik, selisih, dan nilai selisih (rata-rata bergerak).',
    kolom: KOLS(
      ['no_dokumen', 'No. Opname', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['nama_produk', 'Barang', 'teks'],
      ['qty_sistem', 'Sistem', 'angka'],
      ['qty_fisik', 'Fisik', 'angka'],
      ['selisih', 'Selisih', 'angka'],
      ['nilai', 'Nilai', 'rupiah'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama_produk', seri: ['nilai'] },
    kartuKunci: [{ kunci: 'nilai', label: 'Total Nilai Selisih', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const s: string[] = [wherePeriode('os.tanggal'), 'oi.selisih <> 0'];
      const a: unknown[] = argPeriode(f);
      pakaiGudang(f, s, a, 'os.warehouse_id = ?', 'os');
      if (f.produk) { s.push('oi.product_id = ?'); a.push(f.produk); }
      if (f.status === 'draft' || f.status === 'disahkan' || f.status === 'batal') {
        s.push('os.status = ?');
        a.push(f.status);
      }
      const rows = await all<Baris>(
        `SELECT os.id AS session_id, os.no_dokumen, ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, p.nama AS nama_produk,
                oi.qty_sistem, oi.qty_fisik, oi.selisih,
                ROUND(oi.selisih * COALESCE((
                  SELECT CASE WHEN COALESCE(SUM(l.qty_masuk) - SUM(l.qty_keluar), 0) > 0
                    THEN (COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0) - COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0))
                         / (SUM(l.qty_masuk) - SUM(l.qty_keluar))
                    ELSE 0 END
                  FROM stock_ledger l
                  WHERE l.product_id = oi.product_id AND l.warehouse_id = os.warehouse_id
                ), 0), 0) AS nilai
         FROM opname_items oi
         JOIN opname_sessions os ON os.id = oi.session_id
         JOIN products p ON p.id = oi.product_id
         WHERE ${s.join(' AND ')}
         ORDER BY ABS(oi.selisih) DESC, p.nama LIMIT 1000`,
        ...a,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  /* ------------------------------ E. Keuangan ---------------------------- */
  'keuangan-laba-rugi': {
    judul: 'Laba Rugi',
    kategori: 'keuangan',
    deskripsi: 'Pendapatan, HPP/beban, dan laba bersih dari jurnal yang sudah disahkan pada periode terpilih.',
    kolom: KOLS(
      ['kode', 'Akun', 'teks'],
      ['nama', 'Nama Akun', 'teks'],
      ['tipe', 'Tipe', 'teks'],
      ['debit', 'Debit', 'rupiah'],
      ['kredit', 'Kredit', 'rupiah'],
      ['nilai', 'Nilai', 'rupiah'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'nama', seri: ['nilai'] },
    kartuKunci: [],
    jalan: async (f, q) => {
      void q;
      const w = argPeriode(f);
      const rows = await all<Baris>(
        `SELECT a.kode, a.nama, a.tipe, COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.kredit), 0) AS kredit,
                CASE WHEN a.tipe = 'pendapatan'
                     THEN COALESCE(SUM(jl.kredit), 0) - COALESCE(SUM(jl.debit), 0)
                     ELSE COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.kredit), 0) END AS nilai
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         JOIN accounts a ON a.id = jl.account_id
         WHERE a.tipe IN ('pendapatan', 'beban') AND ${wherePeriode('j.tanggal')}
         GROUP BY a.id ORDER BY a.kode`,
        ...w,
      );
      const pendapatan = rows.filter((r) => r.tipe === 'pendapatan').reduce((a2, r) => a2 + num(r.nilai), 0);
      const beban = rows.filter((r) => r.tipe === 'beban').reduce((a2, r) => a2 + num(r.nilai), 0);
      return {
        kartu: [
          { kunci: 'pendapatan', label: 'Pendapatan', nilai: pendapatan, format: 'rupiah' },
          { kunci: 'beban', label: 'Beban / HPP', nilai: beban, format: 'rupiah' },
          { kunci: 'laba', label: 'Laba Bersih', nilai: pendapatan - beban, format: 'rupiah' },
        ],
        rows,
      };
    },
  },

  'keuangan-neraca': {
    judul: 'Neraca',
    kategori: 'keuangan',
    deskripsi: 'Saldo akun aset, kewajiban, dan modal per akhir periode (jurnal disahkan).',
    kolom: KOLS(
      ['kode', 'Akun', 'teks'],
      ['nama', 'Nama Akun', 'teks'],
      ['tipe', 'Tipe', 'teks'],
      ['debit', 'Debit', 'rupiah'],
      ['kredit', 'Kredit', 'rupiah'],
      ['saldo', 'Saldo', 'rupiah'],
    ),
    grafik: 'donat',
    grafikKunci: { x: 'nama', seri: ['saldo'] },
    kartuKunci: [],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT a.kode, a.nama, a.tipe, COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.kredit), 0) AS kredit,
                CASE WHEN a.saldo_normal = 'debit'
                     THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.kredit), 0)
                     ELSE COALESCE(SUM(jl.kredit), 0) - COALESCE(SUM(jl.debit), 0) END AS saldo
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         JOIN accounts a ON a.id = jl.account_id
         WHERE a.tipe IN ('aset', 'kewajiban', 'modal') AND j.tanggal <= ?::timestamptz
         GROUP BY a.id ORDER BY a.kode`,
        f.batasAkhir,
      );
      const aset = rows.filter((r) => r.tipe === 'aset').reduce((a2, r) => a2 + num(r.saldo), 0);
      const kewajiban = rows.filter((r) => r.tipe === 'kewajiban').reduce((a2, r) => a2 + num(r.saldo), 0);
      const modal = rows.filter((r) => r.tipe === 'modal').reduce((a2, r) => a2 + num(r.saldo), 0);
      return {
        kartu: [
          { kunci: 'aset', label: 'Total Aset', nilai: aset, format: 'rupiah' },
          { kunci: 'kewajiban', label: 'Total Kewajiban', nilai: kewajiban, format: 'rupiah' },
          { kunci: 'modal', label: 'Total Modal', nilai: modal, format: 'rupiah' },
        ],
        rows,
      };
    },
  },

  'keuangan-arus-kas': {
    judul: 'Arus Kas',
    kategori: 'keuangan',
    deskripsi: 'Kas masuk & keluar per hari dari akun kas, bank, dan QRIS.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'teks'],
      ['masuk', 'Kas Masuk', 'rupiah'],
      ['keluar', 'Kas Keluar', 'rupiah'],
      ['bersih', 'Bersih', 'rupiah'],
    ),
    grafik: 'garis',
    grafikKunci: { x: 'tanggal', seri: ['masuk', 'keluar'] },
    kartuKunci: [
      { kunci: 'masuk', label: 'Kas Masuk', format: 'rupiah' },
      { kunci: 'keluar', label: 'Kas Keluar', format: 'rupiah' },
      { kunci: 'bersih', label: 'Kas Bersih', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT substr(($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 10) AS tanggal,
                COALESCE(SUM(jl.debit), 0) AS masuk,
                COALESCE(SUM(jl.kredit), 0) AS keluar,
                COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.kredit), 0) AS bersih
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         JOIN accounts a ON a.id = jl.account_id
         WHERE ${AKUN_KAS} AND ${wherePeriode('j.tanggal')}
         GROUP BY 1 ORDER BY 1`,
        ...argPeriode(f),
      );
      return { kartu: [], rows };
    },
  },

  'keuangan-buku-besar': {
    judul: 'Buku Besar',
    kategori: 'keuangan',
    deskripsi: 'Buku besar satu akun (bawaan: 1001 Kas — ganti lewat parameter ?akun=KODE) dengan saldo berjalan.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_jurnal', 'No. Jurnal', 'teks'],
      ['keterangan', 'Keterangan', 'teks'],
      ['debit', 'Debit', 'rupiah'],
      ['kredit', 'Kredit', 'rupiah'],
      ['saldo', 'Saldo', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'debit', label: 'Total Debit', format: 'rupiah' },
      { kunci: 'kredit', label: 'Total Kredit', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      const kode = (q.akun || '1001').trim();
      const akun = await get<{ id: number; saldo_normal: string; nama: string }>(
        `SELECT id, saldo_normal, nama FROM accounts WHERE kode = ? OR CAST(id AS TEXT) = ?`,
        kode,
        kode,
      );
      if (!akun) throw tolak(404, `Akun "${kode}" tidak ditemukan.`);
      const faktor = akun.saldo_normal === 'kredit' ? -1 : 1;
      const batas = Math.min(2000, Math.max(50, Number(q.batas ?? 2000) || 2000));
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, j.no_jurnal,
                COALESCE(jl.keterangan, j.keterangan, '') AS keterangan,
                jl.debit, jl.kredit,
                ROUND(SUM((jl.debit - jl.kredit) * ?) OVER (ORDER BY j.tanggal, jl.id), 0) AS saldo
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         WHERE jl.account_id = ? AND ${wherePeriode('j.tanggal')}
         ORDER BY j.tanggal, jl.id LIMIT ?`,
        faktor,
        akun.id,
        ...argPeriode(f),
        batas,
      );
      return { kartu: [], rows, terbatas: rows.length >= batas };
    },
  },

  'keuangan-jurnal': {
    judul: 'Jurnal Umum',
    kategori: 'keuangan',
    deskripsi: 'Daftar jurnal yang sudah disahkan beserta jumlah debit & kreditnya.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_jurnal', 'No. Jurnal', 'teks'],
      ['sumber', 'Sumber', 'teks'],
      ['keterangan', 'Keterangan', 'teks'],
      ['debit', 'Debit', 'rupiah'],
      ['kredit', 'Kredit', 'rupiah'],
      ['status', 'Status', 'teks'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'debit', label: 'Total Debit', format: 'rupiah' },
      { kunci: 'kredit', label: 'Total Kredit', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, j.no_jurnal, j.sumber_tipe AS sumber,
                COALESCE(j.keterangan, '—') AS keterangan,
                COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.kredit), 0) AS kredit, j.status
         FROM journals j JOIN journal_lines jl ON jl.journal_id = j.id
         WHERE j.status = 'disahkan' AND ${wherePeriode('j.tanggal')}
         GROUP BY j.id ORDER BY j.tanggal DESC, j.id DESC LIMIT 1000`,
        ...argPeriode(f),
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'keuangan-kas-bank': {
    judul: 'Kas dan Bank',
    kategori: 'keuangan',
    deskripsi: 'Mutasi rinci akun kas/bank/QRIS: setiap baris jurnal yang menyentuh kas.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_jurnal', 'No. Jurnal', 'teks'],
      ['akun', 'Akun', 'teks'],
      ['keterangan', 'Keterangan', 'teks'],
      ['masuk', 'Masuk', 'rupiah'],
      ['keluar', 'Keluar', 'rupiah'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'akun', seri: ['masuk'] },
    kartuKunci: [
      { kunci: 'masuk', label: 'Total Masuk', format: 'rupiah' },
      { kunci: 'keluar', label: 'Total Keluar', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, j.no_jurnal,
                a.kode || ' ' || a.nama AS akun,
                COALESCE(jl.keterangan, j.keterangan, '—') AS keterangan,
                CASE WHEN a.saldo_normal = 'debit' THEN jl.debit ELSE jl.kredit END AS masuk,
                CASE WHEN a.saldo_normal = 'debit' THEN jl.kredit ELSE jl.debit END AS keluar
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         JOIN accounts a ON a.id = jl.account_id
         WHERE ${AKUN_KAS} AND ${wherePeriode('j.tanggal')}
         ORDER BY j.tanggal DESC, jl.id DESC LIMIT 1000`,
        ...argPeriode(f),
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  'keuangan-biaya': {
    judul: 'Biaya / Pengeluaran per Akun',
    kategori: 'keuangan',
    deskripsi: 'Pos beban (termasuk HPP) pada periode — siap dibandingkan dengan periode sebelumnya.',
    kolom: KOLS(
      ['kode', 'Akun', 'teks'],
      ['nama', 'Nama Akun', 'teks'],
      ['debit', 'Debit', 'rupiah'],
      ['kredit', 'Kredit', 'rupiah'],
      ['beban', 'Beban', 'rupiah'],
      ['jml_jurnal', 'Jurnal', 'angka'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'nama', seri: ['beban'] },
    kartuKunci: [{ kunci: 'beban', label: 'Total Biaya', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT a.kode, a.nama, COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.kredit), 0) AS kredit,
                COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.kredit), 0) AS beban,
                COUNT(DISTINCT j.id) AS jml_jurnal
         FROM journal_lines jl
         JOIN journals j ON j.id = jl.journal_id AND j.status = 'disahkan'
         JOIN accounts a ON a.id = jl.account_id
         WHERE a.tipe = 'beban' AND ${wherePeriode('j.tanggal')}
         GROUP BY a.id ORDER BY beban DESC`,
        ...argPeriode(f),
      );
      return { kartu: [], rows };
    },
  },

  /* -------------------------------- F. Pajak ----------------------------- */
  'pajak-rekap': {
    judul: 'Rekap Pajak Keluaran & Masukan',
    kategori: 'pajak',
    deskripsi: 'Pajak penjualan (keluaran) vs pajak pembelian (masukan) per hari/bulan, plus selisihnya.',
    kolom: KOLS(
      ['periode', 'Periode', 'teks'],
      ['keluaran', 'Pajak Keluaran', 'rupiah'],
      ['masukan', 'Pajak Masukan', 'rupiah'],
      ['selisih', 'Selisih', 'rupiah'],
    ),
    grafik: 'garis',
    grafikKunci: { x: 'periode', seri: ['keluaran', 'masukan'] },
    kartuKunci: [
      { kunci: 'keluaran', label: 'Pajak Keluaran', format: 'rupiah' },
      { kunci: 'masukan', label: 'Pajak Masukan', format: 'rupiah' },
      { kunci: 'selisih', label: 'Selisih', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const span = Math.round(
        (Date.parse(`${f.sampai}T00:00:00Z`) - Date.parse(`${f.dari}T00:00:00Z`)) / 86_400_000,
      );
      const potong = span > 45 ? 7 : 10; // bulan vs hari
      const wj = wherePenjualan(f);
      const wp = wherePembelian(f);
      const keluaran = await all<Baris>(
        `SELECT substr(($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, ${potong}) AS periode, COALESCE(SUM(s.pajak), 0) AS nilai
         FROM sales s ${wj.sql} GROUP BY 1`,
        ...wj.arg,
      );
      const masukan = await all<Baris>(
        `SELECT substr(($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, ${potong}) AS periode, COALESCE(SUM(p.pajak), 0) AS nilai
         FROM purchases p ${wp.sql} GROUP BY 1`,
        ...wp.arg,
      );
      const peta = new Map<string, { keluaran: number; masukan: number }>();
      for (const r of keluaran) {
        const k = String(r.periode);
        peta.set(k, { keluaran: num(r.nilai), masukan: 0 });
      }
      for (const r of masukan) {
        const k = String(r.periode);
        const e = peta.get(k) ?? { keluaran: 0, masukan: 0 };
        e.masukan = num(r.nilai);
        peta.set(k, e);
      }
      const rows = [...peta.entries()]
        .map(([periode, v]) => ({ periode, keluaran: v.keluaran, masukan: v.masukan, selisih: v.keluaran - v.masukan }))
        .sort((a, b) => a.periode.localeCompare(b.periode));
      return { kartu: [], rows };
    },
  },

  'pajak-faktur': {
    judul: 'Daftar Faktur Berpajak',
    kategori: 'pajak',
    deskripsi: 'Faktur penjualan & pembelian yang memuat pajak (PPN) — siap diekspor Excel. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['jenis', 'Jenis', 'teks'],
      ['tanggal', 'Tanggal', 'waktu'],
      ['no_dokumen', 'No. Dokumen', 'teks'],
      ['pihak', 'Pihak', 'teks'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
      ['dasar', 'Dasar Pengenaan', 'rupiah'],
      ['pajak', 'Pajak', 'rupiah'],
      ['total', 'Total', 'rupiah'],
    ),
    grafik: null,
    kartuKunci: [
      { kunci: 'pajak', label: 'Total Pajak', format: 'rupiah' },
      { kunci: 'dasar', label: 'Total Dasar', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const wj = wherePenjualan(f);
      const wp = wherePembelian(f);
      // Catatan SQLite: cabang UNION tidak boleh di dalam kurung.
      const rows = await all<Baris>(
        `SELECT 'Penjualan' AS jenis, ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, s.no_dokumen,
                COALESCE(c.nama, 'Umum') AS pihak,
                ${RINCI_JUAL('s.id')} AS rincian_barang,
                ${detailDokJual('s.id', 200, f.zona)},
                (s.subtotal - s.diskon) AS dasar, s.pajak, s.total
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.pajak > 0 AND ${wj.sql.replace(/^WHERE /, '')}
         UNION ALL         SELECT 'Pembelian', ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), p.no_dokumen,
                 COALESCE(s2.nama, '—'),
                 ${RINCI_BELI('p.id')} AS rincian_barang,
                 ${detailDokBeli('p.id', 200, f.zona)},
                 (p.subtotal - p.diskon), p.pajak, p.total
         FROM purchases p LEFT JOIN suppliers s2 ON s2.id = p.supplier_id
         WHERE p.pajak > 0 AND ${wp.sql.replace(/^WHERE /, '')}
         ORDER BY tanggal DESC LIMIT 1000`,
        ...wj.arg,
        ...wp.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },

  /* -------------------------- G. Piutang & Utang ------------------------- */
  'piutang-umur': {
    judul: 'Piutang Pelanggan (Aging)',
    kategori: 'piutang',
    deskripsi: 'Piutang per pelanggan dengan pengelompokan umur 0–30, 31–60, 61–90, dan >90 hari (acuan akhir periode). Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['pelanggan', 'Pelanggan', 'teks'],
      ['dokumen', 'Dokumen', 'angka'],
      ['total', 'Total', 'rupiah'],
      ['terbayar', 'Terbayar', 'rupiah'],
      ['sisa', 'Sisa', 'rupiah'],
      ['d0_30', '0–30 hari', 'rupiah'],
      ['d31_60', '31–60 hari', 'rupiah'],
      ['d61_90', '61–90 hari', 'rupiah'],
      ['d90', '>90 hari', 'rupiah'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'pelanggan', seri: ['sisa'] },
    kartuKunci: [
      { kunci: 'sisa', label: 'Total Piutang', format: 'rupiah' },
      { kunci: 'd90', label: 'Lebih 90 Hari', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const w = wherePenjualan(f);
      const rows = await all<Baris>(
        `SELECT COALESCE(c.nama, 'Umum') AS pelanggan, COUNT(*) AS dokumen,
                COALESCE(SUM(r.total), 0) AS total, COALESCE(SUM(r.terbayar), 0) AS terbayar,
                COALESCE(SUM(r.total - r.terbayar), 0) AS sisa,
                COALESCE(SUM(CASE WHEN GREATEST(0, LEAST(999, CAST(?::date - COALESCE(r.jatuh_tempo::date, s.tanggal::date) AS INTEGER))) <= 30
                                  THEN r.total - r.terbayar ELSE 0 END), 0) AS d0_30,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(r.jatuh_tempo::date, s.tanggal::date) AS INTEGER) BETWEEN 31 AND 60
                                  THEN r.total - r.terbayar ELSE 0 END), 0) AS d31_60,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(r.jatuh_tempo::date, s.tanggal::date) AS INTEGER) BETWEEN 61 AND 90
                                  THEN r.total - r.terbayar ELSE 0 END), 0) AS d61_90,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(r.jatuh_tempo::date, s.tanggal::date) AS INTEGER) > 90
                                  THEN r.total - r.terbayar ELSE 0 END), 0) AS d90,
                ${kolomRinciJual(f, 's2.customer_id IS NOT DISTINCT FROM r.customer_id').sql},
                ${detailRinciJual(f, 's2.customer_id IS NOT DISTINCT FROM r.customer_id AND EXISTS (SELECT 1 FROM receivables rx WHERE rx.sale_id = s2.id AND (rx.total - rx.terbayar) > 0)').sql}
         FROM receivables r
         JOIN sales s ON s.id = r.sale_id
         LEFT JOIN customers c ON c.id = r.customer_id
         ${w.sql} AND r.status <> 'batal' AND (r.total - r.terbayar) > 0
         GROUP BY r.customer_id, c.nama ORDER BY sisa DESC LIMIT 200`,
        f.sampai, f.sampai, f.sampai, f.sampai,
        ...kolomRinciJual(f, 's2.customer_id IS r.customer_id').arg,
        ...detailRinciJual(f, 's2.customer_id IS r.customer_id AND EXISTS (SELECT 1 FROM receivables rx WHERE rx.sale_id = s2.id AND (rx.total - rx.terbayar) > 0)').arg,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 200 };
    },
  },

  'utang-umur': {
    judul: 'Utang Pemasok (Aging)',
    kategori: 'piutang',
    deskripsi: 'Utang per pemasok dengan aging 0–30/31–60/61–90/>90 hari dan tanggal jatuh tempo terdekat. Klik baris untuk rincian barang.',
    kolom: KOLS(
      ['pemasok', 'Pemasok', 'teks'],
      ['dokumen', 'Dokumen', 'angka'],
      ['total', 'Total', 'rupiah'],
      ['terbayar', 'Terbayar', 'rupiah'],
      ['sisa', 'Sisa', 'rupiah'],
      ['d0_30', '0–30 hari', 'rupiah'],
      ['d31_60', '31–60 hari', 'rupiah'],
      ['d61_90', '61–90 hari', 'rupiah'],
      ['d90', '>90 hari', 'rupiah'],
      ['jatuh_tempo', 'Jatuh Tempo Terdekat', 'teks'],
      ['rincian_barang', 'Rincian Barang', 'teks'],
    ),
    grafik: 'batang',
    grafikKunci: { x: 'pemasok', seri: ['sisa'] },
    kartuKunci: [
      { kunci: 'sisa', label: 'Total Utang', format: 'rupiah' },
      { kunci: 'd90', label: 'Lebih 90 Hari', format: 'rupiah' },
    ],
    jalan: async (f, q) => {
      void q;
      const w = wherePembelian(f);
      const rows = await all<Baris>(
        `SELECT COALESCE(s.nama, '(tanpa pemasok)') AS pemasok, COUNT(*) AS dokumen,
                COALESCE(SUM(py.total), 0) AS total, COALESCE(SUM(py.terbayar), 0) AS terbayar,
                COALESCE(SUM(py.total - py.terbayar), 0) AS sisa,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(py.jatuh_tempo::date, p.tanggal::date) AS INTEGER) BETWEEN 0 AND 30
                                  THEN py.total - py.terbayar ELSE 0 END), 0) AS d0_30,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(py.jatuh_tempo::date, p.tanggal::date) AS INTEGER) BETWEEN 31 AND 60
                                  THEN py.total - py.terbayar ELSE 0 END), 0) AS d31_60,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(py.jatuh_tempo::date, p.tanggal::date) AS INTEGER) BETWEEN 61 AND 90
                                  THEN py.total - py.terbayar ELSE 0 END), 0) AS d61_90,
                COALESCE(SUM(CASE WHEN CAST(?::date - COALESCE(py.jatuh_tempo::date, p.tanggal::date) AS INTEGER) > 90
                                  THEN py.total - py.terbayar ELSE 0 END), 0) AS d90,
                CASE WHEN COUNT(py.jatuh_tempo) = 0 THEN '—' ELSE MIN(py.jatuh_tempo)::text END AS jatuh_tempo,
                ${kolomRinciBeli(f, 'pp2.supplier_id IS NOT DISTINCT FROM py.supplier_id').sql},
                ${detailRinciBeli(f, 'pp2.supplier_id IS NOT DISTINCT FROM py.supplier_id AND EXISTS (SELECT 1 FROM payables px WHERE px.purchase_id = pp2.id AND (px.total - px.terbayar) > 0)').sql}
         FROM payables py
         JOIN purchases p ON p.id = py.purchase_id
         LEFT JOIN suppliers s ON s.id = py.supplier_id
         ${w.sql} AND py.status <> 'batal' AND (py.total - py.terbayar) > 0
         GROUP BY py.supplier_id, s.nama ORDER BY sisa DESC LIMIT 200`,
        f.sampai, f.sampai, f.sampai, f.sampai,
        ...kolomRinciBeli(f, 'pp2.supplier_id IS py.supplier_id').arg,
        ...detailRinciBeli(f, 'pp2.supplier_id IS py.supplier_id AND EXISTS (SELECT 1 FROM payables px WHERE px.purchase_id = pp2.id AND (px.total - px.terbayar) > 0)').arg,
        ...w.arg,
      );
      return { kartu: [], rows, terbatas: rows.length >= 200 };
    },
  },

  'piutang-pelunasan': {
    judul: 'Riwayat Pelunasan',
    kategori: 'piutang',
    deskripsi: 'Riwayat pembayaran/piutang & utang yang tercatat pada modul keuangan.',
    kolom: KOLS(
      ['tanggal', 'Tanggal', 'waktu'],
      ['tipe', 'Tipe', 'teks'],
      ['jumlah', 'Jumlah', 'rupiah'],
      ['akun', 'Akun Kas', 'teks'],
      ['keterangan', 'Keterangan', 'teks'],
    ),
    grafik: null,
    kartuKunci: [{ kunci: 'jumlah', label: 'Total Pelunasan', format: 'rupiah' }],
    jalan: async (f, q) => {
      void q;
      const rows = await all<Baris>(
        `SELECT ($1 AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}') AS tanggal, py.tipe,
                COALESCE(py.jumlah, 0) AS jumlah, COALESCE(a.nama, '—') AS akun,
                COALESCE(py.referensi_id, 0) AS keterangan
         FROM payments py LEFT JOIN accounts a ON a.id = py.akun_kas_id
         WHERE ${wherePeriode('py.tanggal')}
         ORDER BY py.tanggal DESC, py.id DESC LIMIT 1000`,
        ...argPeriode(f),
      );
      return { kartu: [], rows, terbatas: rows.length >= 1000 };
    },
  },
};

/* ============================== Rute HTTP ================================= */

const cacheKey = (kode: string, f: FilterLaporan, q: Record<string, string>): string =>
  JSON.stringify([kode, f, { grup: q.grup, urut: q.urut, batas: q.batas, produk: q.produk, akun: q.akun, grupby: q.grupby, status_po: q.status_po }]);

async function jalankanLaporan(kode: string, f: FilterLaporan, q: Record<string, string>, segar: boolean): Promise<HasilLaporan & { total: Baris | null }> {
  const def = LAPORAN[kode];
  if (!def) throw tolak(404, `Laporan "${kode}" tidak ditemukan.`);
  let hasil: HasilLaporan;
  try {
    hasil = await denganCache(
      cacheKey(kode, f, q),
      () => def.jalan(f, q),
      segar,
    );
  } catch (err) {
    // Log berkonteks (kode + filter aktif) agar galat relasi/SQL cepat
    // dilacak di console server; klien tetap menerima pesan generik 500.
    console.error(
      `[LAPORAN:${kode}] gagal jalan (${f.dari}..${f.sampai}` +
        `${f.gudang ? `, gudang=${f.gudang}` : ''}` +
        `${f.status ? `, status=${f.status}` : ''}):`,
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    throw err;
  }
  const kartu = hasil.kartu.length
    ? hasil.kartu
    : kartuDari(def, hasil.rows);
  // Perbandingan periode sebelumnya (N1) — dihitung ulang hanya bila diminta.
  if (f.bandingkan) {
    const lalu = await def.jalan(filterBanding(f), q);
    const kartuLalu = lalu.kartu.length ? lalu.kartu : kartuDari(def, lalu.rows);
    for (const k of kartu) {
      const pendamping = kartuLalu.find((x) => x.kunci === k.kunci);
      k.lalu = pendamping ? pendamping.nilai : null;
    }
  }
  const total = hasil.rows.length ? hitungTotal(hasil.rows, def.kolom) : null;
  return { kartu, rows: hasil.rows, total, terbatas: hasil.terbatas };
}

export async  function routerLaporan(): Promise<Router> {
  const r = Router();

  // Rute "tersimpan" (N5) harus terpasang SEBELUM /:kode agar tidak tertangkap.
  pasangTersimpan(r);
  await mulaiJadwalOtomatis();

  // Daftar definisi — dipakai pencarian cepat, pintasan, & validasi kode.
  r.get('/daftar', (_req, res) => {
    res.json({
      data: Object.entries(LAPORAN).map(([kode, d]) => ({
        kode,
        judul: d.judul,
        kategori: d.kategori,
        deskripsi: d.deskripsi,
      })),
    });
  });

  // Ringkasan (N1): KPI + perbandingan + tren + terlaris.
  r.get(
    '/ringkasan',
    asyncHandler(async (req, res) => {
      const t0 = Date.now();
      const reg0 = await regional();
      const f = bacaFilter(req.query as Record<string, unknown>, reg0.offsetMs);
      f.zona = reg0.zona;
      // ISOLASI GUDANG — filter eksplisit di luar cakupan ditolak; tanpa
      // filter, laporan hanya menghitung gudang yang terlihat sesi.
      if (f.gudang) await wajibGudangDiizinkan(req, f.gudang);
      f.lingkup = await idGudangSesi(req);
      const segar = req.query.segar === '1';
      const isi = await denganCache(
        `ringkasan|${cacheKey('ringkasan', f, {})}`,
        async () => {
          const w = wherePenjualan(f);
          const tren = await all<Baris>(
            `SELECT substr((s.tanggal AT TIME ZONE '${f.zona ?? 'Asia/Jakarta'}'), 1, 10) AS periode,
                    COALESCE(SUM(s.subtotal - s.diskon), 0) AS omzet,
                    COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) AS laba
             FROM sales s JOIN sale_items si ON si.sale_id = s.id
             ${w.sql}
             GROUP BY 1 ORDER BY 1`,
            ...w.arg,
          );
          const wi = whereItemPenjualan(f);
          const terlaris = await all<Baris>(
            `SELECT si.nama_produk AS nama, COALESCE(SUM(si.qty), 0) AS qty,
                    COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
             JOIN products p ON p.id = si.product_id
             ${wi.sql}
             GROUP BY si.product_id, si.nama_produk ORDER BY qty DESC LIMIT 5`,
            ...wi.arg,
          );
          return { kartu: ringkasanKPI(f), tren, terlaris };
        },
        segar,
      );
      res.json({
        kartu: isi.kartu,
        tren: isi.tren,
        terlaris: isi.terlaris,
        filter: await ringkasFilter(f),
        periode: { dari: f.dari, sampai: f.sampai, bandingDari: f.bandingDari, bandingSampai: f.bandingSampai },
        durasi_ms: Date.now() - t0,
      });
    }),
  );

  // Data laporan generik (agregasi di server + cache 60 detik — N6).
  r.get(
    '/:kode',
    asyncHandler(async (req, res) => {
      const t0 = Date.now();
      const kode = String(req.params.kode);
      const reg0 = await regional();
      const f = bacaFilter(req.query as Record<string, unknown>, reg0.offsetMs);
      f.zona = reg0.zona;
      // ISOLASI GUDANG — filter eksplisit di luar cakupan ditolak; tanpa
      // filter, laporan hanya menghitung gudang yang terlihat sesi.
      if (f.gudang) await wajibGudangDiizinkan(req, f.gudang);
      f.lingkup = await idGudangSesi(req);
      const segar = req.query.segar === '1';
      const q = req.query as Record<string, string>;
      const hasil = await jalankanLaporan(kode, f, q, segar);
      const def = LAPORAN[kode];
      res.json({
        kode,
        judul: def.judul,
        kategori: def.kategori,
        deskripsi: def.deskripsi,
        kolom: def.kolom,
        grafik: def.grafik,
        grafikKunci: def.grafikKunci ?? null,
        filter: await ringkasFilter(f),
        periode: { dari: f.dari, sampai: f.sampai, bandingDari: f.bandingDari, bandingSampai: f.bandingSampai },
        kartu: hasil.kartu,
        rows: hasil.rows,
        total: hasil.total,
        terbatas: Boolean(hasil.terbatas),
        durasi_ms: Date.now() - t0,
      });
    }),
  );

  // Ekspor Excel (sheet pertama = filter & periode; dicatat ke audit log — N7).
  r.get(
    '/:kode/ekspor',
    asyncHandler(async (req, res) => {
      const kode = String(req.params.kode);
      const def = LAPORAN[kode];
      if (!def) throw tolak(404, `Laporan "${kode}" tidak ditemukan.`);
      const reg0 = await regional();
      const f = bacaFilter(req.query as Record<string, unknown>, reg0.offsetMs);
      f.zona = reg0.zona;
      // ISOLASI GUDANG — filter eksplisit di luar cakupan ditolak; tanpa
      // filter, laporan hanya menghitung gudang yang terlihat sesi.
      if (f.gudang) await wajibGudangDiizinkan(req, f.gudang);
      f.lingkup = await idGudangSesi(req);
      const hasil = await jalankanLaporan(kode, f, req.query as Record<string, string>, false);

      const filterRows: Record<string, unknown>[] = [
        { Parameter: 'Laporan', Nilai: def.judul },
        ...(await ringkasFilter(f)).map(([k, v]) => ({ Parameter: k, Nilai: v })),
        { Parameter: 'Dicetak', Nilai: `${new Date().toLocaleString('id-ID', { timeZone: f.zona ?? 'Asia/Jakarta' })} ${labelZona(f.zona ?? 'Asia/Jakarta')}` },
      ];
      const dataRows = hasil.rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const k of def.kolom) out[k.label] = row[k.kunci] ?? '';
        return out;
      });
      // Sheet "Rincian Barang" — template terbuka ke bawah ikut ekspor.
      // Sumber: kolom tersembunyi rincian_detail (JSON) per baris.
      const kunciGrup = def.kolom.find((k) => k.kunci !== 'rincian_barang' && k.kunci !== 'rincian_detail')?.label ?? 'Grup';
      const rincianRows: Record<string, unknown>[] = [];
      for (const row of hasil.rows) {
        let items: Record<string, unknown>[] = [];
        try {
          const v = (row as Baris).rincian_detail;
          if (Array.isArray(v)) items = v as Record<string, unknown>[];
          else if (typeof v === 'string' && v.trim().startsWith('[')) {
            const p: unknown = JSON.parse(v);
            if (Array.isArray(p)) items = p as Record<string, unknown>[];
          }
        } catch { items = []; }
        const grup = (() => {
          const k = def.kolom.find((c) => c.kunci !== 'rincian_barang' && c.kunci !== 'rincian_detail');
          const v = k ? row[k.kunci] : '';
          return v ?? '';
        })();
        for (const it of items) {
          rincianRows.push({
            [kunciGrup]: grup,
            Tanggal: it.tanggal ?? '',
            Nomor: it.nomor ?? '',
            Barang: it.barang ?? '',
            Qty: it.qty ?? it.selisih ?? '',
            Harga: it.harga ?? '',
            Subtotal: it.subtotal ?? '',
            Laba: it.laba ?? '',
            Sistem: it.sistem ?? '',
            Fisik: it.fisik ?? '',
            Selisih: it.selisih ?? '',
          });
        }
      }
      // Baris Total tidak lagi ditambahkan ke sheet "Data": total hanya
      // boleh muncul di dokumen PDF, dan itu pun opsional (dicentang pengguna
      // di dialog cetak). Angka agregat tetap tersedia di respons API.
      const sheets: SheetExcel[] = [
        { judul: 'Filter dan Periode', kolom: [{ key: 'Parameter', label: 'Parameter' }, { key: 'Nilai', label: 'Nilai' }], baris: filterRows },
        {
          judul: 'Data',
          kolom: def.kolom.map((k) => ({ key: k.label, label: k.label })),
          baris: dataRows,
        },
        ...(rincianRows.length
          ? [
              {
                judul: 'Rincian Barang',
                kolom: [
                  { key: kunciGrup, label: kunciGrup },
                  { key: 'Tanggal', label: 'Tanggal' },
                  { key: 'Nomor', label: 'Nomor' },
                  { key: 'Barang', label: 'Barang' },
                  { key: 'Qty', label: 'Qty' },
                  { key: 'Harga', label: 'Harga' },
                  { key: 'Subtotal', label: 'Subtotal' },
                  { key: 'Laba', label: 'Laba' },
                  { key: 'Sistem', label: 'Sistem' },
                  { key: 'Fisik', label: 'Fisik' },
                  { key: 'Selisih', label: 'Selisih' },
                ],
                baris: rincianRows,
              } as SheetExcel,
            ]
          : []),
      ];
      const buf = await tulisExcelMulti(sheets);
      await catatAudit({
        userId: null,
        aksi: 'ekspor',
        tabel: 'laporan',
        recordId: kode,
        sesudah: { periode: `${f.dari}..${f.sampai}`, baris: hasil.rows.length },
      });
      const nama = `${kode}-${f.dari}-${f.sampai}.xlsx`
        .replace(/[\\/:*?"<>|]/g, '-');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
      res.send(buf);
    }),
  );

  // Log aktivitas cetak/kirim (N7) — dicatat ke audit_logs.
  r.post(
    '/log-aksi',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { kode?: string; aksi?: string };
      const kode = String(body.kode ?? '').slice(0, 40);
      const aksi = body.aksi === 'kirim' ? 'kirim' : body.aksi === 'ekspor' ? 'ekspor' : 'cetak';
      if (!LAPORAN[kode]) throw tolak(404, 'Kode laporan tidak dikenal.');
      await catatAudit({ userId: null, aksi, tabel: 'laporan', recordId: kode });
      res.json({ ok: true });
    }),
  );

  r.post('/bersihkan-cache', (_req, res) => {
    bersihCacheLaporan();
    res.json({ ok: true });
  });

  return r;
}

/* --------------------- Laporan tersimpan (N5) ---------------------- */

function pasangTersimpan(r: Router): void {
  r.get('/tersimpan', async (_req, res) => {
    const data = await all<Record<string, unknown>>(
      `SELECT id, nama, laporan, params_json, jadwal, aktif, terakhir_jalan, dibuat_pada
       FROM saved_reports ORDER BY nama`,
    );
    const berkas = await all<Record<string, unknown>>(
      `SELECT id, saved_report_id, laporan, nama, periode_dari, periode_sampai, dibuat_pada
       FROM report_files ORDER BY id DESC LIMIT 100`,
    );
    res.json({ data, berkas });
  });

  r.post(
    '/tersimpan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { nama?: string; laporan?: string; params?: unknown; jadwal?: string | null };
      const nama = String(body.nama ?? '').trim().slice(0, 80);
      const kode = String(body.laporan ?? '');
      if (!nama) throw tolak(400, 'Nama laporan wajib diisi.');
      if (!LAPORAN[kode]) throw tolak(400, 'Kode laporan tidak dikenal.');
      const jadwal =
        body.jadwal === 'harian' || body.jadwal === 'mingguan' || body.jadwal === 'bulanan'
          ? body.jadwal
          : null;
      const id = Number(
        await ((await run(
          `INSERT INTO saved_reports (nama, laporan, params_json, jadwal) VALUES (?, ?, ?, ?)`,
          nama,
          kode,
          JSON.stringify(body.params ?? {}),
          jadwal,
        ))).lastInsertRowid,
      );
      res.status(201).json({ id });
    }),
  );

  r.delete(
    '/tersimpan/:id',
    asyncHandler(async (req, res) => {
      const hasil = await run(`DELETE FROM saved_reports WHERE id = ?`, Number(req.params.id));
      if (!hasil.changes) throw tolak(404, 'Laporan tersimpan tidak ditemukan.');
      res.json({ ok: true });
    }),
  );

  // Jalankan sekarang: hasil laporan dicatat sebagai berkas laporan (N5).
  r.post(
    '/tersimpan/:id/jalankan',
    asyncHandler(async (req, res) => {
      const s = await get<Record<string, unknown>>(`SELECT * FROM saved_reports WHERE id = ?`, Number(req.params.id));
      if (!s) throw tolak(404, 'Laporan tersimpan tidak ditemukan.');
      const { id, baris } = await jalankanTersimpan(s);
      const def = LAPORAN[String(s.laporan)];
      res.status(201).json({ id, baris, judul: def?.judul ?? s.laporan });
    }),
  );
}

/** Jalankan satu laporan tersimpan → tulis baris report_files (N5). */
async function jalankanTersimpan(s: Record<string, unknown>): Promise<{ id: number; baris: number }> {
  let params: Record<string, string> = {};
  try {
    params = JSON.parse(String(s.params_json ?? '{}')) as Record<string, string>;
  } catch {
    params = {};
  }
  const reg0 = await regional();
  const f = bacaFilter(params, reg0.offsetMs);
  f.zona = reg0.zona;
  const hasil = await jalankanLaporan(String(s.laporan), f, params, true);
  const ringkas: Record<string, unknown> = {};
  for (const k of hasil.kartu) ringkas[k.label] = k.nilai;
  const id = Number(
    await ((await run(
      `INSERT INTO report_files (saved_report_id, laporan, nama, periode_dari, periode_sampai, params_json, ringkas_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      Number(s.id),
      String(s.laporan),
      String(s.nama),
      f.dari,
      f.sampai,
      JSON.stringify(params),
      JSON.stringify(ringkas),
    ))).lastInsertRowid,
  );
  await run(
    `UPDATE saved_reports SET terakhir_jalan = now(), diubah_pada = now() WHERE id = ?`,
    Number(s.id),
  );
  await catatAudit({ userId: null, aksi: 'tambah', tabel: 'report_files', recordId: id, sesudah: { nama: s.nama, laporan: s.laporan } });
  return { id, baris: hasil.rows.length };
}

/* --------------- Penjadwalan otomatis laporan tersimpan (N5) --------------- */

const JAM_MS = 3_600_000;
const JEDA_JADWAL: Record<string, number> = { harian: 24 * JAM_MS, mingguan: 168 * JAM_MS, bulanan: 28 * 24 * JAM_MS };
let timerJadwal: ReturnType<typeof setInterval> | null = null;

/** Jadwal lewat bila belum pernah jalan atau terakhir jalan melewati jeda wajar. */
function jadwalLewat(jadwal: string, terakhir: unknown): boolean {
  const jeda = JEDA_JADWAL[String(jadwal)];
  if (!jeda) return false;
  if (!terakhir) return true;
  const t = Date.parse(String(terakhir).replace(' ', 'T') + 'Z');
  return Number.isNaN(t) || Date.now() - t >= jeda;
}

async function cekJadwal(): Promise<void> {
  const daftar = await all<Record<string, unknown>>(
    `SELECT * FROM saved_reports WHERE aktif = TRUE AND jadwal IS NOT NULL`,
  );
  for (const s of daftar) {
    if (!jadwalLewat(String(s.jadwal ?? ''), s.terakhir_jalan)) continue;
    try {
      await jalankanTersimpan(s);
    } catch {
      // Satu laporan gagal tidak boleh menghentikan jadwal lainnya.
    }
  }
}

async function mulaiJadwalOtomatis(): Promise<void> {
  if (timerJadwal) return;
  timerJadwal = setInterval(cekJadwal, 10 * 60 * 1000);
  timerJadwal.unref?.();
  await cekJadwal();
}
