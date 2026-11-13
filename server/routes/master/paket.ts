import { Router } from 'express';
import { all, get, run, withTransaction } from '../../db.pg.ts';
import { asyncHandler, bacaPaginasi, pesanKesalahan, polaCari, tolak } from '../../lib/http.ts';
import { catatAudit } from '../../lib/audit.ts';
import { penggunaSaatIni } from '../../lib/akses.ts';
import { bacaExcel, tulisExcel } from '../../lib/excel.ts';
import {
  GalatImpor,
  PemantauUnik,
  PengumpulImpor,
  angkaToleran,
  bacaOpsiImpor,
  cetakDebugImpor,
  jejakUrungAman,
  nomorBaris,
  pemetaanOtomatis,
  simpanErrorBatch,
  teksBersih,
  teksKode,
  type JejakUrung,
} from '../../lib/imporBersama.ts';
import { urungkanBatch } from '../imporUrungkan.ts';

interface IsiMasuk {
  product_id: number;
  qty: number;
}

interface PaketMasuk {
  kode_box: string;
  barcode_box: string | null;
  nama: string;
  items: IsiMasuk[];
}

async function validasiPaket(body: Record<string, unknown>, kecualiPackId?: number): Promise<PaketMasuk> {
  const kode_box = String(body.kode_box ?? '').trim();
  if (!kode_box) throw tolak(400, 'Kode box wajib diisi.');
  if (kode_box.length > 60) throw tolak(400, 'Kode box maksimal 60 karakter.');

  const nama = String(body.nama ?? '').trim();
  if (!nama) throw tolak(400, 'Nama paket wajib diisi.');

  const barcodeRaw = body.barcode_box;
  const barcode_box =
    barcodeRaw === null || barcodeRaw === undefined || String(barcodeRaw).trim() === '' ? null : String(barcodeRaw).trim();
  if (barcode_box && barcode_box.length > 80) throw tolak(400, 'Barcode box maksimal 80 karakter.');
  if (barcode_box) {
    const diProduk = await get<{ id: number }>(`SELECT id FROM products WHERE barcode = ?`, barcode_box);
    if (diProduk) throw tolak(409, `Barcode "${barcode_box}" sudah dipakai produk.`);
    const diPaketLain = kecualiPackId
      ? await get<{ id: number }>(`SELECT id FROM packs WHERE barcode_box = ? AND id <> ?`, barcode_box, kecualiPackId)
      : await get<{ id: number }>(`SELECT id FROM packs WHERE barcode_box = ?`, barcode_box);
    if (diPaketLain) throw tolak(409, `Barcode "${barcode_box}" sudah dipakai paket/box lain.`);
  }

  const itemsRaw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  if (itemsRaw.length === 0) throw tolak(400, 'Paket harus memiliki minimal satu isi produk.');

  const lihat = new Set<number>();
  const items: IsiMasuk[] = await Promise.all(itemsRaw.map(async (i) => {
    const product_id = Number(i.product_id);
    if (!Number.isInteger(product_id) || !await get<{ id: number }>('SELECT id FROM products WHERE id = ?', product_id)) {
      throw tolak(400, 'Produk isi paket tidak ditemukan.');
    }
    if (lihat.has(product_id)) throw tolak(409, 'Produk kembar dalam daftar isi paket.');
    lihat.add(product_id);
    const qty = Number(i.qty);
    if (Number.isNaN(qty) || qty <= 0) throw tolak(400, 'Qty isi paket harus lebih dari 0.');
    return { product_id, qty };
  }));

  return { kode_box, barcode_box, nama, items };
}

export function routerPaket(): Router {
  const r = Router();

  const SELECT_PAKET = `
    SELECT pk.*,
           (SELECT COUNT(*) FROM pack_items pi WHERE pi.pack_id = pk.id) AS jumlah_produk,
           (SELECT COALESCE(SUM(pi.qty), 0) FROM pack_items pi WHERE pi.pack_id = pk.id) AS total_pcs
    FROM packs pk`;

  // Daftar paket (pencarian menembus kode box, barcode box, nama, SKU isi)
  r.get('/', async (req, res) => {
    const p = bacaPaginasi(req, { urutBawaan: 'nama', urutDiizinkan: ['nama', 'kode_box', 'total_pcs', 'dibuat_pada'] });
    const syarat: string[] = [];
    const params: unknown[] = [];
    if (p.cari) {
      syarat.push(
        `(pk.nama ILIKE ? ESCAPE '\\' OR pk.kode_box ILIKE ? ESCAPE '\\' OR pk.barcode_box ILIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM pack_items pi JOIN products p ON p.id = pi.product_id
                     WHERE pi.pack_id = pk.id AND p.sku ILIKE ? ESCAPE '\\'))`,
      );
      params.push(polaCari(p.cari), polaCari(p.cari), polaCari(p.cari), polaCari(p.cari));
    }
    if (req.query.barcode === 'sudah') syarat.push('pk.barcode_box IS NOT NULL');
    if (req.query.barcode === 'belum') syarat.push('pk.barcode_box IS NULL');
    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';
    const urut = p.urut === 'total_pcs'
      ? `(SELECT COALESCE(SUM(pi.qty), 0) FROM pack_items pi WHERE pi.pack_id = pk.id)`
      : `pk.${p.urut}`;

    const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM packs pk ${where}`, ...params)))?.n ?? 0);
    const data = await all<Record<string, unknown>>(`${SELECT_PAKET} ${where} ORDER BY ${urut} ${p.arah}, pk.id ASC LIMIT ? OFFSET ?`, ...params, p.per, p.offset);
    res.json({ data, total, hal: p.hal, per: p.per });
  });

  // Ekspor: satu baris per paket dengan rincian isi
  r.get('/ekspor', async (_req, res) => {
    const pakets = await all<Record<string, unknown>>(`${SELECT_PAKET} ORDER BY pk.nama ASC`);
    const isiPerPaket = new Map<number, string>();
    for (const i of await all<Record<string, unknown>>(
      `SELECT pi.pack_id, pi.qty, p.sku FROM pack_items pi JOIN products p ON p.id = pi.product_id ORDER BY p.sku`,
    )) {
      const prev = isiPerPaket.get(Number(i.pack_id));
      const teks = `${String(i.sku)} x${Number(i.qty)}`;
      isiPerPaket.set(Number(i.pack_id), prev ? `${prev}; ${teks}` : teks);
    }
    const kolom = [
      { key: 'kode_box', label: 'Kode Box' },
      { key: 'barcode_box', label: 'Barcode Box' },
      { key: 'nama', label: 'Nama Paket' },
      { key: 'jumlah_produk', label: 'Jumlah Produk' },
      { key: 'total_pcs', label: 'Total Pcs' },
      { key: 'isi', label: 'Isi (SKU xQty)' },
    ];
    const buffer = await tulisExcel('Paket', kolom, pakets.map((pk) => ({ ...pk, isi: isiPerPaket.get(Number(pk.id)) ?? '' })));
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="paket-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      })
      .send(buffer);
  });

  r.get('/template', async (_req, res) => {
    const kolom = [
      { key: 'kode_box', label: 'Kode Box' },
      { key: 'barcode_box', label: 'Barcode Box' },
      { key: 'nama', label: 'Nama Paket' },
      { key: 'isi', label: 'Isi (SKU xQty)' },
    ];
    const buffer = await tulisExcel('Paket', kolom, []);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-paket.xlsx"',
      })
      .send(buffer);
  });

  // Impor: baris = paket, kolom "Isi (SKU xQty)" dipisah ';' lalu 'x' (mesin bersama)
  r.post(
    '/impor',
    asyncHandler(async (req, res) => {
      const { nama_file, data_base64 } = (req.body ?? {}) as { nama_file?: string; data_base64?: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const opsi = bacaOpsiImpor((body.opsi && typeof body.opsi === 'object' ? body.opsi : body) as Record<string, unknown>);
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom: headerPaket, baris: mentahPaket } = await bacaExcel(buffer);
      if (!mentahPaket.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');

      // Judul kolom dibaca otomatis (fuzzy: "Kode"/"Kode Box", "Nama"/"Nama Paket",
      // "Isi"/"Isi (SKU xQty)") dari daftar kolom template yang sama.
      const petaPaket = pemetaanOtomatis(
        [
          { key: 'kode_box', label: 'Kode Box' },
          { key: 'barcode_box', label: 'Barcode Box' },
          { key: 'nama', label: 'Nama Paket' },
          { key: 'isi', label: 'Isi (SKU xQty)' },
        ],
        headerPaket,
      );
      const adaJudulPaket = headerPaket.length ? ` (terdeteksi: ${headerPaket.join(', ')})` : '';
      if (!petaPaket.kode_box) throw tolak(400, `Kolom "Kode Box" tidak ada di file Excel${adaJudulPaket}.`);
      if (!petaPaket.nama) throw tolak(400, `Kolom "Nama Paket" tidak ada di file Excel${adaJudulPaket}.`);
      if (!petaPaket.isi) throw tolak(400, `Kolom "Isi (SKU xQty)" tidak ada di file Excel${adaJudulPaket}.`);
      const baris = mentahPaket.map((r) => ({
        'Kode Box': petaPaket.kode_box ? r[petaPaket.kode_box] : undefined,
        'Barcode Box': petaPaket.barcode_box ? r[petaPaket.barcode_box] : undefined,
        'Nama Paket': petaPaket.nama ? r[petaPaket.nama] : undefined,
        'Isi (SKU xQty)': petaPaket.isi ? r[petaPaket.isi] : undefined,
      }));

      const pengguna = penggunaSaatIni(req);
      const kumpul = new PengumpulImpor();
      const pantauKode = new PemantauUnik('Kode box');
      type BarisSiap = {
        nomor: number;
        ada: boolean;
        packId: number;
        isi: { kode_box: string; barcode_box: string | null; nama: string; items: IsiMasuk[] };
        packsLama: Record<string, unknown> | null;
        itemsLama: Record<string, unknown>[];
      };
      const siap: BarisSiap[] = [];

      const parseIsi = async (teks: string): Promise<IsiMasuk[]> => {
        const items: IsiMasuk[] = [];
        const lihat = new Set<string>();
        for (const potong of teks.split(';')) {
          const segmen = potong.trim();
          if (!segmen) continue;
          const [skuRaw, qtyRaw] = segmen.split(/\s*x\s*/i);
          const sku = teksKode(skuRaw);
          if (!sku) throw new GalatImpor('isi', `Bagian "${segmen}" tidak memiliki SKU.`);
          const v = await get<{ id: number }>(`SELECT id FROM products WHERE sku ILIKE ? AND deleted_at IS NULL`, sku);
          if (!v) throw new GalatImpor('isi', `SKU "${sku}" tidak ditemukan.`, sku);
          const jumlah = angkaToleran(qtyRaw, `Qty untuk SKU "${sku}"`);
          if (jumlah === null || jumlah <= 0) {
            throw new GalatImpor('isi', `Qty untuk SKU "${sku}" tidak valid.`, qtyRaw);
          }
          const kunci = sku.toLowerCase();
          if (lihat.has(kunci)) throw new GalatImpor('isi', `SKU "${sku}" kembar dalam satu baris isi.`, sku);
          lihat.add(kunci);
          items.push({ product_id: Number(v.id), qty: jumlah });
        }
        if (!items.length) {
          throw new GalatImpor('isi', 'Isi (SKU xQty) kosong. Contoh: SKU-A x12; SKU-B x4');
        }
        return items;
      };

      cetakDebugImpor('paket/impor', baris, async (b) => {
        if (!teksKode(b['Kode Box'])) throw new GalatImpor('kode_box', 'Kode box wajib diisi.', b['Kode Box']);
        if (!teksBersih(b['Nama Paket'])) throw new GalatImpor('nama', 'Nama paket wajib diisi.', b['Nama Paket']);
        await parseIsi(teksBersih(b['Isi (SKU xQty)']));
      });

      barisBerikutnya: for (const [idx, raw] of baris.entries()) {
        const nomor = nomorBaris(idx);
        try {
          const kodeBox = teksKode(raw['Kode Box']);
          if (!kodeBox) throw new GalatImpor('kode_box', 'Kode box wajib diisi.', raw['Kode Box']);
          if (kodeBox.length > 60) throw new GalatImpor('kode_box', 'Kode box maksimal 60 karakter.', raw['Kode Box']);
          const nama = teksBersih(raw['Nama Paket']);
          if (!nama) throw new GalatImpor('nama', 'Nama paket wajib diisi.', raw['Nama Paket']);

          const barcodeRaw = teksKode(raw['Barcode Box']);
          if (barcodeRaw && barcodeRaw.length > 80) {
            throw new GalatImpor('barcode_box', 'Barcode box maksimal 80 karakter.', raw['Barcode Box']);
          }
          if (barcodeRaw) {
            const diProduk = await get<{ id: number }>(`SELECT id FROM products WHERE barcode = ?`, barcodeRaw);
            if (diProduk) throw new GalatImpor('barcode_box', `Barcode "${barcodeRaw}" sudah dipakai produk.`, barcodeRaw);
          }

          const items = await parseIsi(teksBersih(raw['Isi (SKU xQty)']));
          pantauKode.cek(kodeBox, nomor);

          const ada = await get<{ id: number }>(`SELECT id FROM packs WHERE kode_box ILIKE ?`, kodeBox);
          if (ada && !opsi.perbarui) {
            kumpul.ingatkan(nomor, 'kode_box', `Paket "${kodeBox}" sudah ada — baris dilewati (opsi perbarui mati).`);
            continue barisBerikutnya;
          }
          if (barcodeRaw && ada) {
            const diPaketLain = await get<{ id: number }>(`SELECT id FROM packs WHERE barcode_box = ? AND id <> ?`, barcodeRaw, Number(ada.id));
            if (diPaketLain) {
              throw new GalatImpor('barcode_box', `Barcode "${barcodeRaw}" sudah dipakai paket/box lain.`, barcodeRaw);
            }
          }

          const packId = ada ? Number(ada.id) : null;
          const packsLama = packId ? await get<Record<string, unknown>>(`SELECT * FROM packs WHERE id = ?`, packId) : null;
          const itemsLama = packId
            ? await all<Record<string, unknown>>(`SELECT * FROM pack_items WHERE pack_id = ?`, packId)
            : [];
          siap.push({
            nomor,
            ada: !!ada,
            packId: packId ?? 0,
            isi: { kode_box: kodeBox, barcode_box: barcodeRaw || null, nama, items },
            packsLama: packsLama ?? null,
            itemsLama,
          });
        } catch (err) {
          kumpul.tolakDari(err, nomor, {
            'Kode Box': raw['Kode Box'],
            'Barcode Box': raw['Barcode Box'],
            'Nama Paket': raw['Nama Paket'],
            'Isi (SKU xQty)': raw['Isi (SKU xQty)'],
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
        `INSERT INTO import_batches (modul, nama_file, total_baris, status, user_id) VALUES ('paket', ?, ?, 'diproses', ?)`,
        nama_file ?? 'impor-paket.xlsx',
        baris.length,
        pengguna.id,
      ))).lastInsertRowid;

      const jejak: JejakUrung[] = [];
      await withTransaction(async () => {
        for (const s of siap) {
          if (s.ada) {
            await run(`UPDATE packs SET barcode_box = ?, nama = ?, diubah_pada = ? WHERE id = ?`, s.isi.barcode_box, s.isi.nama, new Date().toISOString(), s.packId);
            await run(`DELETE FROM pack_items WHERE pack_id = ?`, s.packId);
            for (const i of s.isi.items) await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, ?)`, s.packId, i.product_id, i.qty);
            const sesudah = (await get<Record<string, unknown>>(`SELECT * FROM packs WHERE id = ?`, s.packId))!
            await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'packs', recordId: s.packId, sebelum: s.packsLama, sesudah });
            jejak.push({
              aksi: 'perbarui',
              tabel: 'packs',
              id: s.packId,
              sebelum: s.packsLama,
              turunan: [{ tabel: 'pack_items', baris: s.itemsLama, kunciInduk: 'pack_id' }],
            });
          } else {
            const packId = Number(
              await ((await run(`INSERT INTO packs (kode_box, barcode_box, nama, dibuat_oleh) VALUES (?, ?, ?, ?)`, s.isi.kode_box, s.isi.barcode_box, s.isi.nama, pengguna.id)))
                .lastInsertRowid,
            );
            for (const i of s.isi.items) await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, ?)`, packId, i.product_id, i.qty);
            await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'packs', recordId: packId, sesudah: s.isi });
            jejak.push({ aksi: 'tambah', tabel: 'packs', id: packId });
          }
        }
        await simpanErrorBatch(Number(batch), kumpul.kesalahan);
        await run(
          `UPDATE import_batches SET baris_valid = ?, baris_error = ?, status = ?, undo_data = ? WHERE id = ?`,
          siap.length,
          kumpul.jumlahError,
          siap.length === 0 && kumpul.jumlahError > 0 ? 'gagal' : 'selesai',
          jejakUrungAman(jejak),
          Number(batch),
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'impor',
          tabel: 'packs',
          recordId: Number(batch),
          sesudah: {
            nama_file: nama_file ?? 'impor-paket.xlsx',
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

  // AB3 — Urungkan impor paket.
  r.post('/impor/urungkan', urungkanBatch(['paket']));

  // Detail paket + isi
  r.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const paket = await get<Record<string, unknown>>(`${SELECT_PAKET} WHERE pk.id = ?`, id);
    if (!paket) throw tolak(404, 'Paket tidak ditemukan.');
    const items = await all<Record<string, unknown>>(
      `SELECT pi.*, p.sku, p.barcode, p.nama AS produk_nama
       FROM pack_items pi
       JOIN products p ON p.id = pi.product_id
       WHERE pi.pack_id = ?
       ORDER BY p.sku`,
      id,
    );
    res.json({ data: { ...paket, items } });
  });

  const simpan = asyncHandler(async (req, res) => {
    const id = req.params.id ? Number(req.params.id) : null;
    const pengguna = penggunaSaatIni(req);
    const isi = await validasiPaket((req.body ?? {}) as Record<string, unknown>);
    const lama = id ? await get<Record<string, unknown>>(`SELECT * FROM packs WHERE id = ?`, id) : null;
    if (id && !lama) throw tolak(404, 'Paket tidak ditemukan.');

    const idHasil = await withTransaction(async () => {
      let packId: number;
      if (id) {
        await run(`UPDATE packs SET kode_box = ?, barcode_box = ?, nama = ?, diubah_pada = ? WHERE id = ?`, isi.kode_box, isi.barcode_box, isi.nama, new Date().toISOString(), id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'packs', recordId: id, sebelum: lama, sesudah: isi });
        packId = id;
        await run(`DELETE FROM pack_items WHERE pack_id = ?`, packId);
      } else {
        packId = Number(await ((await run(`INSERT INTO packs (kode_box, barcode_box, nama, dibuat_oleh) VALUES (?, ?, ?, ?)`, isi.kode_box, isi.barcode_box, isi.nama, pengguna.id))).lastInsertRowid);
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'packs', recordId: packId, sesudah: isi });
      }
      for (const i of isi.items) await run(`INSERT INTO pack_items (pack_id, product_id, qty) VALUES (?, ?, ?)`, packId, i.product_id, i.qty);
      return packId;
    });

    res.status(id ? 200 : 201).json({ id: idHasil });
  });

  r.post('/', simpan);
  r.put('/:id', simpan);

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM packs WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Paket tidak ditemukan.');
      try {
        await withTransaction(async () => {
          await run(`DELETE FROM packs WHERE id = ?`, id);
          await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'packs', recordId: id, sebelum: lama });
        });
      } catch (err) {
        const { pesan } = pesanKesalahan(err);
        if (/Data terkait|FOREIGN KEY/i.test(pesan)) throw tolak(409, 'Paket masih dipakai dokumen pembelian dan tidak bisa dihapus.');
        throw err;
      }
      res.json({ ok: true });
    }),
  );

  return r;
}
