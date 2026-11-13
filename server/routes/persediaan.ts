// ============================================================================
// MODUL PERSEDIAAN SUB — Item Masuk (tambah stok) & Item Keluar (kurang stok)
//
// Rute:
//   GET    /          daftar dokumen riwayat (filter arah + cari + urut A-Z/Z-A)
//   GET    /meta      nomor dokumen berikutnya (pratinjau) + daftar alasan
//   GET    /stok      stok per gudang untuk daftar product_id (baris bentrok gudang)
//   GET    /ekspor    unduh Excel (.xlsx) sesuai filter riwayat
//   GET    /template  contoh file impor sesuai kolom modul (+ lembar petunjuk)
//   GET    /:id       detail dokumen + item
//   POST   /          buat dokumen + langsung ubah stok (transaksi atomik)
//   POST   /impor     impor massal Excel: satu baris = satu item, baris dengan
//                     Tanggal+Gudang+Alasan+Keterangan sama → satu dokumen
//   POST   /:id/batal batalkan dokumen: pergerakan dibalik, stok kembali otomatis
//
// Perubahan stok SELALU lewat ubahStok() (server/lib/stok.ts) dengan
// tipe_dokumen 'penyesuaian' dan dokumen_id = id dokumen ini — stock_ledger
// (riwayat per produk) ikut tercatat tanpa mengubah CHECK tipe_dokumen.
// Dokumen yang dibatalkan dihapus permanen (kebijakan No Retain) setelah
// pergerakan stoknya dibalik — tidak menyisakan log berstatus "batal".
// ============================================================================

import { Router, type Request } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, pesanKesalahan, polaCari, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { nomorOtomatis, pratinjauNomor as pratinjauNomorPengaturan } from '../lib/pengaturanBaru.ts';
import { penggunaSaatIni } from '../lib/akses.ts'; 
import { klausaGudangOtomatis, wajibGudangDiizinkan, wajibSel } from '../lib/hak.ts';
import { bacaSaldo, ubahStok } from '../lib/stok.ts';
import { bacaExcel, tulisExcel, tulisExcelMulti } from '../lib/excel.ts';
import { hapusSubStockPermanen } from '../lib/pembersihanTransaksi.ts';
import {
  PengumpulImpor,
  angkaToleran,
  bacaOpsiImpor,
  cetakDebugImpor,
  nomorBaris,
  simpanErrorBatch,
  teksBersih,
  teksKode,
  tanggalToleran,
} from '../lib/imporBersama.ts';

export type Arah = 'masuk' | 'keluar';

/** Daftar alasan dokumen — satu sumber kebenaran untuk server & client (/meta). */
export const ALASAN: Record<Arah, { kode: string; label: string }[]> = {
  masuk: [
    { kode: 'stok_awal', label: 'Stok Awal' },
    { kode: 'temuan', label: 'Temuan' },
    { kode: 'koreksi_pos', label: 'Koreksi (+)' },
    { kode: 'lainnya', label: 'Lainnya' },
  ],
  keluar: [
    { kode: 'rusak', label: 'Rusak' },
    { kode: 'hilang', label: 'Hilang' },
    { kode: 'sampel', label: 'Sampel' },
    { kode: 'koreksi_neg', label: 'Koreksi (-)' },
    { kode: 'lainnya', label: 'Lainnya' },
  ],
};

const PREFIX: Record<Arah, string> = { masuk: 'PSM', keluar: 'PSK' };
/** tipe_dokumen di stock_ledger — nilai CHECK yang sudah ada, tidak ditambah. */
const TIPE = 'penyesuaian';

const STATUS_LABEL: Record<string, string> = { disahkan: 'Tersimpan', batal: 'Dibatalkan' };

const KOLOM_URUT = new Set(['no_dokumen', 'tanggal', 'dibuat_pada']);

interface BarisDok {
  id: number;
  no_dokumen: string;
  arah: Arah;
  warehouse_id: number;
  gudang_kode: string | null;
  gudang_nama: string;
  tanggal: string;
  alasan: string;
  alasan_label: string;
  keterangan: string | null;
  status: string;
  status_label: string;
  total_qty: number;
  jumlah_item: number;
  dibuat_pada: string;
  dibatalkan_pada: string | null;
  alasan_batal: string | null;
}

const Q_DOK = `SELECT d.*, w.kode AS gudang_kode, w.nama AS gudang_nama,
    (SELECT COUNT(*) FROM sub_stock_items i WHERE i.doc_id = d.id) AS jumlah_item
  FROM sub_stock_docs d
  JOIN warehouses w ON w.id = d.warehouse_id`;

function labelAlasan(arah: Arah, kode: string): string {
  return ALASAN[arah].find((a) => a.kode === kode)?.label ?? kode;
}

function tampil(r: Record<string, unknown>): BarisDok {
  const arah = String(r.arah) as Arah;
  const status = String(r.status);
  return {
    id: Number(r.id),
    no_dokumen: String(r.no_dokumen),
    arah,
    warehouse_id: Number(r.warehouse_id),
    gudang_kode: (r.gudang_kode as string | null) ?? null,
    gudang_nama: String(r.gudang_nama),
    tanggal: String(r.tanggal),
    alasan: String(r.alasan),
    alasan_label: labelAlasan(arah, String(r.alasan)),
    keterangan: (r.keterangan as string | null) ?? null,
    status,
    status_label: STATUS_LABEL[status] ?? status,
    total_qty: Number(r.total_qty),
    jumlah_item: Number(r.jumlah_item),
    dibuat_pada: String(r.dibuat_pada),
    dibatalkan_pada: (r.dibatalkan_pada as string | null) ?? null,
    alasan_batal: (r.alasan_batal as string | null) ?? null,
  };
}

function cekArah(v: unknown): Arah {
  if (v === 'masuk' || v === 'keluar') return v;
  throw tolak(400, 'Parameter arah wajib: masuk | keluar.');
}

function idDok(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'Nomor dokumen tidak valid.');
  return id;
}

/** Pratinjau nomor berikutnya TANPA mengurangi counter (read-only). */
async function pratinjauNomor(arah: Arah): Promise<string> {
  return await pratinjauNomorPengaturan(arah === 'masuk' ? 'item_masuk' : 'item_keluar');
}

/** Filter riwayat dipakai bersama oleh daftar, ekspor, dan cetak. */
async function filterRiwayat(query: Record<string, unknown>, req?: import('express').Request): Promise<{ syarat: string[]; params: unknown[] }> {
  const arah = cekArah(query.arah);
  const syarat = ['d.arah = ?'];
  const params: unknown[] = [arah];
  const cari = String(query.cari ?? '').trim();
  if (cari) {
    // Kurung WAJIB: agar tidak bocor ke kondisi OR di rantai filter berikutnya.
    syarat.push(`(d.no_dokumen ILIKE ? ESCAPE '\\' OR d.keterangan ILIKE ? ESCAPE '\\')`);
    params.push(polaCari(cari), polaCari(cari));
  }
  const gudang = Number(query.gudang ?? 0);
  if (Number.isInteger(gudang) && gudang > 0) {
    syarat.push('d.warehouse_id = ?');
    params.push(gudang);
  } else if (req) {
    // ISOLASI: tanpa filter eksplisit, kunci ke gudang sesi.
    const auto = await klausaGudangOtomatis(req, 'd.warehouse_id');
    if (auto) syarat.push(`1 = 1${auto}`);
  }
  const status = String(query.status ?? '');
  if (status === 'disahkan' || status === 'batal') {
    syarat.push('d.status = ?');
    params.push(status);
  }
  const ids = String(query.ids ?? '')
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length > 0) {
    syarat.push(`d.id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }
  return { syarat, params };
}

/** Satu baris impor = satu item; baris berheader sama digabung jadi satu dokumen. */
interface BarisImpor {
  nomor: number;
  tanggal: string;
  gudang_id: number;
  gudang_kode: string;
  alasan: string;
  keterangan: string;
  kode: string;
  qty: number;
}

function teks(v: unknown): string {
  if (v instanceof Date) {
    const b = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${b(v.getMonth() + 1)}-${b(v.getDate())}`;
  }
  return String(v ?? '').trim();
}

/** Normalisasi pencocokan teks: lower-case, strip dipakai-dash, rapikan spasi. */
function normTeks(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function routerPersediaan() {
  const r = Router();

  // --- Pratinjau nomor + daftar alasan --------------------------------------
  r.get(
    '/meta',
    asyncHandler(async (_req, res) => {
      res.json({
        data: {
          nomor: { masuk: await pratinjauNomor('masuk'), keluar: await pratinjauNomor('keluar') },
          alasan: ALASAN,
          prefix: PREFIX,
        },
      });
    }),
  );

  // --- Stok terkini per gudang untuk daftar product_id (pembaruan baris) -----
  r.get(
    '/stok',
    asyncHandler(async (req, res) => {
      const warehouseId = Number(req.query.gudang ?? 0);
      if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
        throw tolak(400, 'Parameter gudang wajib diisi.');
      }
      // ISOLASI BACA: gudang di luar cakupan sesi → 403.
      await wajibGudangDiizinkan(req, warehouseId);
      const ids = String(req.query.produk ?? '')
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 300);
      if (ids.length === 0) {
        res.json({ data: [] as { product_id: number; qty: number }[] });
        return;
      }
      // Produk tanpa baris saldo pun ikut (qty 0) — form tetap menampilkan stok sebelum.
      const row = await all<{ product_id: number; qty: number; satuan: string | null }>(
        `SELECT p.id AS product_id, COALESCE(SUM(sb.qty), 0) AS qty, u.nama AS satuan
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.warehouse_id = ?
         LEFT JOIN units u ON u.id = p.satuan_dasar_id
         WHERE p.id IN (${ids.map(() => '?').join(', ')})
         GROUP BY p.id, u.nama`,
        warehouseId,
        ...ids,
      );
      res.json({ data: row });
    }),
  );

  // --- Ekspor Excel riwayat ---------------------------------------------------
  r.get(
    '/ekspor',
    asyncHandler(async (req, res) => {
      const arah = cekArah(req.query.arah);
      const { syarat, params } = await filterRiwayat(req.query as Record<string, unknown>, req);
      const rows = await all<Record<string, unknown>>(
        `${Q_DOK} WHERE ${syarat.join(' AND ')} ORDER BY d.no_dokumen ASC`,
        ...params,
      );
      const baris = rows.map((v) => {
        const d = tampil(v);
        return {
          Tanggal: d.tanggal,
          Nomor: d.no_dokumen,
          Gudang: [d.gudang_kode, d.gudang_nama].filter(Boolean).join(' — '),
          Alasan: d.alasan_label,
          Keterangan: d.keterangan ?? '',
          'Jumlah Item': d.jumlah_item,
          'Total Qty': d.total_qty,
          Status: d.status_label,
        };
      });
      const kolom = [
        { key: 'Tanggal', label: 'Tanggal' },
        { key: 'Nomor', label: 'Nomor Dokumen' },
        { key: 'Gudang', label: 'Gudang' },
        { key: 'Alasan', label: 'Alasan' },
        { key: 'Keterangan', label: 'Keterangan' },
        { key: 'Jumlah Item', label: 'Jumlah Item' },
        { key: 'Total Qty', label: 'Total Qty' },
        { key: 'Status', label: 'Status' },
      ];
      const nama = `riwayat-persediaan-sub-${arah}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const buffer = await tulisExcel('Riwayat', kolom, baris);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${nama}"`,
        })
        .send(buffer);
    }),
  );

  // --- Template impor (contoh file sesuai kolom modul) ------------------------
  r.get(
    '/template',
    asyncHandler(async (req, res) => {
      const arah: Arah = req.query.arah === 'keluar' ? 'keluar' : 'masuk';
      const gudang = await get<{ kode: string; nama: string }>(
        'SELECT kode, nama FROM warehouses ORDER BY id LIMIT 1',
      );
      const produk = await get<{ kode_item: string | null; sku: string; nama: string }>(
        'SELECT kode_item, sku, nama FROM products WHERE deleted_at IS NULL ORDER BY id LIMIT 1',
      );
      const kodeProduk = produk?.kode_item || produk?.sku || 'SKU-001';
      const gudangTeks = gudang?.kode || 'GUDANG';
      const hariIni = new Date().toISOString().slice(0, 10);
      const alasanContoh = ALASAN[arah][0].label;
      const kedua = ALASAN[arah][1].label;
      const kolom = [
        { key: 'Tanggal', label: 'Tanggal (yyyy-mm-dd)' },
        { key: 'Gudang', label: 'Gudang (kode/nama)' },
        { key: 'Alasan', label: `Alasan (${arah === 'masuk' ? 'Item Masuk' : 'Item Keluar'})` },
        { key: 'Keterangan', label: 'Keterangan' },
        { key: 'Kode Item', label: 'Kode Item / SKU / Barcode' },
        { key: 'Nama', label: 'Nama Barang (diisi otomatis)' },
        { key: 'Qty', label: 'Qty' },
      ];
      const contoh = [
        { Tanggal: hariIni, Gudang: gudangTeks, Alasan: alasanContoh, Keterangan: 'Contoh — hapus baris ini', 'Kode Item': kodeProduk, Nama: produk?.nama ?? '', Qty: 5 },
        { Tanggal: hariIni, Gudang: gudangTeks, Alasan: alasanContoh, Keterangan: 'Contoh — hapus baris ini', 'Kode Item': kodeProduk, Nama: produk?.nama ?? '', Qty: 2 },
        { Tanggal: hariIni, Gudang: gudangTeks, Alasan: kedua, Keterangan: 'Baris lain = dokumen lain', 'Kode Item': kodeProduk, Nama: produk?.nama ?? '', Qty: 1 },
      ];
      const petunjuk = [
        'PETUNJUK IMPOR PERSEDIAAN SUB',
        '1. Kolom wajib: Gudang, Alasan, Kode Item, Qty. Tanggal kosong = hari ini.',
        '2. Kode Item menerima kode item, SKU, atau barcode produk aktif.',
        `3. Alasan untuk modul ini: ${ALASAN[arah].map((a) => a.label).join(', ')}.`,
        '4. Baris dengan Tanggal + Gudang + Alasan + Keterangan yang sama digabung menjadi SATU dokumen.',
        '5. Keterangan boleh kosong; baris berketerangan berbeda menjadi dokumen terpisah.',
        '6. HAPUS baris contoh berketerangan "Contoh" sebelum impor.',
        `7. Dokumen hasil impor bernomor otomatis (${PREFIX[arah]}-tahun-urut) dan langsung mengubah stok.`,
        '8. Baris tidak valid dilaporkan per nomor baris dan tidak diimpor. Jika stok tidak mencukupi saat penyimpanan, seluruh dokumen kelompok itu dilewati dengan pesan kesalahan.',
      ];
      const nama = `contoh-impor-persediaan-${arah}.xlsx`;
      const buffer = await tulisExcelMulti([
        { judul: 'Data', kolom, baris: contoh },
        {
          judul: 'Petunjuk',
          kolom: [{ key: 'isi', label: 'Petunjuk' }],
          baris: petunjuk.map((isi) => ({ isi })),
        },
      ]);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${nama}"`,
        })
        .send(buffer);
    }),
  );

  // --- Daftar riwayat ---------------------------------------------------------
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const hal = Math.max(1, Number.parseInt(String(req.query.hal ?? '1'), 10) || 1);
      const per = Math.min(100, Math.max(5, Number.parseInt(String(req.query.per ?? '10'), 10) || 10));
      const urutMinta = String(req.query.urut ?? 'no_dokumen');
      const urut = KOLOM_URUT.has(urutMinta) ? urutMinta : 'no_dokumen';
      const arahUrut = String(req.query.arah_urut ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      const { syarat, params } = await filterRiwayat(req.query as Record<string, unknown>, req);
      const where = syarat.join(' AND ');
      const total = Number(
        await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM sub_stock_docs d WHERE ${where}`, ...params)))?.n ?? 0,
      );
      const rows = await all<Record<string, unknown>>(
        `${Q_DOK} WHERE ${where} ORDER BY d.${urut} ${arahUrut}, d.id ${arahUrut} LIMIT ? OFFSET ?`,
        ...params,
        per,
        (hal - 1) * per,
      );
      res.json({ data: rows.map(tampil), total, hal, per });
    }),
  );

  // --- Detail dokumen ---------------------------------------------------------
  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idDok(req);
      const row = await get<Record<string, unknown>>(`${Q_DOK} WHERE d.id = ?`, id);
      if (!row) throw tolak(404, 'Dokumen tidak ditemukan.');
      if (!req.konteks?.admin) await wajibGudangDiizinkan(req, Number(row.warehouse_id));
      const items = await all<Record<string, unknown>>(
        `SELECT i.id, i.product_id, i.qty, i.satuan, i.stok_sebelum, i.stok_sesudah,
                p.kode_item, p.sku, p.nama AS produk, p.barcode
         FROM sub_stock_items i JOIN products p ON p.id = i.product_id
         WHERE i.doc_id = ? ORDER BY i.id`,
        id,
      );
      res.json({
        data: {
          dokumen: tampil(row),
          item: items.map((v) => ({
            id: Number(v.id),
            product_id: Number(v.product_id),
            kode_item: (v.kode_item as string | null) ?? v.sku,
            nama: String(v.produk),
            barcode: (v.barcode as string | null) ?? null,
            qty: Number(v.qty),
            satuan: (v.satuan as string | null) ?? null,
            stok_sebelum: Number(v.stok_sebelum),
            stok_sesudah: Number(v.stok_sesudah),
          })),
        },
      });
    }),
  );

  // --- Buat dokumen + ubah stok ------------------------------------------------
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const arah = cekArah(body.arah);
      const warehouseId = Number(body.warehouse_id ?? 0);
      if (!Number.isInteger(warehouseId) || warehouseId <= 0) throw tolak(400, 'Gudang wajib dipilih.');
      const gudang = await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', warehouseId);
      if (!gudang) throw tolak(400, 'Gudang tidak ditemukan.');
      // ISOLASI TULIS: gudang dokumen harus di dalam cakupan sesi.
      await wajibGudangDiizinkan(req, warehouseId);

      const tanggal = teks(body.tanggal) || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw tolak(400, 'Tanggal tidak valid (pakai yyyy-mm-dd).');

      const alasan = String(body.alasan ?? '');
      const daftarAlasan = ALASAN[arah];
      if (!daftarAlasan.some((a) => a.kode === alasan)) {
        throw tolak(400, `Alasan tidak valid untuk Item ${arah === 'masuk' ? 'Masuk' : 'Keluar'}.`);
      }
      const keterangan = teks(body.keterangan) || null;
      if (alasan === 'lainnya' && !keterangan) throw tolak(400, 'Keterangan wajib diisi untuk alasan Lainnya.');

      const itemMinta = Array.isArray(body.items) ? body.items : [];
      if (itemMinta.length === 0) throw tolak(400, 'Dokumen belum berisi barang.');
      if (itemMinta.length > 500) throw tolak(400, 'Maksimal 500 baris per dokumen.');

      // Validasi item + kumpulkan kebutuhan; snapshot stok dihitung di dalam transaksi.
      const idProduk = new Set<number>();
      const siap: { product_id: number; qty: number; satuan: string | null }[] = [];
      for (const v of itemMinta) {
        const it = (v ?? {}) as Record<string, unknown>;
        const pid = Number(it.product_id);
        const qty = Number(it.qty);
        if (!Number.isInteger(pid) || pid <= 0) throw tolak(400, 'Barang tidak valid.');
        if (idProduk.has(pid)) throw tolak(409, 'Barang duplikat dalam satu dokumen.');
        idProduk.add(pid);
        if (!Number.isFinite(qty) || qty <= 0) throw tolak(400, 'Qty harus lebih dari 0.');
        const p = await get<{ id: number }>(
          'SELECT id FROM products WHERE id = ? AND deleted_at IS NULL',
          pid,
        );
        if (!p) throw tolak(400, 'Barang tidak ditemukan.');
        // ISOLASI GUDANG MUTLAK — Item Masuk/Keluar hanya untuk barang yang
        // terdaftar (punya relasi saldo) di gudang dokumen. Produk baru untuk
        // gudang ini wajib ditempatkan dulu via Master › Produk (kolom Gudang).
        if (!await get<{ product_id: number }>('SELECT product_id FROM stock_balances WHERE product_id = ? AND warehouse_id = ?', pid, warehouseId)) {
          const namaGudang = await ((await get<{ nama: string }>('SELECT nama FROM warehouses WHERE id = ?', warehouseId)))?.nama ?? 'gudang terpilih';
          throw tolak(400, `Barang ini tidak terdaftar di ${namaGudang}.`);
        }
        const satuan = await get<{ nama: string }>(
          'SELECT u.nama FROM products p JOIN units u ON u.id = p.satuan_dasar_id WHERE p.id = ?',
          pid,
        );
        siap.push({ product_id: pid, qty, satuan: satuan?.nama ?? null });
      }

      const pengguna = penggunaSaatIni(req);
      const tahun = tanggal.slice(0, 4);
      let id = 0;
      await withTransaction(async () => {
        const noDok = await nomorOtomatis(arah === 'masuk' ? 'item_masuk' : 'item_keluar', `${tahun}-01-01`);
        const h = await run(
          `INSERT INTO sub_stock_docs
             (no_dokumen, arah, warehouse_id, tanggal, alasan, keterangan, status,
              total_qty, jumlah_item, dibuat_oleh)
           VALUES (?, ?, ?, ?, ?, ?, 'disahkan', ?, ?, ?)`,
          noDok,
          arah,
          warehouseId,
          tanggal,
          alasan,
          keterangan,
          siap.reduce((t, s) => t + s.qty, 0),
          siap.length,
          pengguna?.id ?? null,
        );
        id = Number(h.lastInsertRowid);
        for (const s of siap) {
          const sebelum = (await bacaSaldo(s.product_id, warehouseId)).qty;
          if (arah === 'masuk') {
            // Valuasi barang masuk memakai harga beli terakhir (bila ada).
            const hb = await get<{ harga_beli: number }>('SELECT harga_beli FROM products WHERE id = ?', s.product_id);
            const hargaMasuk = hb && hb.harga_beli > 0 ? hb.harga_beli : undefined;
            await ubahStok({
              productId: s.product_id,
              warehouseId,
              masuk: s.qty,
              hargaMasuk,
              tipeDokumen: TIPE,
              dokumenId: id,
              userId: pengguna?.id ?? undefined,
            });
          } else {
            await ubahStok({
              productId: s.product_id,
              warehouseId,
              keluar: s.qty,
              tipeDokumen: TIPE,
              dokumenId: id,
              userId: pengguna?.id ?? undefined,
            });
          }
          await run(
            `INSERT INTO sub_stock_items (doc_id, product_id, qty, satuan, stok_sebelum, stok_sesudah)
             VALUES (?, ?, ?, ?, ?, ?)`,
            id,
            s.product_id,
            s.qty,
            s.satuan,
            sebelum,
            (await bacaSaldo(s.product_id, warehouseId)).qty,
          );
        }
        await catatAudit({
          userId: pengguna?.id ?? null,
          aksi: 'tambah',
          tabel: 'sub_stock_docs',
          recordId: id,
          sesudah: { no_dokumen: noDok, arah, warehouse_id: warehouseId, alasan, tanggal, jumlah_item: siap.length },
        });
      });

      const row = await get<Record<string, unknown>>(`${Q_DOK} WHERE d.id = ?`, id);
      res.status(201).json({ data: row ? tampil(row) : null });
    }),
  );

  // --- Impor massal Excel -------------------------------------------------------
  r.post(
    '/impor',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const arah = cekArah(body.arah);
      const namaFile = teks(body.nama_file) || 'impor.xlsx';
      const data = teks(body.data_base64);
      if (!data) throw tolak(400, 'File Excel belum dipilih.');
      if (data.length > 20_000_000) throw tolak(413, 'File terlalu besar (maks 15 MB).');

      let lembar: Record<string, unknown>[];
      try {
        const buffer = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
        lembar = (await bacaExcel(buffer)).baris;
      } catch (e) {
        throw tolak(400, `Gagal membaca Excel: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (lembar.length === 0) throw tolak(400, 'File tidak berisi baris data.');
      if (lembar.length > 2000) throw tolak(400, 'Maksimal 2000 baris per impor.');

      // Peta pemetaan: gudang (kode, nama, dan label dropdown "KODE — Nama"), alasan, produk.
      const petaGudang = new Map<string, number>();
      for (const g of await all<{ id: number; kode: string; nama: string }>('SELECT id, kode, nama FROM warehouses')) {
        petaGudang.set(normTeks(g.kode), g.id);
        petaGudang.set(normTeks(g.nama), g.id);
        petaGudang.set(normTeks(`${g.kode} — ${g.nama}`), g.id);
      }
      const petaAlasan = new Map<string, string>();
      for (const a of ALASAN[arah]) {
        petaAlasan.set(a.kode.toLowerCase(), a.kode);
        petaAlasan.set(a.label.toLowerCase().replace(/−/g, '-'), a.kode);
      }
      const petaProduk = new Map<string, { id: number; nama: string }>();
      for (const p of await all<{ id: number; kode_item: string | null; sku: string; barcode: string | null; nama: string }>(
        'SELECT id, kode_item, sku, barcode, nama FROM products WHERE deleted_at IS NULL',
      )) {
        for (const k of [p.kode_item, p.sku, p.barcode]) {
          if (k) petaProduk.set(k.toLowerCase(), { id: p.id, nama: p.nama });
        }
      }

      // Mesin bersama (AB2): opsi wizard, pengumpul error berkonteks + ringkasan alasan.
      const opsi = bacaOpsiImpor((body.opsi && typeof body.opsi === 'object' ? body.opsi : body) as Record<string, unknown>);
      const kumpul = new PengumpulImpor();
      const hariIni = new Date().toISOString().slice(0, 10);
      const baris: BarisImpor[] = [];
      cetakDebugImpor(`persediaan-${arah}/impor`, lembar);
      for (const [i, v] of lembar.entries()) {
        const nomor = nomorBaris(i); // baris 1 = judul
        const ambil = (kunci: string) =>
          teksBersih(v[kunci] ?? v[kunci.toLowerCase()] ?? v[kunci.toUpperCase()]);
        const kode = teksKode(ambil('Kode Item')) || teksKode(ambil('SKU')) || teksKode(ambil('Barcode'));
        const qtyRaw = v['Qty'] ?? v['qty'];
        const gudangTeks = ambil('Gudang');
        const alasanTeks = ambil('Alasan');

        if (!gudangTeks && !alasanTeks && !kode && !teksBersih(qtyRaw)) continue; // baris kosong dilewati

        let lulus = true;

        // Gudang: normalisasi + kunci ke cakupan sesi (Gudang A ≠ Gudang B).
        let gudangId = petaGudang.get(normTeks(gudangTeks));
        if (gudangId && !req.konteks?.admin) {
          try { await wajibGudangDiizinkan(req, gudangId); }
          catch {
            kumpul.tolak(nomor, 'Gudang', `Gudang "${gudangTeks}" di luar hak akses Anda.`, gudangTeks);
            lulus = false;
          }
        }
        // Pengguna terbatas TIDAK boleh membuat gudang baru via impor (perluasan cakupan).
        if (!gudangId && gudangTeks && opsi.buat_otomatis && !req.konteks?.admin) {
          kumpul.tolak(nomor, 'Gudang', `Gudang "${gudangTeks}" tidak ada dalam hak akses Anda — minta Admin membuatnya.`, gudangTeks);
          lulus = false;
        }
        if (!gudangId && gudangTeks && opsi.buat_otomatis && req.konteks?.admin) {
          const kodeGudang = teksKode(gudangTeks).toUpperCase().slice(0, 20);
          gudangId = Number(await ((await run(`INSERT INTO warehouses (kode, nama) VALUES (?, ?)`, kodeGudang, gudangTeks))).lastInsertRowid);
          petaGudang.set(normTeks(gudangTeks), gudangId);
          kumpul.ingatkan(nomor, 'Gudang', `Gudang "${gudangTeks}" belum ada — akan dibuat otomatis.`);
          await catatAudit({
            userId: penggunaSaatIni(req).id,
            aksi: 'tambah',
            tabel: 'warehouses',
            recordId: gudangId,
            sesudah: { kode: kodeGudang, nama: gudangTeks },
          });
        }
        if (!gudangId) {
          kumpul.tolak(nomor, 'Gudang', `Gudang "${gudangTeks || '(kosong)'}" tidak ditemukan.`, gudangTeks);
          lulus = false;
        }

        const alasanKode = petaAlasan.get(alasanTeks.toLowerCase().replace(/−/g, '-'));
        if (!alasanKode) {
          kumpul.tolak(nomor, 'Alasan', `Alasan "${alasanTeks || '(kosong)'}" tidak valid untuk arah ${arah}.`, alasanTeks);
          lulus = false;
        }

        const produk = petaProduk.get(kode.toLowerCase());
        if (!produk) {
          kumpul.tolak(nomor, 'Kode Item', `Barang "${kode || '(kosong)'}" tidak ditemukan.`, kode);
          lulus = false;
        }

        let qty: number | null = null;
        try {
          qty = angkaToleran(qtyRaw, 'Qty');
        } catch (e) {
          kumpul.tolakDari(e, nomor, { Qty: qtyRaw });
          lulus = false;
        }
        if (qty !== null && !(qty > 0)) {
          kumpul.tolak(nomor, 'Qty', 'Qty harus lebih dari 0.', qtyRaw);
          lulus = false;
        }

        let tanggal = hariIni;
        try {
          const tRaw = v['Tanggal'] ?? v['tanggal'] ?? v['TANGGAL'];
          const t = tanggalToleran(tRaw ?? null, 'Tanggal');
          if (t) tanggal = t;
        } catch (e) {
          kumpul.tolakDari(e, nomor, { Tanggal: v['Tanggal'] ?? v['tanggal'] });
          lulus = false;
        }

        if (!lulus || qty === null || !gudangId || !alasanKode || !produk) continue;
        baris.push({
          nomor,
          tanggal,
          gudang_id: gudangId,
          gudang_kode: gudangTeks,
          alasan: alasanKode,
          keterangan: ambil('Keterangan'),
          kode,
          qty,
        });
      }

      // Kelompokkan baris: header sama → satu dokumen.
      const kelompok = new Map<string, BarisImpor[]>();
      const urutKelompok: string[] = [];
      for (const b of baris) {
        const kunci = `${b.tanggal}|${b.gudang_id}|${b.alasan}|${b.keterangan}`;
        if (!kelompok.has(kunci)) {
          kelompok.set(kunci, []);
          urutKelompok.push(kunci);
        }
        kelompok.get(kunci)!.push(b);
      }

      const pengguna = penggunaSaatIni(req);
      let dokumenDibuat = 0;
      let barisValid = 0;

      for (const kunci of urutKelompok) {
        const grup = kelompok.get(kunci)!;
        // Gabungkan duplikat produk dalam satu dokumen.
        const gabung = new Map<string, BarisImpor & { qty: number }>();
        for (const b of grup) {
          const prev = gabung.get(b.kode.toLowerCase());
          if (prev) prev.qty += b.qty;
          else gabung.set(b.kode.toLowerCase(), { ...b });
        }
        const gudangId = grup[0].gudang_id;
        try {
          await withTransaction(async () => {
            const tahun = grup[0].tanggal.slice(0, 4);
            const noDok = await nomorOtomatis(arah === 'masuk' ? 'item_masuk' : 'item_keluar', `${tahun}-01-01`);
            const total = [...gabung.values()].reduce((t, s) => t + s.qty, 0);
            const h = await run(
              `INSERT INTO sub_stock_docs
                 (no_dokumen, arah, warehouse_id, tanggal, alasan, keterangan, status, total_qty, jumlah_item, dibuat_oleh)
               VALUES (?, ?, ?, ?, ?, ?, 'disahkan', ?, ?, ?)`,
              noDok,
              arah,
              gudangId,
              grup[0].tanggal,
              grup[0].alasan,
              grup[0].keterangan || null,
              total,
              gabung.size,
              pengguna?.id ?? null,
            );
            const docId = Number(h.lastInsertRowid);
            for (const s of gabung.values()) {
              const produk = petaProduk.get(s.kode.toLowerCase())!;
              const sebelum = (await bacaSaldo(produk.id, gudangId)).qty;
              const satuan = await get<{ nama: string }>(
                'SELECT u.nama FROM products p JOIN units u ON u.id = p.satuan_dasar_id WHERE p.id = ?',
                produk.id,
              );
              await run(
                `INSERT INTO sub_stock_items (doc_id, product_id, qty, satuan, stok_sebelum, stok_sesudah)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                docId,
                produk.id,
                s.qty,
                satuan?.nama ?? null,
                sebelum,
                arah === 'masuk' ? sebelum + s.qty : sebelum - s.qty,
              );
              if (arah === 'masuk') {
                const hb = await get<{ harga_beli: number }>('SELECT harga_beli FROM products WHERE id = ?', produk.id);
                const hargaMasuk = hb && hb.harga_beli > 0 ? hb.harga_beli : undefined;
                await ubahStok({
                  productId: produk.id,
                  warehouseId: gudangId,
                  masuk: s.qty,
                  hargaMasuk,
                  tipeDokumen: TIPE,
                  dokumenId: docId,
                  userId: pengguna?.id ?? undefined,
                });
              } else {
                await ubahStok({
                  productId: produk.id,
                  warehouseId: gudangId,
                  keluar: s.qty,
                  tipeDokumen: TIPE,
                  dokumenId: docId,
                  userId: pengguna?.id ?? undefined,
                });
              }
            }
            await catatAudit({
              userId: pengguna?.id ?? null,
              aksi: 'impor',
              tabel: 'sub_stock_docs',
              recordId: docId,
              sesudah: { sumber: 'impor', nama_file: namaFile, arah, no_dokumen: noDok },
            });
          });
          dokumenDibuat += 1;
          barisValid += grup.length;
        } catch (e) {
          const pesan = pesanKesalahan(e).pesan;
          for (const b of grup) {
            kumpul.tolak(b.nomor, null, `Dokumen dilewati — ${pesan}`);
          }
        }
      }

      const barisError = kumpul.jumlahError;
      const batch = await run(
        'INSERT INTO import_batches (modul, nama_file, total_baris, status, user_id) VALUES (?, ?, ?, ?, ?)',
        `persediaan-${arah}`,
        namaFile,
        lembar.length,
        'diproses',
        pengguna?.id ?? null,
      );
      const batchId = Number(batch.lastInsertRowid);
      await simpanErrorBatch(batchId, kumpul.kesalahan);
      await run(
        'UPDATE import_batches SET baris_valid = ?, baris_error = ?, status = ? WHERE id = ?',
        barisValid,
        barisError,
        barisValid > 0 || barisError === 0 ? 'selesai' : 'gagal',
        batchId,
      );

      res.json({
        data: {
          batch_id: batchId,
          total_baris: lembar.length,
          baris_valid: barisValid,
          baris_dilewati: Math.max(0, lembar.length - barisValid - barisError),
          baris_error: barisError,
          dokumen_dibuat: dokumenDibuat,
          errors: kumpul.kesalahan,
          ringkasan: kumpul.ringkas(),
          peringatan: kumpul.peringatan,
        },
      });
    }),
  );

  // --- Batalkan dokumen (stok dikembalikan otomatis) ----------------------------
  r.post(
    '/:id/batal',
    asyncHandler(async (req, res) => {
      const id = idDok(req);
      // AX2 — batal dokumen Item Masuk/Keluar membalik pergerakan stok yang
      // sudah diposting = sel Hapus DAN Sahkan.
      await wajibSel(req, 'persediaan-sub', 'hapus', 'sahkan');
      const doc = await get<Record<string, unknown>>(`${Q_DOK} WHERE d.id = ?`, id);
      if (!doc) throw tolak(404, 'Dokumen tidak ditemukan.');
      if (!req.konteks?.admin) await wajibGudangDiizinkan(req, Number(doc.warehouse_id));
      if (String(doc.status) === 'batal') throw tolak(409, 'Dokumen sudah pernah dibatalkan.');

      const arah = String(doc.arah) as Arah;
      const warehouseId = Number(doc.warehouse_id);
      const alasanBatal = teks((req.body ?? {}).alasan) || null;
      const item = await all<{ product_id: number; qty: number; stok_sebelum: number; stok_sesudah: number }>(
        'SELECT product_id, qty, stok_sebelum, stok_sesudah FROM sub_stock_items WHERE doc_id = ?',
        id,
      );
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        // FOR UPDATE: kunci dokumen agar dua pembatalan bersamaan tidak
        // membalik stok dua kali (permintaan kedua menunggu lalu 404).
        const kunci = await get<{ id: number }>('SELECT id FROM sub_stock_docs WHERE id = ? FOR UPDATE', id);
        if (!kunci) throw tolak(404, 'Dokumen tidak ditemukan.');
        for (const s of item) {
          if (arah === 'masuk') {
            // Dokumen masuk dibatalkan → kurangi kembali stok yang pernah ditambah.
            await ubahStok({
              productId: s.product_id,
              warehouseId,
              keluar: s.qty,
              tipeDokumen: TIPE,
              dokumenId: id,
              userId: pengguna?.id ?? undefined,
            });
          } else {
            // Dokumen keluar dibatalkan → kembalikan stok dengan valuasi asal.
            const nilai =
              await ((await get<{ rata: number | null }>(
                `SELECT AVG(nilai_unit) AS rata FROM stock_ledger
                 WHERE product_id = ? AND warehouse_id = ? AND tipe_dokumen = ?
                   AND dokumen_id = ? AND qty_keluar > 0`,
                s.product_id,
                warehouseId,
                TIPE,
                id,
              )))?.rata ?? null;
            await ubahStok({
              productId: s.product_id,
              warehouseId,
              masuk: s.qty,
              hargaMasuk: nilai && nilai > 0 ? nilai : undefined,
              tipeDokumen: TIPE,
              dokumenId: id,
              userId: pengguna?.id ?? undefined,
            });
          }
        }
        await catatAudit({
          userId: pengguna?.id ?? null,
          aksi: 'batal',
          tabel: 'sub_stock_docs',
          recordId: id,
          sesudah: { status: 'dihapus_permanen' },
          alasan: alasanBatal,
        });
        // Kebijakan No Retain: dokumen & kartu stoknya dihapus permanen.
        await hapusSubStockPermanen(id);
      });

      const row = await get<Record<string, unknown>>(`${Q_DOK} WHERE d.id = ?`, id);
      res.json({ data: row ? tampil(row) : null });
    }),
  );

  return r;
}
