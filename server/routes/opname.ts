// MODUL STOK OPNAME — API sesi opname fisik.
//
// Alur (status kolom = CHECK migrasi 001; tahap = migrasi 013):
//   POST /            buat sesi  -> SNAPSHOT stok sistem (qty_sistem) per baris
//   POST /:id/hitung  metode 1 (manual): qty_fisik absolut per baris
//   POST /:id/scan    metode 2 (scan): qty_fisik +1 per barcode; undo membalik scan terakhir
//        Kedua metode menulis data yang sama dan boleh digabung dalam satu sesi.
//   POST /:id/selesai => tahap 'tinjau' (review selisih)
//   POST /:id/sahkan  => status 'disahkan' (AW5: tanpa PIN, izin opname.sahkan):
//                        penyesuaian stok via sesuaikanStok() per gudang/lokasi.
// Nilai unit penyesuaian memakai rata-rata bergerak per lokasi (konsisten valuasi).
import { Router, type Request } from 'express';
import { all, get, getSettings, run, runOpsional, withTransaction } from '../db.pg.ts';
import { nomorOtomatis } from '../lib/pengaturanBaru.ts';
import { asyncHandler, bacaPaginasi, polaCari, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { idGudangSesi, syaratGudangSesi, wajibGudangDiizinkan, wajibSel } from '../lib/hak.ts';
import { bacaSaldo, sesuaikanStok } from '../lib/stok.ts';
import { idPenggunaBawaan } from '../lib/jurnal.ts';
import {
  batasSelisihPersen,
  bacaBerkasOpname,
  laporanErrorXlsx,
  productSesiCtx,
  stokSistemCtx,
  templateOpnameXlsx,
  validasiImporOpname,
  type BarisPratinjau,
} from '../lib/opnameImpor.ts';

/** Baris dihitung bila dihitung_manual = TRUE ATAU jml_scan > 0. */
const SQL_DIHITUNG = '(dihitung_manual = TRUE OR jml_scan > 0)';

const SELECT_SESI = `
  SELECT os.*, w.kode AS gudang_kode, w.nama AS gudang_nama,
         l.kode_lokasi,
         pj.nama AS penanggung_jawab,
         su.nama AS disetujui_oleh_nama,
         (SELECT COUNT(*) FROM opname_items i WHERE i.session_id = os.id) AS jumlah_item,
         (SELECT COUNT(*) FROM opname_items i WHERE i.session_id = os.id AND ${SQL_DIHITUNG}) AS jumlah_dihitung,
         (SELECT COUNT(*) FROM opname_items i WHERE i.session_id = os.id AND ${SQL_DIHITUNG} AND i.selisih <> 0) AS jumlah_selisih,
         (SELECT COALESCE(SUM(i.selisih), 0) FROM opname_items i
           WHERE i.session_id = os.id
             AND (i.dihitung_manual = TRUE OR EXISTS (
               SELECT 1 FROM opname_scans s WHERE s.session_id = i.session_id
                 AND s.product_id = i.product_id AND s.dibatalkan = FALSE))) AS netto_selisih,
         (SELECT COUNT(*) FROM opname_scans s WHERE s.session_id = os.id AND s.dibatalkan = FALSE AND s.product_id IS NULL) AS scan_tak_dikenal
  FROM opname_sessions os
  JOIN warehouses w ON w.id = os.warehouse_id
  LEFT JOIN locations l ON l.id = os.location_id
  LEFT JOIN users pj ON pj.id = os.penanggung_jawab_id
  LEFT JOIN users su ON su.id = os.disetujui_oleh`;

const SELECT_ITEM = `
  SELECT i.*, p.sku, p.barcode, p.nama AS produk, p.id AS product_id,
         l.kode_lokasi,
         CASE WHEN ${SQL_DIHITUNG} THEN 1 ELSE 0 END AS terhitung,
         ${stokRata('os.warehouse_id')} AS rata
  FROM opname_items i
  JOIN opname_sessions os ON os.id = i.session_id
  JOIN products p ON p.id = i.product_id
  LEFT JOIN locations l ON l.id = i.location_id`;

/** Rata-rata bergerak per baris item (produk × gudang sesi — dari Kartu Stok). */
function stokRata(kolomGudang: string): string {
  return `(
    SELECT CASE
      WHEN COALESCE(SUM(l2.qty_masuk) - SUM(l2.qty_keluar), 0) > 0
        THEN (COALESCE(SUM(l2.qty_masuk * l2.nilai_unit), 0) - COALESCE(SUM(l2.qty_keluar * l2.nilai_unit), 0))
             / (SUM(l2.qty_masuk) - SUM(l2.qty_keluar))
      ELSE 0 END
    FROM stock_ledger l2
    WHERE l2.product_id = i.product_id AND l2.warehouse_id = ${kolomGudang}
  )`;
}

export function routerOpname(): Router {
  const r = Router();

  async function bacaSesi(id: number): Promise<Record<string, unknown>> {
    const s = await get<Record<string, unknown>>(`${SELECT_SESI} WHERE os.id = ?`, id);
    if (!s) throw tolak(404, 'Sesi opname tidak ditemukan.');
    return s;
  }

  /**
   * ISOLASI GUDANG — sesi opname hanya boleh dibuka/diubah oleh sesi yang
   * diizinkan atas gudang sesi tersebut. Berlaku untuk peran bawaan & kustom.
   */
  async function sesiTerisolasi(req: Request, id: number): Promise<Record<string, unknown>> {
    const s = await bacaSesi(id);
    await wajibGudangDiizinkan(req, Number(s.warehouse_id));
    return s;
  }

  async function daftarItem(sessionId: number): Promise<Record<string, unknown>[]> {
    return await all<Record<string, unknown>>(`${SELECT_ITEM} WHERE i.session_id = ? ORDER BY p.nama, p.sku`, sessionId);
  }

  function ringkasanItem(items: Record<string, unknown>[]) {
    let dihitung = 0;
    let belum = 0;
    let selisihLebih = 0;
    let selisihKurang = 0;
    let qtySistem = 0;
    let qtyFisik = 0;
    for (const i of items) {
      if (!Number(i.terhitung)) {
        belum++;
        continue;
      }
      dihitung++;
      qtySistem += Number(i.qty_sistem);
      qtyFisik += Number(i.qty_fisik);
      const s = Number(i.selisih);
      if (s > 0) selisihLebih++;
      else if (s < 0) selisihKurang++;
    }
    return { jumlah: items.length, dihitung, belum, selisih_lebih: selisihLebih, selisih_kurang: selisihKurang, qty_sistem: qtySistem, qty_fisik: qtyFisik };
  }

  /** Lokasi baris item: lokasi eksplisit > lokasi sesi > lokasi pertama gudang. */
  async function lokasiItem(bodyLokasi: unknown, sesi: Record<string, unknown>): Promise<number> {
    if (bodyLokasi !== undefined && bodyLokasi !== null && bodyLokasi !== '') {
      const id = Number(bodyLokasi);
      if (!Number.isInteger(id) || !await get<{ id: number }>(`SELECT id FROM locations WHERE id = ? AND warehouse_id = ?`, id, sesi.warehouse_id)) {
        throw tolak(400, 'Lokasi tidak berada di gudang sesi opname.');
      }
      return id;
    }
    if (sesi.location_id) return Number(sesi.location_id);
    const pertama = await get<{ id: number }>(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, sesi.warehouse_id);
    if (!pertama) throw tolak(400, 'Gudang belum memiliki lokasi.');
    return pertama.id;
  }

  // Stok disimpan per produk per gudang → satu baris hitung per produk dalam sesi
  // (lokasi baris bersifat informasi penempatan, bukan kunci saldo).
  async function temukanItem(sessionId: number, productId: number): Promise<Record<string, unknown> | undefined> {
    return await get<Record<string, unknown>>(
      `SELECT * FROM opname_items WHERE session_id = ? AND product_id = ?`,
      sessionId,
      productId,
    );
  }

  /** Satu baris item lengkap dengan info produk (untuk respons scan). */
  async function itemRinci(sessionId: number, productId: number): Promise<Record<string, unknown> | undefined> {
    return await get<Record<string, unknown>>(
      `${SELECT_ITEM} WHERE i.session_id = ? AND i.product_id = ?`,
      sessionId,
      productId,
    );
  }

  /** Baris baru: qty_sistem = saldo AWAL (snapshot sesi bila ada, else saldo sekarang). */
  async function buatBarisItem(sessionId: number, warehouseId: number, productId: number, locationId: number | null): Promise<number> {
    const saldo = await bacaSaldo(productId, warehouseId);
    return Number(
      await ((await run(
        `INSERT INTO opname_items (session_id, product_id, location_id, qty_sistem, qty_fisik, selisih)
         VALUES (?, ?, ?, ?, 0, ?)`,
        sessionId,
        productId,
        locationId,
        saldo.qty,
        0 - saldo.qty,
      ))).lastInsertRowid,
    );
  }

  // ==========================================================================
  // Opsi pengguna (penanggung jawab sesi) — modul login belum ada, pakai users.
  // ==========================================================================
  r.get('/opsi-pengguna', async (_req, res) => {
    const data = await all<Record<string, unknown>>(`SELECT id, nama FROM users WHERE aktif = TRUE ORDER BY nama`);
    res.json({ data });
  });

  // ==========================================================================
  // BAGIAN L — TEMPLATE EXCEL (3 sheet: Opname, Petunjuk, Referensi)
  // GET /template?isi=stok|kosong&gudang=&lokasi=&kategori=&merek=&aktif=
  // DIDAHULUKAN dari GET /:id agar "template" tidak tertangkap sebagai id sesi.
  // ==========================================================================
  r.get(
    '/template',
    asyncHandler(async (req, res) => {
      const isi = req.query.isi === 'kosong' ? 'kosong' : 'stok';
      const n = (v: unknown) => (v === undefined || v === '' ? null : Number(v));
      // ISOLASI GUDANG — template stok tanpa gudang = dump global. Sesi
      // satu gudang otomatis memakai gudangnya; selain itu wajib pilih.
      let wid = n(req.query.gudang);
      if (!wid) {
        const ids = await idGudangSesi(req);
        if (ids && ids.length === 1) wid = ids[0];
        else if (ids) throw tolak(400, 'Pilih gudang untuk template stok.');
      }
      if (wid) await wajibGudangDiizinkan(req, wid);
      const buf = await templateOpnameXlsx({
        isi,
        warehouseId: wid,
        locationId: n(req.query.lokasi),
        categoryId: n(req.query.kategori),
        brandId: n(req.query.merek),
        aktif: req.query.aktif !== '0',
      });
      const nama = isi === 'kosong' ? 'template-opname-kosong.xlsx' : 'template-opname-stok-terkini.xlsx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
      res.send(buf);
    }),
  );

  // ==========================================================================
  // Daftar sesi
  // ==========================================================================
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const p = bacaPaginasi(req, { urutBawaan: 'dibuat_pada', urutDiizinkan: ['dibuat_pada', 'tanggal', 'no_dokumen'] });
      const syarat: string[] = [];
      const params: unknown[] = [];
      if (p.cari) {
        syarat.push('os.no_dokumen ILIKE ? ESCAPE \'\\\\\'');
        params.push(polaCari(p.cari));
      }
      // ISOLASI GUDANG — "Semua" hanya mencakup gudang sesi; eksplisit di
      // luar cakupan ditolak 403. Berlaku untuk peran bawaan & kustom.
      if (req.query.gudang) {
        const gudangMinta = Number(req.query.gudang);
        await wajibGudangDiizinkan(req, gudangMinta);
        syarat.push('os.warehouse_id = ?');
        params.push(gudangMinta);
      } else {
        const lingkup = await syaratGudangSesi(req, 'os.warehouse_id');
        if (lingkup.sql) {
          syarat.push(lingkup.sql);
          params.push(...lingkup.params);
        }
      }
      const tahap = String(req.query.tahap ?? '');
      if (tahap === 'draft') syarat.push(`os.status = 'draft'`);
      else if (tahap === 'hitung') syarat.push(`os.status = 'draft' AND os.tahap = 'hitung'`);
      else if (tahap === 'tinjau') syarat.push(`os.status = 'draft' AND os.tahap = 'tinjau'`);
      else if (tahap === 'selesai') syarat.push(`os.status = 'disahkan'`);
      else if (tahap === 'batal') syarat.push(`os.status = 'batal'`);
      const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

      // O3 — jumlah per tab status (dihitung dari filter dasar yang sama,
      // tanpa syarat tahap) untuk tab Semua | Draft | Dihitung | Menunggu | Disahkan.
      const hitungTab = async (syaratTambahan: string[]): Promise<number> => {
        const s = [...syarat, ...syaratTambahan];
        return Number(
          await ((await get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM opname_sessions os ${s.length ? `WHERE ${s.join(' AND ')}` : 'WHERE 1 = 1'}`,
            ...params,
          )))?.n ?? 0,
        );
      };
      const tab = {
        semua: await hitungTab([]),
        draft: await hitungTab([`os.status = 'draft'`]),
        hitung: await hitungTab([`os.status = 'draft'`, `os.tahap = 'hitung'`]),
        tinjau: await hitungTab([`os.status = 'draft'`, `os.tahap = 'tinjau'`]),
        selesai: await hitungTab([`os.status = 'disahkan'`]),
      };

      const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM opname_sessions os ${where}`, ...params)))?.n ?? 0);
      const data = await all<Record<string, unknown>>(
        `${SELECT_SESI} ${where} ORDER BY ${p.urut} ${p.arah}, os.id ASC LIMIT ? OFFSET ?`,
        ...params,
        p.per,
        p.offset,
      );
      res.json({ data, total, hal: p.hal, per: p.per, tab });
    }),
  );

  // ==========================================================================
  // Buat sesi + snapshot stok sistem
  // ==========================================================================
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const warehouseId = Number(body.warehouse_id);
      if (!Number.isInteger(warehouseId) || !await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', warehouseId)) {
        throw tolak(400, 'Gudang tidak ditemukan.');
      }
      // ISOLASI GUDANG — sesi opname hanya untuk gudang yang diizinkan.
      await wajibGudangDiizinkan(req, warehouseId);
      let locationId: number | null = null;
      if (body.location_id !== undefined && body.location_id !== null && body.location_id !== '') {
        const id = Number(body.location_id);
        if (!Number.isInteger(id) || !await get<{ id: number }>(`SELECT id FROM locations WHERE id = ? AND warehouse_id = ?`, id, warehouseId)) {
          throw tolak(400, 'Lokasi tidak berada di gudang tersebut.');
        }
        locationId = id;
      }
      const tanggal = body.tanggal ? String(body.tanggal) : new Date().toISOString();
      const penanggungJawab = Number(body.penanggung_jawab_id) || await idPenggunaBawaan();
      if (!await get<{ id: number }>('SELECT id FROM users WHERE id = ?', penanggungJawab)) throw tolak(400, 'Penanggung jawab tidak ditemukan.');
      const catatan = body.catatan ? String(body.catatan).slice(0, 1000) : null;

      const pengguna = penggunaSaatIni(req);
      const idBaru = await withTransaction(async () => {
        const tahun = new Date().getFullYear();
        const noDokumen = await nomorOtomatis('opname', `${tahun}-01-01`);
        const hasil = await run(
          `INSERT INTO opname_sessions (no_dokumen, warehouse_id, location_id, tanggal, metode, status, tahap,
                                        penanggung_jawab_id, dibuat_oleh, catatan)
           VALUES (?, ?, ?, ?, 'manual', 'draft', 'hitung', ?, ?, ?)`,
          noDokumen,
          warehouseId,
          locationId,
          tanggal,
          penanggungJawab,
          pengguna.id,
          catatan,
        );
        const id = Number(hasil.lastInsertRowid);

        // SNAPSHOT: seluruh saldo produk di gudang menjadi baris hitung —
        // satu baris per produk (saldo disimpan per produk per gudang).
        const lokasiBaris =
          locationId ??
          await ((await get<{ id: number }>(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, warehouseId)))?.id ??
          null;
        await run(
          `INSERT INTO opname_items (session_id, product_id, location_id, qty_sistem, qty_fisik, selisih)
           SELECT ?, sb.product_id, ?, sb.qty, 0, 0 - sb.qty
           FROM stock_balances sb
           WHERE sb.warehouse_id = ?`,
          id,
          lokasiBaris,
          warehouseId,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'tambah',
          tabel: 'opname_sessions',
          recordId: id,
          sesudah: { no_dokumen: noDokumen, warehouse_id: warehouseId, location_id: locationId, penanggung_jawab_id: penanggungJawab },
        });
        return id;
      });

      res.status(201).json({ id: idBaru, data: await bacaSesi(idBaru) });
    }),
  );

  // ==========================================================================
  // Detail sesi: sesi + semua baris + ringkasan + scan terakhir
  // ==========================================================================
  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      const items = await daftarItem(id);
      const scans = await all<Record<string, unknown>>(
        `SELECT s.*, p.sku, p.barcode AS produk_barcode, p.nama AS produk
         FROM opname_scans s
         LEFT JOIN products p ON p.id = s.product_id
         WHERE s.session_id = ?
         ORDER BY s.id DESC
         LIMIT 20`,
        id,
      );
      res.json({ data: { ...sesi, items, ringkasan: ringkasanItem(items), scans } });
    }),
  );

  // ==========================================================================
  // Ubah sesi (draft tahap hitung): tanggal, penanggung jawab, lokasi, catatan
  // ==========================================================================
  r.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft') throw tolak(409, 'Hanya sesi draft yang bisa diubah.');
      if (sesi.tahap !== 'hitung') throw tolak(409, 'Sesi sudah selesai dihitung — kembalikan ke tahap hitung dulu.');
      const body = (req.body ?? {}) as Record<string, unknown>;

      let locationId: number | null = sesi.location_id === null ? null : Number(sesi.location_id);
      if (body.location_id !== undefined) {
        if (body.location_id === null || body.location_id === '') {
          locationId = null;
        } else {
          const id2 = Number(body.location_id);
          if (!Number.isInteger(id2) || !await get<{ id: number }>(`SELECT id FROM locations WHERE id = ? AND warehouse_id = ?`, id2, sesi.warehouse_id)) {
            throw tolak(400, 'Lokasi tidak berada di gudang sesi.');
          }
          locationId = id2;
        }
      }
      const tanggal = body.tanggal !== undefined ? String(body.tanggal) : String(sesi.tanggal);
      const penanggungJawab = body.penanggung_jawab_id !== undefined ? Number(body.penanggung_jawab_id) : Number(sesi.penanggung_jawab_id);
      if (!await get<{ id: number }>('SELECT id FROM users WHERE id = ?', penanggungJawab)) throw tolak(400, 'Penanggung jawab tidak ditemukan.');
      const catatan = body.catatan !== undefined ? (body.catatan ? String(body.catatan).slice(0, 1000) : null) : (sesi.catatan ?? null);

      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        // Kunci lokasi berubah -> snapshot ulang baris yang belum disentuh.
        const lokasiBaru = locationId;
        const lokasiLama = sesi.location_id === null ? null : Number(sesi.location_id);
        if (lokasiBaru !== lokasiLama) {
          // Baris yang sudah dihitung dipertahankan; sisanya disusun ulang dari saldo awal.
          await run(`DELETE FROM opname_items WHERE session_id = ? AND NOT ${SQL_DIHITUNG}`, id);
          await run(
            `INSERT INTO opname_items (session_id, product_id, location_id, qty_sistem, qty_fisik, selisih)
             SELECT ?, sb.product_id, ?, sb.qty, 0, 0 - sb.qty
             FROM stock_balances sb
             WHERE sb.warehouse_id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM opname_items i WHERE i.session_id = ? AND i.product_id = sb.product_id
               )`,
            id,
            lokasiBaru,
            sesi.warehouse_id,
            id,
          );
        }
        await run(
          `UPDATE opname_sessions SET location_id = ?, tanggal = ?, penanggung_jawab_id = ?, catatan = ?, diubah_pada = ? WHERE id = ?`,
          locationId,
          tanggal,
          penanggungJawab,
          catatan,
          new Date().toISOString(),
          id,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'opname_sessions',
          recordId: id,
          sebelum: { location_id: lokasiLama, tanggal: sesi.tanggal, penanggung_jawab_id: sesi.penanggung_jawab_id },
          sesudah: { location_id: lokasiBaru, tanggal, penanggung_jawab_id: penanggungJawab },
        });
      });
      res.json({ ok: true, data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Metode 1 — hitung manual: daftar { product_id, location_id?, qty_fisik, catatan? }
  // ==========================================================================
  r.post(
    '/:id/hitung',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft' || sesi.tahap !== 'hitung') throw tolak(409, 'Sesi tidak dalam tahap penghitungan.');
      // AX2 — mencatat hasil hitung = sel Ubah pada Opname.
      await wajibSel(req, 'opname', 'ubah');
      const body = (req.body ?? {}) as { items?: Record<string, unknown>[] };
      const raw = Array.isArray(body.items) ? body.items : [];
      if (raw.length === 0) throw tolak(400, 'Tidak ada baris hitung.');

      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        for (const b of raw) {
          const productId = Number(b.product_id);
          if (!Number.isInteger(productId) || !await get<{ id: number }>('SELECT id FROM products WHERE id = ?', productId)) {
            throw tolak(400, 'Produk tidak ditemukan.');
          }
          // ISOLASI GUDANG MUTLAK — sama seperti scan: hanya barang
          // terdaftar di gudang sesi yang boleh dihitung manual.
          if (!await get<{ product_id: number }>('SELECT product_id FROM stock_balances WHERE product_id = ? AND warehouse_id = ?', productId, Number(sesi.warehouse_id))) {
            const namaGudang = await ((await get<{ nama: string }>('SELECT nama FROM warehouses WHERE id = ?', Number(sesi.warehouse_id))))?.nama ?? 'gudang sesi';
            throw tolak(400, `Barang ini tidak terdaftar di ${namaGudang}.`);
          }
          const qty = Number(b.qty_fisik);
          if (!Number.isFinite(qty) || qty < 0) throw tolak(400, 'Stok fisik harus bilangan >= 0.');
          const lokasiId = await lokasiItem(b.location_id, sesi);
          let baris = await temukanItem(id, productId);
          if (!baris) {
            await buatBarisItem(id, Number(sesi.warehouse_id), productId, lokasiId);
            baris = (await temukanItem(id, productId))!;
          }
          const selisih = qty - Number(baris.qty_sistem);
          await run(
            `UPDATE opname_items
             SET qty_fisik = ?, selisih = ?, location_id = ?, dihitung_manual = TRUE, sumber = 'manual',
                 catatan = ?, dihitung_pada = ?
             WHERE id = ?`,
            qty,
            selisih,
            lokasiId,
            b.catatan !== undefined && b.catatan !== null ? String(b.catatan).slice(0, 500) : (baris.catatan ?? null),
            new Date().toISOString(),
            Number(baris.id),
          );
        }
        // Metode = 'manual' bila belum ada scan; 'gabungan' bila keduanya terpakai.
        const adaScan = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM opname_scans WHERE session_id = ? AND dibatalkan = FALSE AND product_id IS NOT NULL`, id)))?.n ?? 0);
        await run(`UPDATE opname_sessions SET metode = ?, diubah_pada = ? WHERE id = ?`, adaScan > 0 ? 'gabungan' : 'manual', new Date().toISOString(), id);
      });
      await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'opname_items', recordId: id, sesudah: { metode: 'manual', jumlah_baris: raw.length } });

      const items = await daftarItem(id);
      res.json({ ok: true, ringkasan: ringkasanItem(items), data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Metode 2 — scan 1 per 1: barcode -> qty_fisik +1 pada baris & lokasi pilihan
  // ==========================================================================
  r.post(
    '/:id/scan',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft' || sesi.tahap !== 'hitung') throw tolak(409, 'Sesi tidak dalam tahap penghitungan.');
      // AX2 — scan = sel Ubah pada Opname.
      await wajibSel(req, 'opname', 'ubah');
      const body = (req.body ?? {}) as { barcode?: unknown; location_id?: unknown };
      const kode = String(body.barcode ?? '').trim();
      if (!kode) throw tolak(400, 'Barcode kosong.');

      const produk = await get<Record<string, unknown>>(
        `SELECT id FROM products
          WHERE deleted_at IS NULL AND (barcode ILIKE ? OR sku ILIKE ?)
          LIMIT 1`,
        kode,
        kode,
      );
      const pengguna = penggunaSaatIni(req);

      if (!produk) {
        // Barcode tidak dikenal tetap dicatat agar ditandai pada laporan sesi.
        await run(
          `INSERT INTO opname_scans (session_id, barcode, product_id, location_id, user_id) VALUES (?, ?, NULL, NULL, ?)`,
          id,
          kode,
          pengguna.id,
        );
        res.json({ ok: false, dikenal: false, pesan: `Barcode "${kode}" tidak dikenal.`, ringkasan: ringkasanItem(await daftarItem(id)), data: await bacaSesi(id) });
        return;
      }

      const productId = Number(produk.id);
      // ISOLASI GUDANG MUTLAK — lembar opname murni milik gudang sesi:
      // barang tanpa baris saldo di gudang ini tidak boleh masuk hitungan.
      if (!await get<{ product_id: number }>('SELECT product_id FROM stock_balances WHERE product_id = ? AND warehouse_id = ?', productId, Number(sesi.warehouse_id))) {
        const namaGudang = await ((await get<{ nama: string }>('SELECT nama FROM warehouses WHERE id = ?', Number(sesi.warehouse_id))))?.nama ?? 'gudang sesi';
        throw tolak(400, `Barang ini tidak terdaftar di ${namaGudang}.`);
      }
      const lokasiId = await lokasiItem(body.location_id, sesi);
      let baris: Record<string, unknown> | undefined;
      await withTransaction(async () => {
        baris = await temukanItem(id, productId);
        if (!baris) {
          await buatBarisItem(id, Number(sesi.warehouse_id), productId, lokasiId);
          baris = (await temukanItem(id, productId))!;
        }
        const qtyBaru = Number(baris.qty_fisik) + 1;
        await run(
          `UPDATE opname_items SET qty_fisik = ?, selisih = ?, location_id = ?, jml_scan = jml_scan + 1, sumber = 'scan', dihitung_pada = ? WHERE id = ?`,
          qtyBaru,
          qtyBaru - Number(baris.qty_sistem),
          lokasiId,
          new Date().toISOString(),
          Number(baris.id),
        );
        await run(
          `INSERT INTO opname_scans (session_id, barcode, product_id, location_id, user_id) VALUES (?, ?, ?, ?, ?)`,
          id,
          kode,
          productId,
          lokasiId,
          pengguna.id,
        );
        await run(`UPDATE opname_sessions SET metode = 'gabungan', diubah_pada = ? WHERE id = ? AND metode = 'manual'`, new Date().toISOString(), id);
      });

      // Ambil ulang baris SETELAH transaksi agar qty_fisik/selisih yang dikembalikan sudah terbaru (dengan info produk).
      const barisBaru = await itemRinci(id, productId);
      res.json({ ok: true, dikenal: true, baris: barisBaru, ringkasan: ringkasanItem(await daftarItem(id)), data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Undo scan terakhir (scan aktif terbaru -> dibatalkan, qty_fisik -1)
  // ==========================================================================
  r.post(
    '/:id/scan/undo',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft' || sesi.tahap !== 'hitung') throw tolak(409, 'Sesi tidak dalam tahap penghitungan.');
      // AX2 — urungkan scan = sel Ubah pada Opname.
      await wajibSel(req, 'opname', 'ubah');

      const terakhir = await get<Record<string, unknown>>(
        // Hanya scan yang benar-benar menambah hitungan (product_id terisi) yang bisa diurungkan;
        // barcode tak dikenal (product_id NULL) tidak mengubah qty sehingga tidak ikut dipilih —
        // penandanya harus tetap ada pada sesi.
        `SELECT * FROM opname_scans WHERE session_id = ? AND dibatalkan = FALSE AND product_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
        id,
      );
      if (!terakhir) throw tolak(409, 'Tidak ada scan yang bisa diurungkan.');

      await withTransaction(async () => {
        await run(`UPDATE opname_scans SET dibatalkan = TRUE WHERE id = ?`, Number(terakhir.id));
        if (terakhir.product_id) {
          const baris = await temukanItem(id, Number(terakhir.product_id));
          if (baris) {
            const qtyBaru = Math.max(0, Number(baris.qty_fisik) - 1);
            await run(
              `UPDATE opname_items SET qty_fisik = ?, selisih = ?, jml_scan = MAX(0, jml_scan - 1) WHERE id = ?`,
              qtyBaru,
              qtyBaru - Number(baris.qty_sistem),
              Number(baris.id),
            );
          }
        }
      });
      res.json({ ok: true, dibatalkan: terakhir, ringkasan: ringkasanItem(await daftarItem(id)), data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Selesai hitung -> tahap 'tinjau'
  // ==========================================================================
  r.post(
    '/:id/selesai',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft' || sesi.tahap !== 'hitung') throw tolak(409, 'Sesi tidak dalam tahap penghitungan.');
      // AX2 — selesai hitung = sel Ubah pada Opname.
      await wajibSel(req, 'opname', 'ubah');
      const items = await daftarItem(id);
      const ringkas = ringkasanItem(items);
      if (ringkas.dihitung === 0) throw tolak(400, 'Belum ada satu pun baris yang dihitung.');

      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(`UPDATE opname_sessions SET tahap = 'tinjau', selesai_hitung_pada = ?, diubah_pada = ? WHERE id = ?`, new Date().toISOString(), new Date().toISOString(), id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'opname_sessions', recordId: id, sesudah: { tahap: 'tinjau', ringkasan: ringkas } });
      });
      res.json({ ok: true, ringkasan: ringkas, data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Kembali ke tahap hitung (bila belum disahkan)
  // ==========================================================================
  r.post(
    '/:id/buka',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft') throw tolak(409, 'Hanya sesi draft yang bisa dibuka kembali.');
      // AX2 — "Kembali Hitung" = sel Ubah pada Opname.
      await wajibSel(req, 'opname', 'ubah');
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(`UPDATE opname_sessions SET tahap = 'hitung', selesai_hitung_pada = NULL, diubah_pada = ? WHERE id = ?`, new Date().toISOString(), id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'opname_sessions', recordId: id, sesudah: { tahap: 'hitung' } });
      });
      res.json({ ok: true, data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // AW5 — Sahkan tanpa PIN: izin opname.sahkan + cakupan gudang. Dialog
  // konfirmasi biasa (tanpa PIN) di frontend; penyesuaian stok per gudang/
  // lokasi dalam satu transaksi; sesi terkunci; Berita Acara tersedia.
  // ==========================================================================
  r.post(
    '/:id/sahkan',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft') throw tolak(409, 'Sesi bukan berstatus draft.');
      if (sesi.tahap !== 'tinjau') throw tolak(409, 'Sesi belum masuk tahap tinjau selisih.');
      // AX2/AX5 — Sahkan tanpa PIN: hanya sel Sahkan pada Opname + cakupan gudang.
      await wajibSel(req, 'opname', 'sahkan');

      const items = (await daftarItem(id)).filter((i) => Number(i.terhitung));
      const warehouseId = Number(sesi.warehouse_id);
      const pengguna = penggunaSaatIni(req);
      let disesuaikan = 0;
      let totalLebih = 0;
      let totalKurang = 0;

      const hasil = await withTransaction(async () => {
        for (const it of items) {
          const qtySistem = Number(it.qty_sistem);
          const qtyFisik = Number(it.qty_fisik);
          if (qtyFisik === qtySistem) continue;
          const lokasiId =
            it.location_id !== null && it.location_id !== undefined
              ? Number(it.location_id)
              : sesi.location_id === null || sesi.location_id === undefined
                ? null
                : Number(sesi.location_id);

          // Nilai unit = rata-rata bergerak gudang saat ini (konsisten dengan valuasi).
          const { rataBergerak } = await bacaSaldo(Number(it.product_id), warehouseId);
          const nilai = Math.abs(qtyFisik - qtySistem) * rataBergerak;
          if (qtyFisik > qtySistem) totalLebih += nilai;
          else totalKurang += nilai;

          await sesuaikanStok(Number(it.product_id), warehouseId, lokasiId, qtySistem, qtyFisik, id, pengguna.id);
          disesuaikan++;
        }

        // AKUNTANSI DASAR — tanpa jurnal penyesuaian persediaan. Opname hanya
        // menyelaraskan stok fisik (di atas); nilai lebih/kurang tetap dicatat
        // pada audit log sebagai ringkasan, tanpa akun/buku besar.
        const bulatLebih = Math.round(totalLebih);
        const bulatKurang = Math.round(totalKurang);
        const idJurnal: number | null = null;

        await run(
          `UPDATE opname_sessions SET status = 'disahkan', disetujui_oleh = ?, disetujui_pada = ?, diubah_pada = ? WHERE id = ?`,
          pengguna.id,
          new Date().toISOString(),
          new Date().toISOString(),
          id,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'sahkan',
          tabel: 'opname_sessions',
          recordId: id,
          sesudah: { status: 'disahkan', disesuaikan, nilai_lebih: bulatLebih, nilai_kurang: bulatKurang, jurnal_id: idJurnal },
        });
        return { jurnal_id: idJurnal, nilai_lebih: bulatLebih, nilai_kurang: bulatKurang };
      });

      res.json({ ok: true, penyesuaian: { jumlah_baris: disesuaikan, ...hasil }, data: await bacaSesi(id) });
    }),
  );

  // ==========================================================================
  // Batal sesi (draft) — stok belum tersentuh, cukup tandai batal
  // ==========================================================================
  r.post(
    '/:id/batal',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft') throw tolak(409, 'Hanya sesi draft yang bisa dibatalkan.');
      // AX2 — Batal sesi draft = sel Hapus pada Opname.
      await wajibSel(req, 'opname', 'hapus');
      const body = (req.body ?? {}) as { alasan?: unknown };
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        // FOR UPDATE: status diperiksa di dalam transaksi (bukan hanya dari
        // bacaan awal) supaya pembatalan ganda tidak saling menimpa.
        const kunci = await get<{ status: string }>('SELECT status FROM opname_sessions WHERE id = ? FOR UPDATE', id);
        if (!kunci) throw tolak(404, 'Sesi opname tidak ditemukan.');
        if (kunci.status !== 'draft') throw tolak(409, 'Hanya sesi draft yang bisa dibatalkan.');
        await catatAudit({
          userId: pengguna.id,
          aksi: 'batal',
          tabel: 'opname_sessions',
          recordId: id,
          sebelum: { status: 'draft' },
          sesudah: { status: 'dihapus_permanen' },
          alasan: body.alasan ? String(body.alasan).slice(0, 500) : null,
        });
        // Kebijakan No Retain: sesi draft yang dibatalkan dihapus permanen.
        // runOpsional (SAVEPOINT) — kegagalan di sini tidak boleh meng-abort
        // transaksi sehingga hapus sesi utama tetap berjalan.
        await runOpsional(`DELETE FROM opname_scans WHERE session_id = ?`, id);
        await run(`DELETE FROM opname_items WHERE session_id = ?`, id);
        await run(`DELETE FROM opname_sessions WHERE id = ?`, id);
      });
      res.json({ ok: true, dihapus_permanen: true });
    }),
  );

  // ==========================================================================
  // BAGIAN L — VALIDASI & PRATINJAU (tanpa menulis apa pun)
  // ==========================================================================
  r.post(
    '/impor/validasi',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        nama_file?: string;
        data_base64?: string;
        warehouse_id?: number;
        location_id?: number | null;
        sesi_id?: number | null;
      };
      if (!body.data_base64) throw tolak(400, 'File belum dikirim.');

      // Konteks: sesi yang dipilih menentukan gudang (snapshot) — atau gudang pilihan.
      let warehouseId: number;
      let locationId: number | null = null;
      let sesiId: number | null = null;
      if (body.sesi_id) {
        const sesi = await bacaSesi(Number(body.sesi_id));
        warehouseId = Number(sesi.warehouse_id);
        locationId = sesi.location_id === null ? null : Number(sesi.location_id);
        sesiId = Number(body.sesi_id);
      } else {
        warehouseId = Number(body.warehouse_id);
        if (!Number.isInteger(warehouseId) || !await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', warehouseId)) {
          throw tolak(400, 'Gudang tidak ditemukan.');
        }
        locationId = body.location_id ? Number(body.location_id) : null;
      }

      const buffer = Buffer.from(String(body.data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom, baris } = await bacaBerkasOpname(buffer, body.nama_file || 'impor.xlsx');
      if (!baris.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');

      const hasil = await validasiImporOpname(kolom, baris, {
        warehouseId,
        locationId,
        sesiId,
        batasPersen: batasSelisihPersen((await getSettings())),
        stokSistem: await stokSistemCtx(warehouseId, sesiId),
        productSesi: await productSesiCtx(sesiId),
      });
      res.json({ nama_file: body.nama_file || 'impor.xlsx', ...hasil });
    }),
  );

  // ==========================================================================
  // BAGIAN L — stok sistem terbaru untuk perbaikan inline di pratinjau
  // ==========================================================================
  r.post(
    '/impor/stok',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { product_ids?: number[]; warehouse_id?: number; sesi_id?: number | null };
      const ids = (Array.isArray(body.product_ids) ? body.product_ids : []).map(Number).filter(Number.isInteger);
      if (!ids.length) throw tolak(400, 'product_ids kosong.');
      let warehouseId = Number(body.warehouse_id) || 0;
      let sesiId: number | null = body.sesi_id ? Number(body.sesi_id) : null;
      if (sesiId) {
        const s = await bacaSesi(sesiId);
        warehouseId = Number(s.warehouse_id);
      }
      if (!warehouseId) throw tolak(400, 'Gudang tidak ditentukan.');
      const stok: Record<number, number> = {};
      if (sesiId) {
        for (const r of await all<{ product_id: number; qty_sistem: number }>(
          `SELECT product_id, qty_sistem FROM opname_items WHERE session_id = ?`,
          sesiId,
        )) {
          stok[r.product_id] = Number(r.qty_sistem);
        }
      }
      for (const r of await all<{ product_id: number; qty: number }>(
        `SELECT product_id, qty FROM stock_balances WHERE warehouse_id = ?`,
        warehouseId,
      )) {
        if (stok[r.product_id] === undefined) stok[r.product_id] = Number(r.qty);
      }
      res.json({ stok, warehouse_id: warehouseId });
    }),
  );

  // ==========================================================================
  // BAGIAN L — LAPORAN ERROR (Excel baris bermasalah + alasannya)
  // ==========================================================================
  r.post(
    '/impor/laporan-error',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { baris?: BarisPratinjau[] };
      const baris = Array.isArray(body.baris) ? body.baris : [];
      if (!baris.length) throw tolak(400, 'Tidak ada baris error untuk diunduh.');
      const buf = await laporanErrorXlsx(baris);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="laporan-error-opname.xlsx"');
      res.send(buf);
    }),
  );

  // ==========================================================================
  // BAGIAN L — TERAPKAN IMPOR ke sesi Draft.
  // Diproses per batch 500 baris dalam SATU transaksi: gagal = batal seluruhnya.
  // Arsip file asli + log (siapa, kapan, nama file, jumlah baris) ikut dokumen.
  // ==========================================================================
  r.post(
    '/:id/impor',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const sesi = await sesiTerisolasi(req, id);
      if (sesi.status !== 'draft' || sesi.tahap !== 'hitung') throw tolak(409, 'Sesi tidak dalam tahap penghitungan.');
      const body = (req.body ?? {}) as {
        baris?: { product_id?: unknown; qty_fisik?: unknown; lokasi_id?: unknown; keterangan?: unknown }[];
        opsi?: { mode?: string; duplikat?: string; produk_tidak_ada?: string };
        nama_file?: string;
        data_base64?: string;
        total_file?: number;
        baris_error?: number;
      };
      const raw = Array.isArray(body.baris) ? body.baris : [];
      if (!raw.length) throw tolak(400, 'Tidak ada baris impor.');
      const mode = body.opsi?.mode === 'tambah' ? ('tambah' as const) : ('timpa' as const);
      const duplikat = body.opsi?.duplikat === 'terakhir' ? ('terakhir' as const) : ('jumlahkan' as const);
      const produkNol = body.opsi?.produk_tidak_ada === 'nol';

      // Validasi ulang ringan — server otoritatif atas baris yang diterima.
      const siap: { product_id: number; qty_fisik: number; lokasi_id: number | null; keterangan: string | null }[] = [];
      for (const b of raw) {
        const pid = Number(b.product_id);
        const qty = Number(b.qty_fisik);
        if (!Number.isInteger(pid) || !await get<{ id: number }>('SELECT id FROM products WHERE id = ?', pid)) {
          throw tolak(400, 'Produk tidak ditemukan pada baris impor.');
        }
        if (!Number.isFinite(qty) || qty < 0) throw tolak(400, 'Stok fisik harus bilangan >= 0.');
        const lokasiId = b.lokasi_id ? Number(b.lokasi_id) : null;
        if (lokasiId && !await get<{ id: number }>(`SELECT id FROM locations WHERE id = ? AND warehouse_id = ?`, lokasiId, sesi.warehouse_id)) {
          throw tolak(400, 'Lokasi tidak berada di gudang sesi opname.');
        }
        siap.push({
          product_id: pid,
          qty_fisik: qty,
          lokasi_id: lokasiId,
          keterangan: b.keterangan ? String(b.keterangan).slice(0, 500) : null,
        });
      }

      // Duplikat (produk + lokasi sama): “jumlahkan” atau “pakai baris terakhir”.
      const peta = new Map<string, (typeof siap)[number]>();
      const urut: string[] = [];
      for (const b of siap) {
        const key = `${b.product_id}|${b.lokasi_id ?? ''}`;
        if (!peta.has(key)) {
          peta.set(key, { ...b });
          urut.push(key);
        } else if (duplikat === 'terakhir') {
          peta.set(key, { ...b });
        } else {
          const lama = peta.get(key)!;
          lama.qty_fisik += b.qty_fisik;
        }
      }
      const daftar = urut.map((k) => peta.get(k)!);
      const pengguna = penggunaSaatIni(req);
      const now = new Date().toISOString();

      const hasil = await withTransaction(async () => {
        let terisi = 0;
        let dilewati = 0;
        // Batch 500 baris — satu transaksi untuk seluruh impor (gagal = batal semua).
        for (let i = 0; i < daftar.length; i += 500) {
          for (const b of daftar.slice(i, i + 500)) {
            let baris = await temukanItem(id, b.product_id);
            if (baris) {
              const sudahDihitung = Number(baris.dihitung_manual) === 1 || Number(baris.jml_scan) > 0;
              if (mode === 'tambah' && sudahDihitung) {
                dilewati++;
                continue;
              }
            }
            const lokasiId = await lokasiItem(b.lokasi_id, sesi);
            if (!baris) {
              await buatBarisItem(id, Number(sesi.warehouse_id), b.product_id, lokasiId);
              baris = (await temukanItem(id, b.product_id))!;
            }
            await run(
              `UPDATE opname_items
                SET qty_fisik = ?, selisih = ?, location_id = ?, dihitung_manual = TRUE,
                    sumber = 'impor', catatan = ?, dihitung_pada = ?
              WHERE id = ?`,
              b.qty_fisik,
              b.qty_fisik - Number(baris.qty_sistem),
              lokasiId,
              b.keterangan ?? baris.catatan ?? null,
              now,
              Number(baris.id),
            );
            terisi++;
          }
        }

        // Produk sesi yang tidak ada di file: “anggap 0” → dihitung, selisih = −stok sistem.
        let dihitungNol = 0;
        if (produkNol) {
          const lokasiBasis =
            sesi.location_id !== null && sesi.location_id !== undefined
              ? Number(sesi.location_id)
              : await ((await get<{ id: number }>(`SELECT id FROM locations WHERE warehouse_id = ? ORDER BY id LIMIT 1`, sesi.warehouse_id)))?.id ?? null;
          const r = await run(
            `UPDATE opname_items
                SET qty_fisik = 0, selisih = 0 - qty_sistem,
                    location_id = COALESCE(location_id, ?), dihitung_manual = TRUE,
                    sumber = 'impor', dihitung_pada = ?
              WHERE session_id = ? AND NOT ${SQL_DIHITUNG}`,
            lokasiBasis,
            now,
            id,
          );
          dihitungNol = Number(r.changes ?? 0);
        }

        // Metode = 'manual' bila belum ada scan; 'gabungan' bila keduanya terpakai.
        const adaScan = Number(
          await ((await get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM opname_scans WHERE session_id = ? AND dibatalkan = FALSE AND product_id IS NOT NULL`,
            id,
          )))?.n ?? 0,
        );
        await run(`UPDATE opname_sessions SET metode = ?, diubah_pada = ? WHERE id = ?`, adaScan > 0 ? 'gabungan' : 'manual', now, id);

        // Arsip file asli + jumlah baris pada dokumen opname (L5).
        const namaFile = body.nama_file ? String(body.nama_file).slice(0, 255) : null;
        if (body.data_base64) {
          const blob = Buffer.from(String(body.data_base64).replace(/^data:[^,]+,/, ''), 'base64');
          await run(
            `UPDATE opname_sessions SET impor_file_nama = ?, impor_file_data = ?, impor_baris = ?, impor_pada = ? WHERE id = ?`,
            namaFile,
            blob,
            daftar.length,
            now,
            id,
          );
        } else if (namaFile) {
          await run(`UPDATE opname_sessions SET impor_file_nama = ?, impor_baris = ?, impor_pada = ? WHERE id = ?`, namaFile, daftar.length, now, id);
        }

        // Log impor: siapa, kapan, nama file, jumlah baris.
        const batch = await run(
          `INSERT INTO import_batches (modul, nama_file, total_baris, baris_valid, baris_error, status, user_id)
           VALUES ('opname', ?, ?, ?, ?, 'selesai', ?)`,
          namaFile ?? 'impor-opname',
          Number(body.total_file ?? daftar.length),
          daftar.length,
          Number(body.baris_error ?? 0),
          pengguna.id,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'impor',
          tabel: 'opname_sessions',
          recordId: id,
          sesudah: {
            nama_file: namaFile,
            jumlah_baris: daftar.length,
            baris_error: Number(body.baris_error ?? 0),
            mode,
            produk_anggap_0: dihitungNol,
          },
        });
        return { terisi, dilewati, produk_anggap_0: dihitungNol, batch_id: Number(batch.lastInsertRowid) };
      });

      const items = await daftarItem(id);
      res.json({ ok: true, ...hasil, ringkasan: ringkasanItem(items), data: await bacaSesi(id) });
    }),
  );

  return r;
}
