// MODUL DASHBOARD — API tampilan kartu, ringkasan KPI/grafik/tabel,
// dan Pengingat faktur belum lunas (piutang penjualan + hutang pembelian).
//
// Identitas pengguna: modul login menyusul — semua permintaan dianggap
// berasal dari Administrator (lihat lib/akses.ts), jadi preferensi tampilan
// menempel pada pengguna bawaan (idPenggunaBawaan). Bawaan tampilan bisa
// ditetapkan Admin per peran (klien mengirim peran aktif dari localStorage).
import { Router, type Request } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { idGudangSesi, wajibGudangDiizinkan } from '../lib/hak.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { idPenggunaBawaan } from '../lib/jurnal.ts';
import { catatBayarTagihanKas } from '../lib/jurnal.ts';
import { akunKasMetode, daftarAkunKas, saldoKas } from '../lib/dasarKas.ts';
import { totalNilaiPersediaan } from '../lib/stok.ts';
import { regional, zonaToko } from '../lib/zonaWaktu.ts';
import { nilaiPembelianBersih, seriPembelianBersih } from '../lib/pembelianBersih.ts';

/* ====================== Daftar kartu (sumber kebenaran) ==================== */

export const KARTU_DASHBOARD = [
  'pintasan',
  'kpi-penjualan',
  'kpi-transaksi',
  'kpi-laba',
  'kpi-stok',
  'kpi-piutang',
  'kpi-menipis',
  'pengingat',
  'grafik-7hari',
  'grafik-metode',
  'grafik-terlaris',
  'grafik-vs',
  'tabel-transaksi',
  'tabel-menipis',
] as const;

const SET_KARTU = new Set<string>(KARTU_DASHBOARD);
const PERAN_DIKENAL = new Set(['admin', 'manajer', 'kasir']);

/** Zona waktu toko untuk agregasi harian (aplikasi menyimpan timestamp UTC).
 * Bawaan bila regional belum termuat — handler selalu memakai zona aktif. */
const ZONA_BAWAN = 'Asia/Jakarta';

function kartuDariBody(v: unknown): Record<string, boolean> {
  const isi = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(isi)) {
    if (SET_KARTU.has(k) && typeof isi[k] === 'boolean') out[k] = isi[k] as boolean;
  }
  return out;
}

async function bacaPengingat(): Promise<{ hariSebelum: number; terlambatHarian: boolean }> {
  const s = await getSettings();
  const hari = Number(s.pengingat_hari_sebelum ?? '3');
  return {
    hariSebelum: hari === 1 || hari === 7 ? hari : 3,
    terlambatHarian: (s.pengingat_terlambat_harian ?? 'true') !== 'false',
  };
}

/* =================== X2 — model widget & penghitung data ================== */

type TipeWidget = 'kpi' | 'grafik' | 'donat' | 'daftar' | 'kas' | 'pintasan';

/** Metrik dashboard + jenis widget yang mendukungnya (katalog klien sinkron). */
export const METRIK_DASHBOARD: Record<
  string,
  { label: string; jenis: TipeWidget[]; format: 'rupiah' | 'angka' | 'produk' | 'rekening' }
> = {
  penjualan: { label: 'Penjualan (omzet)', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  pembelian: { label: 'Pembelian', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  laba: { label: 'Laba kotor', jenis: ['kpi', 'grafik'], format: 'rupiah' },
  transaksi: { label: 'Jumlah transaksi', jenis: ['kpi', 'grafik'], format: 'angka' },
  stok: { label: 'Nilai persediaan', jenis: ['kpi'], format: 'rupiah' },
  piutang: { label: 'Piutang belum lunas', jenis: ['kpi', 'daftar'], format: 'rupiah' },
  utang: { label: 'Utang belum lunas', jenis: ['kpi'], format: 'rupiah' },
  menipis: { label: 'Stok menipis', jenis: ['kpi', 'daftar'], format: 'produk' },
  terlaris: { label: 'Produk terlaris', jenis: ['grafik', 'daftar'], format: 'rupiah' },
  metode: { label: 'Metode pembayaran', jenis: ['donat'], format: 'rupiah' },
  kas: { label: 'Ringkasan kas & bank', jenis: ['kas'], format: 'rekening' },
  'piutang-jatuh-tempo': { label: 'Piutang jatuh tempo', jenis: ['daftar'], format: 'rupiah' },
  'transaksi-terakhir': { label: 'Transaksi terakhir', jenis: ['daftar'], format: 'rupiah' },
};

const LEBAR_VALIDE = new Set([3, 4, 6, 8, 12]);
const TINGGI_VALIDE = new Set(['kompak', 'normal', 'tinggi']);
const JENIS_VALIDE = new Set<TipeWidget>(['kpi', 'grafik', 'donat', 'daftar', 'kas', 'pintasan']);

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Validasi & sanitasi daftar widget dari body klien. */
function validasiWidgets(v: unknown): WidgetDashboard[] {
  if (!Array.isArray(v)) throw tolak(400, 'Layout harus berupa daftar widget.');
  const out: WidgetDashboard[] = [];
  for (const raw of v.slice(0, 40)) {
    const w = (raw ?? {}) as Record<string, unknown>;
    const jenis = String(w.jenis ?? '') as TipeWidget;
    const metrik = String(w.metrik ?? 'pintasan');
    if (!JENIS_VALIDE.has(jenis)) continue;
    if (jenis !== 'pintasan' && !METRIK_DASHBOARD[metrik]) continue;
    if (jenis !== 'pintasan' && !METRIK_DASHBOARD[metrik].jenis.includes(jenis)) continue;
    const lebar = Number(w.lebar);
    const tinggi = String(w.tinggi ?? 'normal');
    out.push({
      id: String(w.id ?? `w-${out.length}`).slice(0, 40),
      jenis,
      metrik,
      judul: String(w.judul ?? METRIK_DASHBOARD[metrik]?.label ?? 'Kartu').slice(0, 80),
      periode: typeof w.periode === 'string' ? w.periode.slice(0, 20) : undefined,
      dari: typeof w.dari === 'string' ? w.dari.slice(0, 10) : undefined,
      sampai: typeof w.sampai === 'string' ? w.sampai.slice(0, 10) : undefined,
      gudang: num(w.gudang) ? String(num(w.gudang)) : undefined,
      kasir: num(w.kasir) ? String(num(w.kasir)) : undefined,
      kategori: num(w.kategori) ? String(num(w.kategori)) : undefined,
      tampilan: w.tampilan === 'batang' ? 'batang' : w.tampilan === 'garis' ? 'garis' : undefined,
      jumlah: num(w.jumlah),
      lebar: LEBAR_VALIDE.has(lebar) ? lebar : 6,
      tinggi: TINGGI_VALIDE.has(tinggi) ? tinggi : 'normal',
    });
  }
  if (!out.length) throw tolak(400, 'Layout minimal berisi satu widget yang valid.');
  return out;
}

interface WidgetDashboard {
  id: string;
  jenis: TipeWidget;
  judul: string;
  metrik: string;
  periode?: string;
  dari?: string;
  sampai?: string;
  gudang?: string;
  kasir?: string;
  kategori?: string;
  tampilan?: 'garis' | 'batang';
  jumlah?: number;
  lebar: number;
  tinggi: string;
}

/** Tanggal hari ini menurut kalender zona toko (YYYY-MM-DD). */
const hariIni = (offsetMs = 7 * 3600000): string => new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

/** Rentang tanggal (kalender zona toko) dari kode periode widget. */
function hitungRentang(periode: unknown, dari?: unknown, sampai?: unknown, offsetMs = 7 * 3600000): { dari: string; sampai: string } {
  const hari = hariIni(offsetMs);
  const tgl = (d: Date) => new Date(d.getTime() + offsetMs).toISOString().slice(0, 10);
  const mundur = (n: number) => tgl(new Date(Date.now() - n * 86400000));
  switch (String(periode ?? '7-hari')) {
    case 'hari-ini':
      return { dari: hari, sampai: hari };
    case '14-hari':
      return { dari: mundur(13), sampai: hari };
    case '30-hari':
      return { dari: mundur(29), sampai: hari };
    case 'bulan-ini':
      return { dari: `${hari.slice(0, 7)}-01`, sampai: hari };
    case 'tahun-ini':
      return { dari: `${hari.slice(0, 4)}-01-01`, sampai: hari };
    case 'kustom': {
      const d = typeof dari === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dari) ? dari : mundur(6);
      const s = typeof sampai === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sampai) ? sampai : hari;
      return { dari: d, sampai: s };
    }
    default:
      return { dari: mundur(6), sampai: hari };
  }
}

/**
 * ISOLASI GUDANG — gudang yang boleh dilihat sesi: null = semua (Admin /
 * tanpa pembatasan); [] = tanpa akses (tidak ada baris).
 */
async function lingkupGudang(req: Request): Promise<number[] | null> {
  return await idGudangSesi(req);
}

/** Fragmen batas gudang (literal id aman dari DB) untuk alias tabel ber-warehouse. */
function batasLingkup(lingkup: number[] | null, alias: string): string {
  if (lingkup === null) return '';
  if (lingkup.length === 0) return ' AND 1 = 0';
  return ` AND ${alias}.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})`;
}

/** Klausa filter penjualan (gudang/kasir/kategori) untuk widget. */
function whereSales(f: { gudang?: number; kasir?: number; kategori?: number }, alias = 's', lingkup: number[] | null = null): string {
  const w: string[] = [`${alias}.status = 'disahkan'`];
  if (f.gudang) w.push(`${alias}.warehouse_id = ${f.gudang}`);
  else if (lingkup !== null) w.push(lingkup.length ? `${alias}.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})` : '1 = 0');
  if (f.kasir) w.push(`${alias}.kasir_id = ${f.kasir}`);
  if (f.kategori) {
    w.push(
      `EXISTS (SELECT 1 FROM sale_items si2 JOIN products p2 ON p2.id = si2.product_id
        WHERE si2.sale_id = ${alias}.id AND p2.category_id = ${f.kategori})`,
    );
  }
  return w.join(' AND ');
}

const rentangSql = (zona: string): string => `(s.tanggal AT TIME ZONE '${zona}')::date`;

/** Nilai KPI tunggal (satu angka) sesuai metrik & rentang. */
async function nilaiKpi(metrik: string, rentang: { dari: string; sampai: string }, f: Record<string, number | undefined>, lingkup: number[] | null = null, zona: string = ZONA_BAWAN): Promise<number> {
  const where = `${whereSales(f, 's', lingkup)} AND ${rentangSql(zona)} BETWEEN ? AND ?`;
  switch (metrik) {
    case 'penjualan': {
      const bruto = Number(await ((await get<{ v: number | null }>(`SELECT COALESCE(SUM(s.subtotal - s.diskon), 0) v FROM sales s WHERE ${where}`, rentang.dari, rentang.sampai)))?.v ?? 0);
      // NET SALES — retur disahkan mengurangi omzet agar angka dashboard sama
      // dengan Net Sales di Riwayat & Detail Penjualan.
      return Math.max(0, bruto - await totalReturPenjualan(rentang, f, lingkup, zona));
    }
    case 'transaksi':
      return Number(await ((await get<{ v: number | null }>(`SELECT COUNT(*) v FROM sales s WHERE ${where}`, rentang.dari, rentang.sampai)))?.v ?? 0);
    case 'laba':
      return Number(
        await ((await get<{ v: number | null }>(
          `SELECT COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) v FROM sale_items si
             JOIN sales s ON s.id = si.sale_id WHERE ${where}`,
          rentang.dari,
          rentang.sampai,
        )))?.v ?? 0,
      );
    case 'pembelian':
      // Pembelian BERSIH: pembelian langsung + PO yang sudah diterima − retur
      // pembelian. Sumber tunggal bersama laporan agar angka Dashboard sama
      // dengan laporan yang dibuka dari tombol Detail.
      return nilaiPembelianBersih(
        { gudang: f.gudang, lingkup, zona },
        rentang.dari,
        rentang.sampai,
      );
    case 'stok':
      return Number((await totalNilaiPersediaan(lingkup ?? undefined)).nilai);
    case 'piutang': {
      // Piutang selalu menunjuk penjualan (receivables.sale_id NOT NULL) —
      // batasi lewat gudang penjualannya.
      const syaratPiu = f.gudang
        ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id = ${f.gudang})`
        : lingkup !== null
          ? lingkup.length
            ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')}))`
            : ' AND 1 = 0'
          : '';
      return Number(await ((await get<{ v: number | null }>(`SELECT COALESCE(SUM(rc.total - rc.terbayar), 0) v FROM receivables rc WHERE rc.status IN ('belum', 'sebagian')${syaratPiu}`)))?.v ?? 0);
    }
    case 'utang': {
      // Hutang selalu menunjuk pembelian (payables.purchase_id) — batasi
      // lewat gudang pembeliannya.
      const syaratUta = f.gudang
        ? ` AND EXISTS (SELECT 1 FROM purchases p WHERE p.id = py.purchase_id AND p.warehouse_id = ${f.gudang})`
        : lingkup !== null
          ? lingkup.length
            ? ` AND EXISTS (SELECT 1 FROM purchases p WHERE p.id = py.purchase_id AND p.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')}))`
            : ' AND 1 = 0'
          : '';
      return Number(await ((await get<{ v: number | null }>(`SELECT COALESCE(SUM(py.total - py.terbayar), 0) v FROM payables py WHERE py.status IN ('belum', 'sebagian')${syaratUta}`)))?.v ?? 0);
    }
    case 'menipis': {
      // Stok menipis dihitung dari saldo gudang yang terlihat sesi saja.
      const gabungSb = f.gudang
        ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ${f.gudang}`
        : lingkup !== null
          ? lingkup.length
            ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})`
            : `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND 1 = 0`
          : `LEFT JOIN stock_balances sb ON sb.product_id = p.id`;
      const syaratMnp = lingkup !== null && !lingkup.length ? ' AND 1 = 0' : '';
      return Number(
        await ((await get<{ n: number | null }>(
          `SELECT COUNT(*) n FROM (
             SELECT p.id FROM products p ${gabungSb}
              WHERE p.aktif = TRUE AND p.deleted_at IS NULL AND p.stok_min > 0${syaratMnp}
              GROUP BY p.id HAVING COALESCE(SUM(sb.qty), 0) < p.stok_min
           )`,
        )))?.n ?? 0,
      );
    }
    default:
      return 0;
  }
}

/** Deret harian (satu nilai per tanggal) untuk grafik garis/batang. */
async function seriHarian(metrik: string, rentang: { dari: string; sampai: string }, f: Record<string, number | undefined>, lingkup: number[] | null = null, zona: string = ZONA_BAWAN) {
  const where = `${whereSales(f, 's', lingkup)} AND ${rentangSql(zona)} BETWEEN ? AND ?`;
  let rows: { periode: string; nilai: number }[] = [];
  if (metrik === 'pembelian') {
    rows = await seriPembelianBersih(
      { gudang: f.gudang, lingkup, zona },
      rentang.dari,
      rentang.sampai,
    );
  } else if (metrik === 'laba') {
    rows = (await all(`SELECT (s.tanggal AT TIME ZONE '${zona}')::date periode, COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0) nilai FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${where} GROUP BY periode ORDER BY periode`, rentang.dari, rentang.sampai));
  } else if (metrik === 'transaksi') {
    rows = (await all(`SELECT (s.tanggal AT TIME ZONE '${zona}')::date periode, COUNT(*) nilai FROM sales s WHERE ${where} GROUP BY periode ORDER BY periode`, rentang.dari, rentang.sampai));
  } else {
    rows = (await all(`SELECT (s.tanggal AT TIME ZONE '${zona}')::date periode, COALESCE(SUM(s.subtotal - s.diskon), 0) nilai FROM sales s WHERE ${where} GROUP BY periode ORDER BY periode`, rentang.dari, rentang.sampai));
  }
  // NET SALES — kurangi retur disahkan (pada tanggal retur) untuk metrik penjualan.
  if (metrik === 'penjualan') {
    const returHarian = await all<{ periode: string; nilai: number }>(
      `SELECT (sr.tanggal AT TIME ZONE '${zona}')::date periode, COALESCE(SUM(sr.total), 0) nilai
         FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
        WHERE ${syaratRetur(f, lingkup)}
          AND (sr.tanggal AT TIME ZONE '${zona}')::date BETWEEN ? AND ?
        GROUP BY periode`,
      rentang.dari,
      rentang.sampai,
    );
    const petaRetur = new Map(returHarian.map((r) => [r.periode, Number(r.nilai)]));
    rows = rows.map((r) => ({
      periode: r.periode,
      nilai: Math.max(0, Number(r.nilai) - (petaRetur.get(r.periode) ?? 0)),
    }));
  }
  // Hari kosong diisi 0 agar deret padat.
  const peta = new Map(rows.map((r) => [r.periode, Number(r.nilai)]));
  const seri: { periode: string; nilai: number }[] = [];
  for (let t = Date.parse(`${rentang.dari}T00:00:00Z`); t <= Date.parse(`${rentang.sampai}T00:00:00Z`); t += 86400000) {
    const hari = new Date(t).toISOString().slice(0, 10);
    if (seri.length >= 92) break; /* batasi 3 bulan agar ringan */
    seri.push({ periode: hari, nilai: peta.get(hari) ?? 0 });
  }
  return seri;
}

/** Syarat retur penjualan DISAHKAN untuk filter widget (gudang/kasir/kategori). */
function syaratRetur(f: Record<string, number | undefined>, lingkup: number[] | null): string {
  const w: string[] = [`sr.status = 'disahkan'`];
  if (f.gudang) w.push(`s.warehouse_id = ${Number(f.gudang)}`);
  else if (lingkup !== null) {
    w.push(lingkup.length ? `s.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})` : '1 = 0');
  }
  if (f.kasir) w.push(`s.kasir_id = ${Number(f.kasir)}`);
  if (f.kategori) {
    w.push(
      `EXISTS (SELECT 1 FROM sale_items si3 JOIN products p3 ON p3.id = si3.product_id
        WHERE si3.sale_id = s.id AND p3.category_id = ${Number(f.kategori)})`,
    );
  }
  return w.join(' AND ');
}

/** Total nilai retur penjualan disahkan pada rentang & filter yang sama. */
async function totalReturPenjualan(
  rentang: { dari: string; sampai: string },
  f: Record<string, number | undefined>,
  lingkup: number[] | null,
  zona: string,
): Promise<number> {
  const v = await get<{ v: number | null }>(
    `SELECT COALESCE(SUM(sr.total), 0) AS v
       FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
      WHERE ${syaratRetur(f, lingkup)}
        AND (sr.tanggal AT TIME ZONE '${zona}')::date BETWEEN ? AND ?`,
    rentang.dari,
    rentang.sampai,
  );
  return Number(v?.v ?? 0);
}

/** Hitung isi satu widget (KPI + deret/peringkat/komposisi) untuk klien. */
async function hitungWidget(
  metrik: string,
  rentang: { dari: string; sampai: string },
  f: Record<string, number | undefined>,
  jumlah: number,
  lingkup: number[] | null = null,
  zona: string = ZONA_BAWAN,
) {
  const meta = METRIK_DASHBOARD[metrik];
  const hasil: Record<string, unknown> = {
    metrik,
    label: meta.label,
    format: meta.format,
    rentang,
    nilai: await nilaiKpi(metrik, rentang, f, lingkup, zona),
  };
  const where = `${whereSales(f, 's', lingkup)} AND ${rentangSql(zona)} BETWEEN ? AND ?`;
  // Batas gudang untuk peringkat/daftar yang tidak memakai `where` penjualan.
  const batasSbW = f.gudang
    ? ` AND sb.warehouse_id = ${f.gudang}`
    : lingkup !== null
      ? lingkup.length ? ` AND sb.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})` : ' AND 1 = 0'
      : '';
  const tutupMnp = lingkup !== null && !lingkup.length && !f.gudang ? ' AND 1 = 0' : '';

  if (metrik === 'terlaris') {
    hasil.baris = await (await all(
      `SELECT si.nama_produk label, COALESCE(SUM(si.subtotal - si.diskon), 0) nilai, COALESCE(SUM(si.qty), 0) qty
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${where} GROUP BY si.product_id, si.nama_produk ORDER BY nilai DESC LIMIT ?`,
      rentang.dari, rentang.sampai, jumlah,
    )).map((r) => ({ label: r.label, nilai: Number(r.nilai), sub: `${r.qty} terjual` }));
  } else if (metrik === 'menipis') {
    const gabungSbW = f.gudang
      ? `LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ${f.gudang}`
      : `LEFT JOIN stock_balances sb ON sb.product_id = p.id${batasSbW}`;
    hasil.baris = await (await all(
      `SELECT p.nama label, COALESCE(SUM(sb.qty), 0) nilai, p.stok_min minimum
         FROM products p ${gabungSbW}
        WHERE p.aktif = TRUE AND p.deleted_at IS NULL AND p.stok_min > 0${tutupMnp}
        GROUP BY p.id HAVING COALESCE(SUM(sb.qty), 0) < p.stok_min
        ORDER BY (p.stok_min - COALESCE(SUM(sb.qty), 0)) DESC LIMIT ?`,
      jumlah,
    )).map((r) => ({ label: r.label, nilai: Number(r.nilai), sub: `min ${r.minimum}` }));
  } else if (metrik === 'piutang') {
    const bPiuW = f.gudang
      ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id = ${f.gudang})`
      : lingkup !== null
        ? lingkup.length
          ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')}))`
          : ' AND 1 = 0'
        : '';
    hasil.baris = await (await all(
      `SELECT COALESCE(c.nama, 'Tanpa nama') label, SUM(rc.total - rc.terbayar) nilai
         FROM receivables rc LEFT JOIN customers c ON c.id = rc.customer_id
        WHERE rc.status IN ('belum', 'sebagian') AND (rc.total - rc.terbayar) > 0${bPiuW}
        GROUP BY rc.customer_id, c.nama ORDER BY nilai DESC LIMIT ?`,
      jumlah,
    )).map((r) => ({ label: r.label, nilai: Number(r.nilai) }));
  } else if (metrik === 'piutang-jatuh-tempo') {
    const bJtW = f.gudang
      ? ` AND s.warehouse_id = ${f.gudang}`
      : lingkup !== null
        ? lingkup.length ? ` AND s.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})` : ' AND 1 = 0'
        : '';
    hasil.baris = await (await all(
      `SELECT (COALESCE(c.nama, 'Tanpa nama') || ' · ' || s.no_dokumen) label,
              (rc.total - rc.terbayar) nilai, rc.jatuh_tempo sub
         FROM receivables rc JOIN sales s ON s.id = rc.sale_id
         LEFT JOIN customers c ON c.id = rc.customer_id
        WHERE rc.status IN ('belum', 'sebagian') AND (rc.total - rc.terbayar) > 0${bJtW}
        ORDER BY (rc.jatuh_tempo IS NULL), rc.jatuh_tempo ASC LIMIT ?`,
      jumlah,
    )).map((r) => ({ label: r.label, nilai: Number(r.nilai), sub: r.sub ? String(r.sub).slice(0, 10) : '—' }));
  } else if (metrik === 'transaksi-terakhir') {
    const bTrW = f.gudang
      ? ` AND s.warehouse_id = ${f.gudang}`
      : lingkup !== null
        ? lingkup.length ? ` AND s.warehouse_id IN (${lingkup.map((n) => Number(n)).join(',')})` : ' AND 1 = 0'
        : '';
    hasil.baris = await (await all(
      `SELECT s.no_dokumen label, s.total nilai, (s.tanggal AT TIME ZONE '${zona}') sub
         FROM sales s WHERE s.status = 'disahkan'${bTrW} ORDER BY s.tanggal DESC LIMIT ?`,
      jumlah,
    )).map((r) => ({ label: r.label, nilai: Number(r.nilai), sub: String(r.sub ?? '').replace('T', ' ').slice(0, 16) }));
  } else if (metrik === 'metode') {
    hasil.bagian = await (await all(
      `SELECT COALESCE(sp.metode, '-') nama, COALESCE(SUM(sp.jumlah), 0) jumlah
         FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
        WHERE ${where} GROUP BY sp.metode ORDER BY jumlah DESC`,
      rentang.dari, rentang.sampai,
    )).map((r) => ({ nama: r.nama, jumlah: Number(r.jumlah) }));
  } else if (metrik === 'kas') {
    hasil.rekening = await Promise.all((await daftarAkunKas(true)).map(async (a) => ({ nama: a.nama, saldo: await saldoKas(a.id) })));
  } else if (meta.jenis.includes('grafik')) {
    hasil.seri = await seriHarian(metrik, rentang, f, lingkup, zona);
  }
  return hasil;
}

/* =============================== Router =================================== */

export function routerDashboard(): Router {
  const r = Router();

  /* ----------------------- Tampilan kartu -------------------------------- */

  // Resolusi tampilan: baris pengguna > bawaan per peran > semua tampil.
  r.get(
    '/kartu',
    asyncHandler(async (req, res) => {
      const peran = String(req.query.peran ?? 'admin');
      const userId = await idPenggunaBawaan();
      let rows = await all<{ kartu_id: string; tampil: number }>(
        `SELECT kartu_id, tampil FROM pengaturan_dashboard WHERE user_id = ?`,
        userId,
      );
      let sumber = 'pengguna';
      let urutan: string[] = [];
      if (rows.length === 0 && PERAN_DIKENAL.has(peran)) {
        rows = (await all<{ kartu_id: string; tampil: number }>(
          `SELECT kartu_id, tampil FROM pengaturan_dashboard_peran WHERE peran = ?`,
          peran,
        ));
        sumber = 'peran';
      }
      // Lapisan ketiga: Pengaturan ▸ Dashboard (berlaku per database) — hanya
      // dipakai bila tidak ada baris pengguna maupun baris peran.
      let pilihPengaturan: string[] = [];
      if (rows.length === 0) {
        let daftar: unknown = null;
        try {
          daftar = JSON.parse(await ((await getSettings()))['peng.dashboard.kartu'] || 'null');
        } catch {
          daftar = null;
        }
        if (Array.isArray(daftar)) {
          pilihPengaturan = daftar.filter((x): x is string => typeof x === 'string' && SET_KARTU.has(x));
        }
        if (pilihPengaturan.length) {
          sumber = 'pengaturan';
          urutan = pilihPengaturan;
        } else {
          sumber = 'bawaan';
        }
      }

      const hasil: Record<string, boolean> = {};
      if (pilihPengaturan.length) {
        for (const id of KARTU_DASHBOARD) hasil[id] = pilihPengaturan.includes(id);
      } else {
        for (const id of KARTU_DASHBOARD) hasil[id] = true;
        for (const row of rows) if (SET_KARTU.has(row.kartu_id)) hasil[row.kartu_id] = row.tampil === 1;
      }
      res.json({ kartu: hasil, sumber, urutan });
    }),
  );

  // Simpan tampilan pengguna (ganti seluruh baris — daftar kartu kecil).
  r.put(
    '/kartu',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kartu = kartuDariBody(body.kartu);
      const userId = await idPenggunaBawaan();
      await withTransaction(async () => {
        await run(`DELETE FROM pengaturan_dashboard WHERE user_id = ?`, userId);
        for (const [id, tampil] of Object.entries(kartu)) {
          await run(
            `INSERT INTO pengaturan_dashboard (user_id, kartu_id, tampil) VALUES (?, ?, ?)`,
            userId,
            id,
            tampil ? 1 : 0,
          );
        }
      });
      res.json({ ok: true, jumlah: Object.keys(kartu).length });
    }),
  );

  // Admin menetapkan tampilan bawaan sebuah peran.
  r.put(
    '/kartu/bawaan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const peran = String(body.peran ?? '');
      if (!PERAN_DIKENAL.has(peran)) throw tolak(400, 'Peran tidak dikenal (admin/manajer/kasir).');
      const kartu = kartuDariBody(body.kartu);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        // Bawaan lama untuk audit log (aksi 'ubah' butuh sebelum & sesudah).
        const lama: Record<string, boolean> = {};
        for (const row of await all<{ kartu_id: string; tampil: number }>(
          `SELECT kartu_id, tampil FROM pengaturan_dashboard_peran WHERE peran = ?`,
          peran,
        )) {
          lama[row.kartu_id] = row.tampil === 1;
        }
        await run(`DELETE FROM pengaturan_dashboard_peran WHERE peran = ?`, peran);
        for (const [id, tampil] of Object.entries(kartu)) {
          await run(
            `INSERT INTO pengaturan_dashboard_peran (peran, kartu_id, tampil) VALUES (?, ?, ?)`,
            peran,
            id,
            tampil ? 1 : 0,
          );
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'pengaturan_dashboard_peran',
          recordId: peran,
          sebelum: lama,
          sesudah: kartu,
        });
      });
      res.json({ ok: true, peran });
    }),
  );

  /* =============== X2 — Tata letak widget (Atur Tampilan) ================ */

  /* ------------------- Resolusi & simpan layout -------------------------- */

  // Layout pengguna > bawaan per peran > null (klien memakai preset).
  r.get(
    '/layout',
    asyncHandler(async (req, res) => {
      const peran = String(req.query.peran ?? 'admin');
      const userId = await idPenggunaBawaan();
      const milik = await get<{ json: string }>(`SELECT json FROM dashboard_layout WHERE user_id = ?`, userId);
      if (milik) {
        res.json({ sumber: 'pengguna', layout: JSON.parse(milik.json) });
        return;
      }
      if (PERAN_DIKENAL.has(peran)) {
        const bawaan = await get<{ json: string }>(`SELECT json FROM dashboard_layout_peran WHERE peran = ?`, peran);
        if (bawaan) {
          res.json({ sumber: 'peran', layout: JSON.parse(bawaan.json) });
          return;
        }
      }
      res.json({ sumber: 'bawaan', layout: null });
    }),
  );

  r.put(
    '/layout',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const widgets = validasiWidgets(body.layout);
      const userId = await idPenggunaBawaan();
      const json = JSON.stringify({ versi: 1, widgets });
      await run(
        `INSERT INTO dashboard_layout (user_id, json, diubah_pada) VALUES (?, ?, now())
         ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, diubah_pada = excluded.diubah_pada`,
        userId,
        json,
      );
      res.json({ ok: true, jumlah: widgets.length });
    }),
  );

  // Admin menetapkan layout sebagai bawaan sebuah peran (tercatat audit).
  r.put(
    '/layout/bawaan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const peran = String(body.peran ?? '');
      if (!PERAN_DIKENAL.has(peran)) throw tolak(400, 'Peran tidak dikenal (admin/manajer/kasir).');
      const widgets = validasiWidgets(body.layout);
      const json = JSON.stringify({ versi: 1, widgets });
      const pengguna = penggunaSaatIni(req);
      const lama = await get<{ json: string }>(`SELECT json FROM dashboard_layout_peran WHERE peran = ?`, peran);
      await run(
        `INSERT INTO dashboard_layout_peran (peran, json, diubah_pada) VALUES (?, ?, now())
         ON CONFLICT(peran) DO UPDATE SET json = excluded.json, diubah_pada = excluded.diubah_pada`,
        peran,
        json,
      );
      await catatAudit({
        userId: pengguna.id,
        aksi: 'ubah',
        tabel: 'dashboard_layout_peran',
        recordId: peran,
        sebelum: lama ? JSON.parse(lama.json) : null,
        sesudah: { versi: 1, widgets },
      });
      res.json({ ok: true, peran });
    }),
  );

  /* ---------------------- Data satu widget (X2.2) ------------------------ */

  r.get(
    '/widget',
    asyncHandler(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const metrik = String(q.metrik ?? 'penjualan');
      if (!METRIK_DASHBOARD[metrik]) throw tolak(400, `Metrik "${metrik}" tidak dikenal.`);
      const regW = await regional();
      const rentang = hitungRentang(q.periode, q.dari, q.sampai, regW.offsetMs);
      const f = { gudang: num(q.gudang), kasir: num(q.kasir), kategori: num(q.kategori) };
      // ISOLASI GUDANG — filter eksplisit di luar cakupan ditolak; tanpa
      // filter, widget hanya menghitung gudang yang terlihat sesi.
      if (f.gudang) await wajibGudangDiizinkan(req, f.gudang);
      const lingkup = await lingkupGudang(req);
      const jumlah = Math.min(20, Math.max(1, Number(q.jumlah) || 5));
      res.json(await hitungWidget(metrik, rentang, f, jumlah, lingkup, regW.zona));
    }),
  );

  /* ------------------- Ringkasan: KPI + grafik + tabel -------------------- */

  r.get(
    '/isi',
    asyncHandler(async (req, res) => {
      // ISOLASI GUDANG — ringkasan hanya menghitung gudang yang terlihat sesi.
      const regIsi = await regional();
      const ZT = regIsi.zona;
      const lingkupIsi = await lingkupGudang(req);
      const bS = batasLingkup(lingkupIsi, 's');
      const tutupIsi = lingkupIsi !== null && !lingkupIsi.length ? ' AND 1 = 0' : '';
      // --- KPI hari ini (WIB) ---
      const kpiHari = await get<{
        omzet: number | null;
        transaksi: number | null;
        laba: number | null;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(s.subtotal - s.diskon), 0) FROM sales s
             WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date) AS omzet,
           (SELECT COUNT(*) FROM sales s
             WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date) AS transaksi,
           (SELECT COALESCE(SUM(si.subtotal - si.diskon - si.hpp), 0)
              FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date) AS laba`,
      );
      // NET SALES — retur disahkan hari ini mengurangi omzet KPI.
      const returHari = Number(
        await ((await get<{ v: number | null }>(
          `SELECT COALESCE(SUM(sr.total), 0) AS v FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
            WHERE sr.status = 'disahkan'${bS} AND (sr.tanggal AT TIME ZONE '${ZT}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date`,
        )))?.v ?? 0,
      );
      const piutang = await get<{ v: number | null }>(
        `SELECT COALESCE(SUM(rc.total - rc.terbayar), 0) AS v FROM receivables rc
          WHERE rc.status IN ('belum', 'sebagian')${
            lingkupIsi !== null
              ? lingkupIsi.length
                ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id IN (${lingkupIsi.map((n) => Number(n)).join(',')}))`
                : ' AND 1 = 0'
              : ''
          }`,
      );
      const menipis = await get<{ n: number | null }>(
        `SELECT COUNT(*) AS n FROM (
           SELECT p.id FROM products p LEFT JOIN stock_balances sb ON sb.product_id = p.id${batasLingkup(lingkupIsi, 'sb')}
            WHERE p.aktif = TRUE AND p.deleted_at IS NULL AND p.stok_min > 0${tutupIsi}
            GROUP BY p.id HAVING COALESCE(SUM(sb.qty), 0) < p.stok_min
         )`,
      );

      // --- Tren 7 hari (omzet per hari, WIB) + vs pembelian ---
      const jual7 = await all<{ periode: string; omzet: number }>(
        `SELECT (s.tanggal AT TIME ZONE '${ZT}')::date AS periode, COALESCE(SUM(s.subtotal - s.diskon), 0) AS omzet
           FROM sales s
          WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date >= ((CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date - 6)
          GROUP BY periode ORDER BY periode`,
      );
      // Tren 7 hari memakai sumber Pembelian Bersih yang sama dengan widget.
      const hariIni7 = new Date(Date.now() + regIsi.offsetMs).toISOString().slice(0, 10);
      const dari7 = new Date(Date.now() + regIsi.offsetMs - 6 * 86400000).toISOString().slice(0, 10);
      const beli7 = await seriPembelianBersih(
        { lingkup: lingkupIsi, zona: ZT },
        dari7,
        hariIni7,
      );
      // NET SALES — kurangi retur disahkan per tanggal agar tren = Net Sales.
      const retur7 = await all<{ periode: string; nilai: number }>(
        `SELECT (sr.tanggal AT TIME ZONE '${ZT}')::date AS periode, COALESCE(SUM(sr.total), 0) AS nilai
           FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id
          WHERE sr.status = 'disahkan'${bS} AND (sr.tanggal AT TIME ZONE '${ZT}')::date >= ((CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date - 6)
          GROUP BY periode`,
      );
      const petaRetur7 = new Map(retur7.map((x) => [x.periode, Number(x.nilai)]));
      // Hari kosong diisi 0 agar grafik penuh 7 titik.
      const petaJual = new Map(jual7.map((x) => [x.periode, Number(x.omzet)]));
      const petaBeli = new Map(beli7.map((x) => [x.periode, Number(x.nilai)]));
      const tren = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400000);
        const periode = new Date(d.getTime() + regIsi.offsetMs).toISOString().slice(0, 10);
        return {
          periode,
          omzet: Math.max(0, (petaJual.get(periode) ?? 0) - (petaRetur7.get(periode) ?? 0)),
          pembelian: petaBeli.get(periode) ?? 0,
        };
      });

      // --- Metode pembayaran (30 hari) & produk terlaris (omzet, 30 hari) ---
      const metode = await all<{ metode: string; jumlah: number }>(
        `SELECT COALESCE(sp.metode, '-') AS metode, COALESCE(SUM(sp.jumlah), 0) AS jumlah
           FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
          WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date >= ((CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date - 29)
          GROUP BY COALESCE(sp.metode, '-') ORDER BY jumlah DESC`,
      );
      const terlaris = await all<{ nama: string; omzet: number }>(
        `SELECT MAX(si.nama_produk) AS nama, COALESCE(SUM(si.subtotal - si.diskon), 0) AS omzet
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.status = 'disahkan'${bS} AND (s.tanggal AT TIME ZONE '${ZT}')::date >= ((CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date - 29)
          GROUP BY si.product_id ORDER BY omzet DESC LIMIT 7`,
      );

      // --- Tabel transaksi terakhir & stok menipis ---
      const transaksi = await all<{ no_dokumen: string; waktu: string; total: number; kasir: string | null }>(
        `SELECT s.no_dokumen, (s.tanggal AT TIME ZONE '${ZT}') AS waktu, s.total, u.nama AS kasir
           FROM sales s LEFT JOIN users u ON u.id = s.kasir_id
          WHERE s.status = 'disahkan'${bS} ORDER BY s.tanggal DESC LIMIT 8`,
      );
      const stokMenipis = await all<{ nama: string; sku: string; qty: number; minimum: number }>(
        `SELECT p.nama, p.sku, COALESCE(SUM(sb.qty), 0) AS qty, p.stok_min AS minimum
           FROM products p LEFT JOIN stock_balances sb ON sb.product_id = p.id${batasLingkup(lingkupIsi, 'sb')}
          WHERE p.aktif = TRUE AND p.deleted_at IS NULL AND p.stok_min > 0${tutupIsi}
          GROUP BY p.id HAVING COALESCE(SUM(sb.qty), 0) < p.stok_min
          ORDER BY (p.stok_min - COALESCE(SUM(sb.qty), 0)) DESC LIMIT 8`,
      );

      res.json({
        kpi: {
          penjualan: Math.max(0, Number(kpiHari?.omzet ?? 0) - returHari),
          transaksi: Number(kpiHari?.transaksi ?? 0),
          laba: Number(kpiHari?.laba ?? 0),
          stok: (await totalNilaiPersediaan(lingkupIsi ?? undefined)).nilai,
          piutang: Number(piutang?.v ?? 0),
          menipis: Number(menipis?.n ?? 0),
        },
        tren,
        metode: metode.map((m) => ({ nama: m.metode, jumlah: Number(m.jumlah) })),
        terlaris: terlaris.map((t) => ({ nama: t.nama, nilai: Number(t.omzet) })),
        transaksi,
        stokMenipis,
      });
    }),
  );

  /* --------------------- Pengingat faktur belum lunas -------------------- */

  /** Baris pengingat: sisa tagihan + jatuh tempo + penanda urgensi (WIB). */
  async function daftarPengingat(tipe: 'piutang' | 'hutang', lingkup: number[] | null = null, offsetMs = 7 * 3600000) {
    const { hariSebelum, terlambatHarian } = await bacaPengingat();
    // ISOLASI GUDANG — pengingat piutang/hutang hanya dari dokumen gudang sesi.
    const daftarW = lingkup !== null
      ? lingkup.length
        ? ` IN (${lingkup.map((n) => Number(n)).join(',')})`
        : null
      : '';
    const bIngat = tipe === 'piutang'
      ? daftarW === null ? ' AND 1 = 0' : daftarW ? ` AND s.warehouse_id${daftarW}` : ''
      : daftarW === null ? ' AND 1 = 0' : daftarW ? ` AND p.warehouse_id${daftarW}` : '';
    const rows =
      tipe === 'piutang'
        ? await all<{
            id: number; jatuh_tempo: string | null; sisa: number; total: number; terbayar: number;
            no_dokumen: string; no_faktur: string | null; pihak: string | null; telepon: string | null;
          }>(
            `SELECT rc.id, rc.jatuh_tempo, (rc.total - rc.terbayar) AS sisa, rc.total, rc.terbayar,
                    s.no_dokumen,
                    (SELECT i.no_faktur FROM invoices i
                      WHERE i.sumber_tipe = 'penjualan' AND i.sumber_id = rc.sale_id
                      ORDER BY i.id LIMIT 1) AS no_faktur,
                    c.nama AS pihak, c.telepon
               FROM receivables rc
               JOIN sales s ON s.id = rc.sale_id
               LEFT JOIN customers c ON c.id = rc.customer_id
              WHERE rc.status IN ('belum', 'sebagian') AND (rc.total - rc.terbayar) > 0${tipe === 'piutang' ? bIngat : ''}
              ORDER BY (rc.jatuh_tempo IS NULL), rc.jatuh_tempo ASC, rc.id ASC`,
          )
        : await all<{
            id: number; jatuh_tempo: string | null; sisa: number; total: number; terbayar: number;
            no_dokumen: string; no_faktur: string | null; pihak: string | null; telepon: string | null;
          }>(
            `SELECT py.id, py.jatuh_tempo, (py.total - py.terbayar) AS sisa, py.total, py.terbayar,
                    p.no_dokumen,
                    (SELECT i.no_faktur FROM invoices i
                      WHERE i.sumber_tipe = 'pembelian' AND i.sumber_id = py.purchase_id
                      ORDER BY i.id LIMIT 1) AS no_faktur,
                    sp.nama AS pihak, sp.telepon
               FROM payables py
               JOIN purchases p ON p.id = py.purchase_id
               LEFT JOIN suppliers sp ON sp.id = py.supplier_id
              WHERE py.status IN ('belum', 'sebagian') AND (py.total - py.terbayar) > 0${tipe === 'hutang' ? bIngat : ''}
              ORDER BY (py.jatuh_tempo IS NULL), py.jatuh_tempo ASC, py.id ASC`,
          );

    const hari = (d: string | null): number | null => {
      if (!d) return null;
      const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(t)) return null;
      const now = Date.now() + offsetMs;
      return Math.round((t - (now - (now % 86400000))) / 86400000);
    };

    return rows.map((x) => {
      const sisaHari = hari(x.jatuh_tempo);
      const terlambat = sisaHari !== null && sisaHari < 0;
      const dekat = sisaHari !== null && !terlambat && sisaHari <= hariSebelum;
      return {
        id: Number(x.id),
        pihak: x.pihak ?? '—',
        telepon: x.telepon ?? null,
        no_faktur: x.no_faktur ?? x.no_dokumen,
        no_dokumen: x.no_dokumen,
        sisa: Number(x.sisa),
        total: Number(x.total),
        terbayar: Number(x.terbayar),
        jatuh_tempo: x.jatuh_tempo,
        urgensi: terlambat ? 'terlambat' : dekat ? 'dekat' : 'aman',
        // Perlu tindak lanjut: masih dalam N hari menjelang jatuh tempo, atau
        // terlambat bila pengingat harian aktif.
        perlu_ingat: dekat || (terlambat && terlambatHarian),
      };
    });
  }

  r.get(
    '/pengingat',
    asyncHandler(async (req, res) => {
      const regIngat = await regional();
      const lingkupIngat = await lingkupGudang(req);
      const piutang = await daftarPengingat('piutang', lingkupIngat, regIngat.offsetMs);
      const hutang = await daftarPengingat('hutang', lingkupIngat, regIngat.offsetMs);
      const terlambat =
        piutang.filter((x) => x.urgensi === 'terlambat').length +
        hutang.filter((x) => x.urgensi === 'terlambat').length;
      res.json({ piutang, hutang, terlambat, pengaturan: await bacaPengingat() });
    }),
  );

  // Lencana menu: jumlah faktur terlambat (piutang + hutang).
  r.get(
    '/badge',
    asyncHandler(async (req, res) => {
      const { terlambatHarian } = await bacaPengingat();
      if (!terlambatHarian) {
        res.json({ terlambat: 0 });
        return;
      }
      // ISOLASI GUDANG — lencana hanya menghitung tagihan gudang sesi.
      const ZT = await zonaToko();
      const lingkupBadge = await lingkupGudang(req);
      const tutupBadge = lingkupBadge !== null && !lingkupBadge.length ? ' AND 1 = 0' : '';
      const dalamBadge = lingkupBadge !== null && lingkupBadge.length
        ? ` IN (${lingkupBadge.map((n) => Number(n)).join(',')})`
        : '';
      const n =
        Number(
          await ((await get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM receivables rc
              WHERE rc.status IN ('belum', 'sebagian') AND (rc.total - rc.terbayar) > 0
                AND rc.jatuh_tempo IS NOT NULL AND date(rc.jatuh_tempo) < (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date${tutupBadge}${dalamBadge ? ` AND EXISTS (SELECT 1 FROM sales s WHERE s.id = rc.sale_id AND s.warehouse_id${dalamBadge})` : ''}`,
          )))?.n ?? 0,
        ) +
        Number(
          await ((await get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM payables py
              WHERE py.status IN ('belum', 'sebagian') AND (py.total - py.terbayar) > 0
                AND py.jatuh_tempo IS NOT NULL AND date(py.jatuh_tempo) < (CURRENT_TIMESTAMP AT TIME ZONE '${ZT}')::date${tutupBadge}${dalamBadge ? ` AND EXISTS (SELECT 1 FROM purchases p WHERE p.id = py.purchase_id AND p.warehouse_id${dalamBadge})` : ''}`,
          )))?.n ?? 0,
        );
      res.json({ terlambat: n });
    }),
  );

  // Pengaturan pengingat: 1/3/7 hari sebelum jatuh tempo + harian setelah terlambat.
  r.put(
    '/pengingat-pengaturan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const hari = Number(body.hari_sebelum);
      if (hari !== 1 && hari !== 3 && hari !== 7) {
        throw tolak(400, 'Ingatkan 1, 3, atau 7 hari sebelum jatuh tempo.');
      }
      const harian = body.terlambat_harian !== false;
      const upsert = async (kunci: string, nilai: string) =>
        await run(
          `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
           ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
          kunci,
          nilai,
        );
      await upsert('pengingat_hari_sebelum', String(hari));
      await upsert('pengingat_terlambat_harian', String(harian));
      res.json({ ok: true, pengaturan: await bacaPengingat() });
    }),
  );

  /* ------------------------ Catat pembayaran ------------------------------ */

  // Pembayaran piutang (receivables) / hutang (payables) — boleh sebagian.
  // AKUNTANSI DASAR — tanpa jurnal. Mencatat: kolom terbayar+status, tabel
  // payments, dan mutasi kas otomatis (piutang masuk kas, hutang keluar kas).
  r.post(
    '/pelunasan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tipe = String(body.tipe ?? '');
      if (tipe !== 'piutang' && tipe !== 'hutang') throw tolak(400, 'Tipe pembayaran tidak dikenal.');
      const id = Number(body.id);
      const jumlah = Number(body.jumlah);
      const metode = String(body.metode ?? 'tunai');
      // AKUNTANSI DASAR — rekening kas dari pemetaan metode bayar (Pengaturan
      // ▸ Kas & Bank), bukan Pemetaan Akun COA.
      const akunKas = await akunKasMetode(metode === 'kredit' ? 'tunai' : metode);
      if (!akunKas) throw tolak(409, `Metode bayar "${metode}" belum ditautkan ke rekening kas. Tambahkan rekening Kas & Bank, lalu tautkan metodenya di Pengaturan ▸ Kas & Bank.`);
      const akunKasId = akunKas.id;
      if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'Dokumen tagihan tidak valid.');
      if (!Number.isFinite(jumlah) || jumlah <= 0) throw tolak(400, 'Jumlah pembayaran tidak valid.');

      const tabel = tipe === 'piutang' ? 'receivables' : 'payables';
      const pengguna = penggunaSaatIni(req);

      const hasil = await withTransaction(async () => {
        const row = await get<{ id: number; total: number; terbayar: number; status: string; no_dokumen: string }>(
          `SELECT ${tabel === 'receivables' ? 'rc' : 'py'}.id,
                  ${tabel === 'receivables' ? 'rc' : 'py'}.total,
                  ${tabel === 'receivables' ? 'rc' : 'py'}.terbayar,
                  ${tabel === 'receivables' ? 'rc' : 'py'}.status,
                  ${tabel === 'receivables' ? 's' : 'p'}.no_dokumen
             FROM ${tabel} ${tabel === 'receivables' ? 'rc' : 'py'}
             JOIN ${tabel === 'receivables' ? 'sales s ON s.id = rc.sale_id' : 'purchases p ON p.id = py.purchase_id'}
            WHERE ${tabel === 'receivables' ? 'rc' : 'py'}.id = ?`,
          id,
        );
        if (!row) throw tolak(404, 'Dokumen tagihan tidak ditemukan.');
        if (row.status === 'lunas') throw tolak(409, 'Tagihan sudah lunas.');
        if (row.status === 'batal') throw tolak(409, 'Tagihan dibatalkan.');
        const sisa = Number(row.total) - Number(row.terbayar);
        if (jumlah > sisa + 0.5) throw tolak(400, `Jumlah melebihi sisa tagihan (${Math.round(sisa)}).`);

        const terbayarBaru = Number(row.terbayar) + jumlah;
        const statusBaru = terbayarBaru >= Number(row.total) - 0.5 ? 'lunas' : 'sebagian';
        await run(
          `UPDATE ${tabel} SET terbayar = ?, status = ?, diubah_pada = now()
            WHERE id = ?`,
          terbayarBaru,
          statusBaru,
          id,
        );
        const bayarId = Number(
          await ((await run(
            `INSERT INTO payments (tipe, referensi_id, tanggal, jumlah, akun_kas_id, dibuat_oleh)
             VALUES (?, ?, CURRENT_DATE, ?, ?, ?)`,
            tipe,
            id,
            jumlah,
            akunKasId,
            pengguna.id ?? await idPenggunaBawaan(),
          ))).lastInsertRowid,
        );

        const keterangan =
          tipe === 'piutang'
            ? `Pelunasan piutang ${row.no_dokumen}`
            : `Pembayaran hutang ${row.no_dokumen}`;
        // AKUNTANSI DASAR — tanpa jurnal: kas bergerak sungguhan. Piutang
        // masuk kas, hutang keluar kas, sesuai rekening metode bayar.
        await catatBayarTagihanKas({
          tipe: tipe === 'piutang' ? 'piutang' : 'hutang',
          akunKasId,
          jumlah,
          keterangan,
          sumberId: bayarId,
          dibuatOleh: pengguna.id,
        });

        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel,
          recordId: id,
          sebelum: { terbayar: Number(row.terbayar), status: row.status },
          sesudah: { terbayar: terbayarBaru, status: statusBaru },
        });

        return { id, terbayar: terbayarBaru, sisa: Math.max(0, Number(row.total) - terbayarBaru), status: statusBaru };
      });

      res.status(201).json({ ok: true, data: hasil });
    }),
  );

  return r;
}
