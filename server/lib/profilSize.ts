// BAGIAN X5 — Profil Size: model + resolusi untuk Master Data.
// Prioritas resolusi (X5.2): produk > kategori/merek > kata kunci > profil
// default (settings size_profile_default).
import { all, get, getSettings } from '../db.pg.ts';

/** Aturan kodi lama: jumlah pasang per kodi + peta size → jatah. */
interface AturanKodi {
  per_kodi: number;
  normal: Record<string, number>;
}

export interface ProfilSize {
  id: number;
  kode: string;
  nama: string;
  pasang_per_kodi: number;
  kata_kunci: string[];
  bawaan: boolean;
  /** Urut sesuai kolom urutan; size unik per profil. */
  sizes: { size: string; jatah: number }[];
}

interface BarisProfil {
  id: number;
  kode: string;
  nama: string;
  pasang_per_kodi: number;
  kata_kunci: string;
  bawaan: number;
}

async function rakit(rows: BarisProfil[]): Promise<ProfilSize[]> {
  if (!rows.length) return [];
  const sizes = await all<{ profile_id: number; size: string; jatah: number }>(
    `SELECT profile_id, size, jatah FROM size_profile_sizes
      WHERE profile_id IN (${rows.map(() => '?').join(',')}) ORDER BY profile_id, urutan, size`,
    ...rows.map((r) => r.id),
  );
  const peta = new Map<number, { size: string; jatah: number }[]>();
  for (const s of sizes) {
    const arr = peta.get(Number(s.profile_id)) ?? [];
    arr.push({ size: s.size, jatah: Number(s.jatah) });
    peta.set(Number(s.profile_id), arr);
  }
  return rows.map((r) => {
    let kata_kunci: string[] = [];
    try {
      const j = JSON.parse(r.kata_kunci || '[]');
      if (Array.isArray(j)) kata_kunci = j.filter((x): x is string => typeof x === 'string');
    } catch {
      /* JSON rusak → tanpa kata kunci */
    }
    return {
      id: Number(r.id),
      kode: r.kode,
      nama: r.nama,
      pasang_per_kodi: Number(r.pasang_per_kodi),
      kata_kunci,
      bawaan: r.bawaan === 1,
      sizes: peta.get(Number(r.id)) ?? [],
    };
  });
}

/** Semua profil (untuk halaman pengaturan & API). */
export async function daftarProfilSize(): Promise<ProfilSize[]> {
  return rakit((await all<BarisProfil>(`SELECT id, kode, nama, pasang_per_kodi, kata_kunci, bawaan FROM size_profiles ORDER BY id`)));
}

export async function profilSizeDariId(id: number | null | undefined): Promise<ProfilSize | null> {
  if (!id) return null;
  return (await rakit((await all<BarisProfil>(`SELECT id, kode, nama, pasang_per_kodi, kata_kunci, bawaan FROM size_profiles WHERE id = ?`, id))))[0] ?? null;
}

export async function profilSizeDariKode(kode: string): Promise<ProfilSize | null> {
  return (await rakit((await all<BarisProfil>(`SELECT id, kode, nama, pasang_per_kodi, kata_kunci, bawaan FROM size_profiles WHERE kode = ?`, kode))))[0] ?? null;
}

/** Profil default (settings size_profile_default → profil ber-flag bawaan pertama). */
export async function profilSizeDefault(): Promise<ProfilSize | null> {
  const kode = await ((await getSettings()))['size_profile_default'] ?? '';
  if (kode) {
    const p = await profilSizeDariKode(kode);
    if (p) return p;
  }
  const bawaan = await get<{ id: number }>(`SELECT id FROM size_profiles WHERE bawaan = TRUE ORDER BY id LIMIT 1`);
  if (bawaan) return profilSizeDariId(Number(bawaan.id));
  const pertama = await get<{ id: number }>(`SELECT id FROM size_profiles ORDER BY id LIMIT 1`);
  return pertama ? profilSizeDariId(Number(pertama.id)) : null;
}

/** Adapter ke model aturan lama parser (per_kodi + peta size→jatah). */
export function aturanDariProfil(p: ProfilSize | null): AturanKodi | null {
  if (!p || p.sizes.length === 0) return null;
  const normal: Record<string, number> = {};
  for (const s of p.sizes) normal[s.size] = s.jatah;
  return { per_kodi: p.pasang_per_kodi, normal };
}

export type AsalProfil = 'produk' | 'kategori' | 'kata' | 'size' | 'default' | 'manual' | null;

export interface HasilResolusi {
  profil: ProfilSize | null;
  dari: AsalProfil;
  /**
   * AF1.6 — true bila tidak ada petunjuk tegas (produk/kategori/kata/size):
   * profil default tetap dipakai untuk menghitung, TETAPI pratinjau wajib
   * bertanya ke pengguna (jangan menebak diam-diam).
   */
  ragu: boolean;
  /** Saran profil dari petunjuk size eksklusif (mis. "db 37" → Wanita). */
  saran: ProfilSize | null;
  /** Size yang membuat ragu (ada di dua profil atau tidak ada di mana pun). */
  ukuranRagu: string[];
}

/** Kata kunci dicocokkan sebagai kata utuh ("pria" tidak cocok di "priawati"). */
function adaKata(teks: string, kata: string): boolean {
  const k = kata.trim().toLowerCase();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9]+$/.test(k)) return new RegExp(`\\b${esc}\\b`, 'i').test(teks);
  return teks.includes(k);
}

/**
 * Profil LAIN (`kecuali`) yang seharusnya memuat sebuah size — untuk pesan
 * "Size 37 tidak ada di profil Pria … Barang ini termasuk Wanita?" (AF5).
 * Dihitung per kelompok: 37 ada di Sepatu-Wanita & Sandal-Wanita → satu
 * kelompok "wanita" → tawarkan profil utamanya.
 */
export async  function profilUntukSize(size: string | null | undefined, kecuali?: ProfilSize | null): Promise<ProfilSize | null> {
  const u = String(size ?? '').trim().toLowerCase();
  if (!u) return null;
  const semua = (await daftarProfilSize()).filter((p) => p.id !== (kecuali?.id ?? -1));
  const punya = semua.filter((p) => p.sizes.some((s) => s.size.trim().toLowerCase() === u));
  const grup = new Set(punya.map(grupProfil));
  if (grup.size !== 1) return null;
  const g = [...grup][0];
  if (kecuali && grupProfil(kecuali) === g) return null; // masih kelompok yang sama → tidak ditawar
  return profilUtamaGrup(punya.filter((p) => grupProfil(p) === g));
}

/**
 * Kelompok profil (AF2 — kartu Pria / Wanita / Anak / kustom): Sandal Pria
 * ikut kelompok Pria sehingga size 43 (ada di Sepatu & Sandal Pria) tetap
 * dianggap "hanya Pria", dan size 39/40 (Pria + Wanita) tetap ambigu.
 */
export function grupProfil(p: ProfilSize): string {
  const t = `${p.kode} ${p.nama}`.toLowerCase();
  if (t.includes('wanita') || t.includes('women') || t.includes('cewek') || t.includes('cwe')) return 'wanita';
  if (t.includes('pria') || t.includes('cowok') || t.includes('cwo')) return 'pria';
  if (t.includes('anak') || t.includes('kid')) return 'anak';
  return p.kode;
}

/** Profil utama sebuah kelompok (sepatu- dulu, lalu bawaan, lalu id terkecil). */
function profilUtamaGrup(list: ProfilSize[]): ProfilSize {
  return [...list].sort(
    (a, b) =>
      Number(b.kode.startsWith('sepatu-')) - Number(a.kode.startsWith('sepatu-')) ||
      Number(b.bawaan) - Number(a.bawaan) ||
      a.id - b.id,
  )[0];
}

/**
 * Nama pendek untuk pesan (AF5 memakai gaya "profil Pria (39-43)",
 * "Barang ini termasuk Wanita?") — "Sepatu Pria"/"Sandal Pria" → "Pria".
 */
export function labelProfil(p: ProfilSize): string {
  const g = grupProfil(p);
  const t = p.nama.toLowerCase();
  if (g === 'wanita' && t.includes('wanita')) return 'Wanita';
  if (g === 'pria' && t.includes('pria')) return 'Pria';
  if (g === 'anak' && t.includes('anak')) return 'Anak';
  return p.nama;
}

/** Daftar size → "39-43" bila berurutan, selain itu "37, 38, …". */
export function rentangSize(sizes: { size: string }[]): string {
  const angka = sizes.map((s) => s.size.trim());
  const semuaAngka = angka.length > 1 && angka.every((s) => /^\d+$/.test(s));
  if (semuaAngka) {
    const urut = [...angka].map(Number).sort((a, b) => a - b);
    const rapat = urut.every((n, i) => i === 0 || n === urut[i - 1] + 1);
    if (rapat) return `${urut[0]}-${urut[urut.length - 1]}`;
  }
  return angka.join(', ');
}

/**
 * Resolusi profil untuk SATU baris chat — urutan AF1:
 * (1) override pada produk, (2) profil pada kategori/merek produk,
 * (3) kata penanda di teks baris, (4) petunjuk size pada Db/Tp,
 * (5) profil default pengaturan, (6) bila masih ragu → tanyakan di pratinjau.
 */
export async function resolusiProfilSize(ops: {
  produkId?: number | null;
  kategoriId?: number | null;
  merekId?: number | null;
  teks?: string;
  /** Size dari Db/Tp (dan size eksplisit) — petunjuk tahap 4. */
  sizes?: (string | number | null | undefined)[];
}): Promise<HasilResolusi> {
  const ragu = (profil: ProfilSize | null, dari: AsalProfil, saran: ProfilSize | null = null, ukuranRagu: string[] = []): HasilResolusi => ({
    profil,
    dari,
    ragu: dari === 'default' || dari === null,
    saran,
    ukuranRagu,
  });

  // (1) override pada produk → (2) profil kategori/merek produk
  if (ops.produkId) {
    const p = await profilSizeDariId(
      await ((await get<{ size_profile_id: number | null }>(`SELECT size_profile_id FROM products WHERE id = ?`, ops.produkId)))?.size_profile_id ?? null,
    );
    if (p) return ragu(p, 'produk');
    const r = await get<{ category_id: number | null; brand_id: number | null }>(
      `SELECT category_id, brand_id FROM products WHERE id = ?`,
      ops.produkId,
    );
    const dariMerek = r?.brand_id
      ? await profilSizeDariId(await ((await get<{ size_profile_id: number | null }>(`SELECT size_profile_id FROM brands WHERE id = ?`, r.brand_id)))?.size_profile_id ?? null)
      : null;
    if (dariMerek) return ragu(dariMerek, 'kategori');
    const dariKategori = r?.category_id
      ? await profilSizeDariId(await ((await get<{ size_profile_id: number | null }>(`SELECT size_profile_id FROM categories WHERE id = ?`, r.category_id)))?.size_profile_id ?? null)
      : null;
    if (dariKategori) return ragu(dariKategori, 'kategori');
  }
  // (2b) penetapan langsung (bila dipanggil tanpa produk)
  if (ops.kategoriId) {
    const p = await profilSizeDariId(await ((await get<{ size_profile_id: number | null }>(`SELECT size_profile_id FROM categories WHERE id = ?`, ops.kategoriId)))?.size_profile_id ?? null);
    if (p) return ragu(p, 'kategori');
  }
  if (ops.merekId) {
    const p = await profilSizeDariId(await ((await get<{ size_profile_id: number | null }>(`SELECT size_profile_id FROM brands WHERE id = ?`, ops.merekId)))?.size_profile_id ?? null);
    if (p) return ragu(p, 'kategori');
  }

  // (3) kata penanda di teks baris (urutan daftar profil: yang pertama menang).
  const teks = (ops.teks ?? '').toLowerCase();
  const semua = await daftarProfilSize();
  if (teks.trim()) {
    for (const p of semua) {
      if (p.kata_kunci.some((k) => adaKata(teks, k))) return ragu(p, 'kata');
    }
  }

  // (4) petunjuk size pada Db/Tp — size yang hanya ada di SATU kelompok profil
  //     (37 → Wanita; 43 → Pria; 39/40 ada di keduanya → TIDAK dipakai menebak).
  const ukuran = [...new Set((ops.sizes ?? []).map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean))];
  if (ukuran.length) {
    const grupPerUkuran = ukuran.map((u) => {
      const punya = semua.filter((p) => p.sizes.some((s) => s.size.trim().toLowerCase() === u));
      return { punya, grup: new Set(punya.map(grupProfil)) };
    });
    const setuju = [...new Set(grupPerUkuran.filter((x) => x.grup.size === 1).flatMap((x) => [...x.grup]))];
    const ambigu = ukuran.filter((_, i) => grupPerUkuran[i].grup.size > 1);
    if (setuju.length === 1) {
      const p = profilUtamaGrup(semua.filter((x) => grupProfil(x) === setuju[0]));
      if (p) return ragu(p, 'size', p);
    }
    // Lebih dari satu kelompok yang setuju ATAU size ambigu/tidak dikenal → ragu.
    return ragu(await profilSizeDefault(), 'default', null, ambigu.length ? ambigu : ukuran);
  }

  // (5) profil default — (6) masih ragu → pratinjau wajib bertanya.
  const def = await profilSizeDefault();
  return ragu(def, def ? 'default' : null);
}
