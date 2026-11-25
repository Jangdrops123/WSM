// BAGIAN X5 — API Profil Size (Pengaturan ▸ Aturan Kode / Chatbot).
// Hanya Admin; setiap perubahan tercatat di log aktivitas. Validasi ketat:
// jumlah jatah semua size wajib sama dengan jumlah pasang per kodi.
import { Router, type RequestHandler } from 'express';
import { all, get, getSettings, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { penggunaSaatIni } from '../lib/akses.ts';
import { daftarProfilSize, profilSizeDariId, aturanDariProfil, profilSizeDefault, type ProfilSize } from '../lib/profilSize.ts';

/** AF2 — perubahan klasifikasi hanya untuk Admin & Manajer. */
const BOLEH_KLASIFIKASI = new Set(['owner', 'administrator', 'admin', 'manajer']);
const wajibKlasifikasi: RequestHandler = (req, _res, next) => {
  const peran = String(req.konteks?.peranKunci ?? req.headers['x-peran'] ?? '').toLowerCase().trim();
  if (!BOLEH_KLASIFIKASI.has(peran)) {
    next(tolak(403, 'Klasifikasi barang hanya untuk Admin dan Manajer.'));
    return;
  }
  next();
};

/** Penanda nama kategori/produk → saran profil (HANYA usulan, tidak otomatis). */
const PENANDA: { kata: string[]; kode: string }[] = [
  { kode: 'sandal-wanita', kata: ['sandal wanita', 'sandal wnt', 'sandal cewek'] },
  { kode: 'sandal-pria', kata: ['sandal pria', 'sandal cowok', 'sandal pria'] },
  { kode: 'sepatu-wanita', kata: ['wanita', 'wnt', 'women', 'cewek', 'cwek', 'cwe', 'lady', 'flat', 'flats', 'heels', 'hak tinggi', 'wedges', 'pump'] },
  { kode: 'sepatu-pria', kata: ['pria', 'pri', 'cowok', 'cwo', 'men', 'male', 'safety'] },
  { kode: 'anak', kata: ['anak', 'kids', 'kid', 'balita'] },
];

function kataAda(teks: string, kata: string): boolean {
  const k = kata.trim().toLowerCase();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9]+$/.test(k)) return new RegExp(`\\b${esc}\\b`, 'i').test(teks);
  return teks.includes(k);
}

/** Usulan profil dari kata dalam nama — dikonfirmasi pengguna, tidak diterapkan diam-diam. */
async function usulanProfil(nama: string): Promise<{ id: number; nama: string; kode: string; dasar: string } | null> {
  const teks = String(nama ?? '').toLowerCase();
  if (!teks.trim()) return null;
  const semua = await daftarProfilSize();
  for (const p of semua) {
    const k = p.kata_kunci.find((x) => kataAda(teks, x));
    if (k) return { id: p.id, nama: p.nama, kode: p.kode, dasar: `kata "${k}"` };
  }
  for (const t of PENANDA) {
    const k = t.kata.find((x) => kataAda(teks, x));
    if (!k) continue;
    const p = semua.find((x) => x.kode === t.kode);
    if (p) return { id: p.id, nama: p.nama, kode: p.kode, dasar: `kata "${k}"` };
  }
  return null;
}

/** Kategori cepat AF2: nama → kode profil. */
const KATEGORI_CEPAT: { nama: string; kode: string }[] = [
  { nama: 'Sepatu Pria', kode: 'sepatu-pria' },
  { nama: 'Sepatu Wanita', kode: 'sepatu-wanita' },
  { nama: 'Sandal Pria', kode: 'sandal-pria' },
  { nama: 'Sandal Wanita', kode: 'sandal-wanita' },
];

/** Ringkasan ukuran profil (untuk pratinjau / endpoint hitung). */
async function hitungSebaran(
  profil: ProfilSize | null,
  ops: { kodi_normal: number; kodi_komp: number; pcs: number; db: number | null; tp: number | null },
): Promise<{
  sizes: { size: string; jatah: number; pasang: number }[];
  total_pasang: number;
  sisa_per_kodi: number;
  seimbang: boolean;
  pesan: string[];
}> {
  const aturan = aturanDariProfil(profil) ?? aturanDariProfil(await profilSizeDefault()) ?? { per_kodi: 20, normal: {} as Record<string, number> };
  const ukuran = Object.keys(aturan.normal).sort((a, b) => Number(a) - Number(b));
  const kodiNormal = Number(ops.kodi_normal) || 0;
  const kodiKomp = Number(ops.kodi_komp) || 0;
  const pesan: string[] = [];
  const hasil = new Map<string, number>();
  for (const s of ukuran) hasil.set(s, (aturan.normal[s] ?? 0) * kodiNormal);

  let sisaPerKodi = aturan.per_kodi;
  if (kodiKomp > 0 && ops.db !== null && ops.tp !== null && ops.db !== ops.tp) {
    const komp = new Map(ukuran.map((s) => [s, aturan.normal[s] ?? 0]));
    const pindah = komp.get(String(ops.tp)) ?? 0;
    komp.set(String(ops.db), (komp.get(String(ops.db)) ?? 0) + pindah);
    komp.set(String(ops.tp), 0);
    for (const s of ukuran) hasil.set(s, (hasil.get(s) ?? 0) + (komp.get(s) ?? 0) * kodiKomp);
    sisaPerKodi = ukuran.reduce((n, s) => n + (komp.get(s) ?? 0), 0);
    if (sisaPerKodi !== aturan.per_kodi) {
      pesan.push(`Tp ${ops.tp} menyisakan ${sisaPerKodi} pasang per kodi. Tambahkan Db untuk menyeimbangkan atau ubah Tp.`);
    }
    if (!ukuran.includes(String(ops.db)) || !ukuran.includes(String(ops.tp))) {
      pesan.push(`Size db ${ops.db} / tp ${ops.tp} tidak ada di profil (${ukuran.join(', ')}).`);
    }
  }
  if (ops.pcs > 0) {
    let sisa = ops.pcs;
    let i = 0;
    while (sisa > 0 && i < ukuran.length * Math.ceil(sisa + 1)) {
      const s = ukuran[i % ukuran.length];
      hasil.set(s, (hasil.get(s) ?? 0) + 1);
      sisa -= 1;
      i += 1;
    }
  }
  const sizes = ukuran.map((s) => ({ size: s, jatah: aturan.normal[s] ?? 0, pasang: Math.round((hasil.get(s) ?? 0) * 1000) / 1000 }));
  const totalPasang = Math.round(sizes.reduce((n, s) => n + s.pasang, 0) * 1000) / 1000;
  return { sizes, total_pasang: totalPasang, sisa_per_kodi: sisaPerKodi, seimbang: Math.abs(sisaPerKodi - aturan.per_kodi) < 0.001, pesan };
}

interface SizeInput {
  size: string;
  jatah: number;
}

interface ProfilInput {
  nama: string;
  pasang_per_kodi: number;
  kata_kunci: string[];
  sizes: SizeInput[];
}

/** Baca & validasi body profil (X5.1 — total jatah wajib == pasang/kodi). */
function bacaProfil(body: unknown): ProfilInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const nama = String(b.nama ?? '').trim().slice(0, 60);
  if (!nama) throw tolak(400, 'Nama profil wajib diisi.');
  const pasang = Number(b.pasang_per_kodi);
  if (!Number.isInteger(pasang) || pasang < 1 || pasang > 999) {
    throw tolak(400, 'Jumlah pasang per kodi harus bilangan bulat1–999.');
  }
  const sizesRaw = Array.isArray(b.sizes) ? b.sizes.slice(0, 60) : [];
  const sizes: SizeInput[] = [];
  const pakai = new Set<string>();
  for (const raw of sizesRaw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const size = String(r.size ?? '').trim().slice(0, 20);
    const jatah = Number(r.jatah);
    if (!size) throw tolak(400, 'Setiap baris size wajib terisi.');
    if (pakai.has(size.toLowerCase())) throw tolak(409, `Size "${size}" kembar dalam profil.`);
    pakai.add(size.toLowerCase());
    if (!Number.isInteger(jatah) || jatah < 0 || jatah > pasang) {
      throw tolak(400, `Jatah size "${size}" harus bilangan bulat0–${pasang}.`);
    }
    sizes.push({ size, jatah });
  }
  if (sizes.length === 0) throw tolak(400, 'Profil minimal berisi satu size.');
  const total = sizes.reduce((a, s) => a + s.jatah, 0);
  if (total !== pasang) {
    throw tolak(400, `Total jatah semua size (${total}) harus sama dengan jumlah pasang per kodi (${pasang}). Selisih: ${total - pasang}.`);
  }
  const kata = Array.isArray(b.kata_kunci)
    ? (b.kata_kunci as unknown[]).map((k) => String(k).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 20)
    : [];
  return { nama, pasang_per_kodi: pasang, kata_kunci: kata, sizes };
}

/** Simpan ukuran profil + kata kunci di dalam transaksi. */
async function simpanIsi(id: number, p: ProfilInput): Promise<void> {
  await run(`DELETE FROM size_profile_sizes WHERE profile_id = ?`, id);
  for (const [i, s] of p.sizes.entries()) {
    await run(`INSERT INTO size_profile_sizes (profile_id, size, jatah, urutan) VALUES (?, ?, ?, ?)`, id, s.size, s.jatah, i);
  }
  await run(
    `UPDATE size_profiles SET nama = ?, pasang_per_kodi = ?, kata_kunci = ?, diubah_pada = now() WHERE id = ?`,
    p.nama,
    p.pasang_per_kodi,
    JSON.stringify(p.kata_kunci),
    id,
  );
}

const profilAtau404 = async (id: number): Promise<ProfilSize> => {
  const p = await profilSizeDariId(id);
  if (!p) throw tolak(404, 'Profil size tidak ditemukan.');
  return p;
};

export function routerProfilSize(): Router {
  const r = Router();

  /** Daftar profil lengkap (untuk halaman Aturan Kode) — `default` = profil default saat ini. */
  r.get('/', async (_req, res) => {
    const daftar = await daftarProfilSize();
    const def = await ((await getSettings()))['size_profile_default'] ?? daftar.find((p) => p.bawaan)?.kode ?? '';
    res.json({ data: daftar.map((p) => ({ ...p, default: p.kode === def })) });
  });

  /** Opsi ringkas (id + nama) untuk dropdown Master/Impor. */
  r.get('/opsi', async (_req, res) => {
    res.json({ data: (await daftarProfilSize()).map((p) => ({ id: p.id, label: p.nama })) });
  });

  // =========================================================================
  // AF2 — KLASIFIKASI BARANG PRIA/WANITA LEWAT KATEGORI
  // =========================================================================

  /**
   * Data klasifikasi: profil + jumlah, daftar kategori/produk yang belum punya
   * profil (dengan USULAN dari kata nama — harus dikonfirmasi pengguna), dan
   * laporan ringkas (AF6).
   */
  r.get(
    '/klasifikasi',
    asyncHandler(async (_req, res) => {
      const profil = await Promise.all((await daftarProfilSize()).map(async (p) => ({
        id: p.id,
        kode: p.kode,
        nama: p.nama,
        pasang_per_kodi: p.pasang_per_kodi,
        sizes: p.sizes,
        jumlah_kategori: Number(
          await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM categories WHERE size_profile_id = ?`, p.id)))?.n ?? 0,
        ),
        jumlah_produk: Number(
          await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE size_profile_id = ? AND deleted_at IS NULL`, p.id)))?.n ?? 0,
        ),
      })));

      const kategori = await await Promise.all((await all<{
        id: number;
        nama: string;
        size_profile_id: number | null;
        jumlah_produk: number;
        profil_nama: string | null;
      }>(
        `SELECT c.id, c.nama, c.size_profile_id, sp.nama AS profil_nama,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS jumlah_produk
           FROM categories c LEFT JOIN size_profiles sp ON sp.id = c.size_profile_id
          ORDER BY c.nama`,
      )).map(async (k) => {
        const usulan = k.size_profile_id ? null : await usulanProfil(k.nama);
        return {
          id: Number(k.id),
          nama: k.nama,
          profil_id: k.size_profile_id === null ? null : Number(k.size_profile_id),
          profil_nama: k.profil_nama,
          jumlah_produk: Number(k.jumlah_produk ?? 0),
          usulan,
        };
      }));

      const belumProduk = await await Promise.all((await all<{
        id: number;
        nama: string;
        kategori: string | null;
        kategori_profil: number | null;
        size_profile_id: number | null;
      }>(
        `SELECT p.id, p.nama, c.nama AS kategori, c.size_profile_id AS kategori_profil, p.size_profile_id
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.deleted_at IS NULL AND p.size_profile_id IS NULL
            AND (c.id IS NULL OR c.size_profile_id IS NULL)
          ORDER BY p.nama LIMIT 300`,
      )).map(async (p) => ({
        id: Number(p.id),
        nama: p.nama,
        kategori: p.kategori,
        usulan: p.kategori ? null : await usulanProfil(p.nama),
      })));

      // AF6 — laporan ringkas di Pengaturan.
      const ringkasan = {
        produk_per_profil: profil.map((p) => ({ nama: p.nama, jumlah: p.jumlah_produk })),
        kategori_tanpa_profil: kategori.filter((k) => k.profil_id === null).length,
        produk_tanpa_profil: Number(
          await ((await get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id
              WHERE p.deleted_at IS NULL AND p.size_profile_id IS NULL AND (c.id IS NULL OR c.size_profile_id IS NULL)`,
          )))?.n ?? 0,
        ),
        // Produk yang pernah dikoreksi = mempunyai override profil sendiri.
        produk_dikoreksi: Number(
          await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND size_profile_id IS NOT NULL`)))?.n ?? 0,
        ),
      };

      res.json({ profil, kategori, belum_produk: belumProduk, ringkasan });
    }),
  );

  /**
   * Buat kategori cepat (AF2): Sepatu Pria/Wanita + Sandal Pria/Wanita —
   * langsung terhubung ke profilnya. Kategori yang sudah ada tidak diduplikat.
   */
  r.post(
    '/kategori-cepat',
    wajibKlasifikasi,
    asyncHandler(async (req, res) => {
      const pengguna = penggunaSaatIni(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const minta = Array.isArray(body.daftar) && body.daftar.length
        ? (body.daftar as unknown[]).map((s) => String(s)).slice(0, 20)
        : KATEGORI_CEPAT.map((k) => k.nama);
      const dibuat: { nama: string; profil: string }[] = [];
      const terpasang: { nama: string; profil: string }[] = [];
      const dilewat: string[] = [];
      await withTransaction(async () => {
        for (const nama of minta) {
          const rencana = KATEGORI_CEPAT.find((k) => k.nama.toLowerCase() === nama.toLowerCase());
          const profil = rencana
            ? (await daftarProfilSize()).find((p) => p.kode === rencana.kode)
            : await usulanProfil(nama);
          if (!profil) {
            dilewat.push(nama);
            continue;
          }
          const ada = await get<{ id: number; size_profile_id: number | null }>(
            `SELECT id, size_profile_id FROM categories WHERE nama ILIKE ?`,
            nama,
          );
          if (ada) {
            if (ada.size_profile_id === null) {
              await run(`UPDATE categories SET size_profile_id = ?, diubah_pada = now() WHERE id = ?`, profil.id, ada.id);
              await catatAudit({
                userId: pengguna.id,
                aksi: 'ubah',
                tabel: 'categories',
                recordId: Number(ada.id),
                sebelum: { size_profile_id: null },
                sesudah: { size_profile_id: profil.id },
              });
              terpasang.push({ nama, profil: profil.nama });
            } else {
              dilewat.push(`${nama} (sudah memakai profil)`);
            }
            continue;
          }
          const idBaru = Number(
            await ((await run(`INSERT INTO categories (nama, size_profile_id, dibuat_oleh) VALUES (?, ?, ?)`, nama, profil.id, pengguna.id)))
              .lastInsertRowid,
          );
          await catatAudit({
            userId: pengguna.id,
            aksi: 'tambah',
            tabel: 'categories',
            recordId: idBaru,
            sesudah: { nama, size_profile_id: profil.id },
          });
          dibuat.push({ nama, profil: profil.nama });
        }
      });
      res.status(201).json({ dibuat, terpasang, dilewat });
    }),
  );

  /**
   * Simpan koreksi pengguna (AF6): override profil produk / profil kategori —
   * pesan berikutnya otomatis benar. `profil_id: null` = kembali ikut resolusi.
   */
  r.post(
    '/koreksi',
    wajibKlasifikasi,
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const tipe = String(b.tipe ?? '');
      const id = Number(b.id);
      const profilId = b.profil_id === null || b.profil_id === undefined || b.profil_id === '' ? null : Number(b.profil_id);
      if (!['produk', 'kategori'].includes(tipe)) throw tolak(400, 'Tipe koreksi tidak dikenal (produk/kategori).');
      if (!Number.isInteger(id) || id <= 0) throw tolak(400, 'Id data tidak valid.');
      if (profilId !== null && (!Number.isInteger(profilId) || !await profilSizeDariId(profilId))) {
        throw tolak(400, 'Profil size tidak ditemukan.');
      }
      const tabel = tipe === 'produk' ? 'products' : 'categories';
      const lama = await get<Record<string, unknown>>(`SELECT id, size_profile_id FROM ${tabel} WHERE id = ?`, id);
      if (!lama) throw tolak(404, `${tipe === 'produk' ? 'Produk' : 'Kategori'} tidak ditemukan.`);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(
          `UPDATE ${tabel} SET size_profile_id = ?, diubah_pada = now() WHERE id = ?`,
          profilId,
          id,
        );
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel,
          recordId: id,
          sebelum: { size_profile_id: lama.size_profile_id ?? null },
          sesudah: { size_profile_id: profilId },
        });
      });
      // AF6 — laporan: berapa produk yang ikut kategori ini (dipengaruhi koreksi kategori).
      const terdampak =
        tipe === 'kategori'
          ? Number(await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND size_profile_id IS NULL AND deleted_at IS NULL`, id)))?.n ?? 0)
          : 0;
      res.json({ ok: true, tipe, id, profil_id: profilId, terdampak });
    }),
  );

  /**
   * Jumlah produk yang IKUT kategori (tanpa override) — dipakai dialog
   * konfirmasi saat profil kategori diubah (AF2).
   */
  r.get(
    '/terdampak',
    asyncHandler(async (req, res) => {
      const kategoriId = Number(req.query.kategori_id);
      if (!Number.isInteger(kategoriId) || kategoriId <= 0) throw tolak(400, 'kategori_id wajib diisi.');
      const ikut = Number(
        await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND size_profile_id IS NULL AND deleted_at IS NULL`, kategoriId)))?.n ?? 0,
      );
      const dioverride = Number(
        await ((await get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND size_profile_id IS NOT NULL AND deleted_at IS NULL`, kategoriId)))?.n ?? 0,
      );
      res.json({ ikut, dioverride });
    }),
  );

  /**
   * Hitung ulang rincian size SATU baris pratinjau (AF3/AF4) setelah pengguna
   * mengganti profil / Db / Tp — rumus yang sama dengan parser.
   */
  r.post(
    '/hitung',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const profilId = b.profil_id === null || b.profil_id === undefined || b.profil_id === '' ? null : Number(b.profil_id);
      const profil = profilId ? await profilSizeDariId(profilId) : await profilSizeDefault();
      if (profilId && !profil) throw tolak(404, 'Profil size tidak ditemukan.');
      const hasil = await hitungSebaran(profil, {
        kodi_normal: Number(b.kodi_normal ?? 0) || 0,
        kodi_komp: Number(b.kodi_komp ?? 0) || 0,
        pcs: Number(b.pcs ?? 0) || 0,
        db: b.db === null || b.db === undefined || b.db === '' ? null : Number(b.db),
        tp: b.tp === null || b.tp === undefined || b.tp === '' ? null : Number(b.tp),
      });
      res.json({
        profil: profil ? { id: profil.id, kode: profil.kode, nama: profil.nama, sizes: profil.sizes } : null,
        ...hasil,
        total_kodi: Math.round((hasil.total_pasang / (profil?.pasang_per_kodi ?? 20)) * 1000) / 1000,
      });
    }),
  );

  r.get('/:id', async (req, res) => {
    res.json(await profilAtau404(Number(req.params.id)));
  });

  /** Kategori/merek yang memakai profil ini (X5.2 — penetapan di editor). */
  r.get('/:id/penetapan', async (req, res) => {
    const id = (await profilAtau404(Number(req.params.id))).id;
    const kategori_ids = await (await all<{ id: number }>(`SELECT id FROM categories WHERE size_profile_id = ? ORDER BY nama`, id)).map((x) => Number(x.id));
    const merek_ids = await (await all<{ id: number }>(`SELECT id FROM brands WHERE size_profile_id = ? ORDER BY nama`, id)).map((x) => Number(x.id));
    res.json({ kategori_ids, merek_ids });
  });

  /**
   * Tetapkan profil ke kategori/merek terpilih (X5.2): yang terpilih menunjuk profil
   * ini, yang tidak lagi terpilih dan menunjuk profil ini dilepas (→ resolusi otomatis).
   */
  r.put(
    '/:id/terapkan',
    asyncHandler(async (req, res) => {
      const id = (await profilAtau404(Number(req.params.id))).id;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const amb = (k: string): number[] =>
        Array.isArray(b[k])
          ? [...new Set((b[k] as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500)
          : [];
      const kategoriIds = amb('kategori_ids');
      const merekIds = amb('merek_ids');
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        // Sebelum: penetapan lama (diurutkan agar diff audit stabil).
        const sebelumKat = await (await all<{ id: number }>(`SELECT id FROM categories WHERE size_profile_id = ? ORDER BY id`, id)).map((x) => Number(x.id));
        const sebelumMerek = await (await all<{ id: number }>(`SELECT id FROM brands WHERE size_profile_id = ? ORDER BY id`, id)).map((x) => Number(x.id));
        for (const [tabel, ids] of [['categories', kategoriIds], ['brands', merekIds]] as const) {
          const kecuali = ids.length ? ids.map(() => '?').join(',') : '-1';
          await run(`UPDATE ${tabel} SET size_profile_id = NULL WHERE size_profile_id = ? AND id NOT IN (${kecuali})`, id, ...ids);
          for (const gid of ids) await run(`UPDATE ${tabel} SET size_profile_id = ? WHERE id = ?`, id, gid);
        }
        await catatAudit({
          userId: pengguna.id,
          aksi: 'ubah',
          tabel: 'size_profiles',
          recordId: id,
          sebelum: { kategori_ids: sebelumKat, merek_ids: sebelumMerek },
          sesudah: {
            kategori_ids: [...kategoriIds].sort((a, b) => a - b),
            merek_ids: [...merekIds].sort((a, b) => a - b),
          },
        });
      });
      res.json({ ok: true, kategori_ids: kategoriIds, merek_ids: merekIds });
    }),
  );

  /** Profil baru (X5.1 — "+ Profil"). */
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const p = bacaProfil(req.body);
      const pengguna = penggunaSaatIni(req);
      const kode = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const id = await withTransaction(async () => {
        const baru = Number(
          await ((await run(`INSERT INTO size_profiles (kode, nama, pasang_per_kodi, kata_kunci) VALUES (?, ?, ?, ?)`,
            kode, p.nama, p.pasang_per_kodi, JSON.stringify(p.kata_kunci)))).lastInsertRowid,
        );
        await simpanIsi(baru, p);
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'size_profiles', recordId: baru, sesudah: p });
        return baru;
      });
      res.status(201).json(await profilAtau404(id));
    }),
  );

  /** Perbarui profil (X5.1 — validasi total jatah serupa dilayani bacaProfil). */
  r.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await profilAtau404(id);
      const p = bacaProfil(req.body);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await simpanIsi(id, p);
        await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'size_profiles', recordId: id, sebelum: lama, sesudah: p });
      });
      res.json(await profilAtau404(id));
    }),
  );

  /** Duplikat profil (X5.1). */
  r.post(
    '/:id/duplikat',
    asyncHandler(async (req, res) => {
      const sumber = await profilAtau404(Number(req.params.id));
      const pengguna = penggunaSaatIni(req);
      const kode = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const id = await withTransaction(async () => {
        const baru = Number(
          await ((await run(`INSERT INTO size_profiles (kode, nama, pasang_per_kodi, kata_kunci) VALUES (?, ?, ?, ?)`,
            kode, `${sumber.nama} (salinan)`, sumber.pasang_per_kodi, JSON.stringify(sumber.kata_kunci)))).lastInsertRowid,
        );
        await simpanIsi(baru, {
          nama: `${sumber.nama} (salinan)`,
          pasang_per_kodi: sumber.pasang_per_kodi,
          kata_kunci: sumber.kata_kunci,
          sizes: sumber.sizes,
        });
        await catatAudit({ userId: pengguna.id, aksi: 'tambah', tabel: 'size_profiles', recordId: baru, sebelum: { disalin_dari: sumber.id } });
        return baru;
      });
      res.status(201).json(await profilAtau404(id));
    }),
  );

  /**
   * Bagi rata (X5.1): total pasang per kodi dibagi merata ke semua size;
   * sisa pembagian diberikan ke size di tengah daftar dan dikembalikan sebagai
   * peringatan agar pengguna memutuskan sendiri.
   */
  r.post(
    '/:id/bagi-rata',
    asyncHandler(async (req, res) => {
      const p = await profilAtau404(Number(req.params.id));
      const total = Number((req.body as Record<string, unknown>)?.pasang_per_kodi ?? p.pasang_per_kodi);
      if (!Number.isInteger(total) || total < 1 || total > 999) {
        throw tolak(400, 'Jumlah pasang per kodi tidak valid.');
      }
      const n = p.sizes.length;
      const dasar = Math.floor(total / n);
      const sisa = total - dasar * n;
      const sizes = p.sizes.map((s) => ({ size: s.size, jatah: dasar }));
      // Sisa dibagi ke size tengah (bukan size pertama/terakhir bila memungkinkan).
      for (let k = 0; k < sisa; k++) {
        const i = n >= 3 ? Math.floor(n / 2) - (sisa - 1) / 2 + k : k % n;
        const idx = Math.min(n - 1, Math.max(0, Math.round(i)));
        sizes[idx].jatah += 1;
      }
      const peringatan = sisa > 0
        ? `${total} tidak habis dibagi ${n} size — dasar ${dasar}, sisa ${sisa} diberikan ke size di tengah. Periksa sebelum menyimpan.`
        : null;
      res.json({ sizes, pasang_per_kodi: total, peringatan });
    }),
  );

  /** Tetapkan profil default (pilihan Pengaturan — X5.2 butir4). */
  r.put(
    '/:id/default',
    asyncHandler(async (req, res) => {
      const p = await profilAtau404(Number(req.params.id));
      const pengguna = penggunaSaatIni(req);
      const lama = await ((await get<{ nilai: string }>(`SELECT nilai FROM settings WHERE kunci = 'size_profile_default'`)))?.nilai ?? '';
      await run(
        `INSERT INTO settings (kunci, nilai, diubah_pada) VALUES ('size_profile_default', ?, now())
         ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_pada = excluded.diubah_pada`,
        p.kode,
      );
      await catatAudit({ userId: pengguna.id, aksi: 'ubah', tabel: 'settings', recordId: 'size_profile_default', sebelum: { kode: lama }, sesudah: { kode: p.kode } });
      res.json({ ok: true, default: p.kode });
    }),
  );

  /** Hapus profil (X5.1) — produk/kategori terkait kembali ke resolusi otomatis. */
  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const lama = await profilAtau404(id);
      const pengguna = penggunaSaatIni(req);
      await withTransaction(async () => {
        await run(`UPDATE products SET size_profile_id = NULL WHERE size_profile_id = ?`, id);
        await run(`UPDATE categories SET size_profile_id = NULL WHERE size_profile_id = ?`, id);
        await run(`UPDATE brands SET size_profile_id = NULL WHERE size_profile_id = ?`, id);
        await run(`DELETE FROM size_profiles WHERE id = ?`, id);
        await catatAudit({ userId: pengguna.id, aksi: 'hapus', tabel: 'size_profiles', recordId: id, sebelum: lama });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
