import { Router, type Request } from 'express';
import { all, get, run, withTransaction } from '../../db.pg.ts';
import { asyncHandler, bacaPaginasi, pesanKesalahan, polaCari, tolak } from '../../lib/http.ts';
import { catatAudit } from '../../lib/audit.ts';
import { adalahAdmin, penggunaSaatIni } from '../../lib/akses.ts';
import { bacaExcel, tulisExcel } from '../../lib/excel.ts';
import {
  GalatImpor,
  PengumpulImpor,
  PemantauUnik,
  type JejakUrung,
  angkaToleran,
  bacaOpsiImpor,
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
} from '../../lib/imporBersama.ts';
import { ENTITAS, type EntitasConfig, type KolomEntitas } from './konfigurasi.ts';
import { lepasAksesGudang } from '../../lib/aksesGudang.ts';

/** Ambil konfigurasi entitas dari parameter URL (hanya yang terdaftar). */
export function entitasDariUrl(req: Request): EntitasConfig {
  const cfg = ENTITAS[req.params.entitas as string];
  if (!cfg) throw tolak(404, 'Entitas Master Data tidak dikenal.');
  return cfg;
}

async function tipeIsi(k: KolomEntitas, nilaiRaw: unknown): Promise<unknown> {
  const kosong = nilaiRaw === null || nilaiRaw === undefined || (typeof nilaiRaw === 'string' && nilaiRaw.trim() === '');

  switch (k.tipe) {
    case 'teks_wajib': {
      const v = teksBersih(nilaiRaw);
      if (!v) throw new GalatImpor(k.key, `${k.label} wajib diisi.`, nilaiRaw);
      if (k.max && v.length > k.max) throw new GalatImpor(k.key, `${k.label} maksimal ${k.max} karakter.`, nilaiRaw);
      return v;
    }
    case 'teks':
    case 'teks_panjang': {
      if (kosong) return null;
      const v = teksBersih(nilaiRaw);
      if (k.max && v.length > k.max) throw new GalatImpor(k.key, `${k.label} maksimal ${k.max} karakter.`, nilaiRaw);
      return v || null;
    }
    case 'angka':
    case 'angka_bulat': {
      if (kosong) return k.key === 'termin_hari' || k.key === 'limit_piutang' ? 0 : null;
      const v = angkaToleran(nilaiRaw, k.label) ?? null;
      if (v === null) return null;
      if (k.tipe === 'angka_bulat' && !Number.isInteger(v)) {
        throw new GalatImpor(k.key, `${k.label} harus bilangan bulat.`, nilaiRaw);
      }
      if (k.min !== undefined && v < k.min) throw new GalatImpor(k.key, `${k.label} tidak boleh negatif.`, nilaiRaw);
      if (k.max !== undefined && v > k.max) throw new GalatImpor(k.key, `${k.label} maksimal ${k.max}.`, nilaiRaw);
      return v;
    }
    case 'bool': {
      if (kosong) return false;
      if (typeof nilaiRaw === 'boolean') return nilaiRaw;
      return (statusToleran(nilaiRaw, k.label) ?? 0) === 1;
    }
    case 'ref': {
      if (kosong) {
        if (k.opsional) return null; // AF2 — Profil size boleh kosong (belum terklasifikasi)
        throw new GalatImpor(k.key, `${k.label} wajib dipilih.`, nilaiRaw);
      }
      const rujuk = k.ref!;
      // Angka murni = id langsung; teks (kode/nama/"KODE — Nama") dicocokkan
      // tanpa peka huruf, trim + rapikan spasi + normalisasi dash.
      const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
      const idLangsung = Number(nilaiRaw);
      if (Number.isInteger(idLangsung)) {
        const ada = await get(`SELECT id FROM ${rujuk.tabel} WHERE id = ?`, idLangsung);
        if (!ada) throw new GalatImpor(k.key, `${k.label} tidak ditemukan.`, nilaiRaw);
        return idLangsung;
      }
      const cari = norm(nilaiRaw);
      if (!cari) {
        if (k.opsional) return null;
        throw new GalatImpor(k.key, `${k.label} wajib dipilih.`, nilaiRaw);
      }
      for (const b of await all<Record<string, unknown>>(`SELECT id, ${rujuk.kolomCari}, ${rujuk.kolomTampil} FROM ${rujuk.tabel}`)) {
        const kode = norm(b[rujuk.kolomCari]);
        const nama = norm(b[rujuk.kolomTampil]);
        if (cari === kode || cari === nama || cari === `${kode} - ${nama}` || cari === `${kode} — ${nama}`) {
          return Number(b.id);
        }
      }
      throw new GalatImpor(k.key, `${k.label} "${teksBersih(nilaiRaw)}" tidak ditemukan (cocok kode/nama, tanpa peka huruf).`, nilaiRaw);
    }
  }
}

/** Validasi seluruh kolom entitas dari body; melempar HttpError 400 bila tidak sah. */
async function validasiIsi(cfg: EntitasConfig, body: Record<string, unknown>, lama: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const keluar: Record<string, unknown> = {};
  for (const k of cfg.kolom) {
    const adaDiBody = Object.prototype.hasOwnProperty.call(body, k.key);
    if (!adaDiBody && lama) {
      keluar[k.key] = k.tipe === 'bool' ? Boolean(lama[k.key]) : lama[k.key] ?? null;
      continue;
    }
    if (!adaDiBody && !lama && k.tipe !== 'ref' && k.tipe !== 'teks_wajib' && !k.wajib) {
      // Default mengikuti DEFAULT kolom di skema (mis. aktif = TRUE).
      keluar[k.key] = k.tipe === 'bool' ? true : k.key === 'limit_piutang' ? 0 : null;
      continue;
    }
    keluar[k.key] = await tipeIsi(k, body[k.key]);
  }
  return keluar;
}

async function cekUnik(cfg: EntitasConfig, k: KolomEntitas, nilai: unknown, kecualiId?: number): Promise<void> {
  if (!k.unik || nilai === null || nilai === undefined) return;
  const baris = kecualiId
    ? await get(`SELECT id FROM ${cfg.tabel} WHERE ${k.key} = ? AND id <> ?`, nilai, kecualiId)
    : await get(`SELECT id FROM ${cfg.tabel} WHERE ${k.key} = ?`, nilai);
  if (baris) throw tolak(409, `${k.label} "${String(nilai)}" sudah dipakai data lain.`);
}

/** Peta label rujukan (id → tampilan) untuk respons & ekspor. */
async function petaRef(k: KolomEntitas): Promise<Map<number, string>> {
  const peta = new Map<number, string>();
  if (!k.ref) return peta;
  const { tabel, kolomCari, kolomTampil } = k.ref;
  const baris = await all<Record<string, unknown>>(`SELECT id, ${kolomCari}, ${kolomTampil} FROM ${tabel}`);
  for (const b of baris) {
    const kode = b[kolomCari];
    const nama = b[kolomTampil];
    peta.set(Number(b.id), kode && nama && kode !== nama ? `${String(kode)} — ${String(nama)}` : String(nama ?? kode ?? b.id));
  }
  return peta;
}

async function tampilanRef(cfg: EntitasConfig, baris: Record<string, unknown>): Promise<Record<string, unknown>> {
  const keluar: Record<string, unknown> = { ...baris };
  for (const k of cfg.kolom) {
    if (k.ref && baris[k.key] !== null && baris[k.key] !== undefined) {
      keluar[`${k.key}_label`] = (await petaRef(k)).get(Number(baris[k.key])) ?? String(baris[k.key]);
    }
  }
  return keluar;
}

function labelBaris(cfg: EntitasConfig, baris: Record<string, unknown>): string {
  const adaNama = cfg.kolom.some((k) => k.key === 'nama');
  const adaKode = cfg.kolom.some((k) => k.key === 'kode');
  if (adaNama && adaKode) return `${String(baris.kode ?? '')} — ${String(baris.nama ?? '')}`;
  if (adaNama) return String(baris.nama ?? baris.id);
  if (adaKode) return String(baris.kode ?? baris.id);
  return String(baris[cfg.urutBawaan] ?? baris.id);
}

function bangunWhere(cfg: EntitasConfig, req: Request, cari: string): { where: string; params: unknown[] } {
  const syarat: string[] = [];
  const params: unknown[] = [];

  if (cari) {
    const bagian = cfg.cariKolom.map((kolom) => `${kolom} ILIKE ? ESCAPE '\\'`);
    syarat.push(`(${bagian.join(' OR ')})`);
    for (let i = 0; i < cfg.cariKolom.length; i++) params.push(polaCari(cari));
  }

  for (const f of cfg.filter ?? []) {
    const nilai = req.query[f.key];
    if (nilai !== undefined && nilai !== '') {
      syarat.push(`${f.key} = ?`);
      params.push(Number(nilai));
    }
  }

  return { where: syarat.length ? `WHERE ${syarat.join(' AND ')}` : '', params };
}

/** Router CRUD generik untuk entitas sederhana (kategori, satuan, gudang, dll.). */
export function routerEntitasUmum(): Router {
  const r = Router({ mergeParams: true });

  // --- Daftar -------------------------------------------------------------
  r.get('/:entitas', async (req, res) => {
    const cfg = entitasDariUrl(req);
    const p = bacaPaginasi(req, { urutBawaan: cfg.urutBawaan, urutDiizinkan: cfg.urutDiizinkan });
    const { where, params } = bangunWhere(cfg, req, p.cari);
    const total = Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${cfg.tabel} ${where}`, ...params)))?.n ?? 0);
    const baris = await all<Record<string, unknown>>(
      `SELECT * FROM ${cfg.tabel} ${where} ORDER BY ${p.urut} ${p.arah}, id ASC LIMIT ? OFFSET ?`,
      ...params,
      p.per,
      p.offset,
    );
    res.json({ data: await Promise.all(baris.map(async (b) => await tampilanRef(cfg, b))), total, hal: p.hal, per: p.per });
  });

  // --- Opsi dropdown (untuk filter & form) --------------------------------
  r.get('/:entitas/opsi', async (req, res) => {
    const cfg = entitasDariUrl(req);
    // AS4 — pilihan gudang hanya berisi gudang yang diizinkan sesi (non-Top).
    if (cfg.kode === 'gudang' && req.konteks && !req.konteks.admin) {
      const cakupan = req.konteks.cakupanToko;
      if (!cakupan || cakupan.length === 0) {
        res.json({ data: [] });
        return;
      }
      const pas = cakupan.map(() => '?').join(',');
      const baris = await all<Record<string, unknown>>(
        `SELECT * FROM warehouses WHERE kode IN (${pas}) ORDER BY nama ASC`,
        ...cakupan,
      );
      res.json({ data: baris.map((b) => ({ id: b.id, label: labelBaris(cfg, b) })) });
      return;
    }
    const baris = await all<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} ORDER BY ${cfg.urutBawaan} ASC`);
    // Pelanggan & pemasok ikut membawa nomor telepon agar form POS/PO dapat
    // mengisi nomor WhatsApp otomatis dari master (tanpa permintaan tambahan).
    const bawaTelepon = cfg.tabel === 'customers' || cfg.tabel === 'suppliers';
    res.json({
      data: baris.map((b) => ({
        id: b.id,
        label: labelBaris(cfg, b),
        ...(bawaTelepon ? { telepon: b.telepon ? String(b.telepon) : null } : {}),
      })),
    });
  });

  // --- Ekspor Excel -------------------------------------------------------
  r.get(
    '/:entitas/ekspor',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const p = bacaPaginasi(req, { urutBawaan: cfg.urutBawaan, urutDiizinkan: cfg.urutDiizinkan });
      const { where, params } = bangunWhere(cfg, req, p.cari);
      // ?ids=1,2,3 → ekspor hanya yang dipilih (dipakai bar aksi massal).
      let syarat = where;
      let arg = params;
      const idsParam = String(req.query.ids ?? '').trim();
      if (idsParam) {
        const ids = [...new Set(idsParam.split(',').map(Number))].filter((n) => Number.isInteger(n) && n > 0);
        if (!ids.length) throw tolak(400, 'Daftar id tidak valid.');
        const klausa = `id IN (${ids.map(() => '?').join(',')})`;
        syarat = syarat ? `${syarat} AND ${klausa}` : `WHERE ${klausa}`;
        arg = [...params, ...ids];
      }
      const baris = await all<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} ${syarat} ORDER BY ${cfg.urutBawaan} ASC`, ...arg);

    // STANDAR: kolom ekspor 100% identik dengan template (cfg.kolom) + UI.
    // Nilai ref ditulis sebagai KODE (kolomCari) agar bisa diimpor ulang tanpa ubahan.
    const kolomExcel = cfg.kolom.map((k) => ({ key: k.key, label: k.label }));
    const isi = await Promise.all(baris.map(async (b) => {
      const out: Record<string, unknown> = {};
      for (const k of cfg.kolom) {
        if (!k.ref) { out[k.key] = b[k.key] ?? null; continue; }
        const rujuk = await get<Record<string, unknown>>(`SELECT ${k.ref.kolomCari} AS kode FROM ${k.ref.tabel} WHERE id = ?`, b[k.key] as number);
        out[k.key] = rujuk?.kode ?? b[k.key] ?? null;
      }
      return out;
    }));

    const buffer = await tulisExcel(cfg.label, kolomExcel, isi);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${cfg.kode}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      })
      .send(buffer);
    }),
  );

  // --- Template impor -----------------------------------------------------
  r.get('/:entitas/template', async (req, res) => {
    const cfg = entitasDariUrl(req);
    const kolomExcel = cfg.kolom.map((k) => ({ key: k.key, label: k.label }));
    tulisExcel(cfg.label, kolomExcel, [])
      .then((buffer) =>
        res
          .set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="template-${cfg.kode}.xlsx"`,
          })
          .send(buffer),
      )
      .catch((err) => {
        const { status, pesan } = pesanKesalahan(err);
        res.status(status).json({ pesan });
      });
  });

  // --- Impor Excel (mesin bersama: normalisasi, pemetaan, opsi, urungkan) --
  /**
   * Peta judul file → key kolom entitas (auto-match fuzzy dari mesin bersama).
   * Sumber kolom = cfg.kolom yang SAMA dengan template & validasi, sehingga
   * kolom baru di master otomatis ikut terbaca tanpa daftar khusus — judul
   * file boleh "Kode", "NAMA", "Telp", "Harga Jual", dsb.
   */
  const petaOtomatis = (cfg: EntitasConfig, header: string[]): Record<string, string> =>
    pemetaanOtomatis(
      cfg.kolom.map((k) => ({ key: k.key, label: k.label })),
      header,
    );

  /**
   * Validasi seluruh baris dengan mesin bersama:
   * normalisasi sel, resolusi referensi (buat otomatis bila opsi aktif), cek unik
   * dalam file & database (mode perbarui = "akan diperbarui", bukan error).
   */
  const validasiImporUmum = async (
    cfg: EntitasConfig,
    baris: Record<string, unknown>[],
    opsi: { perbarui: boolean; buat_otomatis: boolean },
    userId: number | null,
  ) => {
    const kumpul = new PengumpulImpor();
    const siap: { isi: Record<string, unknown>; aksi: 'baru' | 'perbarui'; id: number | null }[] = [];
    const unikPerKolom = new Map<string, PemantauUnik>();
    const kolomUnik = cfg.kolom.filter((k) => k.unik);
    for (const k of kolomUnik) unikPerKolom.set(k.key, new PemantauUnik(k.label));

    barisBerikutnya: for (const [idx, raw] of baris.entries()) {
      const nomor = nomorBaris(idx);
      try {
        // Pra-resolusi: teks ref (kode/nama, trim + tanpa peka huruf) → id
        // sebelum validasiIsi, agar Excel "GD-1"/"Gudang A" lolos.
        // Gudang belum ada + buat_otomatis = dibuat (hanya Admin; pengguna
        // terbatas ditolak agar tidak memperluas cakupan sendiri).
        const mentah: Record<string, unknown> = { ...raw };
        const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
        for (const k of cfg.kolom) {
          if (!k.ref) continue;
          const v = mentah[k.key];
          if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
          if (Number.isInteger(Number(v)) && String(v).trim() !== '') continue; // id langsung
          const rujuk = k.ref;
          const cari = norm(v);
          let cocok: number | undefined;
          for (const b of await all<Record<string, unknown>>(`SELECT id, ${rujuk.kolomCari}, ${rujuk.kolomTampil} FROM ${rujuk.tabel}`)) {
            const kode = norm(b[rujuk.kolomCari]);
            const nama = norm(b[rujuk.kolomTampil]);
            if (cari === kode || cari === nama || cari === `${kode} - ${nama}` || cari === `${kode} — ${nama}`) { cocok = Number(b.id); break; }
          }
          if (cocok !== undefined) { mentah[k.key] = cocok; continue; }
          if (rujuk.tabel === 'warehouses' && opsi.buat_otomatis) {
            const teks = teksBersih(v);
            const kodeGudang = teksKode(teks).toUpperCase().slice(0, 20);
            const idGudang = Number(await ((await run(`INSERT INTO warehouses (kode, nama) VALUES (?, ?)`, kodeGudang, teks))).lastInsertRowid);
            await catatAudit({ userId, aksi: 'tambah', tabel: 'warehouses', recordId: idGudang, sesudah: { kode: kodeGudang, nama: teks } });
            kumpul.ingatkan(nomor, k.key, `${k.label} "${teks}" belum ada — akan dibuat otomatis.`);
            mentah[k.key] = idGudang;
          }
          // Bila tidak cocok & tidak dibuat → biarkan validasiIsi melempar
          // GalatImpor dengan pesan "tidak ditemukan" + nomor baris.
        }
        const isi = await validasiIsi(cfg, mentah, null);

        // Unik dalam file: hanya antar baris berbeda (PemantauUnik).
        for (const k of kolomUnik) {
          const v = isi[k.key];
          if (v === null || v === undefined || teksKode(v) === '') continue;
          unikPerKolom.get(k.key)!.cek(String(v), nomor, k.key);
        }

        // Unik terhadap database: mode perbarui = "akan diperbarui", selain itu dilewati.
        let aksi: 'baru' | 'perbarui' = 'baru';
        let idLama: number | null = null;
        for (const k of kolomUnik) {
          const v = isi[k.key];
          if (v === null || v === undefined || teksKode(v) === '') continue;
          const barisLama = await get<{ id: number }>(
            `SELECT id FROM ${cfg.tabel} WHERE ${k.key} ILIKE ?`,
            String(v),
          );
          if (barisLama) {
            if (!opsi.perbarui) {
              // Opsi perbarui mati → baris ini dilewati (bukan error).
              kumpul.ingatkan(nomor, k.key, `${k.label} "${String(v)}" sudah ada — baris dilewati (opsi perbarui mati).`);
              continue barisBerikutnya;
            }
            aksi = 'perbarui';
            idLama = idLama ?? Number(barisLama.id);
          }
        }

        isi.dibuat_oleh = userId;
        siap.push({ isi, aksi, id: idLama });
      } catch (err) {
        kumpul.tolakDari(err, nomor, raw);
      }
    }

    return { siap, kumpul };
  };

  /** Terapkan baris siap (INSERT / UPDATE) & kembalikan jejak urungkan. */
  const terapkanImporUmum = async (
    cfg: EntitasConfig,
    siap: { isi: Record<string, unknown>; aksi: 'baru' | 'perbarui'; id: number | null }[],
    userId: number | null,
  ): Promise<JejakUrung[]> => {
    const jejak: JejakUrung[] = [];
    const kolomInsert = cfg.kolom.map((k) => k.key);
    for (const s of siap) {
      if (s.aksi === 'perbarui' && s.id !== null) {
        const lama = (await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, s.id))!
        await run(
          `UPDATE ${cfg.tabel} SET ${kolomInsert.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          ...kolomInsert.map((k) => s.isi[k] ?? null),
          s.id,
        );
        const sesudah = (await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, s.id))!
        await catatAudit({ userId, aksi: 'ubah', tabel: cfg.tabel, recordId: s.id, sebelum: lama, sesudah });
        jejak.push({ aksi: 'perbarui', tabel: cfg.tabel, id: s.id, sebelum: lama });
      } else {
        const id = Number(
          await ((await run(
            `INSERT INTO ${cfg.tabel} (${[...kolomInsert, 'dibuat_oleh'].join(', ')}) VALUES (${kolomInsert.map(() => '?').join(', ')}, ?)`,
            ...kolomInsert.map((k) => s.isi[k] ?? null),
            userId,
          ))).lastInsertRowid,
        );
        await catatAudit({ userId, aksi: 'tambah', tabel: cfg.tabel, recordId: id, sesudah: s.isi });
        jejak.push({ aksi: 'tambah', tabel: cfg.tabel, id });
      }
    }
    return jejak;
  };

  /** Baca opsi dari body — dukung format `{ opsi: {...} }` (klien wizard) dan flat. */
  const opsiDariBody = (body: unknown): ReturnType<typeof bacaOpsiImpor> => {
    const b = (body ?? {}) as Record<string, unknown>;
    return bacaOpsiImpor((b.opsi && typeof b.opsi === 'object' ? b.opsi : b) as Record<string, unknown>);
  };

  // Tahap 0 — judul kolom + contoh + total baris (wizard pemetaan).
  r.post(
    '/:entitas/impor/kolom',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const { nama_file, data_base64 } = (req.body ?? {}) as { nama_file?: string; data_base64?: string };
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom, baris } = await bacaExcel(buffer);
      if (!kolom.length) throw tolak(400, 'File tidak memiliki baris judul kolom.');
      res.json({
        nama_file: nama_file ?? `impor-${cfg.kode}.xlsx`,
        kolom,
        contoh: baris[0] ?? {},
        total_baris: baris.length,
      });
    }),
  );

  // Tahap 1 — pratinjau: validasi tanpa menulis; lengkap dengan ringkasan alasan.
  r.post(
    '/:entitas/impor/pra-tinjau',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const { nama_file, data_base64, pemetaan } = (req.body ?? {}) as {
        nama_file?: string;
        data_base64?: string;
        pemetaan?: Record<string, string>;
      };
      const opsi = opsiDariBody(req.body);
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom: header, baris: mentah } = await bacaExcel(buffer);
      if (!mentah.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');
      const peta = pemetaan && Object.keys(pemetaan).length ? pemetaan : petaOtomatis(cfg, header);
      const baris = terapkanPemetaan(header, mentah, peta);
      if (!baris.length) throw tolak(400, 'Semua baris data kosong — periksa file Excel Anda.');
      cetakDebugImpor(`${cfg.kode}/pra-tinjau`, baris);

      const kolomWajib = cfg.kolom.filter((k) => (k.wajib || k.tipe === 'ref') && !k.opsional);
      const belumPetakan = kolomWajib.filter((k) => !peta[k.key]);
      if (belumPetakan.length) {
        throw tolak(400, `Kolom "${belumPetakan.map((k) => k.label).join('", "')}" tidak ada di file Excel.`);
      }

      const { siap, kumpul } = await validasiImporUmum(cfg, baris, opsi, penggunaSaatIni(req).id);
      const dilewati = baris.length - siap.length - kumpul.jumlahError;
      const jumlahBaru = siap.filter((s) => s.aksi === 'baru').length;
      res.json({
        nama_file: nama_file ?? `impor-${cfg.kode}.xlsx`,
        total_baris: baris.length,
        baris_valid: siap.length,
        baris_dilewati: Math.max(0, dilewati),
        baris_error: kumpul.jumlahError,
        blokir: !opsi.lewati_error && kumpul.jumlahError > 0,
        errors: kumpul.kesalahan,
        ringkasan: kumpul.ringkas(),
        peringatan: kumpul.peringatan,
        jumlah_baru: jumlahBaru,
        jumlah_perbarui: siap.length - jumlahBaru,
        baris: siap.slice(0, 200).map((s, i) => ({
          nomor: nomorBaris(i),
          aksi: s.aksi,
          teks: cfg.kolom.map((k) => teksBersih(s.isi[k.key] ?? '')).filter(Boolean).join(' — ') || String(s.id ?? ''),
        })),
        pratinjau: baris.slice(0, 100).map((r, i) => ({
          nomor: nomorBaris(i),
          teks: cfg.kolom.map((k) => teksBersih(r[k.key] ?? '')).filter(Boolean).join(' — '),
        })),
      });
    }),
  );

  // Tahap 2 — konfirmasi: batch 500 per transaksi + jejak urungkan.
  r.post(
    '/:entitas/impor',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const { nama_file, data_base64, pemetaan } = (req.body ?? {}) as {
        nama_file?: string;
        data_base64?: string;
        pemetaan?: Record<string, string>;
      };
      const opsi = opsiDariBody(req.body);
      if (!data_base64) throw tolak(400, 'File Excel belum dikirim.');
      const buffer = Buffer.from(String(data_base64).replace(/^data:[^,]+,/, ''), 'base64');
      const { kolom: header, baris: mentah } = await bacaExcel(buffer);
      if (!mentah.length) throw tolak(400, 'File tidak berisi baris data (baris pertama = judul kolom).');
      const peta = pemetaan && Object.keys(pemetaan).length ? pemetaan : petaOtomatis(cfg, header);
      const baris = terapkanPemetaan(header, mentah, peta);
      if (!baris.length) throw tolak(400, 'Semua baris data kosong — periksa file Excel Anda.');
      cetakDebugImpor(`${cfg.kode}/impor`, baris);

      const pengguna = penggunaSaatIni(req);
      const { siap, kumpul } = await validasiImporUmum(cfg, baris, opsi, pengguna.id);
      if (!opsi.lewati_error && kumpul.jumlahError) {
        throw tolak(
          400,
          `Terdapat ${kumpul.jumlahError} baris error dan opsi "Lewati baris yang error" dimatikan — impor dibatalkan.`,
        );
      }
      const jumlahBaru = siap.filter((s) => s.aksi === 'baru').length;
      const jumlahPerbarui = siap.length - jumlahBaru;
      const dilewati = baris.length - siap.length - kumpul.jumlahError;

      const batch = await ((await run(
        `INSERT INTO import_batches (modul, nama_file, total_baris, status, user_id) VALUES (?, ?, ?, 'diproses', ?)`,
        cfg.kode,
        nama_file ?? `impor-${cfg.kode}.xlsx`,
        baris.length,
        pengguna.id,
      ))).lastInsertRowid;

      const jejak: JejakUrung[] = [];
      for (let i = 0; i < siap.length; i += 500) {
        const potongan = siap.slice(i, i + 500);
        await withTransaction(async () => {
          jejak.push(...await terapkanImporUmum(cfg, potongan, pengguna.id));
        });
      }
      await withTransaction(async () => {
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
          tabel: cfg.tabel,
          recordId: Number(batch),
          sesudah: {
            nama_file: nama_file ?? `impor-${cfg.kode}.xlsx`,
            baris_valid: siap.length,
            baris_error: kumpul.jumlahError,
          },
        });
      });

      res.json({
        batch_id: Number(batch),
        total_baris: baris.length,
        baris_valid: siap.length,
        baris_dilewati: Math.max(0, dilewati),
        baris_error: kumpul.jumlahError,
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
    '/:entitas/impor/laporan-error',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
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
        `Laporan Error Impor ${cfg.label}`,
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
          'Content-Disposition': `attachment; filename="laporan-error-${cfg.kode}-${String(body.nama_file ?? 'impor').replace(/\.[^.]+$/, '')}.xlsx"`,
        })
        .send(buffer);
    }),
  );

  // AB3 — Urungkan impor entitas umum.
  r.post(
    '/:entitas/impor/urungkan',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const batchId = Number(((req.body ?? {}) as { batch_id?: unknown }).batch_id);
      if (!Number.isFinite(batchId) || batchId <= 0) throw tolak(400, 'batch_id wajib diisi.');
      const pengguna = penggunaSaatIni(req);
      const batch = await get<{ id: number; modul: string; status: string; diurungkan: number; undo_data: string | null; user_id: number | null }>(
        `SELECT id, modul, status, diurungkan, undo_data, user_id FROM import_batches WHERE id = ?`,
        batchId,
      );
      if (!batch) throw tolak(404, 'Batch impor tidak ditemukan.');
      if (batch.modul !== cfg.kode) throw tolak(400, 'Batch ini bukan impor modul ini.');
      if (batch.status !== 'selesai') throw tolak(400, 'Hanya batch berstatus "selesai" yang bisa diurungkan.');
      if (batch.diurungkan) throw tolak(409, 'Impor ini sudah pernah diurungkan.');
      if (batch.user_id !== pengguna.id && !adalahAdmin(req)) throw tolak(403, 'Hanya pengguna yang mengimpor (atau Admin) yang boleh mengurungkan.');

      let jejak: JejakUrung[] = [];
      try {
        jejak = JSON.parse(batch.undo_data ?? '[]') as JejakUrung[];
      } catch {
        jejak = [];
      }
      if (!jejak.length) throw tolak(400, 'Jejak impor ini tidak tersimpan — urungkan manual.');

      let dikembalikan = 0;
      await withTransaction(async () => {
        dikembalikan = await urungkanJejak(jejak);
        await run(`UPDATE import_batches SET diurungkan = TRUE WHERE id = ?`, batchId);
        await catatAudit({ userId: pengguna.id, aksi: 'pulihkan', tabel: cfg.tabel, recordId: batchId, sesudah: { diurungkan: true, jumlah_baris: dikembalikan } });
      });
      res.json({ pesan: `Impor #${batchId} diurungkan — ${dikembalikan} baris dikembalikan.`, dikembalikan });
    }),
  );

  // --- Baca satu ----------------------------------------------------------
  r.get('/:entitas/:id', async (req, res) => {
    const cfg = entitasDariUrl(req);
    const baris = await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, Number(req.params.id));
    if (!baris) throw tolak(404, `${cfg.label} tidak ditemukan.`);
    res.json({ data: await tampilanRef(cfg, baris) });
  });

  // --- Tambah -------------------------------------------------------------
  r.post(
    '/:entitas',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const pengguna = penggunaSaatIni(req);
      const isi = await validasiIsi(cfg, (req.body ?? {}) as Record<string, unknown>, null);
      for (const k of cfg.kolom) await cekUnik(cfg, k, isi[k.key]);

      const idBaru = await withTransaction(async () => {
        const kolomInsert = cfg.kolom.map((k) => k.key);
        const hasil = await run(
          `INSERT INTO ${cfg.tabel} (${[...kolomInsert, 'dibuat_oleh'].join(', ')}) VALUES (${[...kolomInsert, '?'].map(() => '?').join(', ')})`,
          ...kolomInsert.map((c) => isi[c] ?? null),
          pengguna.id,
        );
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: cfg.tabel, recordId: Number(hasil.lastInsertRowid), sesudah: isi });
        return hasil.lastInsertRowid;
      });

      res.status(201).json({ id: Number(idBaru) });
    }),
  );

  // --- Ubah ---------------------------------------------------------------
  r.put(
    '/:entitas/:id',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, id);
      if (!lama) throw tolak(404, `${cfg.label} tidak ditemukan.`);

      const isi = await validasiIsi(cfg, (req.body ?? {}) as Record<string, unknown>, lama);
      for (const k of cfg.kolom) await cekUnik(cfg, k, isi[k.key], id);

      await withTransaction(async () => {
        const kolom = cfg.kolom.map((k) => k.key);
        await run(
          `UPDATE ${cfg.tabel} SET ${kolom.map((c) => `${c} = ?`).join(', ')}, diubah_pada = ? WHERE id = ?`,
          ...kolom.map((c) => isi[c] ?? null),
          new Date().toISOString(),
          id,
        );
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: cfg.tabel, recordId: id, sebelum: lama, sesudah: isi });
      });

      // AS3 — gudang dinonaktifkan: lepas akses pengguna + beri tahu Owner.
      let infoAkses = '';
      if (cfg.kode === 'gudang' && Number(lama.aktif ?? 1) === 1 && Number(isi.aktif ?? 1) === 0) {
        const hilang = await lepasAksesGudang(String(lama.kode), pengguna.id, `Gudang "${lama.kode}" dinonaktifkan di Master Data`);
        if (hilang > 0) infoAkses = ` ${hilang} pengguna kehilangan akses ke ${lama.kode}.`;
      }

      res.json({ ok: true, infoAkses: infoAkses || undefined });
    }),
  );

  // --- Hapus (khusus Owner/Admin) -----------------------------------------
  // AX — Hapus data master = sel Hapus (middleware matriks global).
  r.delete(
    '/:entitas/:id',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const id = Number(req.params.id);
      const pengguna = penggunaSaatIni(req);
      const lama = await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, id);
      if (!lama) throw tolak(404, `${cfg.label} tidak ditemukan.`);

      try {
        await withTransaction(async () => {
          await run(`DELETE FROM ${cfg.tabel} WHERE id = ?`, id);
          await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: cfg.tabel, recordId: id, sebelum: lama });
        });
      } catch (err) {
        const { pesan } = pesanKesalahan(err);
        if (/Data terkait|FOREIGN KEY/i.test(pesan)) {
          throw tolak(409, `${cfg.label} masih dipakai data lain dan tidak bisa dihapus. Nonaktifkan bila tersedia.`);
        }
        throw err;
      }

      // AS3 — gudang dihapus: lepas akses pengguna + beri tahu Owner.
      let infoAkses = '';
      if (cfg.kode === 'gudang') {
        const hilang = await lepasAksesGudang(String(lama.kode), pengguna.id, `Gudang "${lama.kode}" dihapus dari Master Data`);
        if (hilang > 0) infoAkses = ` ${hilang} pengguna kehilangan akses ke ${lama.kode}.`;
      }

      res.json({ ok: true, infoAkses: infoAkses || undefined });
    }),
  );

  // --- Aksi massal (pilih banyak baris) ------------------------------------
  const bacaIdsMassal = (body: unknown): number[] => {
    const raw = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(raw) || raw.length === 0) throw tolak(400, 'Tidak ada data yang dipilih.');
    if (raw.length > 1000) throw tolak(400, 'Maksimal 1000 data per permintaan — pecah menjadi batch kecil.');
    const ids = [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw tolak(400, 'Pilihan tidak valid.');
    return ids;
  };

  // Set status aktif — hanya untuk entitas yang punya kolom aktif (Pelanggan/Pemasok).
  r.post(
    '/:entitas/massal/set-aktif',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      if (!cfg.kolom.some((k) => k.key === 'aktif')) {
        throw tolak(400, `${cfg.label} tidak memiliki status aktif/nonaktif.`);
      }
      const ids = bacaIdsMassal(req.body);
      const aktif = Number((req.body as { aktif?: unknown })?.aktif) === 1 ? 1 : 0;
      const pengguna = penggunaSaatIni(req);
      const sebelum: { id: number; aktif: number }[] = [];
      const berhasil = await withTransaction(async () => {
        let n = 0;
        const now = new Date().toISOString();
        for (const id of ids) {
          const baris = await get<{ id: number; aktif: number }>(`SELECT id, aktif FROM ${cfg.tabel} WHERE id = ?`, id);
          if (!baris) continue;
          sebelum.push({ id, aktif: Number(baris.aktif) });
          if (Number(baris.aktif) !== aktif) {
            await run(`UPDATE ${cfg.tabel} SET aktif = ?, diubah_pada = ? WHERE id = ?`, aktif, now, id);
          }
          n++;
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: aktif ? 'aktifkan' : 'nonaktifkan',
          tabel: cfg.tabel,
          recordId: null,
          sesudah: { jumlah: n, ids, nilai: aktif },
        });
        return n;
      });
      // AS3 — gudang dinonaktifkan massal: lepas akses per gudang.
      const info: string[] = [];
      if (cfg.kode === 'gudang' && aktif === 0) {
        for (const s of sebelum) {
          if (s.aktif === 0) continue;
          const kode = await ((await get<{ kode: string }>(`SELECT kode FROM warehouses WHERE id = ?`, s.id)))?.kode;
          if (!kode) continue;
          const hilang = await lepasAksesGudang(kode, pengguna.id, `Gudang "${kode}" dinonaktifkan massal dari Master Data`);
          if (hilang > 0) info.push(`${hilang} pengguna kehilangan akses ke ${kode}`);
        }
      }
      res.json({ berhasil, sebelum: { baris: sebelum }, infoAkses: info.length ? info.join('; ') + '.' : undefined });
    }),
  );

  // Urungkan — membalikkan hasil set-aktif massal.
  r.post(
    '/:entitas/massal/urungkan',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const body = (req.body ?? {}) as { baris?: unknown };
      const daftar = Array.isArray(body.baris) ? body.baris : [];
      if (!daftar.length) throw tolak(400, 'Tidak ada perubahan untuk diurungkan.');
      if (daftar.length > 3000) throw tolak(400, 'Terlalu banyak untuk diurungkan sekaligus.');
      const kunciValid = new Set(cfg.kolom.map((k) => k.key));
      const pengguna = penggunaSaatIni(req);
      const n = await withTransaction(async () => {
        let ok = 0;
        const now = new Date().toISOString();
        for (const raw of daftar) {
          const it = (raw ?? {}) as Record<string, unknown>;
          const id = Number(it.id);
          if (!Number.isInteger(id) || !await get(`SELECT id FROM ${cfg.tabel} WHERE id = ?`, id)) continue;
          const set: string[] = [];
          const arg: unknown[] = [];
          for (const k of Object.keys(it)) {
            if (k === 'id' || !kunciValid.has(k)) continue;
            set.push(`${k} = ?`);
            arg.push(it[k]);
          }
          if (!set.length) continue;
          set.push('diubah_pada = ?');
          arg.push(now);
          try {
            await run(`UPDATE ${cfg.tabel} SET ${set.join(', ')} WHERE id = ?`, ...arg, id);
            ok++;
          } catch {
            // Konflik unik saat memulihkan — lewati baris ini.
          }
        }
        await catatAudit({ userId: pengguna.id, aksi: 'urungkan', tabel: cfg.tabel, recordId: null, sesudah: { jumlah: ok } });
        return ok;
      });
      res.json({ berhasil: n });
    }),
  );

  // AX — Hapus massal = sel Hapus (middleware matriks global; 'hapus' di path).
  r.post(
    '/:entitas/massal/hapus',
    asyncHandler(async (req, res) => {
      const cfg = entitasDariUrl(req);
      const ids = bacaIdsMassal(req.body);
      const pengguna = penggunaSaatIni(req);
      const dilewati: { id: number; nama: string; alasan: string }[] = [];
      const okIds: number[] = [];
      const dihapusKode = new Map<number, string>();

      for (const id of ids) {
        const lama = await get<Record<string, unknown>>(`SELECT * FROM ${cfg.tabel} WHERE id = ?`, id);
        if (!lama) continue;
        try {
          await withTransaction(async () => {
            await run(`DELETE FROM ${cfg.tabel} WHERE id = ?`, id);
            await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: cfg.tabel, recordId: id, sebelum: lama });
          });
          okIds.push(id);
          if (cfg.kode === 'gudang') dihapusKode.set(id, String(lama.kode ?? ''));
        } catch (err) {
          const { pesan } = pesanKesalahan(err);
          if (/Data terkait|FOREIGN KEY/i.test(pesan)) {
            dilewati.push({
              id,
              nama: labelBaris(cfg, lama),
              alasan: `${cfg.label} masih dipakai data lain. Nonaktifkan bila tersedia.`,
            });
          } else {
            throw err;
          }
        }
      }
      await catatAudit({
        userId: pengguna.id,
        aksi: 'hapus_massal',
        tabel: cfg.tabel,
        recordId: null,
        sesudah: { jumlah: okIds.length, ids: okIds, dilewati: dilewati.length },
      });
      // AS3 — gudang dihapus massal: lepas akses per kode.
      const info: string[] = [];
      if (cfg.kode === 'gudang') {
        for (const id of okIds) {
          const kode = (dihapusKode.get(id) ?? '').trim();
          if (!kode) continue;
          const hilang = await lepasAksesGudang(kode, pengguna.id, `Gudang "${kode}" dihapus massal dari Master Data`);
          if (hilang > 0) info.push(`${hilang} pengguna kehilangan akses ke ${kode}`);
        }
      }
      res.json({
        berhasil: okIds.length,
        dilewati,
        saran: 'Data yang masih dipakai tidak bisa dihapus — nonaktifkan bila tersedia.',
        infoAkses: info.length ? info.join('; ') + '.' : undefined,
      });
    }),
  );

  return r;
}
