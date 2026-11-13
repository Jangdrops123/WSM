import { Router, type Request } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, bacaPaginasi, polaCari, tolak } from '../lib/http.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { syaratGudangSesi, wajibGudangDiizinkan } from '../lib/hak.ts';
import { buatFakturPembelian, buatFakturPenjualan, templateBawaan, type JenisFaktur } from '../lib/faktur.ts';

/**
 * API BAGIAN I — Faktur otomatis & template faktur.
 *
 *  - Daftar/detail faktur (dibuka ulang dari Daftar Dokumen).
 *  - CRUD template (blok, urutan kolom, ukuran font, warna aksen, teks tetap,
 *    ukuran kertas + margin + skala) dan penetapan template bawaan per jenis.
 *  - Pengaturan faktur: prefix nomor, identitas toko, aturan per kodi.
 *
 * Pembuatan faktur sendiri terjadi di alur pengesahan (POS & Pembelian).
 */

const JENIS = new Set(['penjualan', 'pembelian', 'surat_jalan']);
const JENIS_FAKTUR = new Set(['penjualan', 'pembelian']);

/** Ukuran kertas yang didukung (mm) — dipakai juga untuk CSS @page. */
export const UKURAN_KERTAS: Record<string, { lebar: number; tinggi: number }> = {
  A4: { lebar: 210, tinggi: 297 },
  A5: { lebar: 148, tinggi: 210 },
  A6: { lebar: 105, tinggi: 148 },
  Letter: { lebar: 215.9, tinggi: 279.4 },
  Legal: { lebar: 215.9, tinggi: 355.6 },
  '58mm': { lebar: 58, tinggi: 200 },
  '80mm': { lebar: 80, tinggi: 200 },
  HalfA4: { lebar: 279.4, tinggi: 215.9 }, // continuous form 9.5" × 11" (landscape A4 setengah)
};

const KOLOM_DIKENAL = new Set(['kode', 'nama', 'qty', 'satuan', 'harga', 'diskon', 'subtotal']);
const RATA_DIKENAL = new Set(['kiri', 'tengah', 'kanan']);
const SATUAN_LEBAR_DIKENAL = new Set(['%', 'mm']);
const SINGKAT_DIKENAL = new Set(['auto', 'ya', 'tidak']);
const BLOK_DIKENAL = new Set([
  'logo', 'alamat', 'telepon', 'nomor', 'pihak', 'gudang', 'kolom_kode', 'kolom_satuan',
  'kolom_diskon', 'terbilang', 'total_qty', 'tanda_tangan', 'catatan', 'rekening',
]);
const KUNCI_PENGATURAN = new Set([
  'faktur_prefix_penjualan', 'faktur_prefix_pembelian',
  'nama_usaha', 'alamat_usaha', 'telepon_usaha', 'logo_usaha',
]);

const angka = (v: unknown, min: number, max: number, bawaan: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : bawaan;
};

/** JSON aman: nilai rusak jatuh ke nilai bawaan (tidak melempar 500). */
function amanJson<T>(v: unknown, bawaan: T): T {
  try {
    return JSON.parse(String(v ?? '')) as T;
  } catch {
    return bawaan;
  }
}

/** Validasi & normalisasi body template. */
function bacaTemplate(body: Record<string, unknown>, lama?: Record<string, unknown>) {
  const ambil = <T>(kunci: string, bawaan: T): T => (body[kunci] !== undefined ? (body[kunci] as T) : (lama?.[kunci] as T) ?? bawaan);

  const jenis = String(ambil('jenis', 'penjualan'));
  if (!JENIS.has(jenis)) throw tolak(400, 'Jenis template tidak dikenal (Penjualan / Pembelian / Surat Jalan).');
  const nama = String(ambil('nama', '') ?? '').trim();
  if (!nama) throw tolak(400, 'Nama template wajib diisi.');

  const kertas = String(ambil('kertas', 'A4'));
  const dikenal = kertas === 'custom' || kertas in UKURAN_KERTAS;
  if (!dikenal) throw tolak(400, `Ukuran kertas "${kertas}" tidak didukung.`);

  const orientasi = String(ambil('orientasi', 'portrait'));
  if (!['portrait', 'landscape'].includes(orientasi)) throw tolak(400, 'Orientasi hanya portrait atau landscape.');

  const lebarMm = kertas === 'custom' ? angka(ambil('lebar_mm', 0), 20, 1000, 210) : null;
  const tinggiMm = kertas === 'custom' ? angka(ambil('tinggi_mm', 0), 20, 1000, 297) : null;
  if (kertas === 'custom' && (!lebarMm || !tinggiMm)) throw tolak(400, 'Ukuran kustom wajib mengisi lebar × tinggi (mm atau cm).');

  const urut: unknown = body['urutan_kolom'] !== undefined ? body['urutan_kolom'] : lama?.['urutan_kolom'];
  let urutanKolom: string[] | null = null;
  if (Array.isArray(urut)) {
    const bersih = (urut as unknown[]).map((x) => String(x)).filter((x) => KOLOM_DIKENAL.has(x));
    for (const k of ['nama', 'qty', 'subtotal']) if (!bersih.includes(k)) bersih.push(k);
    if (bersih.length < 3) throw tolak(400, 'Urutan kolom tidak valid — minimal nama, jumlah, subtotal.');
    urutanKolom = bersih;
  }

  const blok: unknown = body['blok'] !== undefined ? body['blok'] : lama?.['blok'];
  let blokBersih: Record<string, boolean> | null = null;
  if (blok && typeof blok === 'object' && !Array.isArray(blok)) {
    blokBersih = {};
    for (const [k, v] of Object.entries(blok as Record<string, unknown>)) {
      if (BLOK_DIKENAL.has(k)) blokBersih[k] = Boolean(v);
    }
  }

  const teks: unknown = body['teks'] !== undefined ? body['teks'] : lama?.['teks'];
  let teksBersih: Record<string, string> | null = null;
  if (teks && typeof teks === 'object' && !Array.isArray(teks)) {
    teksBersih = {};
    for (const [k, v] of Object.entries(teks as Record<string, unknown>)) {
      teksBersih[k] = String(v).slice(0, 500);
    }
  }

  const aksen = String(ambil('aksen', '#2563eb'));
  if (!/^#[0-9a-fA-F]{3,8}$/.test(aksen)) throw tolak(400, 'Warna aksen harus berupa heksadesimal (mis. #2563eb).');

  // Pengaturan kolom per kolom tabel (BAGIAN K4): nama ganti, lebar
  // (Otomatis/%/mm), rata (kiri/tengah/kanan). Nilai rusak dibuang per kunci.
  const pk: unknown = body['pengaturan_kolom'] !== undefined ? body['pengaturan_kolom'] : lama?.['pengaturan_kolom'];
  let pkBersih: Record<string, unknown> | null = null;
  if (pk && typeof pk === 'object' && !Array.isArray(pk)) {
    pkBersih = {};
    for (const [k, v] of Object.entries(pk as Record<string, unknown>)) {
      if (!KOLOM_DIKENAL.has(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
      const o = v as Record<string, unknown>;
      const hasil: Record<string, unknown> = {};
      if (typeof o['nama'] === 'string' && o['nama'].trim()) hasil['nama'] = o['nama'].trim().slice(0, 40);
      if (o['lebar'] !== null && o['lebar'] !== undefined) {
        const n = Number(o['lebar']);
        if (Number.isFinite(n) && n > 0 && n <= 500) hasil['lebar'] = Math.round(n * 10) / 10;
      }
      const sl = String(o['satuan_lebar'] ?? '%');
      if (SATUAN_LEBAR_DIKENAL.has(sl)) hasil['satuan_lebar'] = sl;
      const rata = String(o['rata'] ?? '');
      if (RATA_DIKENAL.has(rata)) hasil['rata'] = rata;
      if (Object.keys(hasil).length > 0) pkBersih[k] = hasil;
    }
  }

  const singkat = String(ambil('singkat_kolom', 'auto'));
  if (!SINGKAT_DIKENAL.has(singkat)) throw tolak(400, 'Nama kolom singkat hanya auto / ya / tidak.');

  return {
    nama,
    jenis,
    kertas,
    orientasi,
    lebar_mm: lebarMm,
    tinggi_mm: tinggiMm,
    margin_atas: angka(ambil('margin_atas', 12), 0, 60, 12),
    margin_kanan: angka(ambil('margin_kanan', 12), 0, 60, 12),
    margin_bawah: angka(ambil('margin_bawah', 12), 0, 60, 12),
    margin_kiri: angka(ambil('margin_kiri', 12), 0, 60, 12),
    skala: angka(ambil('skala', 100), 50, 200, 100),
    ukuran_font: angka(ambil('ukuran_font', 10), 6, 20, 10),
    aksen,
    blok: JSON.stringify(blokBersih ?? amanJson<Record<string, boolean>>(lama?.blok, {})),
    urutan_kolom: JSON.stringify(
      urutanKolom ?? amanJson<string[]>(lama?.urutan_kolom, ['kode', 'nama', 'qty', 'satuan', 'harga', 'diskon', 'subtotal']),
    ),
    teks: JSON.stringify(teksBersih ?? amanJson<Record<string, string>>(lama?.teks, {})),
    pengaturan_kolom: JSON.stringify(pkBersih ?? amanJson<Record<string, unknown>>(lama?.pengaturan_kolom, {})),
    singkat_kolom: singkat,
  };
}

/** Bentuk respons template (JSON sudah dibuka). */
function bentukTemplate(r: Record<string, unknown>) {
  const aman = <T>(v: unknown, fallback: T): T => {
    try {
      return JSON.parse(String(v ?? '')) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: Number(r.id),
    nama: r.nama,
    jenis: r.jenis,
    bawaan: Number(r.bawaan ?? 0) === 1,
    kertas: r.kertas,
    orientasi: r.orientasi,
    lebar_mm: r.lebar_mm === null || r.lebar_mm === undefined ? null : Number(r.lebar_mm),
    tinggi_mm: r.tinggi_mm === null || r.tinggi_mm === undefined ? null : Number(r.tinggi_mm),
    margin_atas: Number(r.margin_atas),
    margin_kanan: Number(r.margin_kanan),
    margin_bawah: Number(r.margin_bawah),
    margin_kiri: Number(r.margin_kiri),
    skala: Number(r.skala),
    ukuran_font: Number(r.ukuran_font),
    aksen: r.aksen,
    blok: aman<Record<string, boolean>>(r.blok, {}),
    urutan_kolom: aman<string[]>(r.urutan_kolom, ['kode', 'nama', 'qty', 'satuan', 'harga', 'diskon', 'subtotal']),
    teks: aman<Record<string, string>>(r.teks, {}),
    pengaturan_kolom: aman<Record<string, unknown>>(r.pengaturan_kolom, {}),
    singkat_kolom: SINGKAT_DIKENAL.has(String(r.singkat_kolom)) ? String(r.singkat_kolom) : 'auto',
    diubah_pada: r.diubah_pada ?? r.dibuat_pada ?? null,
  };
}

export function routerFaktur(): Router {
  const r = Router();

  // --- Pengaturan faktur (prefix, identitas toko, aturan kodi) ----------
  r.get(
    '/pengaturan',
    asyncHandler(async (_req, res) => {
      const s = await getSettings();
      const isi: Record<string, string> = {};
      for (const k of KUNCI_PENGATURAN) isi[k] = s[k] ?? '';
      res.json({ pengaturan: isi, ukuran_kertas: UKURAN_KERTAS });
    }),
  );

  r.put(
    '/pengaturan',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const disimpan: Record<string, string> = {};
      await withTransaction(async () => {
        for (const k of KUNCI_PENGATURAN) {
          if (body[k] === undefined) continue;
          const nilai = String(body[k]).slice(0, 4000);
          if (/prefix/.test(k) && !/^[A-Za-z0-9-]{1,12}$/.test(nilai)) {
            throw tolak(400, `Prefix "${nilai}" tidak valid — hanya huruf/angka/dash (maks 12).`);
          }
          await run(
            `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES (?, ?, now())
             ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
            k,
            nilai,
          );
          disimpan[k] = nilai;
        }
      });
      res.json({ pengaturan: disimpan });
    }),
  );

  // --- Template faktur ---------------------------------------------------
  r.get(
    '/template',
    asyncHandler(async (req, res) => {
      const jenis = String(req.query.jenis ?? '').trim();
      const where = jenis && JENIS.has(jenis) ? `WHERE jenis = '${jenis}'` : '';
      const rows = await all<Record<string, unknown>>(
        `SELECT * FROM invoice_templates ${where} ORDER BY jenis, bawaan DESC, nama`,
      );
      res.json({ data: rows.map(bentukTemplate), ukuran_kertas: UKURAN_KERTAS });
    }),
  );

  r.post(
    '/template',
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const isi = bacaTemplate((req.body ?? {}) as Record<string, unknown>);
      const id = Number(
        await ((await run(
          `INSERT INTO invoice_templates (nama, jenis, kertas, orientasi, lebar_mm, tinggi_mm,
                                          margin_atas, margin_kanan, margin_bawah, margin_kiri,
                                          skala, ukuran_font, aksen, blok, urutan_kolom, teks,
                                          pengaturan_kolom, singkat_kolom, dibuat_oleh)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          isi.nama,
          isi.jenis,
          isi.kertas,
          isi.orientasi,
          isi.lebar_mm,
          isi.tinggi_mm,
          isi.margin_atas,
          isi.margin_kanan,
          isi.margin_bawah,
          isi.margin_kiri,
          isi.skala,
          isi.ukuran_font,
          isi.aksen,
          isi.blok,
          isi.urutan_kolom,
          isi.teks,
          isi.pengaturan_kolom,
          isi.singkat_kolom,
          pengguna.id,
        ))).lastInsertRowid,
      );
      res.status(201).json({ id });
    }),
  );

  r.put(
    '/template/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM invoice_templates WHERE id = ?`, id);
      if (!lama) throw tolak(404, 'Template faktur tidak ditemukan.');
      const isi = bacaTemplate((req.body ?? {}) as Record<string, unknown>, lama);
      await run(
        `UPDATE invoice_templates
            SET nama = ?, jenis = ?, kertas = ?, orientasi = ?, lebar_mm = ?, tinggi_mm = ?,
                margin_atas = ?, margin_kanan = ?, margin_bawah = ?, margin_kiri = ?,
                skala = ?, ukuran_font = ?, aksen = ?, blok = ?, urutan_kolom = ?, teks = ?,
                pengaturan_kolom = ?, singkat_kolom = ?,
                diubah_pada = now()
          WHERE id = ?`,
        isi.nama,
        isi.jenis,
        isi.kertas,
        isi.orientasi,
        isi.lebar_mm,
        isi.tinggi_mm,
        isi.margin_atas,
        isi.margin_kanan,
        isi.margin_bawah,
        isi.margin_kiri,
        isi.skala,
        isi.ukuran_font,
        isi.aksen,
        isi.blok,
        isi.urutan_kolom,
        isi.teks,
        isi.pengaturan_kolom,
        isi.singkat_kolom,
        id,
      );
      const baru = (await get<Record<string, unknown>>(`SELECT * FROM invoice_templates WHERE id = ?`, id))!;
      res.json(bentukTemplate(baru));
    }),
  );

  r.post(
    '/template/:id/bawaan',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const tpl = await get<Record<string, unknown>>(`SELECT id, jenis FROM invoice_templates WHERE id = ?`, id);
      if (!tpl) throw tolak(404, 'Template faktur tidak ditemukan.');
      await withTransaction(async () => {
        await run(`UPDATE invoice_templates SET bawaan = FALSE WHERE jenis = ?`, tpl.jenis);
        await run(`UPDATE invoice_templates SET bawaan = TRUE, diubah_pada = now() WHERE id = ?`, id);
      });
      res.json({ ok: true, jenis: tpl.jenis });
    }),
  );

  r.delete(
    '/template/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const tpl = await get<Record<string, unknown>>(`SELECT id, bawaan FROM invoice_templates WHERE id = ?`, id);
      if (!tpl) throw tolak(404, 'Template faktur tidak ditemukan.');
      if (Number(tpl.bawaan) === 1) {
        throw tolak(409, 'Template bawaan tidak bisa dihapus — tetapkan template lain sebagai bawaan dulu.');
      }
      const dipakai = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices WHERE template_id = ?`, id);
      if (Number(dipakai?.n ?? 0) > 0) {
        throw tolak(409, `Template ini dipakai ${dipakai?.n} faktur tersimpan — ubah dulu agar bisa dihapus.`);
      }
      await run(`DELETE FROM invoice_templates WHERE id = ?`, id);
      res.json({ ok: true });
    }),
  );

  // --- Faktur: daftar, detail, pembuatan ulang ---------------------------
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const p = bacaPaginasi(req, {
        urutBawaan: 'tanggal',
        arahBawaan: 'DESC',
        urutDiizinkan: ['tanggal', 'no_faktur', 'total', 'jenis'],
      });
      const jenis = String(req.query.jenis ?? '').trim();
      const status = String(req.query.status ?? '').trim();

      const saring: string[] = [];
      const argumen: unknown[] = [];
      if (jenis && JENIS_FAKTUR.has(jenis)) {
        saring.push('i.jenis = ?');
        argumen.push(jenis);
      }
      if (status && ['terbit', 'batal'].includes(status)) {
        saring.push('i.status = ?');
        argumen.push(status);
      }
      // R2 — filter periode tampil (Riwayat & Dokumen Pembelian/Penjualan).
      const dari = String(req.query.dari ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dari)) {
        saring.push('substr(i.tanggal, 1, 10) >= ?');
        argumen.push(dari);
      }
      const sampai = String(req.query.sampai ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
        saring.push('substr(i.tanggal, 1, 10) <= ?');
        argumen.push(sampai);
      }
      if (p.cari) {
        saring.push(
          `(${
            `i.no_faktur ILIKE ? ESCAPE '\\' OR i.pihak_nama ILIKE ? ESCAPE '\\' OR ` +
            `(i.sumber_tipe = 'pembelian' AND i.sumber_id IN (SELECT id FROM purchases WHERE no_dokumen ILIKE ? ESCAPE '\\'))`
          })`,
        );
        argumen.push(polaCari(p.cari), polaCari(p.cari), polaCari(p.cari));
      }
      // ISOLASI GUDANG — faktur penjualan/pembelian hanya dari gudang sesi.
      const lingkupFaktur = await batasFakturSesi(req);
      if (lingkupFaktur.sql) {
        saring.push(lingkupFaktur.sql);
        argumen.push(...lingkupFaktur.params);
      }
      const where = saring.length ? `WHERE ${saring.join(' AND ')}` : '';

      const total = Number(
        await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices i ${where}`, ...argumen)))?.n ?? 0,
      );
      const data = await await Promise.all((await all<Record<string, unknown>>(
        `SELECT i.id, i.no_faktur, i.jenis, i.tanggal, i.pihak_nama, i.pihak_telepon, i.total,
                i.status, i.sumber_tipe, i.sumber_id, i.subtotal, i.diskon, i.pajak,
                t.nama AS template_nama
           FROM invoices i
           LEFT JOIN invoice_templates t ON t.id = i.template_id
           ${where}
          ORDER BY i.${p.urut} ${p.arah}, i.id DESC
          LIMIT ? OFFSET ?`,
        ...argumen,
        p.per,
        p.offset,
      )).map(async (row) => ({
        ...row,
        no_sumber: await noSumber(row),
      })));

      res.json({ data, total, hal: p.hal, per: p.per });
    }),
  );

  /**
 * ISOLASI GUDANG — faktur terikat gudang dokumen sumbernya (penjualan/
 * pembelian). Faktur manual tanpa sumber bukan data gudang → tetap terlihat.
 * Berlaku untuk peran bawaan & kustom (berbasis sesi, bukan nama peran).
 */
async function gudangSumber(tipe: unknown, sumberId: unknown): Promise<number | null> {
  const tabel = tipe === 'penjualan' ? 'sales' : tipe === 'pembelian' ? 'purchases' : null;
  if (!tabel) return null;
  const id = Number(sumberId);
  if (!Number.isInteger(id)) return null;
  return await ((await get<{ warehouse_id: number }>(`SELECT warehouse_id FROM ${tabel} WHERE id = ?`, id)))?.warehouse_id ?? null;
}

/** Fragmen batas daftar faktur ke gudang dokumen sumber sesi. */
async function batasFakturSesi(req: Request): Promise<{ sql: string; params: unknown[] }> {
  const jual = await syaratGudangSesi(req, 's.warehouse_id');
  const beli = await syaratGudangSesi(req, 'p.warehouse_id');
  if (!jual.sql && !beli.sql) return { sql: '', params: [] };
  if (jual.sql === '1 = 0' || beli.sql === '1 = 0') return { sql: '1 = 0', params: [] };
  return {
    sql: `((i.sumber_tipe = 'penjualan' AND EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sumber_id AND ${jual.sql})) OR (i.sumber_tipe = 'pembelian' AND EXISTS (SELECT 1 FROM purchases p WHERE p.id = i.sumber_id AND ${beli.sql})) OR (i.sumber_tipe NOT IN ('penjualan', 'pembelian')))`,
    params: [...jual.params, ...beli.params],
  };
}

/** Nomor dokumen sumber (SJ-… / PB-…) untuk kolom referensi. */
  async function noSumber(row: Record<string, unknown>): Promise<string | null> {
    const tabel = row.sumber_tipe === 'penjualan' ? 'sales' : 'purchases';
    const s = await get<{ no_dokumen: string }>(`SELECT no_dokumen FROM ${tabel} WHERE id = ?`, Number(row.sumber_id));
    return s?.no_dokumen ?? null;
  }

  /** Pembuatan faktur manual (mis. dokumen lama sebelum fitur ini ada). */
  r.post(
    '/hasil/:tipe/:sumberId',
    asyncHandler(async (req, res) => {
      const tipe = String(req.params.tipe);
      const sumberId = Number(req.params.sumberId);
      // ISOLASI GUDANG — faktur manual hanya dari dokumen gudang sesi.
      const gudangSrc = await gudangSumber(tipe, sumberId);
      if (gudangSrc !== null) await wajibGudangDiizinkan(req, gudangSrc);
      const pengguna = penggunaSaatIni(req);
      const faktur =
        tipe === 'penjualan' ? await buatFakturPenjualan(sumberId, pengguna.id) : tipe === 'pembelian' ? await buatFakturPembelian(sumberId, pengguna.id) : null;
      if (!faktur) throw tolak(404, 'Dokumen sumber tidak ditemukan.');
      res.status(201).json({ faktur });
    }),
  );

  // `/template` harus terdaftar sebelum `/:id` (lihat di atas).
  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const row = await get<Record<string, unknown>>(`SELECT * FROM invoices WHERE id = ?`, id);
      if (!row) throw tolak(404, 'Faktur tidak ditemukan.');
      // ISOLASI GUDANG — faktur gudang lain tidak bisa dibuka via ID langsung.
      const gudangInv = await gudangSumber(row.sumber_tipe, row.sumber_id);
      if (gudangInv !== null) await wajibGudangDiizinkan(req, gudangInv);
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(row.data_json ?? '{}')) as Record<string, unknown>;
      } catch {
        data = {};
      }
      const jenis = String(row.jenis) as JenisFaktur;
      // Retur penjualan disahkan milik dokumen sumber. Faktur pembelian tidak
      // lagi memiliki retur (fitur Retur Pembelian dihapus).
      let retur: { id: number; no_dokumen: string; tanggal: string; total: number }[] = [];
      if (jenis === 'penjualan') {
        try {
          retur = (await all<{ id: number; no_dokumen: string; tanggal: string; total: number }>(
            `SELECT id, no_dokumen, tanggal, total FROM sale_returns
              WHERE sale_id = ? AND status = 'disahkan' ORDER BY id`,
            Number(row.sumber_id),
          )).map((x) => ({ ...x, total: Number(x.total) }));
        } catch {
          retur = [];
        }
      }
      const templateRow =
        (row.template_id ? await get<Record<string, unknown>>(`SELECT * FROM invoice_templates WHERE id = ?`, Number(row.template_id)) : null) ??
        await templateBawaan(jenis);
      res.json({
        faktur: {
          id: Number(row.id),
          no_faktur: row.no_faktur,
          jenis: row.jenis,
          tanggal: row.tanggal,
          status: row.status,
          pihak: { nama: row.pihak_nama, telepon: row.pihak_telepon, alamat: row.pihak_alamat },
          subtotal: Number(row.subtotal),
          diskon: Number(row.diskon),
          pajak_persen: Number(row.pajak_persen),
          pajak: Number(row.pajak),
          total: Number(row.total),
          terbilang: row.terbilang,
          catatan: row.catatan,
          sumber_tipe: row.sumber_tipe,
          sumber_id: Number(row.sumber_id),
          no_sumber: await noSumber(row),
          // Retur disahkan yang terkait dokumen sumber — dipakai FakturDokumen
          // untuk baris "Retur …" dan badge FAKTUR DENGAN RETUR.
          retur,
          total_net: Math.max(0, Number(row.total) - retur.reduce((n, r) => n + Number(r.total ?? 0), 0)),
        },
        isi: data,
        template: templateRow ? bentukTemplate(templateRow) : null,
      });
    }),
  );

  return r;
}
