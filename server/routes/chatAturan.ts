// BAGIAN AG3/AG10 — API Aturan Chatbot: Operator Db/Tp, Alias Barang
// (lihat/edit/hapus/impor/ekspor Excel), Ambang Kecocokan, dan log pencocokan.
// Hanya Admin/Manajer yang boleh mengubah; setiap perubahan tercatat di log
// aktivitas (catatAudit) sesuai AG10.
import { Router, type RequestHandler } from 'express';
import { all, get, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { bacaExcel, tulisExcel } from '../lib/excel.ts';
import {
  AMBANG_BAWAAN,
  daftarAlias,
  daftarOperator,
  hapusAlias,
  muatAmbang,
  simpanAlias,
  kunciAlias,
  normalisasi,
} from '../lib/cocok.ts';

/** AG10 — pengubah aturan hanya Admin & Manajer. */
const BOLEH_UBAH = new Set(['owner', 'administrator', 'admin', 'manajer']);
const wajibPengubah: RequestHandler = (req, _res, next) => {
  const peran = String(req.konteks?.peranKunci ?? req.headers['x-peran'] ?? '').toLowerCase().trim();
  if (!BOLEH_UBAH.has(peran)) {
    next(tolak(403, 'Pengaturan aturan Chatbot hanya untuk Admin dan Manajer.'));
    return;
  }
  next();
};

/** Kata kunci operator: array string → JSON string. */
function bacaKata(v: unknown): string[] {
  if (!Array.isArray(v)) throw tolak(400, 'kata_kunci harus berupa daftar kata.');
  const out = [...new Set(v.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  if (out.length === 0) throw tolak(400, 'Operator minimal punya satu kata kunci.');
  if (out.length > 20) throw tolak(400, 'Maksimal 20 kata kunci per operator.');
  for (const k of out) if (!/^[a-z0-9 -]{1,30}$/.test(k)) throw tolak(400, `Kata kunci "${k}" tidak valid (huruf kecil/angka/spasi).`);
  return out;
}

export function routerChatAturan(): Router {
  const r = Router();

  // =========================================================================
  // Operator komposisi (Db/Tp) — kata kunci & pengali dapat diedit/ditambah
  // =========================================================================

  r.get('/operator', async (_req, res) => {
    res.json({ data: await daftarOperator() });
  });

  r.post(
    '/operator',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const label = String(b.label ?? '').trim().slice(0, 30);
      const pengali = Number(b.pengali);
      if (!label) throw tolak(400, 'Label operator wajib diisi.');
      if (!Number.isInteger(pengali) || pengali < 0 || pengali > 99) throw tolak(400, 'Pengali harus bilangan bulat 0–99.');
      const kata = bacaKata(b.kata_kunci);
      const pengguna = penggunaSaatIni(req);
      if (await get<{ id: number }>(`SELECT id FROM operator_komposisi WHERE label ILIKE ?`, label)) {
        throw tolak(409, `Operator "${label}" sudah ada.`);
      }
      const id = await withTransaction(async () => {
        const baru = Number(
          await ((await run(`INSERT INTO operator_komposisi (label, pengali, kata_kunci) VALUES (?, ?, ?)`, label, pengali, JSON.stringify(kata))))
            .lastInsertRowid,
        );
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'operator_komposisi', recordId: baru, sesudah: { label, pengali, kata_kunci: kata } });
        return baru;
      });
      res.status(201).json((await daftarOperator()).find((o) => o.id === id));
    }),
  );

  r.put(
    '/operator/:id',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = (await daftarOperator()).find((o) => o.id === id);
      if (!lama) throw tolak(404, 'Operator tidak ditemukan.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const label = b.label === undefined ? lama.label : String(b.label).trim().slice(0, 30);
      const pengali = b.pengali === undefined ? lama.pengali : Number(b.pengali);
      if (!label) throw tolak(400, 'Label operator wajib diisi.');
      if (!Number.isInteger(pengali) || pengali < 0 || pengali > 99) throw tolak(400, 'Pengali harus bilangan bulat 0–99.');
      const kata = bacaKata(b.kata_kunci ?? lama.kata_kunci);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(
          `UPDATE operator_komposisi SET label = ?, pengali = ?, kata_kunci = ?,
                  aktif = ?, diubah_pada = now() WHERE id = ?`,
          label,
          pengali,
          JSON.stringify(kata),
          b.aktif === undefined ? (lama.aktif ? 1 : 0) : b.aktif ? 1 : 0,
          id,
        );
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'operator_komposisi', recordId: id, sebelum: lama, sesudah: { label, pengali, kata_kunci: kata } });
      });
      res.json((await daftarOperator()).find((o) => o.id === id));
    }),
  );

  r.delete(
    '/operator/:id',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = (await daftarOperator()).find((o) => o.id === id);
      if (!lama) throw tolak(404, 'Operator tidak ditemukan.');
      const jumlah = (await daftarOperator()).filter((o) => o.aktif).length;
      if (lama.aktif && jumlah <= 1) throw tolak(409, 'Minimal ada satu operator aktif.');
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(`DELETE FROM operator_komposisi WHERE id = ?`, id);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'operator_komposisi', recordId: id, sebelum: lama });
      });
      res.json({ ok: true });
    }),
  );

  // =========================================================================
  // Alias Barang — teks ternormalisasi → produk/grup (opsional per pemasok)
  // =========================================================================

  r.get('/alias', async (req, res) => {
    res.json({ data: await daftarAlias(String(req.query.cari ?? '')) });
  });

  r.post(
    '/alias',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const teks = String(b.teks ?? '');
      const productId = b.product_id ? Number(b.product_id) : null;
      const supplierId = b.supplier_id ? Number(b.supplier_id) : null;
      const grup = b.grup ? normalisasi(String(b.grup)) : null;
      if (!kunciAlias(teks)) throw tolak(400, 'Teks alias wajib diisi.');
      if (!productId && !grup) throw tolak(400, 'Alias harus menunjuk produk atau grup barang.');
      if (productId && !await get<{ id: number }>(`SELECT id FROM products WHERE id = ?`, productId)) {
        throw tolak(404, 'Produk tidak ditemukan.');
      }
      if (supplierId && !await get<{ id: number }>(`SELECT id FROM suppliers WHERE id = ?`, supplierId)) {
        throw tolak(404, 'Pemasok tidak ditemukan.');
      }
      const pengguna = penggunaSaatIni(req);
      const hasil = await withTransaction(async () => {
        const ada = await simpanAlias({ teks, product_id: productId, grup, supplier_id: supplierId });
        await catatAudit({
          userId: pengguna.id,
          aksi: ada ? 'ubah' : 'tambah',
          tabel: 'alias_barang',
          recordId: ada?.id ?? 0,
          sesudah: { teks: kunciAlias(teks), product_id: productId, grup, supplier_id: supplierId },
        });
        return ada;
      });
      res.status(201).json(hasil ?? { ok: true });
    }),
  );

  r.put(
    '/alias/:id',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM alias_barang WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Alias tidak ditemukan.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const teks = b.teks === undefined ? String(lama.teks) : kunciAlias(String(b.teks));
      const productId = b.product_id === undefined ? (lama.product_id == null ? null : Number(lama.product_id)) : b.product_id ? Number(b.product_id) : null;
      const supplierId = b.supplier_id === undefined ? (lama.supplier_id == null ? null : Number(lama.supplier_id)) : b.supplier_id ? Number(b.supplier_id) : null;
      const grup = b.grup === undefined ? (lama.grup == null ? null : String(lama.grup)) : b.grup ? normalisasi(String(b.grup)) : null;
      if (!teks) throw tolak(400, 'Teks alias wajib diisi.');
      if (!productId && !grup) throw tolak(400, 'Alias harus menunjuk produk atau grup barang.');
      const pengguna = penggunaSaatIni(req);
      const bentrok = await get<{ id: number }>(`SELECT id FROM alias_barang WHERE teks = ? AND id <> ?`, teks, id);
      if (bentrok) throw tolak(409, 'Alias dengan teks itu sudah ada.');
      await withTransaction(async () => {
        await run(`UPDATE alias_barang SET teks = ?, product_id = ?, grup = ?, supplier_id = ? WHERE id = ?`, teks, productId, grup, supplierId, id);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'alias_barang', recordId: id, sebelum: lama, sesudah: { teks, product_id: productId, grup, supplier_id: supplierId } });
      });
      res.json((await daftarAlias()).find((a) => a.id === id));
    }),
  );

  r.delete(
    '/alias/:id',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM alias_barang WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Alias tidak ditemukan.');
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await hapusAlias(id);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'alias_barang', recordId: id, sebelum: lama });
      });
      res.json({ ok: true });
    }),
  );

  /** Ekspor alias → .xlsx (kolom: Teks, Produk, Grup, Pemasok, Pakai, Terakhir). */
  r.get(
    '/alias/ekspor',
    asyncHandler(async (_req, res) => {
      const baris = (await daftarAlias()).map((a) => ({
        teks: a.teks,
        produk: a.produk_nama ?? '',
        grup: a.grup ?? '',
        pemasok: a.pemasok_nama ?? '',
        pakai: a.pakai,
        terakhir: a.terakhir_pakai,
      }));
      const buf = await tulisExcel(
        'Alias Barang',
        [
          { key: 'teks', label: 'Teks Alias' },
          { key: 'produk', label: 'Produk' },
          { key: 'grup', label: 'Grup' },
          { key: 'pemasok', label: 'Pemasok' },
          { key: 'pakai', label: 'Dipakai' },
          { key: 'terakhir', label: 'Terakhir Dipakai' },
        ],
        baris,
      );
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="alias-barang.xlsx"');
      res.send(buf);
    }),
  );

  /** Impor alias dari .xlsx (data_base64) — UPSERT per teks. */
  r.post(
    '/alias/impor',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const { data_base64 } = (req.body ?? {}) as { data_base64?: string };
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { baris } = await bacaExcel(buffer);
      const pengguna = penggunaSaatIni(req);
      let masuk = 0;
      let dilewat = 0;
      const galat: string[] = [];
      await withTransaction(async () => {
        for (const raw of baris.slice(0, 5000)) {
          const teks = kunciAlias(String(raw.teks ?? raw['Teks Alias'] ?? ''));
          const namaProduk = String(raw.produk ?? raw.Produk ?? '').trim();
          const namaGrup = String(raw.grup ?? raw.Grup ?? '').trim();
          const namaPemasok = String(raw.pemasok ?? raw.Pemasok ?? '').trim();
          if (!teks) {
            dilewat++;
            continue;
          }
          const produk = namaProduk
            ? await get<{ id: number }>(`SELECT id FROM products WHERE nama ILIKE ? AND deleted_at IS NULL`, namaProduk)
            : null;
          const grup = namaGrup ? normalisasi(namaGrup) : null;
          if (!produk && !grup) {
            dilewat++;
            if (galat.length < 5) galat.push(`"${teks}": produk/grup "${namaProduk || namaGrup}" tidak ditemukan.`);
            continue;
          }
          const pemasok = namaPemasok ? await get<{ id: number }>(`SELECT id FROM suppliers WHERE nama ILIKE ?`, namaPemasok) : null;
          await simpanAlias({ teks, product_id: produk?.id ?? null, grup, supplier_id: pemasok?.id ?? null });
          masuk++;
        }
        await catatAudit({ userId: pengguna.id, aksi: 'impor', tabel: 'alias_barang', recordId: 0, sesudah: { masuk, dilewat } });
      });
      res.json({ masuk, dilewat, contoh_galat: galat });
    }),
  );

  // =========================================================================
  // Ambang kecocokan (AG5 — dapat diatur)
  // =========================================================================

  r.get('/ambang', async (_req, res) => {
    res.json({ data: await muatAmbang(), bawaan: AMBANG_BAWAAN });
  });

  r.put(
    '/ambang',
    wajibPengubah,
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const nilai = (v: unknown, batas: [number, number]): number => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < batas[0] || n > batas[1]) throw tolak(400, `Nilai ambang harus antara ${batas[0]}–${batas[1]}.`);
        return Math.round(n);
      };
      const yakin = nilai(b.yakin, [50, 100]);
      const selisih = nilai(b.selisih, [0, 50]);
      const kabur = nilai(b.kabur, [10, 99]);
      if (kabur > yakin) throw tolak(400, 'Ambang "tidak ditemukan" tidak boleh lebih besar dari ambang "yakin".');
      const pengguna = penggunaSaatIni(req);
      const sebelum = await muatAmbang();
      const tulis = async (kunci: string, nilaiBaru: number) =>
        await run(
          `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
           ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
          kunci,
          String(nilaiBaru),
        );
      await withTransaction(async () => {
        await tulis('cocok_ambang_yakin', yakin);
        await tulis('cocok_ambang_selisih', selisih);
        await tulis('cocok_ambang_kabur', kabur);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'settings', recordId: 'cocok_ambang', sebelum, sesudah: { yakin, selisih, kabur } });
      });
      res.json({ data: await muatAmbang() });
    }),
  );

  // =========================================================================
  // Log pencocokan (AG3) — teks, hasil, skor, pengguna
  // =========================================================================

  r.get('/log', async (req, res) => {
    const batas = Math.min(500, Math.max(1, Number(req.query.batas) || 100));
    res.json({
      data: await all<Record<string, unknown>>(
        `SELECT l.id, l.tipe, l.teks, l.hasil, l.skor, l.product_id, l.supplier_id, l.waktu,
                u.nama AS pengguna, p.nama AS produk, s.nama AS pemasok
           FROM chat_match_logs l
           LEFT JOIN users u ON u.id = l.pengguna_id
           LEFT JOIN products p ON p.id = l.product_id
           LEFT JOIN suppliers s ON s.id = l.supplier_id
          ORDER BY l.id DESC LIMIT ?`,
        batas,
      ),
    });
  });

  return r;
}
