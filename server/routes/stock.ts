import { Router, type Request } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { nomorOtomatis } from '../lib/pengaturanBaru.ts';
import { asyncHandler, bacaPaginasi, pesanKesalahan, polaCari, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { idGudangSesi, klausaGudangOtomatis, wajibGudangDiizinkan, wajibSel } from '../lib/hak.ts';
import { stokMinusDiizinkan, totalNilaiPersediaan, ubahStok } from '../lib/stok.ts';
import { hapusTransferPermanen } from '../lib/pembersihanTransaksi.ts';

/** Sub-kueri rata-rata bergerak per baris saldo (per produk per gudang). */
const SUB_RATA = `(
  SELECT CASE
    WHEN COALESCE(SUM(l.qty_masuk) - SUM(l.qty_keluar), 0) > 0
      THEN (COALESCE(SUM(l.qty_masuk * l.nilai_unit), 0) - COALESCE(SUM(l.qty_keluar * l.nilai_unit), 0))
           / (SUM(l.qty_masuk) - SUM(l.qty_keluar))
    ELSE 0 END
  FROM stock_ledger l
  WHERE l.product_id = sb.product_id AND l.warehouse_id = sb.warehouse_id
)`;

export function routerStock(): Router {
  const r = Router();

  // ==========================================================================
  // Halaman Stok: saldo per produk × gudang
  // ==========================================================================
  r.get('/saldo', async (req, res) => {
    const p = bacaPaginasi(req, { urutBawaan: 'produk', urutDiizinkan: ['produk', 'sku', 'qty', 'nilai', 'gudang'] });
    const syarat: string[] = [];
    const params: unknown[] = [];

    if (p.cari) {
      syarat.push(`(prod.sku ILIKE ? ESCAPE '\\' OR prod.barcode ILIKE ? ESCAPE '\\' OR prod.nama ILIKE ? ESCAPE '\\')`);
      params.push(polaCari(p.cari), polaCari(p.cari), polaCari(p.cari));
    }
    if (req.query.gudang) {
      const gudangMinta = Number(req.query.gudang);
      await wajibGudangDiizinkan(req, gudangMinta);
      syarat.push('sb.warehouse_id = ?');
      params.push(gudangMinta);
    } else {
      // ISOLASI: tanpa filter eksplisit, kunci ke gudang sesi (Gudang A ≠ Gudang B).
      const auto = await klausaGudangOtomatis(req, 'sb.warehouse_id');
      if (auto) syarat.push(`1 = 1${auto}`);
    }
    if (req.query.kategori) {
      syarat.push('prod.category_id = ?');
      params.push(Number(req.query.kategori));
    }
    if (req.query.kurang === '1') {
      syarat.push('prod.stok_min > 0 AND sb.qty < prod.stok_min');
    }
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

    const FROM = `FROM stock_balances sb
      JOIN products prod ON prod.id = sb.product_id
      LEFT JOIN categories c ON c.id = prod.category_id
      JOIN warehouses w ON w.id = sb.warehouse_id`;

    const ringkas = await get<{ n: number; qty: number; kurang: number }>(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(sb.qty), 0) AS qty,
              COALESCE(SUM(CASE WHEN prod.stok_min > 0 AND sb.qty < prod.stok_min THEN 1 ELSE 0 END), 0) AS kurang
       ${FROM} ${where}`,
      ...params,
    );

    const urutPeta: Record<string, string> = {
      produk: 'prod.nama',
      sku: 'prod.sku',
      qty: 'sb.qty',
      nilai: 'nilai_total',
      gudang: 'w.kode',
    };
    const kolomUrut = urutPeta[p.urut] ?? 'prod.nama';

    const data = await all<Record<string, unknown>>(
      `SELECT sb.id, sb.product_id, sb.warehouse_id, sb.qty,
              prod.sku, prod.barcode, prod.stok_min, prod.harga_beli,
              prod.nama AS produk, c.nama AS kategori,
              w.kode AS gudang_kode, w.nama AS gudang_nama,
              ${SUB_RATA} AS rata,
              sb.qty * ${SUB_RATA} AS nilai_total,
              CASE WHEN prod.stok_min > 0 AND sb.qty < prod.stok_min THEN 1 ELSE 0 END AS di_bawah_minimum
       ${FROM}
       ${where}
       ORDER BY ${kolomUrut} ${p.arah}, prod.nama ASC, prod.sku ASC
       LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );

    const nilaiHal = data.reduce((a, b) => a + Number(b.nilai_total ?? 0), 0);
    res.json({
      data,
      total: Number(ringkas?.n ?? 0),
      hal: p.hal,
      per: p.per,
      ringkasan: {
        qty_total: Number(ringkas?.qty ?? 0),
        jumlah_kurang: Number(ringkas?.kurang ?? 0),
        nilai_halaman: nilaiHal,
        nilai_persediaan: (await totalNilaiPersediaan(await idGudangSesi(req) ?? undefined)).nilai,
      },
    });
  });

  // ==========================================================================
  // Kartu Stok (mutasi stok) per produk — tanggal, dokumen sumber, lokasi,
  // masuk, keluar, saldo, user
  // ==========================================================================
  r.get('/kartu', async (req, res) => {
    const productId = Number(req.query.product_id);
    if (!Number.isInteger(productId) || productId <= 0) throw tolak(400, 'product_id wajib diisi.');
    const p = bacaPaginasi(req, { urutBawaan: 'tanggal', urutDiizinkan: ['tanggal'], perBawaan: 50 });
    if (p.urut !== 'tanggal') p.urut = 'tanggal';

    const syarat = ['sl.product_id = ?'];
    const params: unknown[] = [productId];
    if (req.query.gudang) {
      syarat.push('sl.warehouse_id = ?');
      params.push(Number(req.query.gudang));
    } else {
      const auto = await klausaGudangOtomatis(req, 'sl.warehouse_id');
      if (auto) syarat.push(`1 = 1${auto}`);
    }
    if (req.query.lokasi) {
      syarat.push('sl.location_id = ?');
      params.push(Number(req.query.lokasi));
    }
    if (req.query.dari) {
      syarat.push('sl.tanggal >= ?');
      params.push(`${String(req.query.dari)}T00:00:00`);
    }
    if (req.query.sampai) {
      syarat.push('sl.tanggal <= ?');
      params.push(`${String(req.query.sampai)}T23:59:59.999`);
    }
    const where = `WHERE ${syarat.join(' AND ')}`;

    const produk = await get<Record<string, unknown>>(
      `SELECT p.id, p.sku, p.barcode, p.stok_min, p.nama AS produk
       FROM products p WHERE p.id = ?`,
      productId,
    );
    if (!produk) throw tolak(404, 'Produk tidak ditemukan.');

    const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_ledger sl ${where}`, ...params)))?.n ?? 0);
    const data = await all<Record<string, unknown>>(
      `SELECT sl.id, sl.tanggal, sl.warehouse_id, sl.location_id, sl.tipe_dokumen, sl.dokumen_id,
              sl.qty_masuk, sl.qty_keluar, sl.saldo, sl.nilai_unit,
              w.kode AS gudang_kode, w.nama AS gudang_nama, l.kode_lokasi,
              u.nama AS pengguna,
              CASE sl.tipe_dokumen
                WHEN 'penjualan' THEN (SELECT no_dokumen FROM sales WHERE id = sl.dokumen_id)
                WHEN 'retur'     THEN (SELECT no_dokumen FROM sale_returns WHERE id = sl.dokumen_id)
                WHEN 'pembelian' THEN (SELECT no_dokumen FROM purchases WHERE id = sl.dokumen_id)
                WHEN 'transfer'  THEN (SELECT no_dokumen FROM stock_transfers WHERE id = sl.dokumen_id)
                WHEN 'opname'    THEN (SELECT no_dokumen FROM opname_sessions WHERE id = sl.dokumen_id)
                ELSE NULL
              END AS no_dokumen
       FROM stock_ledger sl
       JOIN warehouses w ON w.id = sl.warehouse_id
       LEFT JOIN locations l ON l.id = sl.location_id
       LEFT JOIN users u ON u.id = sl.user_id
       ${where}
       ORDER BY sl.tanggal ${p.arah}, sl.id ${p.arah}
       LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );

    // Ringkasan saldo/nilai dengan filter yang sama
    const ringkas = await get<{ qty: number | null; nilai: number | null }>(
      `SELECT COALESCE(SUM(qty_masuk) - SUM(qty_keluar), 0) AS qty,
              COALESCE(SUM(qty_masuk * nilai_unit), 0) - COALESCE(SUM(qty_keluar * nilai_unit), 0) AS nilai
       FROM stock_ledger sl ${where}`,
      ...params,
    );
    const qtyLedger = Number(ringkas?.qty ?? 0);
    const nilaiLedger = Number(ringkas?.nilai ?? 0);

    // Saldo nyata (stock_balances) dengan filter gudang yang sama
    const syaratSaldo: string[] = ['sb.product_id = ?'];
    const paramsSaldo: unknown[] = [productId];
    if (req.query.gudang) {
      syaratSaldo.push('sb.warehouse_id = ?');
      paramsSaldo.push(Number(req.query.gudang));
    }
    const saldoRow = await get<{ qty: number | null }>(
      `SELECT COALESCE(SUM(sb.qty), 0) AS qty FROM stock_balances sb WHERE ${syaratSaldo.join(' AND ')}`,
      ...paramsSaldo,
    );
    const saldoNyata = Number(saldoRow?.qty ?? 0);

    res.json({
      data,
      total,
      hal: p.hal,
      per: p.per,
      produk: {
        ...produk,
        saldo: saldoNyata,
        saldo_dari_kartu: qtyLedger,
        rata_bergerak: qtyLedger > 0 ? nilaiLedger / qtyLedger : 0,
        nilai_persediaan: saldoNyata * (qtyLedger > 0 ? nilaiLedger / qtyLedger : 0),
        stok_min: Number(produk.stok_min ?? 0),
        di_bawah_minimum: Number(produk.stok_min ?? 0) > 0 && saldoNyata < Number(produk.stok_min ?? 0),
      },
    });
  });

  // ==========================================================================
  // Pengaturan Stok: stok minus boleh/tidak (default tidak) + metode valuasi
  // ==========================================================================
  r.get('/pengaturan', async (_req, res) => {
    res.json({
      stok_minus_izinkan: await stokMinusDiizinkan(),
      valuasi: 'rata_rata_bergerak',
      keterangan_valuasi: 'Harga keluar memakai rata-rata bergerak per gudang.',
    });
  });

  r.put(
    '/pengaturan',
    asyncHandler(async (req, res) => {
      // AX2 — kebijakan stok minus = sel Ubah pada Stok.
      await wajibSel(req, 'stok', 'ubah');
      const nilai = (req.body ?? {}) as { stok_minus_izinkan?: unknown };
      if (typeof nilai.stok_minus_izinkan !== 'boolean') throw tolak(400, 'stok_minus_izinkan harus boolean.');
      const sebelum = await stokMinusDiizinkan();
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(
          `INSERT INTO settings (kunci, nilai, keterangan, diubah_pada)
           VALUES ('stok_minus_izinkan', ?, 'Izinkan stok menjadi minus jika stok fisik kurang', ?)
           ON CONFLICT (kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
          String(nilai.stok_minus_izinkan),
          new Date().toISOString(),
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'settings',
          recordId: 'stok_minus_izinkan',
          sebelum: { stok_minus_izinkan: sebelum },
          sesudah: { stok_minus_izinkan: nilai.stok_minus_izinkan },
        });
      });
      res.json({ ok: true, stok_minus_izinkan: nilai.stok_minus_izinkan });
    }),
  );

  // ==========================================================================
  // Transfer antar gudang: draft -> kirim -> terima
  // ==========================================================================

  function tahapTransfer(t: Record<string, unknown>): string {
    if (t.status === 'batal') return 'batal';
    if (t.status === 'disahkan') return 'selesai';
    if (t.dikirim_pada) return 'dikirim';
    return 'draft';
  }

  const SELECT_TRANSFER = `
    SELECT st.*, w1.kode AS dari_kode, w1.nama AS dari_nama,
           w2.kode AS ke_kode, w2.nama AS ke_nama,
           (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = st.id) AS jumlah_item,
           (SELECT COALESCE(SUM(qty), 0) FROM stock_transfer_items i WHERE i.transfer_id = st.id) AS jumlah_qty
    FROM stock_transfers st
    JOIN warehouses w1 ON w1.id = st.dari_warehouse
    JOIN warehouses w2 ON w2.id = st.ke_warehouse`;

  r.get('/transfer', async (req, res) => {
    const p = bacaPaginasi(req, { urutBawaan: 'dibuat_pada', urutDiizinkan: ['dibuat_pada', 'tanggal', 'no_dokumen'] });
    const syarat: string[] = [];
    const params: unknown[] = [];
    if (p.cari) {
      syarat.push(`st.no_dokumen ILIKE ? ESCAPE '\\'`);
      params.push(polaCari(p.cari));
    }
    const tahap = String(req.query.tahap ?? '');
    if (tahap === 'draft') syarat.push(`st.status = 'draft' AND st.dikirim_pada IS NULL`);
    else if (tahap === 'dikirim') syarat.push(`st.status = 'draft' AND st.dikirim_pada IS NOT NULL AND st.diterima_pada IS NULL`);
    else if (tahap === 'selesai') syarat.push(`st.status = 'disahkan'`);
    else if (tahap === 'batal') syarat.push(`st.status = 'batal'`);
    if (req.query.gudang) {
      syarat.push('(st.dari_warehouse = ? OR st.ke_warehouse = ?)');
      params.push(Number(req.query.gudang), Number(req.query.gudang));
    } else {
      const autoDari = await klausaGudangOtomatis(req, 'st.dari_warehouse');
      const autoKe = await klausaGudangOtomatis(req, 'st.ke_warehouse');
      // Transfer terlihat bila salah satu sisi di dalam cakupan sesi.
      if (autoDari || autoKe) syarat.push(`(1 = 1${autoDari} OR 1 = 1${autoKe})`);
    }
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

    const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM stock_transfers st ${where}`, ...params)))?.n ?? 0);
    const data = await all<Record<string, unknown>>(
      `${SELECT_TRANSFER} ${where} ORDER BY ${p.urut} ${p.arah}, st.id ASC LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );
    res.json({ data: data.map((t) => ({ ...t, tahap: tahapTransfer(t) })), total, hal: p.hal, per: p.per });
  });

  async function bacaTransfer(id: number): Promise<Record<string, unknown>> {
    const t = await get<Record<string, unknown>>(`${SELECT_TRANSFER} WHERE st.id = ?`, id);
    if (!t) throw tolak(404, 'Transfer tidak ditemukan.');
    const items = await all<Record<string, unknown>>(
      `SELECT i.*, p.sku, p.barcode, p.nama AS produk
       FROM stock_transfer_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.transfer_id = ?
       ORDER BY p.sku`,
      id,
    );
    return { ...t, tahap: tahapTransfer(t), items };
  }

  r.get('/transfer/:id', async (req, res) => {
    const data = await bacaTransfer(Number(req.params.id));
    // ISOLASI BACA: detail transfer di luar cakupan sesi → 404 (bukan bocor).
    if (!req.konteks?.admin) {
      try {
        await wajibGudangDiizinkan(req, Number((data as Record<string, unknown>).dari_warehouse));
      } catch {
        await wajibGudangDiizinkan(req, Number((data as Record<string, unknown>).ke_warehouse));
      }
    }
    res.json({ data });
  });

  async function validasiIsiTransfer(req: Request, body: Record<string, unknown>): Promise<{ dari: number; ke: number; items: { product_id: number; qty: number }[] }> {
    const dari = Number(body.dari_warehouse);
    const ke = Number(body.ke_warehouse);
    if (!Number.isInteger(dari) || !await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', dari)) throw tolak(400, 'Gudang asal tidak ditemukan.');
    if (!Number.isInteger(ke) || !await get<{ id: number }>('SELECT id FROM warehouses WHERE id = ?', ke)) throw tolak(400, 'Gudang tujuan tidak ditemukan.');
    if (dari === ke) throw tolak(400, 'Gudang asal dan tujuan tidak boleh sama.');
    // ISOLASI TULIS: kedua sisi transfer harus di dalam cakupan sesi (403 bila di luar).
    await wajibGudangDiizinkan(req, dari);
    await wajibGudangDiizinkan(req, ke);

    const raw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (raw.length === 0) throw tolak(400, 'Transfer harus memiliki minimal satu item.');
    const lihat = new Set<number>();
    const items = await Promise.all(raw.map(async (i) => {
      const product_id = Number(i.product_id);
      const qty = Number(i.qty);
      if (!Number.isInteger(product_id) || !await get<{ id: number }>('SELECT id FROM products WHERE id = ?', product_id)) {
        throw tolak(400, 'Produk tidak ditemukan.');
      }
      // ISOLASI GUDANG MUTLAK — transfer hanya memindahkan barang yang
      // terdaftar di gudang asal (pemilih UI sudah dibatasi via /saldo).
      if (!await get<{ product_id: number }>('SELECT product_id FROM stock_balances WHERE product_id = ? AND warehouse_id = ?', product_id, dari)) {
        const namaGudang = await ((await get<{ nama: string }>('SELECT nama FROM warehouses WHERE id = ?', dari)))?.nama ?? 'gudang asal';
        throw tolak(400, `Barang ini tidak terdaftar di ${namaGudang}.`);
      }
      if (Number.isNaN(qty) || qty <= 0) throw tolak(400, 'Qty transfer harus lebih dari 0.');
      if (lihat.has(product_id)) throw tolak(409, 'Produk kembar dalam daftar item transfer.');
      lihat.add(product_id);
      return { product_id, qty };
    }));
    return { dari, ke, items };
  }

  r.post(
    '/transfer',
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const isi = await validasiIsiTransfer(req, (req.body ?? {}) as Record<string, unknown>);
      const idBaru = await withTransaction(async () => {
        const tahun = new Date().getFullYear();
        const noDokumen = await nomorOtomatis('transfer', `${tahun}-01-01`);
        const hasil = await run(
          `INSERT INTO stock_transfers (no_dokumen, dari_warehouse, ke_warehouse, status, dibuat_oleh)
           VALUES (?, ?, ?, 'draft', ?)`,
          noDokumen,
          isi.dari,
          isi.ke,
          pengguna.id,
        );
        const id = Number(hasil.lastInsertRowid);
        for (const i of isi.items) {
          await run(`INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES (?, ?, ?)`, id, i.product_id, i.qty);
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: 'tambah',
          tabel: 'stock_transfers',
          recordId: id,
          sesudah: { no_dokumen: noDokumen, dari_warehouse: isi.dari, ke_warehouse: isi.ke, items: isi.items },
        });
        return id;
      });
      res.status(201).json({ id: idBaru, data: await bacaTransfer(idBaru) });
    }),
  );

  r.put(
    '/transfer/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Transfer tidak ditemukan.');
      if (lama.status !== 'draft') throw tolak(409, 'Transfer yang sudah disahkan/batal tidak bisa diubah.');
      if (lama.dikirim_pada) throw tolak(409, 'Transfer sudah dikirim dan tidak bisa diubah. Batalkan dulu bila perlu.');

      const isi = await validasiIsiTransfer(req, (req.body ?? {}) as Record<string, unknown>);
      await withTransaction(async () => {
        await run(`UPDATE stock_transfers SET dari_warehouse = ?, ke_warehouse = ?, diubah_pada = ? WHERE id = ?`, isi.dari, isi.ke, new Date().toISOString(), id);
        await run(`DELETE FROM stock_transfer_items WHERE transfer_id = ?`, id);
        for (const i of isi.items) await run(`INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES (?, ?, ?)`, id, i.product_id, i.qty);
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'stock_transfers',
          recordId: id,
          sebelum: { dari_warehouse: lama.dari_warehouse, ke_warehouse: lama.ke_warehouse },
          sesudah: { dari_warehouse: isi.dari, ke_warehouse: isi.ke, items: isi.items },
        });
      });
      res.json({ ok: true, data: await bacaTransfer(id) });
    }),
  );

  r.delete(
    '/transfer/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      // AX2 — hapus draft transfer = sel Hapus pada Stok.
      await wajibSel(req, 'stok', 'hapus');
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Transfer tidak ditemukan.');
      if (lama.status !== 'draft' || lama.dikirim_pada) throw tolak(409, 'Hanya draft yang belum dikirim yang bisa dihapus.');
      await withTransaction(async () => {
        await run(`DELETE FROM stock_transfers WHERE id = ?`, id);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'stock_transfers', recordId: id, sebelum: lama });
      });
      res.json({ ok: true });
    }),
  );

  // --- Kirim: stok keluar dari gudang asal ----------------------------------
  r.post(
    '/transfer/:id/kirim',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);

      await withTransaction(async () => {
        const t = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ?`, id);
        if (!t) throw tolak(404, 'Transfer tidak ditemukan.');
        await wajibGudangDiizinkan(req, Number(t.dari_warehouse));
        await wajibGudangDiizinkan(req, Number(t.ke_warehouse));
        if (t.status !== 'draft') throw tolak(409, 'Transfer bukan berstatus draft.');
        // AX2 — Transfer dikirim = sel Ubah pada Stok.
        await wajibSel(req, 'stok', 'ubah');
        if (t.dikirim_pada) throw tolak(409, 'Transfer sudah dikirim.');

        const items = await all<{ product_id: number; qty: number }>(`SELECT product_id, qty FROM stock_transfer_items WHERE transfer_id = ?`, id);

        for (const item of items) {
          // Saldo per gudang — satu mutasi keluar per produk (stok tidak mencukupi
          // akan ditolak di sini kecuali stok minus diizinkan)
          await ubahStok({
            productId: item.product_id,
            warehouseId: Number(t.dari_warehouse),
            keluar: item.qty,
            tipeDokumen: 'transfer',
            dokumenId: id,
            userId: pengguna.id,
          });
        }

        await run(`UPDATE stock_transfers SET dikirim_pada = ?, dikirim_oleh = ?, diubah_pada = ? WHERE id = ?`, new Date().toISOString(), pengguna.id, new Date().toISOString(), id);
        await catatAudit({
          userId: pengguna.id,
          aksi: 'kirim',
          tabel: 'stock_transfers',
          recordId: id,
          sesudah: { tahap: 'dikirim' },
        });
      });

      res.json({ ok: true, data: await bacaTransfer(id) });
    }),
  );

  // --- Terima: stok masuk gudang tujuan (dokumen disahkan) ------------------
  r.post(
    '/transfer/:id/terima',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const locationId = Number((req.body ?? {}).location_id);

      await withTransaction(async () => {
        const t = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ?`, id);
        if (!t) throw tolak(404, 'Transfer tidak ditemukan.');
        await wajibGudangDiizinkan(req, Number(t.dari_warehouse));
        await wajibGudangDiizinkan(req, Number(t.ke_warehouse));
        if (t.status !== 'draft') throw tolak(409, 'Transfer bukan berstatus draft.');
        // AX2 — Transfer diterima = sel Ubah pada Stok.
        await wajibSel(req, 'stok', 'ubah');
        if (!t.dikirim_pada) throw tolak(409, 'Transfer belum dikirim — kirim dulu sebelum diterima.');
        if (t.diterima_pada) throw tolak(409, 'Transfer sudah diterima.');
        if (!Number.isInteger(locationId)) throw tolak(400, 'Lokasi tujuan wajib dipilih.');
        const lokasi = await get<{ id: number }>(`SELECT id FROM locations WHERE id = ? AND warehouse_id = ?`, locationId, t.ke_warehouse);
        if (!lokasi) throw tolak(400, 'Lokasi tujuan tidak berada di gudang tujuan.');

        const items = await all<{ product_id: number; qty: number }>(`SELECT product_id, qty FROM stock_transfer_items WHERE transfer_id = ?`, id);
        for (const item of items) {
          // Biaya pindah = rata-rata yang dipakai saat pengiriman (dari kartu stok sumber)
          const biaya = await get<{ n: number | null; q: number | null }>(
            `SELECT COALESCE(SUM(qty_keluar * nilai_unit), 0) AS n, COALESCE(SUM(qty_keluar), 0) AS q
             FROM stock_ledger
             WHERE tipe_dokumen = 'transfer' AND dokumen_id = ? AND product_id = ? AND warehouse_id = ?`,
            id,
            item.product_id,
            t.dari_warehouse,
          );
          const qtyBiaya = Number(biaya?.q ?? 0);
          const harga = qtyBiaya > 0 ? Number(biaya?.n ?? 0) / qtyBiaya : undefined;

          await ubahStok({
            productId: item.product_id,
            warehouseId: Number(t.ke_warehouse),
            locationId,
            masuk: item.qty,
            ...(harga !== undefined ? { hargaMasuk: harga } : {}),
            tipeDokumen: 'transfer',
            dokumenId: id,
            userId: pengguna.id,
          });
        }

        await run(
          `UPDATE stock_transfers SET diterima_pada = ?, diterima_oleh = ?, status = 'disahkan', diubah_pada = ? WHERE id = ?`,
          new Date().toISOString(),
          pengguna.id,
          new Date().toISOString(),
          id,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'terima',
          tabel: 'stock_transfers',
          recordId: id,
          sesudah: { tahap: 'selesai', location_id: locationId },
        });
      });

      res.json({ ok: true, data: await bacaTransfer(id) });
    }),
  );

  // --- Batal: balikkan pergerakan yang sudah terjadi ------------------------
  r.post(
    '/transfer/:id/batal',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      // AX2 — batal transfer: draft = sel Hapus; sudah dikirim/diterima
      // (membalik pergerakan stok) = sel Hapus DAN Sahkan.
      const t0 = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ?`, id);
      if (!t0) throw tolak(404, 'Transfer tidak ditemukan.');
      if (t0.dikirim_pada) await wajibSel(req, 'stok', 'hapus', 'sahkan');
      else await wajibSel(req, 'stok', 'hapus');
      const pengguna = penggunaSaatIni(req);
      const alasan = String((req.body ?? {}).alasan ?? '').trim() || 'Pembatalan transfer oleh admin';

      try {
        await withTransaction(async () => {
          // FOR UPDATE: kunci baris supaya pembatalan ganda tidak berjalan paralel.
          const t = await get<Record<string, unknown>>(`SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE`, id);
          if (!t) throw tolak(404, 'Transfer tidak ditemukan.');
          if (t.status === 'batal') throw tolak(409, 'Transfer sudah dibatalkan.');

          if (t.dikirim_pada) {
            // 1) Balikkan penerimaan di gudang tujuan (bila sudah diterima)
            if (t.diterima_pada) {
              const masukTujuan = await all<{ product_id: number; qty: number }>(
                `SELECT product_id, SUM(qty_masuk) AS qty
                 FROM stock_ledger
                 WHERE tipe_dokumen = 'transfer' AND dokumen_id = ? AND warehouse_id = ?
                 GROUP BY product_id`,
                id,
                t.ke_warehouse,
              );
              for (const m of masukTujuan) {
                await ubahStok({
                  productId: m.product_id,
                  warehouseId: Number(t.ke_warehouse),
                  keluar: m.qty,
                  tipeDokumen: 'transfer_batal',
                  dokumenId: id,
                  userId: pengguna.id,
                });
              }
            }
            // 2) Kembalikan stok ke gudang asal sesuai jejak pengiriman
            const keluarAsal = await all<{ product_id: number; qty: number; nilai: number }>(
              `SELECT product_id, SUM(qty_keluar) AS qty, AVG(nilai_unit) AS nilai
               FROM stock_ledger
               WHERE tipe_dokumen = 'transfer' AND dokumen_id = ? AND warehouse_id = ?
               GROUP BY product_id`,
              id,
              t.dari_warehouse,
            );
            for (const m of keluarAsal) {
              await ubahStok({
                productId: m.product_id,
                warehouseId: Number(t.dari_warehouse),
                masuk: m.qty,
                hargaMasuk: Number(m.nilai),
                tipeDokumen: 'transfer_batal',
                dokumenId: id,
                userId: pengguna.id,
              });
            }
          }

          await catatAudit({
            userId: pengguna.id,
            aksi: 'batal',
            tabel: 'stock_transfers',
            recordId: id,
            sebelum: { status: t.status },
            sesudah: { status: 'dihapus_permanen' },
            alasan,
          });
          // Kebijakan No Retain: transfer & kartu stoknya dihapus permanen.
          await hapusTransferPermanen(id);
        });
      } catch (err) {
        const { pesan } = pesanKesalahan(err);
        if (pesan.includes('Stok tidak mencukupi')) {
          throw tolak(409, `Pembatalan gagal: stok di gudang tujuan sudah terpakai. Selesaikan lewat Opname. (${pesan})`);
        }
        throw err;
      }

      res.json({ ok: true, dihapus_permanen: true });
    }),
  );

  // Opsi produk untuk form transfer (pemilih cepat) — katalog & chat/scan
  // pembelian. ?gudang_id= mengunci ke barang terdaftar di gudang itu.
  r.get('/produk', async (req, res) => {
    const cari = String(req.query.cari ?? '').trim();
    const gudangId = Number(req.query.gudang_id ?? 0) || null;
    if (gudangId) await wajibGudangDiizinkan(req, gudangId);
    const syarat: string[] = [];
    const params: unknown[] = [];
    if (cari) {
      syarat.push(`(p.sku ILIKE ? ESCAPE '\\' OR p.barcode ILIKE ? ESCAPE '\\' OR p.nama ILIKE ? ESCAPE '\\')`);
      params.push(polaCari(cari), polaCari(cari), polaCari(cari));
    }
    // ISOLASI GUDANG MUTLAK — hanya produk terdaftar di gudang yang diminta.
    if (gudangId) {
      syarat.push('EXISTS (SELECT 1 FROM stock_balances sbG WHERE sbG.product_id = p.id AND sbG.warehouse_id = ?)');
      params.push(gudangId);
    }
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')} AND p.aktif = TRUE` : 'WHERE p.aktif = TRUE';
    const data = await all<Record<string, unknown>>(
      `SELECT p.id, p.sku, p.barcode, p.harga_beli, p.nama AS produk, p.satuan_dasar_id
       FROM products p
       ${where}
       ORDER BY p.nama, p.sku
       LIMIT 500`,
      ...params,
    );
    res.json({ data, total: data.length });
  });

  return r;
}
