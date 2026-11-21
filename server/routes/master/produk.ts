import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import { ROOT_DIR, all, get, run, withTransaction } from '../../db.pg.ts';
import { asyncHandler, bacaPaginasi, pesanKesalahan, polaCari, tolak } from '../../lib/http.ts';
import { catatAudit } from '../../lib/audit.ts';
import { adalahAdmin, penggunaSaatIni } from '../../lib/akses.ts';
import { bacaExcel, tulisExcel, tulisExcelMulti, type KolomExcel, type SheetExcel } from '../../lib/excel.ts';
import {
  GalatImpor,
  PemantauUnik,
  PengumpulImpor,
  angkaToleran,
  bacaOpsiImpor as bacaOpsiImporBersama,
  cetakDebugImpor,
  jejakUrungAman,
  nomorBaris,
  pemetaanOtomatis,
  simpanErrorBatch,
  statusToleran,
  teksBersih,
  teksKode,
  terapkanPemetaan,
  urungkanJejak,
  type JejakUrung,
  type OpsiImporBersama,
} from '../../lib/imporBersama.ts';

import { urungkanBatch } from '../imporUrungkan.ts';
import { hapusProdukPermanen } from '../../lib/pembersihanTransaksi.ts';
import { idGudangDiizinkan } from '../../lib/aksesGudang.ts';
import { syaratGudangSesi, wajibGudangDiizinkan } from '../../lib/hak.ts';
import { ubahStok } from '../../lib/stok.ts';

/**
 * Gudang yang boleh dilihat sesi ini (AS — cakupan = kode gudang).
 * null = semua gudang (Admin / tanpa pembatasan); Set kosong = tanpa akses.
 * Id dikembalikan sebagai angka DB (aman disisipkan literal ke SQL).
 */
async function gudangTerlihat(req: Request): Promise<Set<number> | null> {
  const cakupan = req.konteks?.cakupanToko ?? null;
  if (req.konteks?.admin) return null;
  return await idGudangDiizinkan(cakupan ?? null);
}

/** Fragmen SQL pembatas stock_balances ke gudang yang terlihat sesi. */
function batasGudangSql(terlihat: Set<number> | null, alias = 'sb'): string {
  if (terlihat === null) return '';
  if (terlihat.size === 0) return ' AND 1 = 0';
  return ` AND ${alias}.warehouse_id IN (${[...terlihat].map((n) => Number(n)).join(',')})`;
}

// --- Tipe ------------------------------------------------------------------
interface KonversiMasuk {
  unit_id: number;
  jumlah_per_satuan_dasar: number;
}

interface ProdukMasuk {
  /** null = buat otomatis (produk baru) / pertahankan yang lama (ubah). */
  kode_item: string | null;
  nama: string;
  /** SKU unik — wajib, identitas stok produk (tanpa varian). */
  sku: string;
  barcode: string | null;
  /** Deskripsi panjang untuk pop up detail (opsional). */
  deskripsi: string | null;
  category_id: number | null;
  brand_id: number | null;
  satuan_dasar_id: number | null;
  /** Profil size (X5.2) — null = resolusi otomatis (kategori/merek → keyword → default). */
  size_profile_id: number | null;
  harga_beli: number;
  harga_jual: number;
  stok_min: number;
  aktif: number;
  konversi: KonversiMasuk[];
  /** Gudang tujuan stok awal (tambah manual) — null = tanpa alokasi gudang. */
  gudang_id: number | null;
  /** Stok awal saat tambah manual — hanya ditulis bila produk baru (saldo 0). */
  stok_awal: number;
}

/**
 * Rujukan yang menandai produk masih punya transaksi AKTIF.
 * Baris transaksi yang sudah dibatalkan/di-reset tidak lagi mengunci produk,
 * begitu juga kartu stok/saldo 0 (riwayat lama tidak dihitung).
 */
const RUJUKAN_AKTIF = [
  { tabel: 'sale_items', kolom: 'sale_id', induk: 'sales', label: 'penjualan', saring: "x.status <> 'batal'" },
  { tabel: 'sale_return_items', kolom: 'return_id', induk: 'sale_returns', label: 'retur penjualan', saring: "x.status <> 'batal'" },
  { tabel: 'purchase_items', kolom: 'purchase_id', induk: 'purchases', label: 'pembelian', saring: "x.status <> 'batal'" },
  { tabel: 'stock_transfer_items', kolom: 'transfer_id', induk: 'stock_transfers', label: 'transfer stok', saring: "x.status <> 'batal'" },
  { tabel: 'opname_items', kolom: 'session_id', induk: 'opname_sessions', label: 'opname', saring: "x.status <> 'batal'" },
] as const;

// --- Kolom impor / ekspor / template (SATU sumber kebenaran) -----------------
// Template, ekspor, dan pemetaan impor semuanya lahir dari daftar ini sehingga
// kolom baru otomatis ikut muncul di ketiga tempat. Satu baris = satu produk.
export const KOLOM_IMPOR = [
  { key: 'kode_item', wajib: true, format: 'Teks unik (BRG-0001)', ket: 'Kode unik produk. Wajib. Impor bersifat UPSERT per kode_item.' },
  { key: 'nama_produk', wajib: true, format: 'Teks', ket: 'Nama produk. Wajib.' },
  { key: 'sku', wajib: true, format: 'Teks unik', ket: 'SKU produk — unik di seluruh katalog (tanpa varian).' },
  { key: 'kategori', wajib: false, format: 'Teks', ket: 'Nama kategori — bila belum ada, dibuat otomatis saat konfirmasi impor.' },
  { key: 'merek', wajib: false, format: 'Teks', ket: 'Nama merek — bila belum ada, dibuat otomatis saat konfirmasi impor.' },
  { key: 'satuan', wajib: false, format: 'Teks (kode/nama satuan)', ket: 'Satuan dasar produk — harus sudah ada di menu Satuan.' },
  { key: 'profil_size', wajib: false, format: 'Teks (nama profil)', ket: 'Nama profil size (mis. Sepatu Pria) — harus sudah ada di Pengaturan ▸ Aturan Kodi. Kosong = ikut profil kategori/merek produk.' },
  { key: 'barcode', wajib: false, format: 'Teks unik', ket: 'Barcode produk; kosongkan bila tidak ada. Tidak boleh sama dengan barcode lain/paket.' },
  { key: 'harga_beli', wajib: false, format: 'Angka ≥ 0', ket: 'Kosong = tidak diubah (produk baru: 0).' },
  { key: 'harga_jual', wajib: false, format: 'Angka ≥ 0', ket: 'Harga jual produk. Kosong = tidak diubah (produk baru: 0).' },
  // Stok minimum produk — tampil sebagai kolom MINIMUM di Stok Persediaan.
  // Kosong = 0 (tidak menggagalkan impor); dipakai peringatan "menipis".
  { key: 'stok_min', wajib: false, format: 'Angka ≥ 0 (contoh: 5)', ket: 'Batas stok minimum (batas peringatan stok menipis). Kosong = 0. Dibaca juga dari judul "Stok Minimum", "Minimum", "min_stock".' },
  { key: 'status', wajib: false, format: 'Aktif / Nonaktif', ket: 'Status produk. Kosong = Aktif (produk baru) / tidak diubah.' },
  { key: 'nama_file_foto', wajib: false, format: 'Teks', ket: 'Nama file hasil Unggah Foto Massal (BRG-0001.jpg) atau URL https://…. Bila file belum ada di storage, foto dibiarkan.' },
  { key: 'gudang', wajib: false, format: 'Teks (kode/nama gudang)', ket: 'Gudang penempatan stok awal — harus sudah ada di Master › Gudang (tidak dibuat otomatis). Kosong = tanpa penempatan gudang.', hanyaImpor: true },
  { key: 'stok_awal', wajib: false, format: 'Angka ≥ 0', ket: 'Stok awal di gudang tersebut — wajib isi gudang bila > 0. Hanya diterapkan bila produk BELUM punya saldo di gudang itu (impor ulang tidak menumpuk). Harga memakai harga_beli baris ini.', hanyaImpor: true },
] as const;

/** Header Excel = KOLOM_IMPOR + stok — IDENTIK dengan ekspor (round-trip). Kolom stok pada impor diabaikan. */
const kolomExcelImpor = () => [...KOLOM_IMPOR.map((k) => ({ key: k.key, label: k.key })), { key: 'stok', label: 'stok' }];

// --- Kode item ---------------------------------------------------------------

async function cekKodeItem(kode: string, kecualiProdukId?: number): Promise<void> {
  const baris = kecualiProdukId
    ? await get<{ id: number }>(`SELECT id FROM products WHERE kode_item ILIKE ? AND id <> ?`, kode, kecualiProdukId)
    : await get<{ id: number }>(`SELECT id FROM products WHERE kode_item ILIKE ?`, kode);
  if (baris) throw tolak(409, `Kode item "${kode}" sudah dipakai produk lain.`);
}

/**
 * Kode item berikutnya (BRG-0001, BRG-0002, …) dengan penomoran berurutan.
 * Dipanggil DI DALAM transaksi (BEGIN IMMEDIATE) sehingga bebas balapan.
 */
async function kodeItemOtomatis(): Promise<string> {
  let maks = 0;
  for (const r of await all<{ kode_item: string | null }>(`SELECT kode_item FROM products WHERE kode_item LIKE 'BRG-%'`)) {
    const m = /^BRG-(\d+)$/.exec(String(r.kode_item ?? ''));
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  for (let n = maks + 1; n <= maks + 1000; n++) {
    const k = `BRG-${String(n).padStart(4, '0')}`;
    if (!await get<{ id: number }>(`SELECT id FROM products WHERE kode_item ILIKE ?`, k)) return k;
  }
  throw tolak(500, 'Gagal membuat kode item otomatis.');
}

// --- Foto produk (storage) ---------------------------------------------------

const FOTO_DIR = path.join(ROOT_DIR, 'data', 'uploads', 'produk');
const FOTO_MAKS_BYTES = 5 * 1024 * 1024;
const FOTO_MIME: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Simpan berkas foto terkompresi (data URL dari klien) → URL publik /uploads/…. */
function simpanFoto(dataUrl: string, prefix: string): string {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? '').trim());
  if (!m) throw tolak(400, 'Format foto tidak didukung (gunakan WebP/JPEG/PNG).');
  const biner = Buffer.from(m[2], 'base64');
  if (biner.length === 0) throw tolak(400, 'File foto kosong.');
  if (biner.length > FOTO_MAKS_BYTES) throw tolak(413, 'Foto melebihi batas 5 MB.');
  fs.mkdirSync(FOTO_DIR, { recursive: true });
  const aman = (prefix ?? 'foto').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'foto';
  const namaFile = `${aman}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${FOTO_MIME[m[1]]}`;
  fs.writeFileSync(path.join(FOTO_DIR, namaFile), biner);
  return `/uploads/produk/${namaFile}`;
}

/** Hapus berkas foto lama bila berada di storage internal (abaikan gagal). */
function hapusFoto(url: string | null): void {
  if (!url || !url.startsWith('/uploads/')) return;
  const relatif = url.replace(/^\/uploads\//, '');
  const dasar = path.join(ROOT_DIR, 'data', 'uploads');
  const tujuan = path.join(dasar, relatif);
  if (!tujuan.startsWith(dasar)) return; // cegah path traversal
  try {
    fs.rmSync(tujuan, { force: true });
  } catch {
    /* file mungkin sudah tidak ada */
  }
}

/** Nama file tampilan: URL lengkap dibiarkan, path internal → nama berkasnya. */
function namaBerkasFoto(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith('/uploads/')) return s.slice(s.lastIndexOf('/') + 1);
  return s;
}

function angkaNilai(
  v: unknown,
  label: string,
  { min = 0, wajib = false }: { min?: number; wajib?: boolean } = {},
): number {
  if (v === null || v === undefined || v === '') {
    if (wajib) throw tolak(400, `${label} wajib diisi.`);
    return 0;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (Number.isNaN(n)) throw tolak(400, `${label} harus berupa angka.`);
  if (n < min) throw tolak(400, `${label} tidak boleh negatif.`);
  return n;
}

function teksNilai(v: unknown, label: string, maks = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > maks) throw tolak(400, `${label} maksimal ${maks} karakter.`);
  return s;
}

async function cekBarcodeSilang(barcode: string, kecualiProdukId?: number): Promise<void> {
  const diProduk = kecualiProdukId
    ? await get<{ id: number }>(`SELECT id FROM products WHERE barcode = ? AND id <> ?`, barcode, kecualiProdukId)
    : await get<{ id: number }>(`SELECT id FROM products WHERE barcode = ?`, barcode);
  if (diProduk) throw tolak(409, `Barcode "${barcode}" sudah dipakai produk lain.`);
  const diPaket = await get<{ id: number }>(`SELECT id FROM packs WHERE barcode_box = ?`, barcode);
  if (diPaket) throw tolak(409, `Barcode "${barcode}" sudah dipakai paket/box.`);
}

async function cekSku(sku: string, kecualiProdukId?: number): Promise<void> {
  const baris = kecualiProdukId
    ? await get<{ id: number }>(`SELECT id FROM products WHERE sku = ? AND id <> ?`, sku, kecualiProdukId)
    : await get<{ id: number }>(`SELECT id FROM products WHERE sku = ?`, sku);
  if (baris) throw tolak(409, `SKU "${sku}" sudah dipakai produk lain.`);
}

async function validasiKonversi(raw: unknown): Promise<KonversiMasuk[]> {
  if (!Array.isArray(raw)) return [];
  const dipakai = new Set<number>();
  return await Promise.all(raw.map(async (k) => {
    const item = k as Record<string, unknown>;
    const unit_id = Number(item.unit_id);
    const jumlah = angkaNilai(item.jumlah_per_satuan_dasar, 'Jumlah konversi', { min: 0.0001 });
    if (!Number.isInteger(unit_id) || unit_id <= 0) throw tolak(400, 'Satuan konversi tidak valid.');
    if (dipakai.has(unit_id)) throw tolak(409, 'Satuan konversi kembar dalam daftar.');
    dipakai.add(unit_id);
    if (!await get<{ id: number }>('SELECT id FROM units WHERE id = ?', unit_id)) throw tolak(400, 'Satuan konversi tidak ditemukan.');
    return { unit_id, jumlah_per_satuan_dasar: jumlah };
  }));
}

async function validasiProduk(body: Record<string, unknown>, kecualiProdukId?: number): Promise<ProdukMasuk> {
  const nama = teksNilai(body.nama, 'Nama produk', 200);
  if (!nama) throw tolak(400, 'Nama produk wajib diisi.');

  const sku = teksNilai(body.sku, 'SKU', 60);
  if (!sku) throw tolak(400, 'Produk wajib memiliki SKU.');
  await cekSku(sku, kecualiProdukId);

  const barcode = teksNilai(body.barcode, 'Barcode', 80);
  if (barcode) await cekBarcodeSilang(barcode, kecualiProdukId);

  const kodeItem = teksNilai(body.kode_item, 'Kode item', 40);
  if (kodeItem) await cekKodeItem(kodeItem, kecualiProdukId);

  const resolveRef = async (nilai: unknown, label: string, tabel: string): Promise<number | null> => {
    if (nilai === null || nilai === undefined || nilai === '') return null;
    const id = Number(nilai);
    if (!Number.isInteger(id) || !await get<{ id: number }>(`SELECT id FROM ${tabel} WHERE id = ?`, id)) {
      throw tolak(400, `${label} tidak ditemukan.`);
    }
    return id;
  };

  // Stok awal + gudang tujuan hanya diproses saat TAMBAH produk manual
  // (ubah produk memakai Penyesuaian/Opname). Stok > 0 wajib pilih gudang.
  const tambahBaru = !kecualiProdukId;
  const gudang_id = tambahBaru ? await resolveRef(body.gudang_id, 'Gudang tujuan', 'warehouses') : null;
  const stok_awal = tambahBaru ? angkaNilai(body.stok_awal, 'Stok awal') : 0;
  if (tambahBaru && stok_awal > 0 && gudang_id == null) {
    throw tolak(400, 'Pilih gudang tujuan untuk stok awal.');
  }

  return {
    kode_item: kodeItem,
    nama,
    sku,
    barcode,
    gudang_id,
    stok_awal,
    category_id: await resolveRef(body.category_id, 'Kategori', 'categories'),
    brand_id: await resolveRef(body.brand_id, 'Merek', 'brands'),
    satuan_dasar_id: await resolveRef(body.satuan_dasar_id, 'Satuan dasar', 'units'),
    size_profile_id: await resolveRef(body.size_profile_id, 'Profil size', 'size_profiles'),
    harga_beli: angkaNilai(body.harga_beli, 'Harga beli'),
    harga_jual: angkaNilai(body.harga_jual, 'Harga jual'),
    stok_min: angkaNilai(body.stok_min, 'Stok minimum'),
    aktif: body.aktif === false || body.aktif === 0 || body.aktif === '0' ? 0 : 1,
    deskripsi: teksNilai(body.deskripsi, 'Deskripsi', 2000) || null,
    konversi: await validasiKonversi(body.konversi),
  };
}

/**
 * Apakah produk masih terkunci oleh transaksi AKTIF (atau stok fisik ≠ 0)?
 * Mengembalikan label sumber pengunci, atau null bila aman dihapus permanen.
 */
async function produkDipakai(productId: number): Promise<string | null> {
  for (const r of RUJUKAN_AKTIF) {
    const row = await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "${r.tabel}" d
         JOIN "${r.induk}" x ON x.id = d."${r.kolom}"
        WHERE d.product_id = ? AND ${r.saring}`,
      productId,
    );
    if (Number(row?.n ?? 0) > 0) return r.label;
  }
  const saldo = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_balances WHERE product_id = ? AND COALESCE(qty, 0) <> 0`,
    productId,
  );
  if (Number(saldo?.n ?? 0) > 0) return 'stok';
  return null;
}

async function simpanKonversi(productId: number, konversi: KonversiMasuk[]): Promise<void> {
  await run(`DELETE FROM unit_conversions WHERE product_id = ?`, productId);
  for (const k of konversi) {
    await run(
      `INSERT INTO unit_conversions (product_id, unit_id, jumlah_per_satuan_dasar) VALUES (?, ?, ?)`,
      productId,
      k.unit_id,
      k.jumlah_per_satuan_dasar,
    );
  }
}

// --- Router ----------------------------------------------------------------
export function routerProduk(): Router {
  const r = Router();

  // Daftar produk (pencarian menembus kode item, nama, SKU, barcode).
  // Filter ?gudang=<id|kode>: hanya produk yang tercatat di gudang tersebut
  // (hak akses dicek middleware — di luar cakupan ditolak 403).
  // stok_total & stok_rinci selalu dibatasi ke gudang yang terlihat sesi
  // (cakupan peran/pengguna) sehingga tiap peran melihat angka gudangnya.
  r.get('/', async (req, res) => {
    const p = bacaPaginasi(req, { urutBawaan: 'nama', urutDiizinkan: ['nama', 'kode_item', 'sku', 'dibuat_pada', 'aktif'] });
    const terlihat = await gudangTerlihat(req);
    const batasSb = batasGudangSql(terlihat, 'sb');
    const syarat: string[] = [];
    const params: unknown[] = [];

    // Mode Sampah: hanya produk terhapus (soft delete via aksi massal).
    if (String(req.query.sampah ?? '') === '1') syarat.push('p.deleted_at IS NOT NULL');
    else syarat.push('p.deleted_at IS NULL');

    if (p.cari) {
      syarat.push(
        `(p.kode_item ILIKE ? ESCAPE '\\' OR p.nama ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\' OR p.barcode ILIKE ? ESCAPE '\\')`,
      );
      params.push(polaCari(p.cari), polaCari(p.cari), polaCari(p.cari), polaCari(p.cari));
    }
    if (req.query.kategori) {
      syarat.push('p.category_id = ?');
      params.push(Number(req.query.kategori));
    }
    if (req.query.merek) {
      syarat.push('p.brand_id = ?');
      params.push(Number(req.query.merek));
    }
    if (req.query.aktif !== undefined && req.query.aktif !== '') {
      syarat.push('p.aktif = ?');
      params.push(Number(req.query.aktif));
    }
    // Filter gudang: id numerik atau kode ("GD-1"). Produk yang punya baris
    // saldo di gudang tersebut (berapa pun qty-nya — qty terlihat di kolom).
    // Tanpa filter ("Semua gudang"): non-admin HANYA melihat produk yang
    // ditempatkan di gudang yang diizinkan sesi (atau belum di gudang mana
    // pun) — produk khusus gudang lain tidak bocor sebagai baris daftar.
    let gudangFilterId: number | null = null;
    const gudangMint = String(req.query.gudang ?? '').trim();
    if (gudangMint !== '' && gudangMint !== 'semua') {
      if (/^\d+$/.test(gudangMint)) {
        gudangFilterId = Number(gudangMint);
        if (!await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', gudangFilterId)) {
          throw tolak(400, 'Gudang tidak ditemukan.');
        }
      } else {
        // Terima kode, nama, atau label dropdown "KODE — Nama" (trim + tanpa peka huruf).
        const potong = String(gudangMint).split(/[—-]/)[0]?.trim() ?? '';
        const w = (await get<{ id: number }>('SELECT id FROM warehouses WHERE kode ILIKE ?', potong || gudangMint))
          ?? (await get<{ id: number }>('SELECT id FROM warehouses WHERE nama ILIKE ?', gudangMint))
          ?? (await get<{ id: number }>('SELECT id FROM warehouses WHERE kode ILIKE ?', gudangMint));      if (!w) throw tolak(400, 'Gudang tidak ditemukan.');
      gudangFilterId = Number(w.id);
      }
      // Pertahanan berlapis: middleware menolak gudang di luar cakupan (403);
      // pemeriksaan lokal ini menutup jalur yang lolos dari middleware.
      await wajibGudangDiizinkan(req, gudangFilterId);
      syarat.push('EXISTS (SELECT 1 FROM stock_balances sbF WHERE sbF.product_id = p.id AND sbF.warehouse_id = ?)');
      params.push(gudangFilterId);
    }
    if (gudangFilterId === null) {
      const lingkup = await syaratGudangSesi(req, 'sbF2.warehouse_id');
      if (lingkup.sql === '1 = 0') {
        syarat.push('1 = 0');
      } else if (lingkup.sql) {
        syarat.push(
          `(NOT EXISTS (SELECT 1 FROM stock_balances sbN WHERE sbN.product_id = p.id) OR EXISTS (SELECT 1 FROM stock_balances sbF2 WHERE sbF2.product_id = p.id AND ${lingkup.sql}))`,
        );
        params.push(...lingkup.params);
      }
    }
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

    const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p ${where}`, ...params)))?.n ?? 0);
    const data = await all<Record<string, unknown>>(
      `SELECT p.*, c.nama AS kategori_nama, b.nama AS merek_nama,
              COALESCE((SELECT SUM(sb.qty) FROM stock_balances sb WHERE sb.product_id = p.id${batasSb}), 0) AS stok_total
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       ${where}
       ORDER BY p.${p.urut} ${p.arah}, p.id ASC
       LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );
    // Rincian stok per gudang untuk halaman ini (satu kueri, dikelompokkan
    // di JS) — sumber kolom "Gudang" di tabel produk.
    const perId = new Map<number, { warehouse_id: number; gudang_kode: string; gudang_nama: string; qty: number }[]>();
    const ids = data.map((b) => Number(b.id)).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length > 0 && !(terlihat !== null && terlihat.size === 0)) {
      const batasRinci = batasGudangSql(terlihat, 'sb');
      const rinci = await all<{ product_id: number; warehouse_id: number; gudang_kode: string; gudang_nama: string; qty: number }>(
        `SELECT sb.product_id, w.id AS warehouse_id, w.kode AS gudang_kode, w.nama AS gudang_nama, sb.qty
         FROM stock_balances sb
         JOIN warehouses w ON w.id = sb.warehouse_id
         WHERE sb.product_id IN (${ids.map(() => '?').join(',')})${batasRinci}
         ORDER BY w.kode ASC`,
        ...ids,
      );
      for (const r of rinci) {
        const daftar = perId.get(Number(r.product_id)) ?? [];
        daftar.push({
          warehouse_id: Number(r.warehouse_id),
          gudang_kode: String(r.gudang_kode),
          gudang_nama: String(r.gudang_nama),
          qty: Number(r.qty ?? 0),
        });
        perId.set(Number(r.product_id), daftar);
      }
    }
    for (const b of data) {
      const rinci = perId.get(Number(b.id)) ?? [];
      (b as Record<string, unknown>).stok_rinci = rinci;
      (b as Record<string, unknown>).stok_gudang =
        gudangFilterId !== null ? Number(rinci.find((r) => r.warehouse_id === gudangFilterId)?.qty ?? 0) : null;
    }
    const sampahTotal = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NOT NULL`)))?.n ?? 0);
    res.json({ data, total, hal: p.hal, per: p.per, sampah_total: sampahTotal });
  });

  // --- Ekspor: format kolom SAMA dengan template (satu sumber kebenaran) -----
  // Query opsional:
  //   ids=1,2,3            → hanya baris terpilih (cakupan "terpilih")
  //   cakupan=filter       → terapkan filter kategori & status stok
  //   kolom=kode_item,…    → daftar centang kolom (default: semua KOLOM_IMPOR + stok)
  //   format=json          → balasan data untuk pratinjau Excel/PDF di klien
  //   format=csv           → berkas .csv (UTF-8 BOM)
  //   sheet_per_kategori=1 → satu sheet per kategori (hanya .xlsx)
  //   header=0             → tanpa baris judul kolom
  const KOLOM_TAMBAHAN_EKSPOR = ['stok'];

  r.get('/ekspor', asyncHandler(async (req, res) => {
    // Kolom "stok" mengikuti gudang yang terlihat sesi (hak akses peran).
    const STOK_SQL = `COALESCE((SELECT SUM(sb.qty) FROM stock_balances sb WHERE sb.product_id = prod.id${batasGudangSql(await gudangTerlihat(req), 'sb')}), 0)`;
    const idsParam = String(req.query.ids ?? '').trim();
    const cakupan = String(req.query.cakupan ?? (idsParam ? 'terpilih' : 'semua'));
    const formatMint = String(req.query.format ?? 'xlsx');
    const format = formatMint === 'csv' || formatMint === 'json' ? formatMint : 'xlsx';
    const tanpaJudul = String(req.query.header ?? '1') === '0';
    const perKategori = String(req.query.sheet_per_kategori ?? '') === '1';
    const kategoriId = Number(req.query.kategori ?? 0) || null;
    const filterStokMint = String(req.query.stok ?? '');
    const filterStok = ['habis', 'ada', 'menipis'].includes(filterStokMint) ? filterStokMint : '';

    // STANDAR: ekspor memakai SEMUA kolom KOLOM_IMPOR (termasuk gudang/stok_awal)
    // + stok, sehingga header ekspor 100% identik dengan template impor.
    // gudang/stok_awal pada ekspor dikosongkan (stok agregat ada di kolom stok).
    const semuaKolom = [...KOLOM_IMPOR.map((k) => k.key), ...KOLOM_TAMBAHAN_EKSPOR];
    const minta = String(req.query.kolom ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const pilih = minta.length ? semuaKolom.filter((k) => minta.includes(k)) : semuaKolom;
    if (!pilih.length) throw tolak(400, 'Pilihan kolom ekspor kosong.');

    const syarat: string[] = ['prod.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (cakupan === 'terpilih') {
      const ids = [...new Set(idsParam.split(',').map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) throw tolak(400, 'Cakupan "Baris terpilih" dipilih tetapi tidak ada baris yang dipilih.');
      syarat.push(`prod.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    } else if (cakupan === 'filter') {
      if (kategoriId) {
        syarat.push('prod.category_id = ?');
        params.push(kategoriId);
      }
      if (filterStok === 'habis') syarat.push(`${STOK_SQL} = 0`);
      else if (filterStok === 'ada') syarat.push(`${STOK_SQL} > 0`);
      else if (filterStok === 'menipis') syarat.push(`${STOK_SQL} <= prod.stok_min`);
    }

    const rows = await all<Record<string, unknown>>(
      `SELECT prod.sku, prod.barcode, prod.harga_beli, prod.harga_jual, prod.stok_min,
              prod.kode_item, prod.nama AS nama_produk, prod.aktif AS produk_aktif, prod.foto_url AS produk_foto,
              c.nama AS kategori, b.nama AS merek, u.nama AS satuan, sp.nama AS profil_size, ${STOK_SQL} AS stok_total
       FROM products prod
       LEFT JOIN categories c ON c.id = prod.category_id
       LEFT JOIN brands b ON b.id = prod.brand_id
       LEFT JOIN units u ON u.id = prod.satuan_dasar_id
       LEFT JOIN size_profiles sp ON sp.id = prod.size_profile_id
       WHERE ${syarat.join(' AND ')}
       ORDER BY ${perKategori ? 'c.nama ASC, ' : ''}prod.kode_item ASC`,
      ...params,
    );

    const isi = rows.map((b) => ({
      kode_item: b.kode_item ?? '',
      nama_produk: b.nama_produk ?? '',
      sku: b.sku ?? '',
      kategori: b.kategori ?? '',
      merek: b.merek ?? '',
      satuan: b.satuan ?? '',
      profil_size: b.profil_size ?? '',
      barcode: b.barcode ?? '',
      harga_beli: b.harga_beli ?? 0,
      harga_jual: b.harga_jual ?? 0,
      // Round-trip: nilai minimum aktual dari database → bisa diedit & diimpor ulang.
      stok_min: Number(b.stok_min ?? 0),
      status: Number(b.produk_aktif) === 1 ? 'Aktif' : 'Nonaktif',
      nama_file_foto: namaBerkasFoto(b.produk_foto),
      gudang: '',
      stok_awal: '',
      stok: Number(b.stok_total ?? 0),
    }));
    const kolom: KolomExcel[] = pilih.map((key) => ({ key, label: key }));
    const proyeksi = (r: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(pilih.map((k) => [k, r[k]]));
    const baris = isi.map(proyeksi);
    const namaDasar = `produk-${new Date().toISOString().slice(0, 10)}`;

    // Pratinjau Excel/PDF di klien — JSON, dibatasi agar tetap ringan.
    if (format === 'json') {
      const batas = Math.min(2000, Math.max(1, Number(req.query.batas ?? 300) || 300));
      res.json({ kolom, total: baris.length, baris: baris.slice(0, batas) });
      return;
    }

    if (format === 'csv') {
      const kuot = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const garis = [
        ...(tanpaJudul ? [] : [kolom.map((k) => kuot(k.label)).join(',')]),
        ...baris.map((r) => kolom.map((k) => kuot(r[k.key])).join(',')),
      ];
      res
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${namaDasar}.csv"`,
        })
        .send(`\uFEFF${garis.join('\r\n')}`);
      return;
    }

    let sheets: SheetExcel[];
    if (perKategori) {
      const grup = new Map<string, Record<string, unknown>[]>();
      for (const r of isi) {
        const judul = String(r.kategori || '').trim() || 'Tanpa Kategori';
        const ada = grup.get(judul) ?? [];
        ada.push(proyeksi(r));
        grup.set(judul, ada);
      }
      sheets = [...grup.entries()].map(([judul, isi2]) => ({ judul, kolom, baris: isi2, tanpaJudul }));
    } else {
      sheets = [{ judul: 'Data', kolom, baris, tanpaJudul }];
    }

    const buffer = await tulisExcelMulti(sheets);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${namaDasar}.xlsx"`,
      })
      .send(buffer);
  }));

  // Template: kolom lahir dari KOLOM_IMPOR (kolom baru otomatis ikut muncul),
  // dilengkapi baris contoh + sheet "Petunjuk".
  r.get('/template', async (_req, res) => {
    const contoh: Record<string, unknown>[] = [
      {
        kode_item: 'BRG-9001', nama_produk: 'Kaos Distro Hitam', sku: 'KAOS-9001', kategori: 'Kaos', merek: 'Merek Contoh',
        satuan: 'PCS', profil_size: '', barcode: '', harga_beli: 45000, harga_jual: 75000, stok_min: 5, status: 'Aktif', nama_file_foto: 'BRG-9001.jpg',
        gudang: 'GD-1', stok_awal: 24, stok: '',
      },
      {
        kode_item: 'BRG-9002', nama_produk: 'Sepatu Sneaker Putih', sku: 'SPATU-9002', kategori: 'Sepatu', merek: 'Merek Contoh',
        satuan: 'PCS', profil_size: 'Sepatu Pria', barcode: '8991234567890', harga_beli: 120000, harga_jual: 199000, stok_min: 10, status: 'Aktif', nama_file_foto: '',
        gudang: '', stok_awal: '', stok: '',
      },
    ];

    const barisPetunjuk: Record<string, unknown>[] = [
      {
        kolom: '— CARA PAKAI —', wajib: '', format: '',
        ket: 'HAPUS baris contoh pada sheet "Data" sebelum mengimpor. Satu baris = satu produk (tanpa varian). Impor bersifat UPSERT: kode_item sudah ada → data diperbarui; belum ada → produk baru. Pratinjau ditampilkan sebelum konfirmasi. Kosong pada kolom opsional = tidak diubah (produk baru: nilai default). Kolom gudang + stok_awal: isi kode/nama gudang (harus ada di Master › Gudang) + jumlah stok awal; stok awal hanya ditulis bila produk belum punya saldo di gudang itu, tercatat di Kartu Stok sebagai Penyesuaian (stok awal impor) memakai harga_beli.',
      },
      ...KOLOM_IMPOR.map((k) => ({
        kolom: k.key,
        wajib: k.wajib ? 'Wajib' : 'Opsional',
        format: k.format,
        ket: k.ket,
      })),
      {
        kolom: '— FOTO & EKSPOR —', wajib: '', format: '',
        ket: 'Isi nama_file_foto setelah foto diunggah lewat tombol "Unggah Foto Massal" (nama file, mis. BRG-0001.jpg), atau pakai URL lengkap https://…. Ekspor Excel memakai format kolom yang sama persis dengan template ini.',
      },
    ];

    const buffer = await tulisExcelMulti([
      { judul: 'Data', kolom: kolomExcelImpor(), baris: contoh },
      {
        judul: 'Petunjuk',
        kolom: [
          { key: 'kolom', label: 'Kolom' },
          { key: 'wajib', label: 'Wajib/Opsional' },
          { key: 'format', label: 'Format' },
          { key: 'ket', label: 'Keterangan' },
        ],
        baris: barisPetunjuk,
      },
    ]);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-produk.xlsx"',
      })
      .send(buffer);
  });

  // --- Impor Excel: DUA TAHAP (pra-tinjau → konfirmasi), bersifat UPSERT -----
  // Validasi baris TANPA menulis apa pun; dipakai kedua tahap sehingga
  // pratinjau dan hasil konfirmasi dijamin identik.
  interface BarisImpor {
    nomor: number;
    aksi: 'baru' | 'perbarui';
    kodeItem: string;
    nama: string;
    sku: string;
    raw: Record<string, unknown>;
    produkId: number | null;
    categoryId: number | null;
    kategoriBaru: string | null;
    brandId: number | null;
    merekBaru: string | null;
    satuanId: number | null;
    /** Nama satuan yang belum ada — dibuat otomatis saat konfirmasi (opsi buat_otomatis). */
    satuanBaru: string | null;
    satuanDiisi: boolean;
    /** Profil size produk (X5.5) — null = kosong (tidak diubah / ikut kategori). */
    sizeProfileId: number | null;
    sizeProfileDiisi: boolean;
    /** Gudang penempatan stok awal (id warehouses) — null = tanpa penempatan. */
    gudangId: number | null;
    /** Teks gudang apa adanya (untuk echo pratinjau). */
    gudangTeks: string;
    /** Stok awal (≥ 0) — undefined = kolom kosong. */
    stokAwal: number | undefined;
    /** true = stok awal akan ditulis saat konfirmasi (saldo gudang masih kosong). */
    stokAwalTerap: boolean;
    hargaBeli: number | undefined;
    hargaJual: number | undefined;
    /** Stok minimum (≥ 0, bulat). Sel kosong = 0; undefined = kolom tak ada di file. */
    stokMin: number | undefined;
    aktif: number | undefined;
    barcode: string | null;
    fotoUrl: string | null;
  }

  // Normalisasi sel & opsi dari mesin impor bersama (lib/imporBersama).
  const teksBaris = teksKode;

  /** Stok minimum dari sel Excel: kosong = 0, selain itu wajib angka bulat ≥ 0. */
  const bacaStokMin = (v: unknown): number => {
    const bersih = teksBersih(v).trim();
    if (!bersih) return 0;
    const n = angkaToleran(v, 'stok_min');
    if (n === null || !Number.isFinite(n) || n < 0) {
      throw new GalatImpor('stok_min', 'stok_min harus angka bulat ≥ 0.', v);
    }
    return Math.round(n);
  };

  /** Normalisasi pencocokan impor: trim, rapikan spasi ganda, tanpa peka huruf. */
  const normImpor = (s: string): string => s.toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const cocokNorm = async (tabel: string, kolom: string[], nilai: string): Promise<number | null> => {
    const cari = normImpor(nilai);
    if (!cari) return null;
    for (const b of await all<Record<string, unknown>>(`SELECT id, ${kolom.join(', ')} FROM ${tabel}`)) {
      for (const c of kolom) {
        if (normImpor(String(b[c] ?? '')) === cari) return Number(b.id);
      }
      // Label dropdown "KODE — Nama" juga diterima.
      if (kolom.length >= 2 && (cari === `${normImpor(String(b[kolom[0]] ?? ''))} - ${normImpor(String(b[kolom[1]] ?? ''))}` || cari === `${normImpor(String(b[kolom[0]] ?? ''))} — ${normImpor(String(b[kolom[1]] ?? ''))}`)) {
        return Number(b.id);
      }
    }
    return null;
  };

  const cariRefImpor = async (tabel: 'categories' | 'brands', nama: string): Promise<number | null> =>
    await cocokNorm(tabel, ['nama'], teksBersih(nama));

  const cariSatuanImpor = async (nama: string): Promise<number | null> =>
    await cocokNorm('units', ['nama', 'kode'], teksBersih(nama));

  /** Gudang untuk stok awal impor: cocok kode ATAU nama (tanpa peka huruf).
   *  Gudang tidak dibuat otomatis — harus sudah ada & aktif di Master › Gudang. */
  const cariGudangImpor = async (nama: string): Promise<number | null> => {
    const cari = normImpor(teksBersih(nama));
    if (!cari) return null;
    for (const b of await all<{ id: number; kode: string; nama: string }>(`SELECT id, kode, nama FROM warehouses WHERE COALESCE(aktif, TRUE) = TRUE`)) {
      if (normImpor(b.kode) === cari || normImpor(b.nama) === cari) return Number(b.id);
    }
    return null;
  };

  /** Jepret saldo + kartu stok produk untuk jejak "Urungkan impor". */
  const fotoStok = async (productId: number): Promise<NonNullable<JejakUrung['turunan']>> => [
    { tabel: 'stock_balances', kunciInduk: 'product_id', baris: await all(`SELECT * FROM stock_balances WHERE product_id = ?`, productId) },
    { tabel: 'stock_ledger', kunciInduk: 'product_id', baris: await all(`SELECT * FROM stock_ledger WHERE product_id = ?`, productId) },
  ];

  async function validasiImpor(
    baris: Record<string, unknown>[],
    opsi: OpsiImporBersama,
    /** Batasan gudang sesi (hak akses peran); null = semua gudang. */
    terbatas: Set<number> | null = null,
  ): Promise<{ valid: BarisImpor[]; kumpul: PengumpulImpor }> {
    const kumpul = new PengumpulImpor();
    const valid: BarisImpor[] = [];
    const unikKode = new PemantauUnik('kode_item');
    const unikSku = new PemantauUnik('sku');

    for (const [idx, raw] of baris.entries()) {
      const nomor = nomorBaris(idx);
      try {
        const kodeItem = teksBaris(raw.kode_item);
        if (!kodeItem) throw new GalatImpor('kode_item', 'kode_item wajib diisi.', raw.kode_item);
        if (kodeItem.length > 40) throw new GalatImpor('kode_item', 'kode_item maksimal 40 karakter.', raw.kode_item);
        unikKode.cek(kodeItem, nomor, 'kode_item');

        const nama = teksBersih(raw.nama_produk);
        if (!nama) throw new GalatImpor('nama_produk', 'nama_produk wajib diisi.', raw.nama_produk);
        if (nama.length > 200) throw new GalatImpor('nama_produk', 'nama_produk maksimal 200 karakter.', raw.nama_produk);

        const sku = teksBaris(raw.sku);
        if (!sku) throw new GalatImpor('sku', 'sku wajib diisi.', raw.sku);
        if (sku.length > 60) throw new GalatImpor('sku', 'sku maksimal 60 karakter.', raw.sku);
        unikSku.cek(sku, nomor, 'sku');

        // Cek terhadap database (AB2c): UPSERT per kode_item — SKU yang sudah
        // ada milik produk yang SAMA = "akan diperbarui"; error hanya bila SKU
        // milik produk lain (kode_item berbeda). Pembanding tanpa peka huruf.
        const produk = await get<{ id: number }>(
          `SELECT id FROM products WHERE kode_item ILIKE ? AND deleted_at IS NULL`,
          kodeItem,
        );
        const diSku = await get<{ id: number; kode_item: string | null }>(
          `SELECT id, kode_item FROM products WHERE sku ILIKE ? AND deleted_at IS NULL`,
          sku,
        );
        if (diSku && (!produk || Number(diSku.id) !== Number(produk.id))) {
          throw new GalatImpor(
            'sku',
            `sku "${sku}" sudah dipakai produk lain${diSku.kode_item ? ` (kode_item ${diSku.kode_item})` : ''}.`,
            raw.sku,
          );
        }

        const barcode = teksBaris(raw.barcode) || null;
        if (barcode) {
          const diBarcode = produk
            ? await get<{ id: number }>(`SELECT id FROM products WHERE barcode ILIKE ? AND id <> ?`, barcode, Number(produk.id))
            : await get<{ id: number }>(`SELECT id FROM products WHERE barcode ILIKE ?`, barcode);
          if (diBarcode) throw new GalatImpor('barcode', `barcode "${barcode}" sudah dipakai produk lain.`, raw.barcode);
          const diPaket = await get<{ id: number }>(`SELECT id FROM packs WHERE barcode_box ILIKE ?`, barcode);
          if (diPaket) throw new GalatImpor('barcode', `barcode "${barcode}" sudah dipakai paket/box.`, raw.barcode);
        }

        const kategori = teksBersih(raw.kategori);
        const kategoriId = kategori ? await cariRefImpor('categories', kategori) : null;
        const merek = teksBersih(raw.merek);
        const merekId = merek ? await cariRefImpor('brands', merek) : null;
        const satuan = teksBersih(raw.satuan);
        const satuanId = satuan ? await cariSatuanImpor(satuan) : null;
        // AB2e — referensi belum ada: opsi "Buat otomatis" → Peringatan, bukan Error.
        if (kategori && !kategoriId) {
          if (!opsi.buat_otomatis) throw new GalatImpor('kategori', `Kategori "${kategori}" tidak ditemukan.`, raw.kategori);
          kumpul.ingatkan(nomor, 'kategori', `Kategori "${kategori}" belum ada — akan dibuat otomatis.`);
        }
        if (merek && !merekId) {
          if (!opsi.buat_otomatis) throw new GalatImpor('merek', `Merek "${merek}" tidak ditemukan.`, raw.merek);
          kumpul.ingatkan(nomor, 'merek', `Merek "${merek}" belum ada — akan dibuat otomatis.`);
        }
        const satuanBaru = satuan && satuanId === null ? satuan : null;
        if (satuanBaru) {
          if (!opsi.buat_otomatis) {
            throw new GalatImpor('satuan', `Satuan "${satuan}" belum ada — buat dulu di menu Satuan.`, raw.satuan);
          }
          kumpul.ingatkan(nomor, 'satuan', `Satuan "${satuan}" belum ada — akan dibuat otomatis.`);
        }

        const profilTeks = teksBersih(raw.profil_size);
        let sizeProfileId: number | null = null;
        if (profilTeks) {
          const diProfil = await get<{ id: number }>(
            `SELECT id FROM size_profiles WHERE nama ILIKE ? OR kode ILIKE ?`,
            profilTeks,
            profilTeks,
          );
          if (!diProfil) {
            throw new GalatImpor(
              'profil_size',
              `profil_size "${profilTeks}" tidak ditemukan — pakai nama profil dari Pengaturan ▸ Aturan Kodi.`,
              raw.profil_size,
            );
          }
          sizeProfileId = Number(diProfil.id);
        }

        const fotoTeks = teksBaris(raw.nama_file_foto);
        let fotoUrl: string | null = null;
        if (fotoTeks) {
          if (/^https?:\/\//.test(fotoTeks)) fotoUrl = fotoTeks;
          else {
            const aman = path.basename(fotoTeks.replace(/\\/g, '/'));
            if (fs.existsSync(path.join(FOTO_DIR, aman))) fotoUrl = `/uploads/produk/${aman}`;
          }
        }

        // Kolom gudang + stok_awal: dikenali, divalidasi ke Master Gudang, dan
        // diterapkan sebagai stok awal (saldo + kartu stok) saat konfirmasi.
        const gudangTeks = teksBersih(raw.gudang);
        let gudangId: number | null = null;
        if (gudangTeks) {
          gudangId = await cariGudangImpor(gudangTeks);
          if (!gudangId) {
            throw new GalatImpor('gudang', `Gudang dengan kode '${gudangTeks}' pada baris ${nomor} tidak ditemukan.`, raw.gudang);
          }
          if (terbatas && !terbatas.has(gudangId)) {
            throw new GalatImpor('gudang', `Gudang "${gudangTeks}" di luar hak akses Anda — hubungi Owner.`, raw.gudang);
          }
        }

        let stokAwal: number | undefined;
        const mentahStok = raw.stok_awal;
        if (mentahStok !== null && mentahStok !== undefined && String(mentahStok).trim() !== '') {
          const n = angkaToleran(mentahStok, 'stok_awal');
          if (n === null || !(n >= 0)) throw new GalatImpor('stok_awal', 'stok_awal harus berupa angka ≥ 0.', raw.stok_awal);
          stokAwal = n;
        }
        if (stokAwal !== undefined && stokAwal > 0 && gudangId === null) {
          throw new GalatImpor('stok_awal', 'stok_awal diisi tetapi kolom gudang kosong — isi kode/nama gudang penempatan.', raw.stok_awal);
        }

        // Stok awal hanya ditulis bila saldo gudang masih kosong — impor ulang
        // tidak menumpuk stok (ubah lewat Penyesuaian/Opname bila sudah terisi).
        let stokAwalTerap = stokAwal !== undefined && stokAwal > 0 && gudangId !== null;
        if (stokAwalTerap && produk) {
          const saldo = await get<{ qty: number | null }>(
            `SELECT qty FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
            Number(produk.id),
            Number(gudangId),
          );
          if (Number(saldo?.qty ?? 0) !== 0) {
            kumpul.ingatkan(nomor, 'stok_awal', `Stok awal diabaikan — produk sudah punya saldo di gudang "${gudangTeks}" (pakai Penyesuaian/Opname untuk mengubah).`);
            stokAwalTerap = false;
          }
        }

        valid.push({
          nomor,
          aksi: produk ? 'perbarui' : 'baru',
          kodeItem,
          nama,
          sku,
          raw,
          gudangId,
          gudangTeks,
          stokAwal,
          stokAwalTerap,
          produkId: produk ? Number(produk.id) : null,
          categoryId: kategoriId,
          kategoriBaru: kategori && !kategoriId ? kategori : null,
          brandId: merekId,
          merekBaru: merek && !merekId ? merek : null,
          satuanId,
          satuanBaru,
          satuanDiisi: !!satuan,
          sizeProfileId,
          sizeProfileDiisi: !!profilTeks,
          // AB2b — parse angka toleran: "Rp 1.250.000", "1,250,000.50", angka asli.
          hargaBeli: angkaToleran(raw.harga_beli, 'harga_beli') ?? undefined,
          hargaJual: angkaToleran(raw.harga_jual, 'harga_jual') ?? undefined,
          // Sel kosong pada kolom yang ada → 0. File tanpa kolom ini tidak
          // mengubah batas minimum produk yang sudah ada.
          stokMin: 'stok_min' in raw ? bacaStokMin(raw.stok_min) : undefined,
          aktif: statusToleran(raw.status),
          barcode,
          fotoUrl,
        });
      } catch (err) {
        // Nilai mentah kolom yang terisi ikut dilaporkan (tabel detail error).
        kumpul.tolakDari(err, nomor, raw);
      }
    }
    return { valid, kumpul };
  }

  /** Terapkan baris valid (UPSERT per kode_item). Mengembalikan jejak untuk "Urungkan impor". */
  async function terapkanImpor(valid: BarisImpor[], userId: number | null): Promise<JejakUrung[]> {
    const jejak: JejakUrung[] = [];
    const buatRef = async (tabel: 'categories' | 'brands', nama: string): Promise<number> => {
      const ada = await get<{ id: number }>(`SELECT id FROM ${tabel} WHERE nama ILIKE ?`, nama);
      if (ada) return Number(ada.id);
      return Number(await ((await run(`INSERT INTO ${tabel} (nama) VALUES (?)`, nama))).lastInsertRowid);
    };
    const buatSatuan = async (nama: string): Promise<number> => {
      const ada = await get<{ id: number }>(`SELECT id FROM units WHERE nama ILIKE ? OR kode ILIKE ?`, nama, nama);
      if (ada) return Number(ada.id);
      // Kode diturunkan dari nama (huruf besar, maks 20 karakter) — unik di tabel units.
      const dasar = nama.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'UNIT';
      let kode = dasar;
      let n = 2;
      while (await get<{ id: number }>('SELECT id FROM units WHERE kode ILIKE ?', kode)) kode = `${dasar.slice(0, 17)}${n++}`;
      return Number(await ((await run(`INSERT INTO units (kode, nama) VALUES (?, ?)`, kode, nama))).lastInsertRowid);
    };
    const tambahSet = (patch: Record<string, unknown>): { set: string; arg: unknown[] } => ({
      set: Object.keys(patch).map((k) => `${k} = ?`).join(', '),
      arg: Object.keys(patch).map((k) => patch[k]),
    });
    const now = () => new Date().toISOString();

    for (const b of valid) {
      const kategoriId = b.kategoriBaru ? await buatRef('categories', b.kategoriBaru) : b.categoryId;
      const merekId = b.merekBaru ? await buatRef('brands', b.merekBaru) : b.brandId;
      const satuanId = b.satuanBaru ? await buatSatuan(b.satuanBaru) : b.satuanId;

      if (b.produkId) {
        const lama = (await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, b.produkId))!
        const patch: Record<string, unknown> = { nama: b.nama, sku: b.sku, diubah_pada: now() };
        if (b.kategoriBaru || b.categoryId !== null) patch.category_id = kategoriId;
        if (b.merekBaru || b.brandId !== null) patch.brand_id = merekId;
        if (b.satuanDiisi) patch.satuan_dasar_id = satuanId;
        if (b.sizeProfileDiisi) patch.size_profile_id = b.sizeProfileId;
        if (b.aktif !== undefined) patch.aktif = b.aktif;
        if (b.fotoUrl) patch.foto_url = b.fotoUrl;
        if (b.barcode !== null) patch.barcode = b.barcode;
        if (b.hargaBeli !== undefined) patch.harga_beli = b.hargaBeli;
        if (b.hargaJual !== undefined) patch.harga_jual = b.hargaJual;
        // Stok minimum diterapkan bila kolomnya ada di file (sel kosong → 0) agar
        // hasil ekspor → impor ulang identik dengan nilai di database.
        if (b.stokMin !== undefined) patch.stok_min = b.stokMin;
        const { set, arg } = tambahSet(patch);
        await run(`UPDATE products SET ${set} WHERE id = ?`, ...arg, b.produkId);
        const sesudah = (await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, b.produkId))!
        await catatAudit({ userId, aksi: 'ubah', tabel: 'products', recordId: b.produkId, sebelum: lama, sesudah });
        if (Number(lama.harga_beli) !== Number(sesudah.harga_beli) || Number(lama.harga_jual) !== Number(sesudah.harga_jual)) {
          await catatAudit({ userId, aksi: 'ubah_harga', tabel: 'products', recordId: b.produkId, sebelum: lama, sesudah });
        }
        // Stok awal impor: saldo + kartu stok (Penyesuaian) bila saldo gudang masih kosong.
        let turunanUbah: NonNullable<JejakUrung['turunan']> = [];
        if (b.stokAwalTerap && b.gudangId !== null && b.stokAwal !== undefined) {
          turunanUbah = await fotoStok(Number(b.produkId));
          const hargaFinal = Number(sesudah.harga_beli ?? 0);
          const hasilStok = await ubahStok({
            productId: Number(b.produkId),
            warehouseId: b.gudangId,
            masuk: b.stokAwal,
            hargaMasuk: hargaFinal,
            tipeDokumen: 'penyesuaian',
            userId,
          });
          await catatAudit({ userId, aksi: 'stok_awal', tabel: 'stock_ledger', recordId: Number(b.produkId), sesudah: { gudang_id: b.gudangId, gudang: b.gudangTeks, qty: b.stokAwal, harga: hargaFinal, saldo: hasilStok.saldo } });
        } else if (b.gudangId !== null) {
          // Penempatan tanpa stok awal (kolom gudang terisi, stok_awal kosong/0):
          // pastikan relasi produk–gudang ada (saldo 0) agar kolom GUDANG dan
          // filter per gudang menampilkannya — tanpa baris ini produk tak terlihat.
          const ada = await get<{ qty: number }>(`SELECT qty FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, Number(b.produkId), b.gudangId);
          if (!ada) {
            turunanUbah = await fotoStok(Number(b.produkId));
            await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty, diubah_pada) VALUES (?, ?, 0, ?)`, Number(b.produkId), b.gudangId, now());
            await catatAudit({ userId, aksi: 'stok_awal', tabel: 'stock_balances', recordId: Number(b.produkId), sesudah: { gudang_id: b.gudangId, gudang: b.gudangTeks, qty: 0, penempatan: true } });
          }
        }
        jejak.push({ aksi: 'perbarui', tabel: 'products', id: Number(b.produkId), sebelum: lama, turunan: turunanUbah });
      } else {
        const productId = Number(
          await ((await run(
            `INSERT INTO products (kode_item, nama, sku, barcode, category_id, brand_id, satuan_dasar_id, size_profile_id, harga_beli, harga_jual, stok_min, aktif, foto_url, dibuat_oleh)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            b.kodeItem,
            b.nama,
            b.sku,
            b.barcode,
            kategoriId,
            merekId,
            b.satuanDiisi ? satuanId : null,
            b.sizeProfileId,
            b.hargaBeli ?? 0,
            b.hargaJual ?? 0,
            b.stokMin ?? 0,
            b.aktif ?? 1,
            b.fotoUrl,
            userId,
          ))).lastInsertRowid,
        );
        await catatAudit({ userId, aksi: 'tambah', tabel: 'products', recordId: productId, sesudah: { kode_item: b.kodeItem, nama: b.nama, sku: b.sku } });
        // Stok awal impor untuk produk baru: saldo + kartu stok (Penyesuaian).
        let turunanTambah: NonNullable<JejakUrung['turunan']> = [];
        if (b.stokAwalTerap && b.gudangId !== null && b.stokAwal !== undefined) {
          turunanTambah = await fotoStok(productId);
          const hargaFinal = b.hargaBeli ?? 0;
          const hasilStok = await ubahStok({
            productId,
            warehouseId: b.gudangId,
            masuk: b.stokAwal,
            hargaMasuk: hargaFinal,
            tipeDokumen: 'penyesuaian',
            userId,
          });
          await catatAudit({ userId, aksi: 'stok_awal', tabel: 'stock_ledger', recordId: productId, sesudah: { gudang_id: b.gudangId, gudang: b.gudangTeks, qty: b.stokAwal, harga: hargaFinal, saldo: hasilStok.saldo } });
        } else if (b.gudangId !== null) {
          // Penempatan tanpa stok awal: relasi gudang dengan saldo 0.
          turunanTambah = await fotoStok(productId);
          await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty, diubah_pada) VALUES (?, ?, 0, ?)`, productId, b.gudangId, now());
          await catatAudit({ userId, aksi: 'stok_awal', tabel: 'stock_balances', recordId: productId, sesudah: { gudang_id: b.gudangId, gudang: b.gudangTeks, qty: 0, penempatan: true } });
        }
        jejak.push({ aksi: 'tambah', tabel: 'products', id: productId, turunan: turunanTambah });
      }
    }
    return jejak;
  }

  const bacaFileImpor = async (req: Request): Promise<{ nama_file: string; baris: Record<string, unknown>[] }> => {
    const { nama_file, data_base64, pemetaan } = (req.body ?? {}) as {
      nama_file?: string;
      data_base64?: string;
      /** Pemetaan opsional: { kolomProduk: kolomFileExcel } — dipakai wizard "Cocokkan kolom". */
      pemetaan?: Record<string, string>;
    };
    if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
    const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
    const { kolom, baris } = await bacaExcel(buffer);
    if (!baris.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');
    // AB2a — pemetaan file → kunci kolom modul diterapkan SEBELUM validasi;
    // mesin bersama membuat salinan per baris & membuang baris kosong.
    // Fallback otomatis server: bila wizard tidak mengirim pemetaan (atau ada
    // kolom belum terpetakan seperti Gudang), lengkapi dari pencocokan judul
    // (trim + tanpa peka huruf) agar kolom Kode Gudang/Nama Gudang tidak hilang.
    const modulKolom = [...KOLOM_IMPOR.map((k) => ({ key: k.key, label: k.key })), { key: 'stok', label: 'stok' }];
    const otomatis = pemetaanOtomatis(modulKolom, kolom);
    const gabung: Record<string, string> = { ...otomatis, ...(pemetaan ?? {}) };
    for (const k of Object.keys(gabung)) {
      if (!kolom.includes(gabung[k])) delete gabung[k];
    }
    const hasil = terapkanPemetaan(kolom, baris, gabung);
    if (!hasil.length) throw tolak(400, 'Semua baris data kosong — periksa file Excel Anda.');
    return { nama_file: nama_file ?? 'impor-produk.xlsx', baris: hasil };
  };

  /**
   * Opsi wizard Impor Excel (langkah Cocokkan kolom) — mesin bersama:
   *  - `perbarui`      → perbarui data bila Kode sudah ada (UPSERT); mati = baris
   *                      yang Kode-nya sudah ada dilewati (tidak ditulis).
   *  - `lewati_error`  → lewati baris yang error; mati = satu error membatalkan
   *                      seluruh impor.
   *  - `buat_otomatis` → referensi (kategori/merek/satuan) yang belum ada dibuat
   *                      otomatis (peringatan, bukan error).
   */
  const bacaOpsiImpor = (req: Request): OpsiImporBersama =>
    bacaOpsiImporBersama(((req.body ?? {}) as { opsi?: Record<string, unknown> }).opsi);

  // Tahap 0 — kolom file: baca judul kolom + satu baris contoh + total baris,
  // dipakai wizard "Cocokkan kolom" untuk pemetaan otomatis di klien.
  r.post(
    '/impor/kolom',
    asyncHandler(async (req, res) => {
      const { nama_file, data_base64 } = (req.body ?? {}) as { nama_file?: string; data_base64?: string };
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom, baris } = await bacaExcel(buffer);
      if (!kolom.length) throw tolak(400, 'File tidak memiliki baris judul kolom.');
      res.json({
        nama_file: nama_file ?? 'impor-produk.xlsx',
        kolom,
        contoh: baris[0] ?? {},
        total_baris: baris.length,
      });
    }),
  );

  // Tahap 1 — pratinjau: validasi semua baris TANPA menulis apa pun,
  // lengkap dengan aksi (baru/perbarui), pesan error per baris, kelompok alasan,
  // peringatan "akan dibuat", dan pratinjau baris (tetap tampil walau semua error).
  r.post(
    '/impor/pra-tinjau',
    asyncHandler(async (req, res) => {
      const { nama_file, baris } = await bacaFileImpor(req);
      const opsi = bacaOpsiImpor(req);
      cetakDebugImpor('produk/pra-tinjau', baris);
      const { valid, kumpul } = await validasiImpor(baris, opsi, await gudangTerlihat(req));
      const diterapkan = opsi.perbarui ? valid : valid.filter((b) => !b.produkId);
      res.json({
        nama_file,
        total_baris: baris.length,
        baris_valid: diterapkan.length,
        baris_dilewati: valid.length - diterapkan.length,
        baris_error: kumpul.jumlahError,
        // true = impor akan ditolak server karena "lewati baris error" dimatikan.
        blokir: !opsi.lewati_error && kumpul.jumlahError > 0,
        errors: kumpul.kesalahan,
        ringkasan: kumpul.ringkas(),
        peringatan: kumpul.peringatan,
        baris: diterapkan.map((b) => ({
          nomor: b.nomor,
          aksi: b.aksi,
          kode_item: b.kodeItem,
          nama_produk: b.nama,
          sku: b.sku,
          stok_min: b.stokMin ?? 0,
          gudang: b.gudangTeks || null,
          stok_awal: b.stokAwalTerap ? (b.stokAwal ?? null) : null,
        })),
        // AB1 — pratinjau baris yang dibaca sistem, tetap tampil walau semua error.
        pratinjau: baris.slice(0, 100).map((r, i) => ({
          nomor: nomorBaris(i),
          kode_item: teksKode(r.kode_item),
          nama_produk: teksBersih(r.nama_produk),
          sku: teksKode(r.sku),
        })),
      });
    }),
  );

  // Tahap 2 — konfirmasi: validasi ulang lalu terapkan (UPSERT per kode_item).
  // Proses per batch 500 baris dalam satu transaksi (AB3), jejak disimpan untuk
  // "Urungkan impor".
  r.post(
    '/impor',
    asyncHandler(async (req, res) => {
      const { nama_file, baris } = await bacaFileImpor(req);
      const opsi = bacaOpsiImpor(req);
      const pengguna = penggunaSaatIni(req);
      cetakDebugImpor('produk/impor', baris);
      const { valid, kumpul } = await validasiImpor(baris, opsi, await gudangTerlihat(req));
      if (!opsi.lewati_error && kumpul.jumlahError) {
        throw tolak(
          400,
          `Terdapat ${kumpul.jumlahError} baris error dan opsi "Lewati baris yang error" dimatikan — impor dibatalkan.`,
        );
      }
      const diterapkan = opsi.perbarui ? valid : valid.filter((b) => !b.produkId);
      const dilewati = valid.length - diterapkan.length;
      const jumlahBaru = diterapkan.filter((b) => !b.produkId).length;
      const jumlahPerbarui = diterapkan.length - jumlahBaru;

      const batch = await ((await run(
        `INSERT INTO import_batches (modul, nama_file, total_baris, status, user_id) VALUES ('produk', ?, ?, 'diproses', ?)`,
        nama_file,
        baris.length,
        pengguna.id,
      ))).lastInsertRowid;

      // AB3 — per batch 500 baris dalam SATU transaksi per batch.
      const jejak: JejakUrung[] = [];
      for (let i = 0; i < diterapkan.length; i += 500) {
        const potongan = diterapkan.slice(i, i + 500);
        await withTransaction(async () => {
          jejak.push(...await terapkanImpor(potongan, pengguna.id));
        });
      }
      await withTransaction(async () => {
        await simpanErrorBatch(Number(batch), kumpul.kesalahan);
        await run(
          `UPDATE import_batches SET baris_valid = ?, baris_error = ?, status = ?, undo_data = ? WHERE id = ?`,
          diterapkan.length,
          kumpul.jumlahError,
          diterapkan.length === 0 && kumpul.jumlahError > 0 ? 'gagal' : 'selesai',
          jejakUrungAman(jejak),
          Number(batch),
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'impor',
          tabel: 'products',
          recordId: Number(batch),
          sesudah: {
            nama_file,
            baris_valid: diterapkan.length,
            baris_dilewati: dilewati,
            baris_error: kumpul.jumlahError,
            opsi,
          },
        });
      });

      res.json({
        batch_id: Number(batch),
        total_baris: baris.length,
        baris_valid: diterapkan.length,
        baris_dilewati: dilewati,
        baris_error: kumpul.jumlahError,
        // AB3 — ringkasan "X ditambah, Y diperbarui, Z dilewati".
        jumlah_baru: jumlahBaru,
        jumlah_perbarui: jumlahPerbarui,
        errors: kumpul.kesalahan,
        ringkasan: kumpul.ringkas(),
        peringatan: kumpul.peringatan,
        urungkan_tersedia: jejak.length > 0,
      });
    }),
  );

  // AB1 — Unduh laporan error Excel (dari panel pengecekan, sebelum konfirmasi).
  r.post(
    '/impor/laporan-error',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { nama_file?: string; errors?: unknown };
      const daftar = Array.isArray(body.errors) ? (body.errors as Record<string, unknown>[]) : [];
      if (!daftar.length) throw tolak(400, 'Tidak ada error untuk diunduh.');
      const baris = daftar.slice(0, 20000).map((e) => ({
        nomor_baris: Number(e.nomor_baris ?? 0),
        kolom: e.kolom == null ? '' : String(e.kolom),
        nilai: e.nilai == null ? '' : String(e.nilai),
        pesan: String(e.pesan ?? ''),
      }));
      const buffer = await tulisExcel(
        'Laporan Error Impor Produk',
        [
          { key: 'nomor_baris', label: 'No Baris' },
          { key: 'kolom', label: 'Kolom' },
          { key: 'nilai', label: 'Nilai' },
          { key: 'pesan', label: 'Alasan' },
        ],
        baris,
      );
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="laporan-error-${String(body.nama_file ?? 'impor').replace(/\.[^.]+$/, '')}.xlsx"`,
        })
        .send(buffer);
    }),
  );

  // AB3 — Urungkan impor: pulihkan baris yang ditambah / kembalikan baris lama.
  r.post(
    '/impor/urungkan',
    asyncHandler(async (req, res) => {
      const batchId = Number(((req.body ?? {}) as { batch_id?: unknown }).batch_id);
      if (!Number.isFinite(batchId) || batchId <= 0) throw tolak(400, 'batch_id wajib diisi.');
      const pengguna = penggunaSaatIni(req);
      const batch = await get<{ id: number; modul: string; status: string; diurungkan: number; undo_data: string | null; user_id: number | null }>(
        `SELECT id, modul, status, diurungkan, undo_data, user_id FROM import_batches WHERE id = ?`,
        batchId,
      );
      if (!batch) throw tolak(404, 'Batch impor tidak ditemukan.');
      if (batch.modul !== 'produk') throw tolak(400, 'Batch ini bukan impor Produk.');
      if (batch.status !== 'selesai') throw tolak(400, 'Hanya batch berstatus "selesai" yang bisa diurungkan.');
      if (batch.diurungkan) throw tolak(409, 'Impor ini sudah pernah diurungkan.');
      if (batch.user_id !== pengguna.id && !adalahAdmin(req)) throw tolak(403, 'Hanya pengguna yang mengimpor (atau Admin) yang boleh mengurungkan.');

      let jejak: JejakUrung[] = [];
      try {
        jejak = JSON.parse(batch.undo_data ?? '[]') as JejakUrung[];
      } catch {
        jejak = [];
      }
      if (!jejak.length) throw tolak(400, 'Jejak impor ini tidak tersimpan (file terlalu besar) — urungkan manual lewat menu Produk.');

      let dikembalikan = 0;
      await withTransaction(async () => {
        // Urungkan mundur (turunan dipulihkan, perbarui dipulihkan, tambah dihapus).
        dikembalikan = await urungkanJejak(jejak);
        await run(`UPDATE import_batches SET diurungkan = TRUE WHERE id = ?`, batchId);
        await catatAudit({
          userId: pengguna.id,
          aksi: 'pulihkan',
          tabel: 'products',
          recordId: batchId,
          sesudah: { diurungkan: true, jumlah_baris: dikembalikan },
        });
      });

      res.json({ pesan: `Impor #${batchId} diurungkan — ${dikembalikan} baris dikembalikan.`, dikembalikan });
    }),
  );

  // Pemilih produk pipih (untuk konversi satuan, paket/box, dan pemilih lain)
  r.get('/pemilih', async (req, res) => {
    const cari = String(req.query.cari ?? '').trim();
    const per = Math.min(1000, Math.max(1, Number(req.query.per ?? 500) || 500));
    // Sumber = master produk saja; produk yang dihapus (soft delete) tidak ikut
    // ditawarkan walau namanya cocok. Tidak bergantung pada tabel transaksi.
    const syarat: string[] = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (cari) {
      syarat.push(`(p.sku ILIKE ? ESCAPE '\\' OR p.barcode ILIKE ? ESCAPE '\\' OR p.nama ILIKE ? ESCAPE '\\')`);
      params.push(polaCari(cari), polaCari(cari), polaCari(cari));
    }
    if (req.query.aktif !== undefined && req.query.aktif !== '') {
      syarat.push('p.aktif = ?');
      params.push(Number(req.query.aktif));
    }
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';
    const data = await all<Record<string, unknown>>(
      `SELECT p.id, p.sku, p.barcode, p.aktif, p.harga_jual, p.harga_beli, p.nama AS produk_nama
       FROM products p
       ${where}
       ORDER BY p.nama ASC, p.sku ASC
       LIMIT ?`,
      ...params,
      per,
    );
    res.json({ data, total: data.length });
  });

  // --- Foto produk: unggah massal (satu berkas per request = progres per file),
  // ganti, dan hapus. File disimpan di data/uploads/produk → /uploads/produk/….
  const bacaTargetFoto = async (body: Record<string, unknown>): Promise<{ id: number; baris: Record<string, unknown> }> => {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'id target wajib diisi.');
    const baris = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, id);
    if (!baris) throw tolak(404, 'Produk tidak ditemukan.');
    return { id, baris };
  };

  r.post(
    '/foto',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { id, baris } = await bacaTargetFoto(body);
      const pengguna = penggunaSaatIni(req);

      const prefix = String(baris.kode_item ?? 'produk');
      const url = simpanFoto(String(body.data_base64 ?? ''), prefix);
      const lama = baris.foto_url ? String(baris.foto_url) : null;

      await withTransaction(async () => {
        await run(`UPDATE products SET foto_url = ?, diubah_pada = ? WHERE id = ?`, url, new Date().toISOString(), id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'products', recordId: id, sebelum: { foto_url: lama }, sesudah: { foto_url: url } });
      });
      if (lama && lama !== url) hapusFoto(lama);
      res.json({ url });
    }),
  );

  r.post(
    '/foto/hapus',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { id, baris } = await bacaTargetFoto(body);
      const pengguna = penggunaSaatIni(req);
      const lama = baris.foto_url ? String(baris.foto_url) : null;

      await withTransaction(async () => {
        await run(`UPDATE products SET foto_url = NULL, diubah_pada = ? WHERE id = ?`, new Date().toISOString(), id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'products', recordId: id, sebelum: { foto_url: lama }, sesudah: { foto_url: null } });
      });
      hapusFoto(lama);
      res.json({ ok: true });
    }),
  );

  // Peta untuk pencocokan file foto massal (BRG-0001.jpg)
  r.get('/foto-map', async (_req, res) => {
    const produk = await all<Record<string, unknown>>(`SELECT id, kode_item, sku, nama, foto_url FROM products ORDER BY kode_item`);
    res.json({ data: produk });
  });

  // --- Pop up detail produk ----------------------------------------------
  // Ringan: info + ringkasan + konversi + paket dalam SATU permintaan saat
  // pop up dibuka. Tab Stok & Riwayat dimuat terpisah (lazy).
  r.get('/:id/detail', async (req, res) => {
    // Menerima id numerik ("29") ATAU kode_item ("BRG-0001") agar ?produk= bisa dibagikan.
    const kunci = String(req.params.id);
    const produk = await get<Record<string, unknown>>(
      `SELECT p.*, c.nama AS kategori_nama, b.nama AS merek_nama, u.nama AS satuan_dasar_nama,
              uu.nama AS dibuat_oleh_nama
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN units u ON u.id = p.satuan_dasar_id
       LEFT JOIN users uu ON uu.id = p.dibuat_oleh
       WHERE p.id::text = ? OR p.kode_item = ?`,
      kunci,
      kunci,
    );
    if (!produk) throw tolak(404, 'Produk tidak ditemukan.');
    const id = Number(produk.id);

    // Angka stok mengikuti gudang yang terlihat sesi (hak akses peran).
    const terlihatDetail = await gudangTerlihat(req);
    const batasDetail = batasGudangSql(terlihatDetail, 'sb');
    const ringkas = await get<{ total_stok: number; nilai_stok: number }>(
      `SELECT COALESCE(SUM(sb.qty), 0) AS total_stok,
              COALESCE(SUM(sb.qty * p.harga_beli), 0) AS nilai_stok
       FROM stock_balances sb
       JOIN products p ON p.id = sb.product_id
       WHERE sb.product_id = ?${batasDetail}`,
      id,
    );

    const batasJual =
      terlihatDetail === null
        ? ''
        : terlihatDetail.size === 0
          ? ' AND 1 = 0'
          : ` AND s.warehouse_id IN (${[...terlihatDetail].map((n) => Number(n)).join(',')})`;
    const terjual30Hari = Number(
      await ((await get<{ n: number }>(
        `SELECT COALESCE(SUM(si.qty), 0) AS n
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE si.product_id = ? AND s.status <> 'batal' AND s.tanggal >= ?${batasJual}`,
        id,
        new Date(Date.now() - 30 * 86400000).toISOString(),
      )))?.n ?? 0,
    );

    const konversi = await all<Record<string, unknown>>(
      `SELECT uc.product_id, uc.unit_id, uc.jumlah_per_satuan_dasar,
              u.kode AS unit_kode, u.nama AS unit_nama
       FROM unit_conversions uc
       JOIN units u ON u.id = uc.unit_id
       WHERE uc.product_id = ?
       ORDER BY u.kode`,
      id,
    );

    const paket = await all<Record<string, unknown>>(
      `SELECT pk.id, pk.kode_box, pk.barcode_box, pk.nama,
              COUNT(DISTINCT si.product_id) AS jumlah_produk,
              SUM(si.qty) AS qty_dalam_paket
       FROM pack_items si
       JOIN packs pk ON pk.id = si.pack_id
       WHERE si.product_id = ?
       GROUP BY pk.id
       ORDER BY pk.kode_box`,
      id,
    );

    const galeri: { sumber: 'produk'; ref_id: number; url: string; label: string }[] = [];
    if (produk.foto_url) {
      galeri.push({ sumber: 'produk', ref_id: id, url: String(produk.foto_url), label: String(produk.nama) });
    }

    res.json({
      data: {
        ...produk,
        galeri,
        konversi,
        paket,
        ringkasan: {
          total_stok: Number(ringkas?.total_stok ?? 0),
          nilai_stok: Number(ringkas?.nilai_stok ?? 0),
          terjual_30_hari: terjual30Hari,
          jumlah_gudang: Number(
            await ((await get<{ n: number }>(
              `SELECT COUNT(*) AS n FROM stock_balances sb WHERE sb.product_id = ? AND sb.qty <> 0${batasGudangSql(terlihatDetail, 'sb')}`,
              id,
            )))?.n ?? 0,
          ),
        },
      },
    });
  });

  // Tab Stok (lazy): saldo per gudang + peringatan minimum.
  // Hanya gudang yang terlihat sesi (hak akses peran) yang dikembalikan.
  r.get('/:id/stok', async (req, res) => {
    const kunci = String(req.params.id);
    const barisProduk = await get<{ id: number; stok_min: number }>(`SELECT id, stok_min FROM products WHERE id = ? OR kode_item = ?`, kunci, kunci);
    if (!barisProduk) throw tolak(404, 'Produk tidak ditemukan.');
    const id = Number(barisProduk.id);
    const minimum = Number(barisProduk.stok_min ?? 0);

    const baris = await all<Record<string, unknown>>(
      `SELECT sb.warehouse_id, w.kode AS gudang_kode, w.nama AS gudang_nama, sb.qty
       FROM stock_balances sb
       JOIN warehouses w ON w.id = sb.warehouse_id
       WHERE sb.product_id = ?${batasGudangSql(await gudangTerlihat(req), 'sb')}
       ORDER BY w.kode ASC`,
      id,
    );

    const gudang = baris.map((b) => ({
      gudang_kode: String(b.gudang_kode),
      gudang_nama: String(b.gudang_nama),
      qty: Number(b.qty ?? 0),
    }));
    const total = gudang.reduce((a, g) => a + g.qty, 0);
    res.json({
      ringkasan: {
        total,
        tersedia: total,
        dipesan: 0,
        minimum,
        jumlah_kurang: minimum > 0 && total < minimum ? 1 : 0,
      },
      lokasi: gudang.map((g) => ({ ...g, total: g.qty, minimum: g === gudang[0] ? minimum : 0 })),
      gudang,
      varian: [], // kompatibilitas tampilan lama — varian sudah tidak ada
    });
  });

  // Tab Riwayat (lazy): 20 mutasi stok terakhir produk ini.
  r.get('/:id/riwayat', async (req, res) => {
    const kunci = String(req.params.id);
    const barisProduk = await get<{ id: number }>(`SELECT id FROM products WHERE id = ? OR kode_item = ?`, kunci, kunci);
    if (!barisProduk) throw tolak(404, 'Produk tidak ditemukan.');
    const id = Number(barisProduk.id);
    const data = await all<Record<string, unknown>>(
      `SELECT sl.id, sl.tanggal, sl.tipe_dokumen, sl.qty_masuk, sl.qty_keluar, sl.saldo,
              p.sku, w.nama AS gudang_nama, l.kode_lokasi, u.nama AS pengguna,
              CASE sl.tipe_dokumen
                WHEN 'penjualan' THEN (SELECT no_dokumen FROM sales WHERE id = sl.dokumen_id)
                WHEN 'retur'     THEN (SELECT no_dokumen FROM sale_returns WHERE id = sl.dokumen_id)
                WHEN 'pembelian' THEN (SELECT no_dokumen FROM purchases WHERE id = sl.dokumen_id)
                WHEN 'transfer'  THEN (SELECT no_dokumen FROM stock_transfers WHERE id = sl.dokumen_id)
                WHEN 'opname'    THEN (SELECT no_dokumen FROM opname_sessions WHERE id = sl.dokumen_id)
                ELSE NULL
              END AS no_dokumen
       FROM stock_ledger sl
       JOIN products p ON p.id = sl.product_id
       JOIN warehouses w ON w.id = sl.warehouse_id
       LEFT JOIN locations l ON l.id = sl.location_id
       LEFT JOIN users u ON u.id = sl.user_id
       WHERE sl.product_id = ?
       ORDER BY sl.tanggal DESC, sl.id DESC
       LIMIT 20`,
      id,
    );
    res.json({ data });
  });

  // Detail produk + konversi
  r.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const produk = await get<Record<string, unknown>>(
      `SELECT p.*, c.nama AS kategori_nama, b.nama AS merek_nama, u.nama AS satuan_dasar_nama
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN units u ON u.id = p.satuan_dasar_id
       WHERE p.id = ?`,
      id,
    );
    if (!produk) throw tolak(404, 'Produk tidak ditemukan.');

    const konversi = await all<Record<string, unknown>>(
      `SELECT uc.*, u.kode AS unit_kode, u.nama AS unit_nama
       FROM unit_conversions uc JOIN units u ON u.id = uc.unit_id
       WHERE uc.product_id = ? ORDER BY u.kode`,
      id,
    );
    res.json({ data: { ...produk, konversi } });
  });

  // Tambah / ubah produk (SKU, barcode, harga, stok min, konversi — transaksi atomik)
  const simpanProduk = asyncHandler(async (req: Request, res) => {
    const id = req.params.id ? Number(req.params.id) : null;
    const pengguna = penggunaSaatIni(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const isi = await validasiProduk(body, id ?? undefined);

    const lamaProduk = id ? await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, id) : null;
    if (id && !lamaProduk) throw tolak(404, 'Produk tidak ditemukan.');

    // AX — ubah harga = sel Ubah pada Produk (middleware matriks global).
    const idBaru = await withTransaction(async () => {
      let productId: number;
      // Kode item: kosong → buat otomatis (baru) / pertahankan yang lama (ubah).
      let kodeItem = isi.kode_item ?? null;
      if (!kodeItem && id && lamaProduk?.kode_item) kodeItem = String(lamaProduk.kode_item);
      if (!kodeItem) kodeItem = await kodeItemOtomatis();
      await cekKodeItem(kodeItem, id ?? undefined);

      if (id) {
        await run(
          `UPDATE products SET nama = ?, sku = ?, barcode = ?, kode_item = ?, category_id = ?, brand_id = ?, satuan_dasar_id = ?,
                  size_profile_id = ?, harga_beli = ?, harga_jual = ?, stok_min = ?, aktif = ?, deskripsi = ?, diubah_pada = ? WHERE id = ?`,
          isi.nama,
          isi.sku,
          isi.barcode,
          kodeItem,
          isi.category_id,
          isi.brand_id,
          isi.satuan_dasar_id,
          isi.size_profile_id,
          isi.harga_beli,
          isi.harga_jual,
          isi.stok_min,
          isi.aktif,
          isi.deskripsi,
          new Date().toISOString(),
          id,
        );
        const sesudah = (await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, id))!
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'products', recordId: id, sebelum: lamaProduk, sesudah });
        if (
          lamaProduk &&
          (Number(lamaProduk.harga_beli) !== isi.harga_beli ||
            Number(lamaProduk.harga_jual) !== isi.harga_jual)
        ) {
          await catatAudit({ userId: pengguna.id, aksi: 'ubah_harga', tabel: 'products', recordId: id, sebelum: lamaProduk, sesudah });
        }
        await simpanKonversi(id, isi.konversi);
        productId = id;
      } else {
        productId = Number(
          await ((await run(
            `INSERT INTO products (nama, sku, barcode, kode_item, category_id, brand_id, satuan_dasar_id, size_profile_id, harga_beli, harga_jual, stok_min, aktif, deskripsi, dibuat_oleh)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            isi.nama,
            isi.sku,
            isi.barcode,
            kodeItem,
            isi.category_id,
            isi.brand_id,
            isi.satuan_dasar_id,
            isi.size_profile_id,
            isi.harga_beli,
            isi.harga_jual,
            isi.stok_min,
            isi.aktif,
            isi.deskripsi,
            pengguna.id,
          ))).lastInsertRowid,
        );
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'products', recordId: productId, sesudah: { kode_item: kodeItem, nama: isi.nama, sku: isi.sku } });
        await simpanKonversi(productId, isi.konversi);
        // Alokasi gudang manual: stok awal → saldo + kartu stok (Penyesuaian)
        // memakai harga beli; tanpa stok awal → relasi gudang bersaldo 0 supaya
        // produk langsung terlihat pada filter & kolom gudang tersebut.
        if (isi.gudang_id != null) {
          if (isi.stok_awal > 0) {
            const hasilStok = await ubahStok({
              productId,
              warehouseId: isi.gudang_id,
              masuk: isi.stok_awal,
              hargaMasuk: isi.harga_beli,
              tipeDokumen: 'penyesuaian',
              userId: pengguna.id,
            });
            await catatAudit({ userId: pengguna.id, aksi: 'stok_awal', tabel: 'stock_ledger', recordId: productId, sesudah: { gudang_id: isi.gudang_id, qty: isi.stok_awal, harga: isi.harga_beli, saldo: hasilStok.saldo } });
          } else {
            await run(`INSERT INTO stock_balances (product_id, warehouse_id, qty, diubah_pada) VALUES (?, ?, 0, ?)`, productId, isi.gudang_id, new Date().toISOString());
            await catatAudit({ userId: pengguna.id, aksi: 'stok_awal', tabel: 'stock_balances', recordId: productId, sesudah: { gudang_id: isi.gudang_id, qty: 0, penempatan: true } });
          }
        }
      }

      return productId;
    });

    res.status(id ? 200 : 201).json({ id: idBaru });
  });

  r.post('/', simpanProduk);
  r.put('/:id', simpanProduk);

  // Hapus produk permanen (hard delete). Hanya dikunci bila masih ada
  // transaksi AKTIF atau stok fisik ≠ 0; riwayat yang sudah dibatalkan /
  // di-reset / dikosongkan Proses Tahunan tidak menghalangi.
  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'ID produk tidak valid.');
      const pengguna = penggunaSaatIni(req);
      const produk = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, id);
      if (!produk) throw tolak(404, 'Produk tidak ditemukan.');

      const pengunci = await produkDipakai(id);
      if (pengunci) {
        throw tolak(
          409,
          `Produk masih memiliki transaksi aktif (${pengunci}) atau stok fisik yang belum 0. Selesaikan transaksinya, reset stok, atau nonaktifkan produk.`,
        );
      }

      await withTransaction(async () => {
        await catatAudit({
          userId: pengguna.id,
          aksi: 'hapus_permanen',
          tabel: 'products',
          recordId: id,
          sebelum: produk,
          alasan: 'Hard delete dari Master Produk (tanpa transaksi aktif)',
        });
        // Detail transaksi lama, kartu stok, saldo, konversi, harga, barcode,
        // dan seluruh baris anak lain ikut dibersihkan sebelum products.
        await hapusProdukPermanen(id);
      });
      hapusFoto(typeof produk.foto_url === 'string' ? produk.foto_url : null);
      res.json({ ok: true, pesan: 'Produk berhasil dihapus secara permanen.' });
    }),
  );

  // --- Aksi massal (pilih banyak baris) ------------------------------------
  const bacaIds = (body: unknown): number[] => {
    const raw = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(raw) || raw.length === 0) throw tolak(400, 'Tidak ada data yang dipilih.');
    if (raw.length > 1000) throw tolak(400, 'Maksimal 1000 data per permintaan — pecah menjadi batch kecil.');
    const ids = [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw tolak(400, 'Pilihan tidak valid.');
    return ids;
  };

  type HargaMassal = { cara: 'naik_persen' | 'turun_persen' | 'naik_nominal' | 'turun_nominal' | 'tetap'; nilai: number };
  type PatchMassal = {
    category_id?: number | null;
    brand_id?: number | null;
    satuan_dasar_id?: number | null;
    /** AF2 — aksi massal "Atur profil size" (null = ikut kategori). */
    size_profile_id?: number | null;
    aktif?: number;
    harga?: HargaMassal;
  };

  const bacaPatchMassal = async (body: unknown): Promise<PatchMassal> => {
    const p = ((body as { patch?: Record<string, unknown> } | null)?.patch ?? {}) as Record<string, unknown>;
    const patch: PatchMassal = {};
    const rujuk: Record<string, string> = { category_id: 'categories', brand_id: 'brands', satuan_dasar_id: 'units', size_profile_id: 'size_profiles' };
    for (const k of Object.keys(rujuk)) {
      if (p[k] === undefined) continue;
      const v = p[k] === null || p[k] === '' ? null : Number(p[k]);
      if (v !== null) {
        if (!Number.isInteger(v) || !await get(`SELECT id FROM ${rujuk[k]} WHERE id = ?`, v)) {
          throw tolak(400, 'Referensi tidak ditemukan.');
        }
      }
      (patch as Record<string, unknown>)[k] = v;
    }
    if (p.aktif !== undefined) patch.aktif = Number(p.aktif) === 1 ? 1 : 0;
    if (p.harga !== undefined && p.harga !== null) {
      const h = p.harga as { cara?: unknown; nilai?: unknown };
      const cara = String(h.cara ?? '');
      const nilai = Number(h.nilai);
      const sah = ['naik_persen', 'turun_persen', 'naik_nominal', 'turun_nominal', 'tetap'];
      if (!sah.includes(cara)) throw tolak(400, 'Cara ubah harga tidak dikenal.');
      if (!Number.isFinite(nilai) || nilai < 0) throw tolak(400, 'Nilai perubahan harga tidak valid.');
      patch.harga = { cara: cara as HargaMassal['cara'], nilai };
    }
    if (Object.keys(patch).length === 0) throw tolak(400, 'Tidak ada kolom yang dipilih untuk diubah.');
    return patch;
  };

  const hitungHarga = (lama: number, h: HargaMassal): number => {
    switch (h.cara) {
      case 'tetap':
        return h.nilai;
      case 'naik_persen':
        return Math.round(lama * (1 + h.nilai / 100));
      case 'turun_persen':
        return Math.max(0, Math.round(lama * (1 - h.nilai / 100)));
      case 'naik_nominal':
        return Math.round(lama + h.nilai);
      default:
        return Math.max(0, Math.round(lama - h.nilai));
    }
  };

  const formatUang = (n: number) => `Rp${new Intl.NumberFormat('id-ID').format(n)}`;

  // (a) Aktifkan / Nonaktifkan — satu transaksi per batch; balas "sebelum" untuk Urungkan.
  r.post(
    '/massal/set-aktif',
    asyncHandler(async (req, res) => {
      const ids = bacaIds(req.body);
      const aktif = Number((req.body as { aktif?: unknown })?.aktif) === 1 ? 1 : 0;
      const pengguna = penggunaSaatIni(req);
      const sebelum: { id: number; aktif: number }[] = [];
      const berhasil = await withTransaction(async () => {
        let n = 0;
        const now = new Date().toISOString();
        for (const id of ids) {
          const p = await get<{ id: number; aktif: number }>(`SELECT id, aktif FROM products WHERE id = ? AND deleted_at IS NULL`, id);
          if (!p) continue;
          sebelum.push({ id, aktif: Number(p.aktif) });
          if (Number(p.aktif) !== aktif) {
            await run(`UPDATE products SET aktif = ?, diubah_pada = ? WHERE id = ?`, aktif, now, id);
          }
          n++;
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: aktif ? 'aktifkan' : 'nonaktifkan',
          tabel: 'products',
          recordId: null,
          sesudah: { jumlah: n, ids, nilai: aktif },
        });
        return n;
      });
      res.json({ berhasil, sebelum: { produk: sebelum } });
    }),
  );

  // (b1) Ubah Massal — pratinjau sebelum → sesudah (tanpa menulis).
  r.post(
    '/massal/ubah/pratinjau',
    asyncHandler(async (req, res) => {
      const ids = bacaIds(req.body);
      const patch = await bacaPatchMassal(req.body);
      const namaRef = async (tabel: string, id: number | null | undefined): Promise<string> =>
        id === null || id === undefined ? '—' : String(await ((await get<{ nama: string }>(`SELECT nama FROM ${tabel} WHERE id = ?`, id)))?.nama ?? '—');

      const baris: { nama: string; perubahan: { label: string; sebelum: string; sesudah: string }[] }[] = [];
      for (const id of ids.slice(0, 5)) {
        const p = await get<Record<string, unknown>>(
          `SELECT p.*, c.nama AS kategori_nama, b.nama AS merek_nama, u.nama AS satuan_nama, sp.nama AS profil_nama
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN units u ON u.id = p.satuan_dasar_id
           LEFT JOIN size_profiles sp ON sp.id = p.size_profile_id
           WHERE p.id = ? AND p.deleted_at IS NULL`,
          id,
        );
        if (!p) continue;
        const perubahan: { label: string; sebelum: string; sesudah: string }[] = [];
        if (patch.category_id !== undefined) {
          perubahan.push({ label: 'Kategori', sebelum: String(p.kategori_nama ?? '—'), sesudah: await namaRef('categories', patch.category_id) });
        }
        if (patch.brand_id !== undefined) {
          perubahan.push({ label: 'Merek', sebelum: String(p.merek_nama ?? '—'), sesudah: await namaRef('brands', patch.brand_id) });
        }
        if (patch.satuan_dasar_id !== undefined) {
          perubahan.push({ label: 'Satuan dasar', sebelum: String(p.satuan_nama ?? '—'), sesudah: await namaRef('units', patch.satuan_dasar_id) });
        }
        if (patch.size_profile_id !== undefined) {
          perubahan.push({
            label: 'Profil size',
            sebelum: p.size_profile_id == null ? 'Ikut kategori' : String(p.profil_nama ?? '—'),
            sesudah: patch.size_profile_id == null ? 'Ikut kategori' : await namaRef('size_profiles', patch.size_profile_id),
          });
        }
        if (patch.aktif !== undefined) {
          perubahan.push({ label: 'Status', sebelum: Number(p.aktif) === 1 ? 'Aktif' : 'Nonaktif', sesudah: patch.aktif === 1 ? 'Aktif' : 'Nonaktif' });
        }
        if (patch.harga) {
          perubahan.push({
            label: 'Harga jual',
            sebelum: formatUang(Number(p.harga_jual ?? 0)),
            sesudah: formatUang(hitungHarga(Number(p.harga_jual ?? 0), patch.harga)),
          });
        }
        baris.push({ nama: String(p.nama), perubahan });
      }
      res.json({ baris, total: ids.length });
    }),
  );

  // (b2) Ubah Massal — terapkan dalam transaksi; balas "sebelum" untuk Urungkan.
  r.post(
    '/massal/ubah',
    asyncHandler(async (req, res) => {
      const ids = bacaIds(req.body);
      const patch = await bacaPatchMassal(req.body);
      const pengguna = penggunaSaatIni(req);
      const sebelumProduk: Record<string, unknown>[] = [];
      const okIds: number[] = [];

      const berhasil = await withTransaction(async () => {
        let n = 0;
        const now = new Date().toISOString();
        for (const id of ids) {
          const p = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`, id);
          if (!p) continue;
          sebelumProduk.push({
            id,
            category_id: p.category_id ?? null,
            brand_id: p.brand_id ?? null,
            satuan_dasar_id: p.satuan_dasar_id ?? null,
            size_profile_id: p.size_profile_id ?? null,
            aktif: Number(p.aktif),
            harga_jual: Number(p.harga_jual ?? 0),
          });
          const set: string[] = [];
          const arg: unknown[] = [];
          if (patch.category_id !== undefined) {
            set.push('category_id = ?');
            arg.push(patch.category_id);
          }
          if (patch.brand_id !== undefined) {
            set.push('brand_id = ?');
            arg.push(patch.brand_id);
          }
          if (patch.satuan_dasar_id !== undefined) {
            set.push('satuan_dasar_id = ?');
            arg.push(patch.satuan_dasar_id);
          }
          if (patch.size_profile_id !== undefined) {
            set.push('size_profile_id = ?');
            arg.push(patch.size_profile_id);
          }
          if (patch.aktif !== undefined) {
            set.push('aktif = ?');
            arg.push(patch.aktif);
          }
          if (patch.harga) {
            set.push('harga_jual = ?');
            arg.push(hitungHarga(Number(p.harga_jual ?? 0), patch.harga));
          }
          if (set.length) {
            set.push('diubah_pada = ?');
            arg.push(now);
            await run(`UPDATE products SET ${set.join(', ')} WHERE id = ?`, ...arg, id);
          }
          okIds.push(id);
          n++;
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah_massal',
          tabel: 'products',
          recordId: null,
          sesudah: { jumlah: n, ids: okIds, patch: patch as unknown as Record<string, unknown> },
        });
        return n;
      });
      res.json({ berhasil, sebelum: { produk: sebelumProduk } });
    }),
  );

  // (e) Urungkan — membalikkan hasil set-aktif / ubah massal (dipanggil klien dlm 10 detik).
  r.post(
    '/massal/urungkan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { produk?: unknown };
      const daftarProduk = Array.isArray(body.produk) ? body.produk : [];
      if (!daftarProduk.length) throw tolak(400, 'Tidak ada perubahan untuk diurungkan.');
      if (daftarProduk.length > 3000) throw tolak(400, 'Terlalu banyak untuk diurungkan sekaligus.');
      const pengguna = penggunaSaatIni(req);
      const KOLOM_PRODUK = ['category_id', 'brand_id', 'satuan_dasar_id', 'size_profile_id', 'aktif', 'harga_jual'];

      const n = await withTransaction(async () => {
        let berhasil = 0;
        const now = new Date().toISOString();
        for (const raw of daftarProduk) {
          const it = (raw ?? {}) as Record<string, unknown>;
          const id = Number(it.id);
          if (!Number.isInteger(id) || !await get(`SELECT id FROM products WHERE id = ?`, id)) continue;
          const set: string[] = [];
          const arg: unknown[] = [];
          for (const k of KOLOM_PRODUK) {
            if (it[k] !== undefined) {
              set.push(`${k} = ?`);
              arg.push(k === 'aktif' ? (Number(it[k]) === 1 ? 1 : 0) : k === 'harga_jual' ? Number(it[k]) || 0 : it[k]);
            }
          }
          if (!set.length) continue;
          set.push('diubah_pada = ?');
          arg.push(now);
          await run(`UPDATE products SET ${set.join(', ')} WHERE id = ?`, ...arg, id);
          berhasil++;
        }
        await catatAudit({ userId: pengguna.id, aksi: 'urungkan', tabel: 'products', recordId: null, sesudah: { jumlah: berhasil } });
        return berhasil;
      });
      res.json({ berhasil: n });
    }),
  );

  // (d) Hapus massal — soft delete ke Sampah; yang dipakai transaksi → dilewati + alasan.
  r.post(
    '/massal/hapus',
    asyncHandler(async (req, res) => {
      const ids = bacaIds(req.body);
      const pengguna = penggunaSaatIni(req);
      const dilewati: { id: number; nama: string; alasan: string }[] = [];
      const okIds: number[] = [];

      const berhasil = await withTransaction(async () => {
        let n = 0;
        const now = new Date().toISOString();
        for (const id of ids) {
          const p = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`, id);
          if (!p) continue;
          const tabel = await produkDipakai(id);
          if (tabel) {
            dilewati.push({ id, nama: String(p.nama), alasan: `Masih ada transaksi aktif (${tabel}). Selesaikan/reset transaksinya atau nonaktifkan produk.` });
            continue;
          }
          await run(`UPDATE products SET deleted_at = ?, aktif = FALSE, diubah_pada = ? WHERE id = ?`, now, now, id);
          okIds.push(id);
          n++;
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: 'hapus_massal',
          tabel: 'products',
          recordId: null,
          sesudah: { jumlah: n, ids: okIds, dilewati: dilewati.length },
        });
        return n;
      });
      res.json({
        berhasil,
        dilewati,
        saran: 'Produk yang masih memiliki transaksi aktif atau stok fisik tidak dihapus — selesaikan transaksinya, reset stok, atau nonaktifkan saja.',
      });
    }),
  );

  // (tambahan) Pulihkan dari Sampah.
  r.post(
    '/massal/pulihkan',
    asyncHandler(async (req, res) => {
      const ids = bacaIds(req.body);
      const pengguna = penggunaSaatIni(req);
      const berhasil = await withTransaction(async () => {
        let n = 0;
        const now = new Date().toISOString();
        for (const id of ids) {
          const p = await get<{ id: number }>(`SELECT id FROM products WHERE id = ? AND deleted_at IS NOT NULL`, id);
          if (!p) continue;
          await run(`UPDATE products SET deleted_at = NULL, aktif = TRUE, diubah_pada = ? WHERE id = ?`, now, id);
          n++;
        }
        await catatAudit({ userId: pengguna.id, aksi: 'pulihkan', tabel: 'products', recordId: null, sesudah: { jumlah: n, ids } });
        return n;
      });
      res.json({ berhasil });
    }),
  );

  /** Hapus permanen satu produk Sampah — hanya baris yang sudah di-soft-delete. */
  const hapusPermanenSatu = async (id: number, userId: number | null): Promise<void> => {
    const p = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ? AND deleted_at IS NOT NULL`, id);
    if (!p) throw tolak(404, `Produk #${id} tidak ada di Sampah (mungkin sudah dipulihkan/dihapus).`);
    const pengunci = await produkDipakai(id);
    if (pengunci) {
      throw tolak(
        409,
        `"${String(p.nama)}" masih memiliki transaksi aktif (${pengunci}) atau stok fisik ≠ 0 dan tidak bisa dihapus permanen.`,
      );
    }
    await withTransaction(async () => {
      await catatAudit({ userId, aksi: 'hapus_permanen', tabel: 'products', recordId: id, sebelum: p });
      await hapusProdukPermanen(id);
    });
    hapusFoto(typeof p.foto_url === 'string' ? p.foto_url : null);
  };

  // Hapus permanen per baris dari Sampah (DELETE ... WHERE id — hanya setelah konfirmasi klien).
  r.delete(
    '/:id/permanen',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'ID produk tidak valid.');
      await hapusPermanenSatu(id, penggunaSaatIni(req).id);
      res.json({ ok: true });
    }),
  );

  // Kosongkan Sampah / hapus permanen massal — tanpa ids = seluruh isi Sampah.
  r.post(
    '/massal/permanen',
    asyncHandler(async (req, res) => {
      const raw = (req.body ?? {}).ids;
      const pengguna = penggunaSaatIni(req);
      let ids: number[];
      if (raw === undefined || raw === null) {
        ids = (await all<{ id: number }>(`SELECT id FROM products WHERE deleted_at IS NOT NULL`)).map((b) => Number(b.id));
      } else {
        ids = bacaIds(req.body);
      }
      const dilewati: { id: number; nama: string; alasan: string }[] = [];
      let n = 0;
      for (const id of ids) {
        try {
          await hapusPermanenSatu(id, pengguna.id);
          n++;
        } catch (e) {
          const nama = String((await get<{ nama: string }>(`SELECT nama FROM products WHERE id = ?`, id))?.nama ?? `#${id}`);
          dilewati.push({ id, nama, alasan: e instanceof Error ? e.message : 'Gagal dihapus.' });
        }
      }
      res.json({ berhasil: n, dilewati });
    }),
  );

  return r;
}

// --- Konversi satuan (per produk) -------------------------------------------
export function routerKonversi(): Router {
  const r = Router();

  const SELECT_KONVERSI = `
    SELECT uc.*, p.sku, p.nama AS produk_nama,
           u.kode AS unit_kode, u.nama AS unit_nama
    FROM unit_conversions uc
    JOIN products p ON p.id = uc.product_id
    JOIN units u ON u.id = uc.unit_id`;

  const syaratCari = (req: Request): { where: string; params: unknown[] } => {
    const syarat: string[] = [];
    const params: unknown[] = [];
    const cari = String(req.query.cari ?? '').trim();
    if (cari) {
      syarat.push(`(p.nama ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\' OR u.nama ILIKE ? ESCAPE '\\')`);
      params.push(polaCari(cari), polaCari(cari), polaCari(cari));
    }
    if (req.query.unit_id) {
      syarat.push('uc.unit_id = ?');
      params.push(Number(req.query.unit_id));
    }
    if (req.query.product_id) {
      syarat.push('uc.product_id = ?');
      params.push(Number(req.query.product_id));
    }
    return { where: syarat.length ? `WHERE ${syarat.join(' AND ')}` : '', params };
  };

  // Ekspor Excel
  r.get('/ekspor', async (req, res) => {
    const { where, params } = syaratCari(req);
    const baris = await all<Record<string, unknown>>(`${SELECT_KONVERSI} ${where} ORDER BY p.nama ASC, p.sku ASC`, ...params);
    const kolom = [
      { key: 'produk_nama', label: 'Nama Produk' },
      { key: 'sku', label: 'SKU' },
      { key: 'unit_kode', label: 'Kode Satuan' },
      { key: 'unit_nama', label: 'Satuan' },
      { key: 'jumlah_per_satuan_dasar', label: 'Jumlah per Satuan Dasar' },
    ];
    tulisExcel('Konversi Satuan', kolom, baris)
      .then((buffer) =>
        res
          .set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="konversi-satuan-${new Date().toISOString().slice(0, 10)}.xlsx"`,
          })
          .send(buffer),
      )
      .catch((err) => {
        const { status, pesan } = pesanKesalahan(err);
        res.status(status).json({ pesan });
      });
  });

  // Template impor
  r.get('/template', async (_req, res) => {
    const kolom = [
      { key: 'sku', label: 'SKU' },
      { key: 'satuan', label: 'Satuan' },
      { key: 'jumlah', label: 'Jumlah per Satuan Dasar' },
    ];
    tulisExcel('Konversi Satuan', kolom, [])
      .then((buffer) =>
        res
          .set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="template-konversi.xlsx"',
          })
          .send(buffer),
      )
      .catch((err) => {
        const { status, pesan } = pesanKesalahan(err);
        res.status(status).json({ pesan });
      });
  });

  // Impor Excel: SKU + Satuan + Jumlah (upsert per produk+satuan, mesin bersama)
  r.post(
    '/impor',
    asyncHandler(async (req, res) => {
      const { nama_file, data_base64 } = (req.body ?? {}) as { nama_file?: string; data_base64?: string };
      const opsi = bacaOpsiImporBersama(((req.body ?? {}) as { opsi?: Record<string, unknown> }).opsi);
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom: header, baris } = await bacaExcel(buffer);
      if (!baris.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');

      // Judul kolom dibaca otomatis (fuzzy: "SKU"/"Kode SKU", "Satuan"/"Unit",
      // "Jumlah per Satuan Dasar"/"Qty") dari daftar kolom template yang sama.
      const petaKonversi = pemetaanOtomatis(
        [
          { key: 'sku', label: 'SKU' },
          { key: 'satuan', label: 'Satuan' },
          { key: 'jumlah', label: 'Jumlah per Satuan Dasar' },
        ],
        header,
      );
      const iSku = petaKonversi.sku ? header.indexOf(petaKonversi.sku) : -1;
      const iSat = petaKonversi.satuan ? header.indexOf(petaKonversi.satuan) : -1;
      const iJml = petaKonversi.jumlah ? header.indexOf(petaKonversi.jumlah) : -1;
      const adaJudul = header.length ? ` (terdeteksi: ${header.join(', ')})` : '';
      if (iSku < 0) throw tolak(400, `Kolom "SKU" tidak ada di file Excel${adaJudul}.`);
      if (iSat < 0) throw tolak(400, `Kolom "Satuan" tidak ada di file Excel${adaJudul}.`);
      if (iJml < 0) throw tolak(400, `Kolom "Jumlah per Satuan Dasar" tidak ada di file Excel${adaJudul}.`);

      const pengguna = penggunaSaatIni(req);
      const kumpul = new PengumpulImpor();
      const pantau = new PemantauUnik('Kombinasi SKU + satuan');
      const siap: { product_id: number; unit_id: number; jumlah: number; ada: boolean; lama: Record<string, unknown> | null; nomor: number }[] = [];
      const unitBaru: { id: number; kode: string; nama: string }[] = [];

      cetakDebugImpor('konversi/impor', baris, (b) => {
        if (!teksKode(b.sku)) throw new GalatImpor('sku', 'SKU wajib diisi.', b.sku);
        if (!teksKode(b.satuan)) throw new GalatImpor('satuan', 'Satuan wajib diisi.', b.satuan);
        const j = angkaToleran(b.jumlah, 'Jumlah');
        if (j === null || j <= 0) throw new GalatImpor('jumlah', 'Jumlah per satuan dasar harus lebih dari 0.', b.jumlah);
      });

      for (const [idxBaris, raw] of baris.entries()) {
        const nomor = nomorBaris(idxBaris);
        try {
          const sku = teksKode(raw[header[iSku]]);
          if (!sku) throw new GalatImpor('sku', 'SKU wajib diisi.', raw[header[iSku]]);
          const produk = await get<{ id: number }>(`SELECT id FROM products WHERE sku ILIKE ? AND deleted_at IS NULL`, sku);
          if (!produk) throw new GalatImpor('sku', `SKU "${sku}" tidak ditemukan.`, sku);

          const satuanRaw = teksBersih(raw[header[iSat]]);
          if (!satuanRaw) throw new GalatImpor('satuan', 'Satuan wajib diisi.', raw[header[iSat]]);
          const unit = await get<{ id: number }>(
            `SELECT id FROM units WHERE kode ILIKE ? OR nama ILIKE ?`,
            satuanRaw,
            satuanRaw,
          );
          let unitId: number;
          if (unit) {
            unitId = Number(unit.id);
          } else if (opsi.buat_otomatis) {
            const kodeUnit = teksKode(satuanRaw).toUpperCase().slice(0, 10);
            unitId = Number(await ((await run(`INSERT INTO units (kode, nama) VALUES (?, ?)`, kodeUnit, satuanRaw))).lastInsertRowid);
            unitBaru.push({ id: unitId, kode: kodeUnit, nama: satuanRaw });
            kumpul.ingatkan(nomor, 'satuan', `Satuan "${satuanRaw}" belum ada — akan dibuat otomatis.`);
          } else {
            throw new GalatImpor('satuan', `Satuan "${satuanRaw}" belum ada — buat dulu di menu Satuan.`, satuanRaw);
          }

          const jumlah = angkaToleran(raw[header[iJml]], 'Jumlah per satuan dasar');
          if (jumlah === null || jumlah <= 0) {
            throw new GalatImpor('jumlah', 'Jumlah per satuan dasar harus lebih dari 0.', raw[header[iJml]]);
          }

          const dasarId = await ((await get<{ satuan_dasar_id: number | null }>(`SELECT satuan_dasar_id FROM products WHERE id = ?`, Number(produk.id))))?.satuan_dasar_id;
          if (Number(dasarId) === unitId) {
            throw new GalatImpor('satuan', `Satuan konversi "${satuanRaw}" sama dengan satuan dasar produk "${sku}".`, satuanRaw);
          }

          pantau.cek(`${sku} + ${satuanRaw}`, nomor, 'satuan');

          const lama = await get<Record<string, unknown>>(
            `SELECT * FROM unit_conversions WHERE product_id = ? AND unit_id = ?`,
            Number(produk.id),
            unitId,
          );
          if (lama && !opsi.perbarui) {
            kumpul.ingatkan(nomor, 'sku', `Konversi "${sku}" + "${satuanRaw}" sudah ada — baris dilewati (opsi perbarui mati).`);
            continue;
          }
          siap.push({
            product_id: Number(produk.id),
            unit_id: unitId,
            jumlah,
            ada: !!lama,
            lama: lama ?? null,
            nomor,
          });
        } catch (err) {
          kumpul.tolakDari(err, nomor, {
            sku: raw[header[iSku]],
            satuan: raw[header[iSat]],
            jumlah: raw[header[iJml]],
          });
        }
      }

      if (!opsi.lewati_error && kumpul.jumlahError) {
        throw tolak(
          400,
          `Terdapat ${kumpul.jumlahError} baris error dan opsi "Lewati baris yang error" dimatikan — impor dibatalkan.`,
        );
      }

      const batch = await ((await run(
        `INSERT INTO import_batches (modul, nama_file, total_baris, status, user_id) VALUES ('konversi', ?, ?, 'diproses', ?)`,
        nama_file ?? 'impor-konversi.xlsx',
        baris.length,
        pengguna.id,
      ))).lastInsertRowid;

      const jejak: JejakUrung[] = [];
      // Satuan buatan baris ini ikut jejak agar ikut terhapus saat diurungkan.
      for (const u of unitBaru) jejak.push({ aksi: 'tambah', tabel: 'units', id: u.id });
      await withTransaction(async () => {
        for (const s of siap) {
          await run(
            `INSERT INTO unit_conversions (product_id, unit_id, jumlah_per_satuan_dasar) VALUES (?, ?, ?)
             ON CONFLICT (product_id, unit_id) DO UPDATE SET jumlah_per_satuan_dasar = excluded.jumlah_per_satuan_dasar`,
            s.product_id,
            s.unit_id,
            s.jumlah,
          );
          const barisBaru = (await get<{ id: number }>(
            `SELECT id FROM unit_conversions WHERE product_id = ? AND unit_id = ?`,
            s.product_id,
            s.unit_id,
          ))! as { id: number };
          await catatAudit({
            userId: pengguna.id,
            aksi: s.ada ? 'ubah' : 'tambah',
            tabel: 'unit_conversions',
            recordId: barisBaru.id,
            sebelum: s.lama,
            sesudah: { product_id: s.product_id, unit_id: s.unit_id, jumlah_per_satuan_dasar: s.jumlah },
          });
          if (s.ada) jejak.push({ aksi: 'perbarui', tabel: 'unit_conversions', id: barisBaru.id, sebelum: s.lama });
          else jejak.push({ aksi: 'tambah', tabel: 'unit_conversions', id: barisBaru.id });
        }
        for (const u of unitBaru) {
          await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'units', recordId: u.id, sesudah: u });
        }
        await simpanErrorBatch(Number(batch), kumpul.kesalahan);
        await run(
          `UPDATE import_batches SET baris_valid = ?, baris_error = ?, status = ?, undo_data = ? WHERE id = ?`,
          siap.length,
          kumpul.jumlahError,
          siap.length === 0 ? 'gagal' : 'selesai',
          jejakUrungAman(jejak),
          Number(batch),
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'impor',
          tabel: 'unit_conversions',
          recordId: Number(batch),
          sesudah: {
            nama_file: nama_file ?? 'impor-konversi.xlsx',
            baris_valid: siap.length,
            baris_error: kumpul.jumlahError,
          },
        });
      });

      const jumlahBaru = siap.filter((s) => !s.ada).length;
      res.json({
        batch_id: Number(batch),
        total_baris: baris.length,
        baris_valid: siap.length,
        baris_dilewati: Math.max(0, baris.length - siap.length - kumpul.jumlahError),
        baris_error: kumpul.jumlahError,
        jumlah_baru: jumlahBaru,
        jumlah_perbarui: siap.length - jumlahBaru,
        errors: kumpul.kesalahan,
        ringkasan: kumpul.ringkas(),
        peringatan: kumpul.peringatan,
        urungkan_tersedia: jejak.length > 0,
      });
    }),
  );

  // AB3 — Urungkan impor konversi.
  r.post('/impor/urungkan', urungkanBatch(['konversi']));

  // Daftar
  r.get('/', async (req, res) => {
    const p = bacaPaginasi(req, { urutBawaan: 'produk_nama', urutDiizinkan: ['produk_nama', 'sku', 'unit_nama', 'jumlah'] });
    const { where, params } = syaratCari(req);

    const total = Number(
      await ((await get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM unit_conversions uc
         JOIN products p ON p.id = uc.product_id
         JOIN units u ON u.id = uc.unit_id ${where}`,
        ...params,
      )))?.n ?? 0,
    );
    const data = await all<Record<string, unknown>>(
      `${SELECT_KONVERSI} ${where} ORDER BY ${p.urut === 'jumlah' ? 'uc.jumlah_per_satuan_dasar' : p.urut} ${p.arah}
       LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );
    res.json({ data, total, hal: p.hal, per: p.per });
  });

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const product_id = Number(body.product_id);
      const unit_id = Number(body.unit_id);
      const jumlah = angkaNilai(body.jumlah_per_satuan_dasar, 'Jumlah per satuan dasar', { min: 0.0001, wajib: true });
      const pengguna = penggunaSaatIni(req);

      if (!await get<{ id: number }>('SELECT id FROM products WHERE id = ?', product_id)) throw tolak(400, 'Produk tidak ditemukan.');
      if (!await get<{ id: number }>('SELECT id FROM units WHERE id = ?', unit_id)) throw tolak(400, 'Satuan tidak ditemukan.');
      if (unit_id === Number(await ((await get<{ satuan_dasar_id: number | null }>('SELECT satuan_dasar_id FROM products WHERE id = ?', product_id)))?.satuan_dasar_id)) {
        throw tolak(400, 'Satuan konversi tidak boleh sama dengan satuan dasar produk.');
      }

      const lama = await get<Record<string, unknown>>(`SELECT * FROM unit_conversions WHERE product_id = ? AND unit_id = ?`, product_id, unit_id);
      const id = await withTransaction(async () => {
        await run(
          `INSERT INTO unit_conversions (product_id, unit_id, jumlah_per_satuan_dasar) VALUES (?, ?, ?)
           ON CONFLICT (product_id, unit_id) DO UPDATE SET jumlah_per_satuan_dasar = excluded.jumlah_per_satuan_dasar`,
          product_id,
          unit_id,
          jumlah,
        );
        const baris = (await get<{ id: number }>(`SELECT id FROM unit_conversions WHERE product_id = ? AND unit_id = ?`, product_id, unit_id))!
        await catatAudit({
          userId: pengguna.id,
          aksi: lama ? 'ubah' : 'tambah',
          tabel: 'unit_conversions',
          recordId: baris.id,
          sebelum: lama,
          sesudah: { product_id, unit_id, jumlah_per_satuan_dasar: jumlah },
        });
        return baris.id;
      });
      res.status(lama ? 200 : 201).json({ id });
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM unit_conversions WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Konversi tidak ditemukan.');
      await withTransaction(async () => {
        await run(`DELETE FROM unit_conversions WHERE id = ?`, id);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'unit_conversions', recordId: id, sebelum: lama });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
