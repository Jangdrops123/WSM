// BAGIAN L — IMPOR OPNAME MASSAL VIA EXCEL
//
// Satu baris = satu PRODUK (unit stok). Tidak ada kolom size/warna/varian:
// produk lama ber-varian diperlakukan sebagai produk sendiri (kode_item/sku).
//
// Isi modul (ditambah bertahap):
//   bacaBerkasOpname()    — baca .xlsx / .xls / .csv menjadi baris object
//   bacaAngkaStok()       — angka Indonesia/internasional (1.250, 1,250, 1250,5)
//   validasiImporOpname() — pencocokan kode_item → sku → barcode + status baris
//   templateOpnameXlsx()  — template 3 sheet (Opname, Petunjuk, Referensi)
//   laporanErrorXlsx()    — unduh laporan error
import ExcelJS from 'exceljs';
import { all, get } from '../db.pg.ts';
import { bacaExcel } from './excel.ts';
import { angkaToleran, nomorBaris, teksBersih, teksKode } from './imporBersama.ts';

export interface BarisMentah {
  [k: string]: unknown;
}

/* ==========================================================================
   1. MEMBACA BERKAS
   ========================================================================== */

/** CSV quote-aware; deteksi pemisah ("," ";" tab) dari baris judul. */
export function bacaCsv(teks: string): { kolom: string[]; baris: BarisMentah[] } {
  const bersih = teks.replace(/^\uFEFF/, '');
  const barisPertama = bersih.split(/\r?\n/)[0] ?? '';
  const hitung = (d: string) => barisPertama.split(d).length;
  const pemisah = [';', ',', '\t'].reduce((a, b) => (hitung(b) > hitung(a) ? b : a), ',');

  const baris: string[][] = [];
  let barisKini: string[] = [];
  let sel = '';
  let dalamTanda = false;
  let i = 0;
  const akhir = bersih.length;
  while (i < akhir) {
    const ch = bersih[i];
    if (dalamTanda) {
      if (ch === '"') {
        if (bersih[i + 1] === '"') {
          sel += '"';
          i += 2;
          continue;
        }
        dalamTanda = false;
        i++;
        continue;
      }
      sel += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      dalamTanda = true;
      i++;
      continue;
    }
    if (ch === pemisah) {
      // Pemisah = akhir satu SEL, bukan akhir baris (sel dulu ke baris ini).
      barisKini.push(sel);
      sel = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      barisKini.push(sel);
      sel = '';
      baris.push(barisKini);
      barisKini = [];
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    sel += ch;
    i++;
  }
  barisKini.push(sel);
  baris.push(barisKini);
  while (baris.length && baris[baris.length - 1].every((v) => v.trim() === '')) baris.pop();

  const kolom = (baris.shift() ?? []).map((k) => k.trim());
  const hasil = baris.map((b) => {
    const o: BarisMentah = {};
    kolom.forEach((k, idx) => {
      if (k) o[k] = (b[idx] ?? '').trim() === '' ? null : (b[idx] ?? '').trim();
    });
    return o;
  });
  return { kolom, baris: hasil.filter((b) => Object.values(b).some((v) => v !== null)) };
}

/** Baca berkas impor: .csv memakai parser sendiri; lainnya (xlsx / xls modern). */
export async function bacaBerkasOpname(
  buffer: Buffer,
  namaFile: string,
): Promise<{ kolom: string[]; baris: BarisMentah[] }> {
  const nama = namaFile.toLowerCase();
  if (nama.endsWith('.csv')) {
    return bacaCsv(buffer.toString('utf-8'));
  }
  // Excel 97-2003 (BIFF/OLE2) tidak bisa dibaca exceljs — tolak dengan pesan jelas.
  if (buffer.length > 4 && buffer.subarray(0, 4).toString('hex') === 'd0cf11e0') {
    throw new Error(
      `Berkas "${namaFile}" berformat Excel 97-2003 (.xls lama). Simpan ulang sebagai .xlsx atau CSV lalu unggah lagi.`,
    );
  }
  try {
    return await bacaExcel(buffer);
  } catch (e) {
    throw new Error(
      `Berkas "${namaFile}" tidak bisa dibaca (${(e as Error).message}). Pastikan berkas .xlsx atau .csv yang valid.`,
    );
  }
}

/* ==========================================================================
   2. ANGKA — format Indonesia & internasional
   ========================================================================== */

export type HasilAngka = { status: 'kosong' | 'angka' | 'teks'; nilai: number | null };

/**
 * Terima 1.250 / 1,250 / 1250,5 / 1250.5 / "1 250" — tolak teks lain.
 * Pemisah ribuan terdeteksi otomatis; koma terakhir = desimal bila bukan ribuan.
 */
export function bacaAngkaStok(v: unknown): HasilAngka {
  if (v === null || v === undefined) return { status: 'kosong', nilai: null };
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { status: 'angka', nilai: v } : { status: 'teks', nilai: null };
  }
  const s = String(v).trim();
  if (!s) return { status: 'kosong', nilai: null };
  // Parser angka MESIN BERSAMA (imporBersama.angkaToleran): format Indonesia &
  // internasional, "Rp 1.250.000", angka Excel asli. Bukan angka → 'teks'.
  try {
    const n = angkaToleran(v, 'angka');
    return n === null ? { status: 'kosong', nilai: null } : { status: 'angka', nilai: n };
  } catch {
    return { status: 'teks', nilai: null };
  }
}

/* ==========================================================================
   3. JUDUL KOLOM — tidak peka huruf besar/kecil + variasi umum
   ========================================================================== */

const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, ' ')
    .trim();

/** alias (sudah dinormalkan) → kunci kanonik. Kolom tak dikenal diabaikan. */
const ALIAS: Record<string, string> = {
  kodeitem: 'kode_item',
  'kode item': 'kode_item',
  kode: 'kode_item',
  'kode barang': 'kode_item',
  'kode produk': 'kode_item',
  sku: 'sku',
  barcode: 'barcode',
  'bar code': 'barcode',
  'kode barcode': 'barcode',
  namaproduk: 'nama_produk',
  'nama produk': 'nama_produk',
  'nama barang': 'nama_produk',
  nama: 'nama_produk',
  satuan: 'satuan',
  unit: 'satuan',
  gudang: 'gudang',
  warehouse: 'gudang',
  lokasi: 'lokasi',
  rak: 'lokasi',
  location: 'lokasi',
  stoksistem: 'stok_sistem',
  'stok sistem': 'stok_sistem',
  'stok system': 'stok_sistem',
  'qty sistem': 'stok_sistem',
  'stok awal': 'stok_sistem',
  stokfisik: 'stok_fisik',
  'stok fisik': 'stok_fisik',
  'qty fisik': 'stok_fisik',
  'jumlah fisik': 'stok_fisik',
  fisik: 'stok_fisik',
  jumlah: 'stok_fisik',
  selisih: 'selisih',
  keterangan: 'keterangan',
  catatan: 'keterangan',
  note: 'keterangan',
  notes: 'keterangan',
};

export interface PetaKolom {
  /** kunci kanonik → indeks kolom pada file */
  indeks: Record<string, number>;
  takDikenal: string[];
}

export function petaKolomOpname(kolom: string[]): PetaKolom {
  const indeks: Record<string, number> = {};
  const takDikenal: string[] = [];
  kolom.forEach((h, i) => {
    const kunci = ALIAS[norm(h)];
    if (kunci) {
      if (indeks[kunci] === undefined) indeks[kunci] = i;
    } else if (String(h).trim()) {
      takDikenal.push(String(h).trim());
    }
  });
  return { indeks, takDikenal };
}

/* ==========================================================================
   4. VALIDASI & PENCOCOKAN
   ========================================================================== */

export type StatusBaris = 'valid' | 'peringatan' | 'error';

export interface BarisPratinjau {
  nomor: number;
  kode_input: string;
  product_id: number | null;
  kode_item: string | null;
  nama_produk: string;
  sku: string;
  lokasi: string;
  lokasi_id: number | null;
  qty_sistem: number;
  qty_sistem_file: number | null;
  qty_fisik: number | null;
  selisih: number | null;
  nilai_selisih: number;
  /** Harga beli produk — agar klien bisa menghitung ulang nilai selisih saat pratinjau diedit. */
  harga_beli: number;
  status: StatusBaris;
  pesan: string[];
  keterangan: string;
}

export interface RingkasanImporOpname {
  total: number;
  valid: number;
  peringatan: number;
  error: number;
  selisih_lebih: number;
  selisih_kurang: number;
  nilai_selisih: number;
  /** Produk sesi/sistem yang tidak muncul di file (pilihan: abaikan / anggap 0). */
  produk_tidak_ada: number;
  duplikat: number;
}

export interface HasilValidasiOpname {
  ringkasan: RingkasanImporOpname;
  kolom_tak_dikenal: string[];
  baris: BarisPratinjau[];
}

export interface KonteksImporOpname {
  warehouseId: number;
  locationId: number | null;
  sesiId?: number | null;
  batasPersen: number;
  /** stok sistem terbaru (snapshot sesi bila ada, else saldo gudang). */
  stokSistem: Map<number, number>;
  /** product_id baris sesi — untuk deteksi “produk tidak ada di file”. */
  productSesi: Set<number>;
}

interface ProdukIdx {
  id: number;
  kode_item: string;
  sku: string;
  barcode: string;
  nama: string;
  aktif: number;
  harga_beli: number;
}

/** Indeks pencocokan: kode_item → sku → barcode (huruf sama, spasi ujung dipangkas). */
export async function indeksProdukOpname(): Promise<{
  byKode: Map<string, ProdukIdx>;
  bySku: Map<string, ProdukIdx>;
  byBarcode: Map<string, ProdukIdx>;
}> {
  const rows = await all<ProdukIdx>(
    `SELECT id, COALESCE(kode_item, '') AS kode_item, sku, COALESCE(barcode, '') AS barcode,
            nama, aktif, harga_beli
       FROM products WHERE deleted_at IS NULL`,
  );
  const byKode = new Map<string, ProdukIdx>();
  const bySku = new Map<string, ProdukIdx>();
  const byBarcode = new Map<string, ProdukIdx>();
  for (const p of rows) {
    if (p.kode_item) byKode.set(teksKode(p.kode_item).toLowerCase(), p);
    if (p.sku) bySku.set(teksKode(p.sku).toLowerCase(), p);
    if (p.barcode) byBarcode.set(teksKode(p.barcode).toLowerCase(), p);
  }
  return { byKode, bySku, byBarcode };
}

/** Validasi seluruh baris file terhadap master & sesi (tanpa menulis apa pun). */
export async function validasiImporOpname(
  kolom: string[],
  data: BarisMentah[],
  ctx: KonteksImporOpname,
): Promise<HasilValidasiOpname> {
  const peta = petaKolomOpname(kolom);
  const idx = peta.indeks;
  const { byKode, bySku, byBarcode } = await indeksProdukOpname();

  const gudangById = new Map<number, string>();
  for (const w of await all<{ id: number; kode: string; nama: string }>(`SELECT id, kode, nama FROM warehouses`)) {
    gudangById.set(w.id, w.kode);
  }
  const gudangDariTeks = new Map<string, number>();
  for (const w of gudangById) gudangDariTeks.set(String(w[1]).toLowerCase(), w[0]);
  for (const w of await all<{ id: number; nama: string }>(`SELECT id, nama FROM warehouses`)) {
    gudangDariTeks.set(w.nama.toLowerCase(), w.id);
  }
  const lokasiDariTeks = new Map<string, number>();
  const lokasiById = new Map<number, string>();
  for (const l of await all<{ id: number; kode_lokasi: string }>(
    `SELECT id, kode_lokasi FROM locations WHERE warehouse_id = ?`,
    ctx.warehouseId,
  )) {
    lokasiDariTeks.set(l.kode_lokasi.toLowerCase(), l.id);
    lokasiById.set(l.id, l.kode_lokasi);
  }

  const ambil = (r: BarisMentah, kunci: string): unknown => {
    const i = idx[kunci];
    if (i === undefined) return null;
    const v = r[kolom[i]];
    return v === undefined ? null : v;
  };
  const teks = (v: unknown): string => teksBersih(v);

  const baris: BarisPratinjau[] = [];
  const produkDipakai = new Set<number>();
  const kembar = new Map<string, number>();

  data.forEach((r, i) => {
    const nomor = nomorBaris(i); // baris 1 = judul (AB2h — konsisten antarmodul)
    const pesan: string[] = [];
    let status: StatusBaris = 'valid';
    const tandai = (s: StatusBaris) => {
      if (s === 'error') status = 'error';
      else if (status !== 'error' && s === 'peringatan') status = 'peringatan';
    };

    const kKode = teks(ambil(r, 'kode_item'));
    const kSku = teks(ambil(r, 'sku'));
    const kBarcode = teks(ambil(r, 'barcode'));
    const namaFile = teks(ambil(r, 'nama_produk'));
    const gudangTeks = teks(ambil(r, 'gudang'));
    const lokasiTeks = teks(ambil(r, 'lokasi'));
    const ket = teks(ambil(r, 'keterangan'));

    // --- pencocokan: kode_item → sku → barcode (nama_produk hanya informasi) ---
    let p: ProdukIdx | undefined;
    if (kKode) p = byKode.get(kKode.toLowerCase());
    if (!p && kSku) p = bySku.get(kSku.toLowerCase());
    if (!p && kBarcode) p = byBarcode.get(kBarcode.toLowerCase());
    if (!p) {
      pesan.push(
        `Produk tidak ditemukan (kode_item/sku/barcode "${kKode || kSku || kBarcode || '?'}").`,
      );
      tandai('error');
    } else if (!Number(p.aktif)) {
      pesan.push(`Produk "${p.nama}" nonaktif — tidak diizinkan diimpor.`);
      tandai('error');
    }
    if (p) produkDipakai.add(p.id);

    // --- gudang & lokasi vs master ---
    let lokasiId: number | null = ctx.locationId;
    if (gudangTeks) {
      const gid = gudangDariTeks.get(gudangTeks.toLowerCase());
      if (gid === undefined) {
        pesan.push(`Gudang "${gudangTeks}" tidak valid (tidak ada di master).`);
        tandai('error');
      } else if (gid !== ctx.warehouseId) {
        pesan.push(`Gudang "${gudangTeks}" berbeda dari gudang sesi/pilihan.`);
        tandai('error');
      }
    }
    if (lokasiTeks) {
      const lid = lokasiDariTeks.get(lokasiTeks.toLowerCase());
      if (lid === undefined) {
        pesan.push(`Lokasi "${lokasiTeks}" tidak valid untuk gudang ini.`);
        tandai('error');
      } else {
        lokasiId = lid;
      }
    }

    // --- stok fisik ---
    const angkaFisik = bacaAngkaStok(ambil(r, 'stok_fisik'));
    let qtyFisik: number | null = null;
    if (angkaFisik.status === 'kosong') {
      pesan.push('stok_fisik kosong — wajib diisi (boleh 0).');
      tandai('error');
    } else if (angkaFisik.status === 'teks') {
      pesan.push(`stok_fisik bukan angka ("${teks(ambil(r, 'stok_fisik'))}").`);
      tandai('error');
    } else if ((angkaFisik.nilai ?? -1) < 0) {
      pesan.push('stok_fisik negatif — tidak diizinkan.');
      tandai('error');
    } else {
      qtyFisik = angkaFisik.nilai;
    }

    // --- stok sistem terbaru (file DIABAIKAN) + deteksi berubah sejak unduh ---
    const qtySistem = p ? ctx.stokSistem.get(p.id) ?? 0 : 0;
    const angkaSistemFile = bacaAngkaStok(ambil(r, 'stok_sistem'));
    const qtySistemFile = angkaSistemFile.status === 'angka' ? angkaSistemFile.nilai : null;
    if (p && qtySistemFile !== null && qtySistemFile !== qtySistem) {
      pesan.push(`Stok sistem berubah sejak template diunduh (file ${qtySistemFile} → sistem ${qtySistem}).`);
      tandai('peringatan');
    }

    // --- selisih + peringatan besar ---
    let selisih: number | null = null;
    if (p && qtyFisik !== null) {
      selisih = qtyFisik - qtySistem;
      if (qtySistem > 0) {
        const pct = (Math.abs(selisih) / qtySistem) * 100;
        if (pct > ctx.batasPersen) {
          pesan.push(
            `Selisih ${pct.toFixed(1)}% melebihi batas ${ctx.batasPersen}% (Pengaturan ▸ Opname).`,
          );
          tandai('peringatan');
        }
      } else if (qtySistem === 0 && qtyFisik > 0) {
        pesan.push('Stok sistem 0 tetapi stok fisik terisi — periksa kembali.');
        tandai('peringatan');
      }
    }

    const nilai = p && selisih !== null ? Math.abs(selisih) * p.harga_beli : 0;
    baris.push({
      nomor,
      kode_input: kKode || kSku || kBarcode,
      product_id: p?.id ?? null,
      kode_item: p?.kode_item ?? kKode ?? null,
      nama_produk: p?.nama ?? namaFile,
      sku: p?.sku ?? kSku,
      lokasi: lokasiTeks || (lokasiId !== null ? (lokasiById.get(lokasiId) ?? '') : ''),
      lokasi_id: lokasiId,
      qty_sistem: qtySistem,
      qty_sistem_file: qtySistemFile,
      qty_fisik: qtyFisik,
      selisih,
      nilai_selisih: nilai,
      harga_beli: p?.harga_beli ?? 0,
      status,
      pesan,
      keterangan: ket,
    });
    const key = `${p?.id ?? 'x'}|${lokasiId ?? ''}`;
    kembar.set(key, (kembar.get(key) ?? 0) + 1);
  });

  // --- duplikat (produk + lokasi sama muncul dua kali) ---
  let duplikat = 0;
  for (const b of baris) {
    if (b.product_id === null) continue;
    const key = `${b.product_id}|${b.lokasi_id ?? ''}`;
    if ((kembar.get(key) ?? 0) > 1) {
      duplikat++;
      b.pesan.push('Baris duplikat (produk & lokasi sama) — pilih “jumlahkan” atau “pakai baris terakhir”.');
      if (b.status === 'valid') b.status = 'peringatan';
    }
  }

  // --- produk ada di sistem, tidak ada di file ---
  let produkTidakAda = 0;
  for (const id of ctx.productSesi) if (!produkDipakai.has(id)) produkTidakAda++;

  const ringkasan: RingkasanImporOpname = {
    total: baris.length,
    valid: baris.filter((b) => b.status === 'valid').length,
    peringatan: baris.filter((b) => b.status === 'peringatan').length,
    error: baris.filter((b) => b.status === 'error').length,
    selisih_lebih: baris.reduce((a, b) => a + (b.selisih !== null && b.selisih > 0 ? b.selisih : 0), 0),
    selisih_kurang: baris.reduce((a, b) => a + (b.selisih !== null && b.selisih < 0 ? b.selisih : 0), 0),
    nilai_selisih: Math.round(baris.reduce((a, b) => a + b.nilai_selisih, 0)),
    produk_tidak_ada: produkTidakAda,
    duplikat,
  };
  return { ringkasan, kolom_tak_dikenal: peta.takDikenal, baris };
}

/** Stok sistem per produk: snapshot sesi bila ada, else saldo gudang sekarang. */
export async function stokSistemCtx(warehouseId: number, sesiId?: number | null): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (sesiId) {
    for (const r of await all<{ product_id: number; qty_sistem: number }>(
      `SELECT product_id, qty_sistem FROM opname_items WHERE session_id = ?`,
      sesiId,
    )) {
      m.set(r.product_id, Number(r.qty_sistem));
    }
  }
  for (const r of await all<{ product_id: number; qty: number }>(
    `SELECT product_id, qty FROM stock_balances WHERE warehouse_id = ?`,
    warehouseId,
  )) {
    if (!m.has(r.product_id)) m.set(r.product_id, Number(r.qty));
  }
  return m;
}

/** product_id baris sesi (deteksi produk tidak ada di file). */
export async function productSesiCtx(sesiId?: number | null): Promise<Set<number>> {
  const s = new Set<number>();
  if (!sesiId) return s;
  for (const r of await all<{ product_id: number }>(
    `SELECT product_id FROM opname_items WHERE session_id = ?`,
    sesiId,
  )) {
    s.add(r.product_id);
  }
  return s;
}

/** Batas persentase selisih dari Pengaturan (Opname ▸ batas_selisih_persen). */
export function batasSelisihPersen(settings: Record<string, string>): number {
  const n = Number(settings['batas_selisih_persen'] ?? 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/* ==========================================================================
   5. TEMPLATE EXCEL — 3 sheet (Opname, Petunjuk, Referensi)
   ========================================================================== */

export interface OpsiTemplate {
  isi: 'stok' | 'kosong';
  warehouseId?: number | null;
  locationId?: number | null;
  categoryId?: number | null;
  brandId?: number | null;
  aktif?: boolean;
}

const KOLOM_TEMPLATE = [
  { key: 'kode_item', lebar: 14 },
  { key: 'sku', lebar: 16 },
  { key: 'barcode', lebar: 16 },
  { key: 'nama_produk', lebar: 34 },
  { key: 'satuan', lebar: 10 },
  { key: 'gudang', lebar: 10 },
  { key: 'lokasi', lebar: 12 },
  { key: 'stok_sistem', lebar: 13 },
  { key: 'stok_fisik', lebar: 13 },
  { key: 'selisih', lebar: 11 },
  { key: 'keterangan', lebar: 28 },
] as const;

/** Isi sheet Opname: daftar produk sesuai filter, urut lokasi lalu kode_item. */
async function barisTemplate(ctx: OpsiTemplate): Promise<Record<string, unknown>[]> {
  if (ctx.isi === 'kosong') {
    return [
      { kode_item: 'BRG-0001', sku: 'SKU-0001', barcode: '8991234567890', nama_produk: 'Contoh Produk A', satuan: 'pcs', gudang: 'GUD-01', lokasi: 'A-01', stok_sistem: 12, stok_fisik: null, selisih: null, keterangan: '' },
      { kode_item: 'BRG-0002', sku: 'SKU-0002', barcode: '8991234567891', nama_produk: 'Contoh Produk B', satuan: 'pcs', gudang: 'GUD-01', lokasi: 'A-02', stok_sistem: 8, stok_fisik: null, selisih: null, keterangan: '' },
      { kode_item: 'BRG-0003', sku: 'SKU-0003', barcode: '8991234567892', nama_produk: 'Contoh Produk C', satuan: 'pcs', gudang: 'GUD-01', lokasi: 'B-01', stok_sistem: 5, stok_fisik: null, selisih: null, keterangan: '' },
    ];
  }

  const w = ctx.warehouseId
    ? await get<{ id: number; kode: string }>(`SELECT id, kode FROM warehouses WHERE id = ?`, ctx.warehouseId)
    : undefined;
  const lokasiKode = ctx.locationId
    ? await ((await get<{ kode_lokasi: string }>(`SELECT kode_lokasi FROM locations WHERE id = ?`, ctx.locationId)))?.kode_lokasi ?? ''
    : '';

  const syarat: string[] = ['sb.warehouse_id = ?', 'p.deleted_at IS NULL'];
  const arg: unknown[] = [ctx.warehouseId ?? 0];
  if (ctx.categoryId) {
    syarat.push('p.category_id = ?');
    arg.push(ctx.categoryId);
  }
  if (ctx.brandId) {
    syarat.push('p.brand_id = ?');
    arg.push(ctx.brandId);
  }
  if (ctx.aktif !== false) syarat.push('p.aktif = TRUE');

  const rows = await all<{
    kode_item: string | null;
    sku: string;
    barcode: string | null;
    nama: string;
    satuan: string | null;
    qty: number;
  }>(
    `SELECT p.kode_item, p.sku, p.barcode, p.nama, u.nama AS satuan, sb.qty
       FROM stock_balances sb
       JOIN products p ON p.id = sb.product_id
       LEFT JOIN units u ON u.id = p.satuan_dasar_id
      WHERE ${syarat.join(' AND ')}
      ORDER BY COALESCE(NULLIF(p.kode_item, ''), p.sku) ASC`,
    ...arg,
  );

  return rows.map((r) => ({
    kode_item: r.kode_item ?? '',
    sku: r.sku,
    barcode: r.barcode ?? '',
    nama_produk: r.nama,
    satuan: r.satuan ?? '',
    gudang: w?.kode ?? '',
    lokasi: lokasiKode,
    stok_sistem: Number(r.qty),
    stok_fisik: null,
    selisih: null,
    keterangan: '',
  }));
}

/** Sheet Petunjuk: penjelasan tiap kolom (wajib/opsional, format, contoh). */
const PETUNJUK: [string, string, string, string][] = [
  ['kode_item', 'Wajib SALAH SATU dari kode_item / sku / barcode', 'Teks', 'BRG-0001 — kunci pencocokan UTAMA'],
  ['sku', 'Opsional (pembanding)', 'Teks', 'SKU-0001 — dipakai bila kode_item kosong/tak cocok'],
  ['barcode', 'Opsional (pembanding)', 'Teks', '8991234567890 — dipakai bila kode_item & sku tak cocok'],
  ['nama_produk', 'Informasi saja', 'Teks', 'TIDAK dipakai mencocokkan'],
  ['satuan', 'Informasi saja', 'Teks', 'pcs / box / lusin'],
  ['gudang', 'Wajib bila file memuat >1 gudang', 'Teks', 'Harus cocok dengan master Gudang & Lokasi'],
  ['lokasi', 'Opsional', 'Teks', 'A-01 — harus cocok dengan master; kosong = lokasi sesi'],
  ['stok_sistem', 'Terisi otomatis — TERKUNCI', 'Angka', 'Hanya baca; sistem memakai stok terbaru saat impor'],
  ['stok_fisik', 'WAJIB diisi pengguna', 'Angka ≥ 0', 'Boleh 0; format 1.250 / 1,250 / 1250,5'],
  ['selisih', 'Rumus — TERKUNCI', 'Angka', '=stok_fisik − stok_sistem (otomatis)'],
  ['keterangan', 'Opsional', 'Teks', 'Catatan per baris'],
];

const ATURAN = [
  'ATURAN PENCOCOKAN & VALIDASI',
  '1. Satu baris = satu produk (unit stok). Tidak ada kolom size, warna, atau varian.',
  '2. Produk lama ber-varian diperlakukan sebagai produk sendiri (kode_item & sku masing-masing).',
  '3. Kunci pencocokan: kode_item (utama) → sku → barcode. Huruf sama, spasi ujung dipangkas.',
  '4. nama_produk HANYA informasi — tidak dipakai mencocokkan.',
  '5. Gudang & lokasi dicocokkan dengan master Gudang & Lokasi.',
  '6. Nilai stok_sistem di file DIABAIKAN — sistem membaca stok sistem terbaru saat impor.',
  '7. Status baris: Valid (hijau) · Peringatan (kuning) · Error (merah).',
  '   Error: produk tak ditemukan, gudang/lokasi tak valid, stok_fisik kosong/bukan angka/negatif, produk nonaktif.',
  '   Peringatan: selisih besar (batas % di Pengaturan ▸ Opname), baris duplikat, stok sistem berubah sejak template diunduh.',
  '8. Baris diurutkan lokasi lalu kode_item agar mudah dihitung di gudang.',
];

/** Bangun buffer .xlsx template opname (L2). */
export async function templateOpnameXlsx(ctx: OpsiTemplate): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  /* ---- Sheet "Opname" ---- */
  const ws = wb.addWorksheet('Opname');
  ws.columns = KOLOM_TEMPLATE.map((k) => ({ key: k.key, width: k.lebar }));
  const kepala = KOLOM_TEMPLATE.map((k) => k.key);
  ws.addRow(kepala);
  for (const r of await barisTemplate(ctx)) ws.addRow(r);
  const akhirBaris = ws.rowCount;
  // Rumus selisih (kolom J): stok_fisik − stok_sistem, hidup saat diedit.
  for (let nomor = 2; nomor <= akhirBaris; nomor++) {
    ws.getCell(`J${nomor}`).value = { formula: `IF(I${nomor}=\"\",\"\",I${nomor}-H${nomor})` };
  }

  const isiKuning = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } } as const;
  const kunciAbu = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } } as const;
  const kunciBiru = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } } as const;
  for (let c = 1; c <= kepala.length; c++) {
    const sel = ws.getCell(1, c);
    sel.font = { bold: true };
    const nama = kepala[c - 1];
    if (nama === 'stok_sistem' || nama === 'selisih') sel.fill = kunciAbu;
    else if (nama === 'stok_fisik') sel.fill = isiKuning;
    else if (nama === 'kode_item' || nama === 'sku' || nama === 'barcode') sel.fill = kunciBiru;
  }

  // Kunci sel: stok_sistem (H) & selisih (J) terkunci; stok_fisik (I) & keterangan (K) bebas.
  for (let r = 2; r <= akhirBaris; r++) {
    for (let c = 1; c <= kepala.length; c++) {
      const nama = kepala[c - 1];
      ws.getCell(r, c).protection = { locked: nama !== 'stok_fisik' && nama !== 'keterangan' };
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kepala.length } };

  /* ---- Sheet "Petunjuk" ---- */
  const wp = wb.addWorksheet('Petunjuk');
  wp.columns = [
    { header: 'Kolom', width: 16 },
    { header: 'Wajib / Opsional', width: 46 },
    { header: 'Format', width: 18 },
    { header: 'Contoh & keterangan', width: 70 },
  ];
  for (const b of PETUNJUK) wp.addRow(b);
  let barisKini = wp.rowCount + 2;
  for (const t of ATURAN) {
    const sel = wp.getCell(barisKini, 1);
    sel.value = t;
    if (t === ATURAN[0]) sel.font = { bold: true };
    wp.mergeCells(barisKini, 1, barisKini, 4);
    barisKini++;
  }
  wp.getRow(1).font = { bold: true };
  wp.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

  /* ---- Sheet "Referensi" (sumber dropdown validasi data) ---- */
  const wr = wb.addWorksheet('Referensi');
  const gudangSemua = await all<{ kode: string }>(`SELECT kode FROM warehouses ORDER BY kode`);
  const lokasiSemua = ctx.warehouseId
    ? await all<{ kode_lokasi: string }>(`SELECT kode_lokasi FROM locations WHERE warehouse_id = ? ORDER BY kode_lokasi`, ctx.warehouseId)
    : await all<{ kode_lokasi: string }>(`SELECT kode_lokasi FROM locations ORDER BY kode_lokasi`);
  const satuanSemua = await all<{ nama: string }>(`SELECT nama FROM units ORDER BY nama`);
  wr.columns = [
    { header: 'Gudang', width: 24 },
    { header: 'Lokasi', width: 16 },
    { header: 'Satuan', width: 14 },
  ];
  const maks = Math.max(gudangSemua.length, lokasiSemua.length, satuanSemua.length);
  for (let i = 0; i < maks; i++) {
    wr.addRow([gudangSemua[i]?.kode ?? null, lokasiSemua[i]?.kode_lokasi ?? null, satuanSemua[i]?.nama ?? null]);
  }
  wr.getRow(1).font = { bold: true };
  wr.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

  // Dropdown validasi data: gudang (F) & lokasi (G) menunjuk sheet Referensi.
  const batasGudang = Math.max(2, gudangSemua.length + 1);
  const batasLokasi = Math.max(2, lokasiSemua.length + 1);
  for (let r = 2; r <= akhirBaris; r++) {
    ws.getCell(`F${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=Referensi!$A$2:$A$${batasGudang}`],
    };
    ws.getCell(`G${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=Referensi!$B$2:$B$${batasLokasi}`],
    };
  }

  // Kunci sheet: hanya stok_fisik & keterangan yang boleh diedit.
  await ws.protect('', {
    selectLockedCells: false,
    selectUnlockedCells: false,
    autoFilter: false,
    sort: false,
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/* ==========================================================================
   6. LAPORAN ERROR
   ========================================================================== */

/** Laporan error (Excel): baris bermasalah + alasannya (L4). */
export async function laporanErrorXlsx(baris: BarisPratinjau[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Laporan Error');
  ws.columns = [
    { header: 'Baris File', key: 'nomor', width: 10 },
    { header: 'Kode / SKU / Barcode', key: 'kode', width: 22 },
    { header: 'Nama Produk', key: 'nama', width: 34 },
    { header: 'Lokasi', key: 'lokasi', width: 12 },
    { header: 'Stok Sistem', key: 'sistem', width: 13 },
    { header: 'Stok Fisik', key: 'fisik', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Alasan', key: 'pesan', width: 80 },
  ];
  for (const b of baris) {
    ws.addRow({
      nomor: b.nomor,
      kode: b.kode_input,
      nama: b.nama_produk,
      lokasi: b.lokasi,
      sistem: b.qty_sistem,
      fisik: b.qty_fisik,
      status: b.status,
      pesan: b.pesan.join(' '),
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
